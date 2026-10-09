import {
  acknowledge,
  cancelIncident,
  createManualSOS,
  isDomainError,
  makeEventBatch,
  newOutboxMessage,
  recordPeerReceipt,
  recordSendAttempt,
  retryDelayMs,
  type DomainEvent,
} from '@/domain';
import {
  ALEX,
  MIKA,
  NOAH,
  PEERS,
  STRANGER,
  forgeEvent,
  fullScenario,
  makeWorld,
  packetFor,
  shuffled,
  sosWithPeers,
} from '@/domain/testing/fixtures';

import type { IncidentRepository } from '../incidentRepository';

/**
 * TEST ONLY. The behaviour every IncidentRepository must have. Run against the SQLite repository
 * and the in-memory Demo repository so both follow the same rules.
 */
export interface RepositoryHarness {
  open(): Promise<IncidentRepository>;
  close(): Promise<void>;
}

async function codeOfAsync(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (error) {
    if (isDomainError(error)) return error.code;
    throw error;
  }
}

export function describeRepositoryContract(name: string, makeHarness: () => RepositoryHarness): void {
  describe(`IncidentRepository contract: ${name}`, () => {
    let harness: RepositoryHarness;
    let repo: IncidentRepository;

    beforeEach(async () => {
      harness = makeHarness();
      repo = await harness.open();
    });

    afterEach(async () => {
      await harness.close();
    });

    describe('manual SOS', () => {
      it('persists with no recipients, no AI and no transport, and replays as queued', async () => {
        const sos = createManualSOS(makeWorld().as(ALEX), { recipients: [] });
        const appended = await repo.commit(sos);

        expect(appended).toEqual({ inserted: [sos.events[0]?.id], duplicates: [] });
        expect(await repo.allIncidentIds()).toEqual([sos.incidentId]);
        expect(await repo.getPendingOutbox()).toEqual([]);
        const state = await repo.replay(sos.incidentId);
        expect(state).toEqual(sos.state);
        expect(state.status).toEqual({ status: 'queued', reason: 'no_trusted_peer' });
      });

      it('writes the event and one outbox row per recipient together', async () => {
        const sos = sosWithPeers(makeWorld());
        await repo.commit(sos);
        expect(await repo.eventsForIncident(sos.incidentId)).toEqual(sos.events);
        expect(await repo.getPendingOutbox(sos.incidentId)).toEqual(sos.outbox);
        expect((await repo.getPendingOutbox()).map((m) => m.recipientDeviceId)).toEqual(PEERS.map((p) => p.deviceId));
      });

      it('is atomic: if the outbox write fails the incident is not persisted either', async () => {
        const sos = sosWithPeers(makeWorld());
        const first = sos.outbox[0]!;
        const broken = [first, { ...first, packetId: 'pkt-broken', attempts: -1 }];

        expect(await codeOfAsync(() => repo.commit({ events: sos.events, outbox: broken }))).toBe('invalid_input');
        expect(await repo.allIncidentIds()).toEqual([]);
        expect(await repo.eventsForIncident(sos.incidentId)).toEqual([]);
        expect(await repo.getPendingOutbox()).toEqual([]);

        // The same SOS can be committed afterwards.
        await repo.commit(sos);
        expect(await repo.getPendingOutbox()).toHaveLength(PEERS.length);
      });

      it('a failing transaction rolls back everything done inside it', async () => {
        const sos = sosWithPeers(makeWorld());
        await expect(
          repo.transaction(async (tx) => {
            await tx.appendEvents(sos.events);
            await tx.enqueue(sos.outbox);
            await tx.recordInbound('pkt-in-1');
            expect(await tx.allIncidentIds()).toEqual([sos.incidentId]);
            throw new Error('synthetic failure');
          }),
        ).rejects.toThrow('synthetic failure');
        expect(await repo.allIncidentIds()).toEqual([]);
        expect(await repo.getPendingOutbox()).toEqual([]);
        expect(await repo.recordInbound('pkt-in-1')).toBe('new');
      });
    });

    describe('ledger', () => {
      it('is idempotent by event id: appending the same events again changes nothing', async () => {
        const { incidentId, events, state } = fullScenario();
        const first = await repo.appendEvents(events);
        expect(first.inserted).toHaveLength(events.length);

        const second = await repo.appendEvents(events);
        expect(second).toEqual({ inserted: [], duplicates: events.map((e) => e.id) });
        expect(await repo.eventsForIncident(incidentId)).toEqual(events);
        expect(await repo.replay(incidentId)).toEqual(state);
      });

      it('replays to the same state whatever order the events were stored in', async () => {
        const { incidentId, events, state } = fullScenario();
        for (const event of shuffled(events, 21)) await repo.appendEvents([event], { origin: 'remote' });
        expect(await repo.eventsForIncident(incidentId)).toEqual(events);
        expect(await repo.replay(incidentId)).toEqual(state);
      });

      it('keeps incidents separate and lists them in creation order', async () => {
        const a = sosWithPeers(makeWorld('a'));
        const b = createManualSOS(makeWorld('b').as(MIKA), { recipients: [] });
        await repo.commit(a);
        await repo.commit(b);
        expect(await repo.allIncidentIds()).toEqual([a.incidentId, b.incidentId]);
        expect((await repo.replay(b.incidentId)).incident?.reporter).toEqual(MIKA);
        expect((await repo.replay(a.incidentId)).incident?.reporter).toEqual(ALEX);
        expect((await repo.replay('inc-unknown')).incident).toBeNull();
      });

      it('rejects a locally authored event that is unauthorized or malformed, with a typed error, and writes nothing', async () => {
        const world = makeWorld();
        const sos = sosWithPeers(world);
        await repo.commit(sos);

        const cancelByMika = forgeEvent(sos.state, world.as(MIKA), { type: 'INCIDENT_CANCELLED', payload: {} });
        expect(await codeOfAsync(() => repo.appendEvents([cancelByMika]))).toBe('not_reporter');

        const valid = acknowledge(sos.state, world.as(MIKA)).events;
        // One bad event in the call rejects the whole call.
        expect(await codeOfAsync(() => repo.appendEvents([...valid, cancelByMika]))).toBe('not_reporter');

        const malformed: unknown = { ...valid[0], id: 'evt-malformed', payload: { severity: 'high' } };
        expect(await codeOfAsync(() => repo.appendEvents([malformed as DomainEvent]))).toBe('invalid_event');

        expect(await repo.eventsForIncident(sos.incidentId)).toEqual(sos.events);
      });
    });

    describe('remote events', () => {
      it('ingests a batch: applies, deduplicates, quarantines malformed events, never applies unauthorized ones', async () => {
        const world = makeWorld();
        const sos = sosWithPeers(world);
        await repo.commit(sos);

        const ack = acknowledge(sos.state, world.as(MIKA)).events[0]!;
        const forgedCancel = forgeEvent(sos.state, world.as(STRANGER), { type: 'INCIDENT_CANCELLED', payload: {} });
        const malformed = { ...ack, id: 'evt-diagnosis', payload: { diagnosis: 'fracture' } };
        const batch = {
          version: 1,
          incidentId: sos.incidentId,
          fromDeviceId: MIKA.deviceId,
          events: [malformed, ack, forgedCancel, sos.events[0]],
        };

        const merged = await repo.ingestRemote(batch, 1234);
        expect(merged.applied.map((e) => e.id)).toEqual([ack.id]);
        expect(merged.duplicates).toEqual([sos.events[0]?.id]);
        expect(merged.rejected.map((r) => [r.eventId, r.stage, r.code])).toEqual([
          ['evt-diagnosis', 'schema', 'invalid_event'],
          [forgedCancel.id, 'policy', 'not_reporter'],
        ]);

        const quarantine = await repo.quarantined();
        expect(quarantine).toHaveLength(1);
        expect(quarantine[0]).toMatchObject({
          incidentId: sos.incidentId,
          eventId: 'evt-diagnosis',
          stage: 'schema',
          receivedAtMs: 1234,
        });
        // The malformed event is not in the ledger; the unauthorized one is stored but not applied.
        const stored = (await repo.eventsForIncident(sos.incidentId)).map((e) => e.id);
        expect(stored).not.toContain('evt-diagnosis');
        expect(stored).toContain(forgedCancel.id);
        const state = await repo.replay(sos.incidentId);
        expect(state.closure).toBeNull();
        expect(state.recipients.find((r) => r.deviceId === MIKA.deviceId)?.acknowledged).toBe(true);
        expect(state.notApplied.map((n) => [n.eventId, n.code])).toEqual([[forgedCancel.id, 'not_reporter']]);

        // The same batch again: nothing new is stored or applied.
        const again = await repo.ingestRemote(batch, 1300);
        expect(again.applied).toEqual([]);
        expect(again.toStore).toEqual([]);
        expect(await repo.replay(sos.incidentId)).toEqual(state);
      });

      it('quarantines a malformed batch without throwing', async () => {
        const merged = await repo.ingestRemote({ not: 'a batch' }, 5);
        expect(merged.state).toBeNull();
        expect(await repo.quarantined()).toMatchObject([{ incidentId: null, eventId: null, stage: 'batch', receivedAtMs: 5 }]);
        expect(await repo.allIncidentIds()).toEqual([]);
      });

      it('two devices that exchange batches in either order converge', async () => {
        const { incidentId, events, state } = fullScenario();
        const mine = events.filter((_, i) => i % 2 === 0);
        const theirs = events.filter((_, i) => i % 2 === 1);
        await repo.appendEvents(mine, { origin: 'remote' });
        await repo.ingestRemote(makeEventBatch(incidentId, MIKA.deviceId, shuffled(theirs, 5)), 1);
        expect(await repo.replay(incidentId)).toEqual(state);
      });
    });

    describe('outbox', () => {
      it('a send attempt keeps the row pending and backs off; only a receipt clears it', async () => {
        const world = makeWorld();
        const sos = sosWithPeers(world);
        await repo.commit(sos);
        const packetId = packetFor(sos.state, MIKA.deviceId);
        const created = sos.outbox[0]!.createdAtMs;

        expect((await repo.retryDue(created)).map((m) => m.packetId)).toEqual(sos.outbox.map((m) => m.packetId));

        let now = created;
        const delays: number[] = [];
        for (let attempt = 1; attempt <= 7; attempt += 1) {
          const updated = await repo.markSendAttempt(packetId, now);
          expect(updated).toMatchObject({ status: 'pending', attempts: attempt, lastAttemptAtMs: now, receiptId: null });
          delays.push((updated?.nextRetryAtMs ?? 0) - now);
          // Not due one millisecond before the backoff ends, due exactly when it ends.
          const next = updated?.nextRetryAtMs ?? 0;
          expect((await repo.retryDue(next - 1)).map((m) => m.packetId)).not.toContain(packetId);
          expect((await repo.retryDue(next)).map((m) => m.packetId)).toContain(packetId);
          now = next;
        }
        expect(delays).toEqual([1, 2, 3, 4, 5, 6, 7].map(retryDelayMs));
        expect(delays).toEqual([2000, 4000, 8000, 16000, 32000, 60000, 60000]);
        expect((await repo.getPendingOutbox()).map((m) => m.packetId)).toContain(packetId);

        expect(await repo.acknowledgeReceipt(packetId, 'rcpt-1', now)).toBe('acknowledged');
        expect((await repo.getPendingOutbox()).map((m) => m.packetId)).not.toContain(packetId);
        expect(await repo.getPendingOutbox()).toHaveLength(PEERS.length - 1);
        // A duplicate receipt and a receipt for an unknown packet are harmless.
        expect(await repo.acknowledgeReceipt(packetId, 'rcpt-1', now)).toBe('already_acknowledged');
        expect(await repo.acknowledgeReceipt('pkt-unknown', 'rcpt-9', now)).toBe('unknown_packet');
        expect(await repo.markSendAttempt('pkt-unknown', now)).toBeNull();
        expect(await repo.markSendAttempt(packetId, now)).toMatchObject({ status: 'receipted', attempts: 7 });
      });

      it('re-enqueueing on reconnect creates no duplicate rows and does not reset attempts', async () => {
        const sos = sosWithPeers(makeWorld());
        await repo.commit(sos);
        const packetId = sos.outbox[0]!.packetId;
        await repo.markSendAttempt(packetId, 10);
        await repo.markSendAttempt(packetId, 20);

        for (let i = 0; i < 3; i += 1) {
          expect(await repo.enqueue(sos.outbox)).toEqual({ inserted: [], duplicates: sos.outbox.map((m) => m.packetId) });
          await repo.commit(sos);
        }
        const pending = await repo.getPendingOutbox();
        expect(pending).toHaveLength(PEERS.length);
        expect(pending.find((m) => m.packetId === packetId)).toMatchObject({ attempts: 2, lastAttemptAtMs: 20 });
        expect(await repo.eventsForIncident(sos.incidentId)).toHaveLength(1);
      });

      it('outbox state and ledger delivery state are separate and both need the receipt', async () => {
        const world = makeWorld();
        const sos = sosWithPeers(world);
        await repo.commit(sos);
        const packetId = packetFor(sos.state, MIKA.deviceId);

        await repo.markSendAttempt(packetId, 100);
        await repo.commit(recordSendAttempt(await repo.replay(sos.incidentId), world.as(ALEX), { packetId }));
        let state = await repo.replay(sos.incidentId);
        expect(state.recipients.find((r) => r.deviceId === MIKA.deviceId)?.delivery).toBe('send_attempted');
        expect(state.status.status).toBe('queued');
        expect((await repo.getPendingOutbox()).map((m) => m.packetId)).toContain(packetId);

        const receipt = { receiptId: 'rcpt-7', packetId, recipientDeviceId: MIKA.deviceId };
        await repo.transaction(async (tx) => {
          await tx.commit(recordPeerReceipt(await tx.replay(sos.incidentId), world.as(ALEX), { receipt }));
          await tx.acknowledgeReceipt(packetId, receipt.receiptId, 200);
        });
        state = await repo.replay(sos.incidentId);
        expect(state.recipients.find((r) => r.deviceId === MIKA.deviceId)?.delivery).toBe('delivered');
        expect(state.recipients.find((r) => r.deviceId === NOAH.deviceId)?.delivery).toBe('queued');
        expect(state.status.status).toBe('delivered');
      });

      it('expires rows past their expiry and cancels pending rows on request', async () => {
        const base = { incidentId: 'inc-x', recipientDeviceId: MIKA.deviceId, kind: 'event_sync' as const, eventIds: [], createdAtMs: 0 };
        await repo.enqueue([
          newOutboxMessage({ ...base, packetId: 'pkt-expiring', expiresAtMs: 500 }),
          newOutboxMessage({ ...base, packetId: 'pkt-lasting' }),
          newOutboxMessage({ ...base, packetId: 'pkt-other', incidentId: 'inc-y' }),
        ]);
        expect((await repo.retryDue(499)).map((m) => m.packetId).sort()).toEqual(['pkt-expiring', 'pkt-lasting', 'pkt-other']);
        expect((await repo.retryDue(500)).map((m) => m.packetId).sort()).toEqual(['pkt-lasting', 'pkt-other']);
        expect((await repo.getPendingOutbox()).map((m) => m.packetId).sort()).toEqual(['pkt-lasting', 'pkt-other']);

        expect(await repo.cancelPendingOutbox('inc-x')).toBe(1);
        expect((await repo.getPendingOutbox()).map((m) => m.packetId)).toEqual(['pkt-other']);
        expect(await repo.retryDue(10_000)).toHaveLength(1);
      });
    });

    describe('inbox and cursors', () => {
      it('suppresses duplicate packets', async () => {
        expect(await repo.recordInbound('pkt-1', { incidentId: 'inc-1', fromDeviceId: MIKA.deviceId, receivedAtMs: 9 })).toBe('new');
        expect(await repo.recordInbound('pkt-1')).toBe('duplicate');
        expect(await repo.recordInbound('pkt-1', { receivedAtMs: 99 })).toBe('duplicate');
        expect(await repo.recordInbound('pkt-2')).toBe('new');
      });

      it('a packet received twice is applied once', async () => {
        const world = makeWorld();
        const sos = sosWithPeers(world);
        await repo.commit(sos);
        const batch = makeEventBatch(sos.incidentId, MIKA.deviceId, acknowledge(sos.state, world.as(MIKA)).events);

        const applied: number[] = [];
        for (let delivery = 0; delivery < 3; delivery += 1) {
          await repo.transaction(async (tx) => {
            if ((await tx.recordInbound('pkt-ack-1')) === 'duplicate') return;
            applied.push((await tx.ingestRemote(batch, delivery)).applied.length);
          });
        }
        expect(applied).toEqual([1]);
        expect(await repo.eventsForIncident(sos.incidentId)).toHaveLength(2);
      });

      it('stores one sync cursor per peer and incident', async () => {
        expect(await repo.getSyncCursor(MIKA.deviceId, 'inc-1')).toBeNull();
        const cursor = { peerDeviceId: MIKA.deviceId, incidentId: 'inc-1', seqByDevice: { [ALEX.deviceId]: 3 }, updatedAtMs: 10 };
        await repo.setSyncCursor(cursor);
        await repo.setSyncCursor({ ...cursor, incidentId: 'inc-2', seqByDevice: {} });
        expect(await repo.getSyncCursor(MIKA.deviceId, 'inc-1')).toEqual(cursor);

        const advanced = { ...cursor, seqByDevice: { [ALEX.deviceId]: 5, [MIKA.deviceId]: 1 }, updatedAtMs: 20 };
        await repo.setSyncCursor(advanced);
        expect(await repo.getSyncCursor(MIKA.deviceId, 'inc-1')).toEqual(advanced);
        expect(await repo.getSyncCursor(MIKA.deviceId, 'inc-2')).toMatchObject({ seqByDevice: {} });
        expect(await repo.getSyncCursor(NOAH.deviceId, 'inc-1')).toBeNull();
      });
    });

    describe('reset', () => {
      it('removes every incident, outbox row, inbox row, cursor and quarantined event, and the store still works', async () => {
        const world = makeWorld();
        const sos = sosWithPeers(world);
        await repo.commit(sos);
        await repo.commit(cancelIncident(sos.state, world.as(ALEX)));
        await repo.recordInbound('pkt-1');
        await repo.setSyncCursor({ peerDeviceId: MIKA.deviceId, incidentId: sos.incidentId, seqByDevice: {}, updatedAtMs: 1 });
        await repo.ingestRemote('garbage', 1);

        await repo.reset();

        expect(await repo.allIncidentIds()).toEqual([]);
        expect(await repo.eventsForIncident(sos.incidentId)).toEqual([]);
        expect(await repo.getPendingOutbox()).toEqual([]);
        expect(await repo.quarantined()).toEqual([]);
        expect(await repo.getSyncCursor(MIKA.deviceId, sos.incidentId)).toBeNull();
        expect(await repo.recordInbound('pkt-1')).toBe('new');

        const fresh = sosWithPeers(makeWorld('after-reset'));
        await repo.commit(fresh);
        expect(await repo.replay(fresh.incidentId)).toEqual(fresh.state);
      });
    });
  });
}
