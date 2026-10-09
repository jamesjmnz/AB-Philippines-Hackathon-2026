import {
  DomainError,
  DomainEventSchema,
  OutboxMessageSchema,
  SyncCursorSchema,
  mergeRemoteEvents,
  replay,
  retryDelayMs,
  type CommandResult,
  type DomainEvent,
  type EventOrigin,
  type IncidentState,
  type MergeOptions,
  type MergeResult,
  type OutboxMessage,
  type SyncCursor,
} from '@/domain';

import type { LedgerStore, QuarantinedEvent } from './ledgerStore';

export interface AppendResult {
  /** Ids written now. */
  inserted: string[];
  /** Ids that were already in the ledger; appending them again changed nothing. */
  duplicates: string[];
}

export interface EnqueueResult {
  inserted: string[];
  duplicates: string[];
}

export type ReceiptOutcome = 'acknowledged' | 'already_acknowledged' | 'unknown_packet';

/**
 * The only way the app reads or writes incident data.
 *
 * - The ledger is append-only and idempotent by event id.
 * - `replay` derives state from the ledger every time; no status is stored.
 * - Locally authored events are validated (schema, then reducer) before they are written and a
 *   refusal throws a typed DomainError. Remote events go through `ingestRemote`, which quarantines
 *   what is malformed and never throws for bad input.
 * - An outbox row leaves the pending set only on a recipient receipt, expiry or cancellation.
 */
export interface IncidentRepository {
  appendEvents(events: readonly DomainEvent[], options?: { origin?: EventOrigin }): Promise<AppendResult>;
  /** Writes a command's events and outbox rows in one transaction. */
  commit(result: Pick<CommandResult, 'events' | 'outbox'>): Promise<AppendResult>;
  /** Validates, deduplicates, stores and quarantines a batch of events from another device. */
  ingestRemote(batch: unknown, nowMs: number, options?: MergeOptions): Promise<MergeResult>;
  eventsForIncident(incidentId: string): Promise<DomainEvent[]>;
  allIncidentIds(): Promise<string[]>;
  replay(incidentId: string): Promise<IncidentState>;
  transaction<T>(fn: (repo: IncidentRepository) => Promise<T>): Promise<T>;

  enqueue(messages: readonly OutboxMessage[]): Promise<EnqueueResult>;
  getPendingOutbox(incidentId?: string): Promise<OutboxMessage[]>;
  /** Counts an attempt and schedules the next retry with backoff. The row stays pending. */
  markSendAttempt(packetId: string, nowMs: number): Promise<OutboxMessage | null>;
  /** Clears the row because the recipient's receipt arrived. */
  acknowledgeReceipt(packetId: string, receiptId: string, nowMs: number): Promise<ReceiptOutcome>;
  /** Pending rows whose retry time has come. Rows past their expiry are marked expired and not returned. */
  retryDue(nowMs: number): Promise<OutboxMessage[]>;
  /** Stops retrying everything still pending for an incident. Returns how many rows were cancelled. */
  cancelPendingOutbox(incidentId: string): Promise<number>;

  /** Duplicate packet suppression: 'new' the first time a packet id is seen, 'duplicate' after. */
  recordInbound(
    packetId: string,
    meta?: { incidentId?: string; fromDeviceId?: string; receivedAtMs?: number },
  ): Promise<'new' | 'duplicate'>;

  getSyncCursor(peerDeviceId: string, incidentId: string): Promise<SyncCursor | null>;
  setSyncCursor(cursor: SyncCursor): Promise<void>;

  quarantined(): Promise<QuarantinedEvent[]>;
  /** Hard reset: removes every incident, outbox row, inbox row, cursor and quarantined event. */
  reset(): Promise<void>;
}

const QUARANTINE_BODY_LIMIT = 8_192;

function quarantineBody(raw: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(raw) ?? 'undefined';
  } catch {
    text = '"<unserializable>"';
  }
  return text.length > QUARANTINE_BODY_LIMIT ? text.slice(0, QUARANTINE_BODY_LIMIT) : text;
}

export function createIncidentRepository(store: LedgerStore): IncidentRepository {
  const repo: IncidentRepository = {
    appendEvents(events, options = {}) {
      const origin = options.origin ?? 'local';
      return store.transaction(async (tx) => {
        const parsed: DomainEvent[] = [];
        for (const event of events) {
          const result = DomainEventSchema.safeParse(event);
          if (!result.success) throw new DomainError('invalid_event');
          parsed.push(result.data);
        }

        if (origin === 'local') {
          // A locally authored event must be one the reducer applies, or nothing is written.
          const byIncident = new Map<string, DomainEvent[]>();
          for (const event of parsed) {
            const list = byIncident.get(event.incidentId) ?? [];
            list.push(event);
            byIncident.set(event.incidentId, list);
          }
          for (const [incidentId, fresh] of byIncident) {
            const existing = await tx.eventsFor(incidentId);
            const known = new Set(existing.map((e) => e.id));
            const added = new Set(fresh.filter((e) => !known.has(e.id)).map((e) => e.id));
            const state = replay(incidentId, [...existing, ...fresh]);
            const refused = state.notApplied.find((n) => added.has(n.eventId));
            if (refused) throw new DomainError(refused.code, refused.eventId);
          }
        }

        const inserted: string[] = [];
        const duplicates: string[] = [];
        for (const event of parsed) {
          if (await tx.insertEvent(event, origin)) inserted.push(event.id);
          else duplicates.push(event.id);
        }
        return { inserted, duplicates };
      });
    },

    commit(result) {
      return repo.transaction(async (tx) => {
        const appended = await tx.appendEvents(result.events);
        await tx.enqueue(result.outbox);
        return appended;
      });
    },

    ingestRemote(batch, nowMs, options) {
      return store.transaction(async (tx) => {
        const incidentId =
          typeof batch === 'object' && batch !== null && 'incidentId' in batch && typeof batch.incidentId === 'string'
            ? batch.incidentId
            : null;
        const local = incidentId === null ? [] : await tx.eventsFor(incidentId);
        const merged = mergeRemoteEvents(local, batch, options);
        for (const event of merged.toStore) await tx.insertEvent(event, 'remote');
        for (const rejection of merged.rejected) {
          if (rejection.storedInLedger) continue;
          await tx.insertQuarantine({
            incidentId: merged.incidentId,
            eventId: rejection.eventId,
            stage: rejection.stage,
            body: quarantineBody(rejection.raw),
            receivedAtMs: nowMs,
          });
        }
        return merged;
      });
    },

    eventsForIncident(incidentId) {
      return store.eventsFor(incidentId);
    },

    allIncidentIds() {
      return store.incidentIds();
    },

    async replay(incidentId) {
      return replay(incidentId, await store.eventsFor(incidentId));
    },

    transaction(fn) {
      return store.transaction((tx) => fn(createIncidentRepository(tx)));
    },

    enqueue(messages) {
      return store.transaction(async (tx) => {
        const inserted: string[] = [];
        const duplicates: string[] = [];
        for (const message of messages) {
          const parsed = OutboxMessageSchema.safeParse(message);
          if (!parsed.success) throw new DomainError('invalid_input');
          if (await tx.insertOutbox(parsed.data)) inserted.push(parsed.data.packetId);
          else duplicates.push(parsed.data.packetId);
        }
        return { inserted, duplicates };
      });
    },

    getPendingOutbox(incidentId) {
      return store.listOutbox({ status: 'pending', ...(incidentId === undefined ? {} : { incidentId }) });
    },

    markSendAttempt(packetId, nowMs) {
      return store.transaction(async (tx) => {
        const message = await tx.getOutbox(packetId);
        if (!message) return null;
        if (message.status !== 'pending') return message;
        const attempts = message.attempts + 1;
        const updated: OutboxMessage = {
          ...message,
          attempts,
          lastAttemptAtMs: nowMs,
          nextRetryAtMs: nowMs + retryDelayMs(attempts),
        };
        await tx.updateOutbox(updated);
        return updated;
      });
    },

    acknowledgeReceipt(packetId, receiptId, nowMs) {
      return store.transaction(async (tx): Promise<ReceiptOutcome> => {
        const message = await tx.getOutbox(packetId);
        if (!message) return 'unknown_packet';
        if (message.status === 'receipted') return 'already_acknowledged';
        await tx.updateOutbox({ ...message, status: 'receipted', receiptId, nextRetryAtMs: nowMs });
        return 'acknowledged';
      });
    },

    retryDue(nowMs) {
      return store.transaction(async (tx) => {
        const due: OutboxMessage[] = [];
        for (const message of await tx.listOutbox({ status: 'pending' })) {
          if (message.expiresAtMs !== null && message.expiresAtMs <= nowMs) {
            await tx.updateOutbox({ ...message, status: 'expired' });
            continue;
          }
          if (message.nextRetryAtMs <= nowMs) due.push(message);
        }
        return due;
      });
    },

    cancelPendingOutbox(incidentId) {
      return store.transaction(async (tx) => {
        const pending = await tx.listOutbox({ status: 'pending', incidentId });
        for (const message of pending) await tx.updateOutbox({ ...message, status: 'cancelled' });
        return pending.length;
      });
    },

    async recordInbound(packetId, meta = {}) {
      const inserted = await store.insertInbox({
        packetId,
        incidentId: meta.incidentId ?? null,
        fromDeviceId: meta.fromDeviceId ?? null,
        receivedAtMs: meta.receivedAtMs ?? 0,
      });
      return inserted ? 'new' : 'duplicate';
    },

    getSyncCursor(peerDeviceId, incidentId) {
      return store.getCursor(peerDeviceId, incidentId);
    },

    async setSyncCursor(cursor) {
      const parsed = SyncCursorSchema.safeParse(cursor);
      if (!parsed.success) throw new DomainError('invalid_input');
      await store.putCursor(parsed.data);
    },

    quarantined() {
      return store.listQuarantine();
    },

    reset() {
      return store.reset();
    },
  };
  return repo;
}
