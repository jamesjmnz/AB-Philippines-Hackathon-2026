import type { DomainErrorCode } from './errors';
import { DomainEventSchema, EventBatchSchema, type DomainEvent, type EventBatch } from './events';
import type { SyncCursor } from './outbox';
import { replay } from './reducer';
import type { IncidentState } from './state';

/**
 * Merging events received from another device. Pure: it decides what to store and what to
 * quarantine, and reports the outcome; the repository does the writing.
 */

export type RemoteRejectionStage = 'batch' | 'schema' | 'incident_mismatch' | 'signature' | 'policy';

export interface RejectedRemoteEvent {
  eventId: string | null;
  stage: RemoteRejectionStage;
  /** Set for `policy` rejections: why the reducer refused the event. */
  code: DomainErrorCode | null;
  /**
   * `policy` rejections are well-formed, so they are kept in the ledger (never applied) so that
   * every device replays the same set. All other rejections are quarantined and never stored in the ledger.
   */
  storedInLedger: boolean;
  raw: unknown;
}

export interface MergeResult {
  incidentId: string | null;
  /** New events the reducer applied. */
  applied: DomainEvent[];
  /** Ids already in the ledger, or repeated inside the batch. */
  duplicates: string[];
  rejected: RejectedRemoteEvent[];
  /** Events to append to the ledger: `applied` plus policy-rejected events. */
  toStore: DomainEvent[];
  /** State after the merge. Null when the batch itself was malformed. */
  state: IncidentState | null;
}

export interface MergeOptions {
  /** Signature check supplied by the crypto layer. Events it refuses are quarantined. */
  verifySignature?: (event: DomainEvent) => boolean;
}

function idOf(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null || !('id' in raw)) return null;
  const id: unknown = raw.id;
  return typeof id === 'string' && id.length > 0 && id.length <= 128 ? id : null;
}

export function mergeRemoteEvents(
  localEvents: readonly DomainEvent[],
  batch: unknown,
  options: MergeOptions = {},
): MergeResult {
  const parsedBatch = EventBatchSchema.safeParse(batch);
  if (!parsedBatch.success) {
    return {
      incidentId: null,
      applied: [],
      duplicates: [],
      rejected: [{ eventId: null, stage: 'batch', code: null, storedInLedger: false, raw: batch }],
      toStore: [],
      state: null,
    };
  }
  const { incidentId, events } = parsedBatch.data;
  const local = localEvents.filter((e) => e.incidentId === incidentId);
  const known = new Set(local.map((e) => e.id));
  const duplicates: string[] = [];
  const rejected: RejectedRemoteEvent[] = [];
  const fresh: DomainEvent[] = [];

  for (const raw of events) {
    const parsed = DomainEventSchema.safeParse(raw);
    if (!parsed.success) {
      rejected.push({ eventId: idOf(raw), stage: 'schema', code: 'invalid_event', storedInLedger: false, raw });
      continue;
    }
    const event = parsed.data;
    if (event.incidentId !== incidentId) {
      rejected.push({ eventId: event.id, stage: 'incident_mismatch', code: null, storedInLedger: false, raw });
      continue;
    }
    if (known.has(event.id)) {
      duplicates.push(event.id);
      continue;
    }
    if (options.verifySignature && !options.verifySignature(event)) {
      rejected.push({ eventId: event.id, stage: 'signature', code: null, storedInLedger: false, raw });
      continue;
    }
    known.add(event.id);
    fresh.push(event);
  }

  const state = replay(incidentId, [...local, ...fresh]);
  const refused = new Map(state.notApplied.map((n) => [n.eventId, n.code]));
  const applied: DomainEvent[] = [];
  for (const event of fresh) {
    const code = refused.get(event.id);
    if (code === undefined) {
      applied.push(event);
    } else {
      rejected.push({ eventId: event.id, stage: 'policy', code, storedInLedger: true, raw: event });
    }
  }
  return { incidentId, applied, duplicates, rejected, toStore: fresh, state };
}

/** Events the peer is not known to hold, in replay order. */
export function eventsAfterCursor(events: readonly DomainEvent[], cursor: SyncCursor | null): DomainEvent[] {
  if (!cursor) return [...events];
  return events.filter(
    (e) => e.incidentId === cursor.incidentId && e.clock.seq > (cursor.seqByDevice[e.actor.deviceId] ?? 0),
  );
}

/**
 * The cursor after the peer confirmed holding `events`. A device's entry only advances across a
 * gap-free run of sequence numbers, so an event the peer never got is offered again.
 */
export function advanceCursor(
  cursor: SyncCursor | null,
  peerDeviceId: string,
  incidentId: string,
  events: readonly DomainEvent[],
  updatedAtMs: number,
): SyncCursor {
  const seqByDevice: Record<string, number> = { ...(cursor?.seqByDevice ?? {}) };
  const byDevice = new Map<string, number[]>();
  for (const e of events) {
    if (e.incidentId !== incidentId) continue;
    const list = byDevice.get(e.actor.deviceId) ?? [];
    list.push(e.clock.seq);
    byDevice.set(e.actor.deviceId, list);
  }
  for (const [deviceId, seqs] of byDevice) {
    let reached = seqByDevice[deviceId] ?? 0;
    for (const seq of [...new Set(seqs)].sort((a, b) => a - b)) {
      if (seq <= reached) continue;
      if (seq !== reached + 1) break;
      reached = seq;
    }
    seqByDevice[deviceId] = reached;
  }
  return { peerDeviceId, incidentId, seqByDevice, updatedAtMs };
}

export function makeEventBatch(incidentId: string, fromDeviceId: string, events: readonly DomainEvent[]): EventBatch {
  return { version: 1, incidentId, fromDeviceId, events: events.filter((e) => e.incidentId === incidentId) };
}
