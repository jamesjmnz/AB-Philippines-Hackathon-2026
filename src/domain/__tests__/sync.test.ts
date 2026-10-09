import { acceptTask, acknowledge, cancelIncident, offerTask } from '../commands';
import type { DomainEvent } from '../events';
import { replay } from '../reducer';
import { advanceCursor, eventsAfterCursor, makeEventBatch, mergeRemoteEvents } from '../sync';
import { ALEX, MIKA, NOAH, STRANGER, forgeEvent, fullScenario, makeWorld, shuffled, sosWithPeers } from '../testing/fixtures';

describe('mergeRemoteEvents', () => {
  it('applies new events, reports duplicates, and converges whatever the batch order', () => {
    const { incidentId, events, state } = fullScenario();
    const local = events.slice(0, 6);
    const batch = makeEventBatch(incidentId, MIKA.deviceId, shuffled(events, 11));
    const merged = mergeRemoteEvents(local, batch);

    expect(merged.duplicates.sort()).toEqual(local.map((e) => e.id).sort());
    expect(merged.applied).toHaveLength(events.length - local.length);
    expect(merged.rejected).toEqual([]);
    expect(merged.toStore).toHaveLength(events.length - local.length);
    expect(merged.state).toEqual(state);

    // Receiving the same batch again is a no-op.
    const again = mergeRemoteEvents([...local, ...merged.toStore], batch);
    expect(again.applied).toEqual([]);
    expect(again.toStore).toEqual([]);
    expect(again.duplicates).toHaveLength(events.length);
    expect(again.state).toEqual(state);
  });

  it('quarantines malformed events and keeps the valid ones in the same batch', () => {
    const world = makeWorld();
    const base = sosWithPeers(world).state;
    const ack = acknowledge(base, world.as(MIKA)).events[0]!;
    const withSeverity = { ...ack, id: 'evt-sev', payload: { severity: 'critical' } };
    const garbage = { id: 'evt-garbage', hello: 'world' };
    const otherIncident = { ...ack, id: 'evt-other', incidentId: 'inc-elsewhere' };

    const merged = mergeRemoteEvents(base.events, {
      version: 1,
      incidentId: base.incidentId,
      fromDeviceId: MIKA.deviceId,
      events: [withSeverity, garbage, 42, null, otherIncident, ack, ack],
    });

    expect(merged.applied.map((e) => e.id)).toEqual([ack.id]);
    expect(merged.duplicates).toEqual([ack.id]);
    expect(merged.rejected.map((r) => [r.eventId, r.stage, r.storedInLedger])).toEqual([
      ['evt-sev', 'schema', false],
      ['evt-garbage', 'schema', false],
      [null, 'schema', false],
      [null, 'schema', false],
      ['evt-other', 'incident_mismatch', false],
    ]);
    expect(merged.toStore.map((e) => e.id)).toEqual([ack.id]);
    expect(merged.state?.recipients.find((r) => r.deviceId === MIKA.deviceId)?.acknowledged).toBe(true);
  });

  it('never applies an unauthorized remote event', () => {
    const world = makeWorld();
    let base = sosWithPeers(world).state;
    base = offerTask(base, world.as(ALEX), { kind: 'go_to_requester', title: 'Go to Alex' }).state;
    const taskId = base.tasks[0]!.id;
    const forged: DomainEvent[] = [
      forgeEvent(base, world.as(MIKA), { type: 'INCIDENT_CANCELLED', payload: {} }),
      forgeEvent(base, world.as(NOAH), { type: 'TASK_ACCEPTED', payload: { taskId, assignee: MIKA } }),
      forgeEvent(base, world.as(STRANGER), { type: 'RESPONDER_ACKNOWLEDGED', payload: {} }),
      forgeEvent(base, world.as(MIKA), { type: 'TASK_COMPLETION_CONFIRMED', payload: { taskId } }),
    ];
    const merged = mergeRemoteEvents(base.events, makeEventBatch(base.incidentId, MIKA.deviceId, forged));

    expect(merged.applied).toEqual([]);
    expect(merged.rejected.map((r) => [r.stage, r.code, r.storedInLedger])).toEqual([
      ['policy', 'not_reporter', true],
      ['policy', 'cannot_accept_for_another', true],
      ['policy', 'not_recipient', true],
      ['policy', 'not_reporter', true],
    ]);
    expect(merged.state?.closure).toBeNull();
    expect(merged.state?.tasks[0]).toMatchObject({ status: 'unassigned', assignee: null });
    expect(merged.state?.recipients.some((r) => r.acknowledged)).toBe(false);
    // Stored so every device replays the same set, and still refused on every replay.
    expect(replay(base.incidentId, [...base.events, ...merged.toStore]).notApplied).toHaveLength(4);
  });

  it('holds an early event and applies it once its context arrives', () => {
    const world = makeWorld();
    const base = sosWithPeers(world).state;
    const offered = offerTask(base, world.as(ALEX), { kind: 'communicate', title: 'Call the front desk' });
    const accepted = acceptTask(offered.state, world.as(MIKA), { taskId: offered.state.tasks[0]!.id });

    const first = mergeRemoteEvents(base.events, makeEventBatch(base.incidentId, MIKA.deviceId, accepted.events));
    expect(first.applied).toEqual([]);
    expect(first.rejected.map((r) => [r.stage, r.code])).toEqual([['policy', 'unknown_task']]);
    expect(first.state?.ledger.missingParents).toEqual(offered.events.map((e) => e.id));

    const second = mergeRemoteEvents([...base.events, ...first.toStore], makeEventBatch(base.incidentId, ALEX.deviceId, offered.events));
    expect(second.rejected).toEqual([]);
    expect(second.state).toEqual(accepted.state);
  });

  it('rejects a malformed batch and events failing the signature check', () => {
    const world = makeWorld();
    const base = sosWithPeers(world).state;
    const ack = acknowledge(base, world.as(MIKA)).events;
    const cancel = cancelIncident(base, world.as(ALEX)).events;

    const bad = mergeRemoteEvents(base.events, { incidentId: base.incidentId, events: ack });
    expect(bad).toMatchObject({ incidentId: null, applied: [], toStore: [], state: null });
    expect(bad.rejected.map((r) => r.stage)).toEqual(['batch']);

    const merged = mergeRemoteEvents(base.events, makeEventBatch(base.incidentId, MIKA.deviceId, [...ack, ...cancel]), {
      verifySignature: (event) => event.actor.deviceId === MIKA.deviceId,
    });
    expect(merged.applied.map((e) => e.id)).toEqual(ack.map((e) => e.id));
    expect(merged.rejected.map((r) => [r.stage, r.storedInLedger])).toEqual([['signature', false]]);
    expect(merged.state?.closure).toBeNull();
  });
});

describe('sync cursor', () => {
  it('offers only what the peer is not known to hold and advances across gap-free runs', () => {
    const { incidentId, events } = fullScenario();
    expect(eventsAfterCursor(events, null)).toEqual(events);

    const firstHalf = events.slice(0, 10);
    const cursor = advanceCursor(null, MIKA.deviceId, incidentId, firstHalf, 5);
    expect(cursor).toMatchObject({ peerDeviceId: MIKA.deviceId, incidentId, updatedAtMs: 5 });
    expect(eventsAfterCursor(events, cursor)).toEqual(events.slice(10));

    const done = advanceCursor(cursor, MIKA.deviceId, incidentId, events, 6);
    expect(eventsAfterCursor(events, done)).toEqual([]);

    // The peer confirmed Alex's seq 1 and 3 but not 2: the cursor stops at 1, so 2 and 3 are offered again.
    const alexEvents = events.filter((e) => e.actor.deviceId === ALEX.deviceId);
    const gappy = advanceCursor(null, NOAH.deviceId, incidentId, [alexEvents[0]!, alexEvents[2]!], 7);
    expect(gappy.seqByDevice[ALEX.deviceId]).toBe(1);
    expect(eventsAfterCursor(alexEvents, gappy).map((e) => e.clock.seq).slice(0, 2)).toEqual([2, 3]);
  });
});
