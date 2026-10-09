import { acknowledge, offerTask } from '../commands';
import { compareEvents, sortEvents } from '../events';
import { emptyState, replay } from '../reducer';
import { ALEX, MIKA, fullScenario, makeWorld, shuffled, sosWithPeers } from '../testing/fixtures';

describe('replay determinism (invariant 8)', () => {
  const scenario = fullScenario();
  const { incidentId, events } = scenario;
  const reference = replay(incidentId, events);

  it('replaying the same ledger gives the same state', () => {
    expect(reference).toEqual(scenario.state);
    expect(JSON.stringify(replay(incidentId, events))).toBe(JSON.stringify(reference));
  });

  it('every seeded shuffle of the history replays to the same state', () => {
    expect(events.length).toBeGreaterThan(20);
    for (let seed = 1; seed <= 300; seed += 1) {
      const state = replay(incidentId, shuffled(events, seed));
      expect(JSON.stringify(state)).toBe(JSON.stringify(reference));
    }
  });

  it('every permutation of a short history replays to the same state', () => {
    const world = makeWorld();
    let s = sosWithPeers(world).state;
    s = acknowledge(s, world.as(MIKA)).state;
    s = offerTask(s, world.as(ALEX), { kind: 'communicate', title: 'Call the front desk' }).state;
    s = acknowledge(s, world.as(MIKA)).state;
    const short = s.events;
    expect(short).toHaveLength(4);

    const permutations = <T,>(items: readonly T[]): T[][] =>
      items.length <= 1
        ? [[...items]]
        : items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
    const all = permutations(short);
    expect(all).toHaveLength(24);
    for (const order of all) expect(replay(s.incidentId, order)).toEqual(s);
  });

  it('duplicate events are a no-op', () => {
    const doubled = [...events, ...shuffled(events, 7), ...events.slice(0, 5)];
    const state = replay(incidentId, doubled);
    expect(state).toEqual(reference);
    expect(state.ledger.eventCount).toBe(events.length);
    expect(sortEvents(doubled)).toEqual(events);
  });

  it('orders by (lamport, deviceId, id) and never by wall clock', () => {
    const sorted = sortEvents(shuffled(events, 3));
    for (let i = 1; i < sorted.length; i += 1) {
      expect(compareEvents(sorted[i - 1]!, sorted[i]!)).toBeLessThan(0);
    }
    // Scramble every wall clock: order and all non-display state are unchanged.
    const skewed = events.map((e, i) => ({ ...e, clock: { ...e.clock, wallClockMs: 9_999_999_999_999 - i * 86_400_000 } }));
    const state = replay(incidentId, skewed);
    expect(state.events.map((e) => e.id)).toEqual(reference.events.map((e) => e.id));
    expect(state.status).toEqual(reference.status);
    expect(state.claims.floor.value).toBe(reference.claims.floor.value);
    expect(state.tasks.map((t) => [t.id, t.status])).toEqual(reference.tasks.map((t) => [t.id, t.status]));
    expect(state.notApplied).toEqual([]);
  });

  it('is total over partial histories and converges once the missing events arrive', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const order = shuffled(events, seed);
      for (const cut of [1, Math.floor(order.length / 3), Math.floor(order.length / 2), order.length - 1]) {
        const partial = replay(incidentId, order.slice(0, cut));
        expect(partial.ledger.eventCount).toBe(cut);
        // Nothing is applied on top of context that has not arrived.
        expect(partial.timeline.length + partial.notApplied.length).toBe(cut);
        expect(replay(incidentId, [...order.slice(cut), ...order.slice(0, cut)])).toEqual(reference);
      }
    }
  });

  it('stores an event whose parents are missing, reports the gap, and applies it when the parent arrives', () => {
    const created = events[0]!;
    const rest = events.slice(1);
    const orphaned = replay(incidentId, rest);
    expect(orphaned.incident).toBeNull();
    expect(orphaned.events).toHaveLength(rest.length);
    expect(orphaned.ledger.missingParents).toEqual([created.id]);
    expect(orphaned.notApplied).toHaveLength(rest.length);
    expect(orphaned.notApplied.every((n) => n.code === 'incident_not_found')).toBe(true);

    expect(replay(incidentId, [...rest, created])).toEqual(reference);
  });

  it('ignores events of another incident and has a stable empty state', () => {
    const other = fullScenario();
    const renamed = other.events.map((e) => ({ ...e, id: `x-${e.id}`, incidentId: 'inc-other' }));
    expect(replay(incidentId, [...events, ...renamed])).toEqual(reference);
    expect(emptyState('inc-none')).toMatchObject({
      incident: null,
      status: { status: 'queued', reason: 'not_created' },
      events: [],
      ledger: { eventCount: 0, maxLamport: 0, heads: [], missingParents: [] },
    });
  });

  it('gives each device a monotonic sequence and each event a lamport above its parents', () => {
    const byId = new Map(events.map((e) => [e.id, e]));
    const lastSeq = new Map<string, number>();
    for (const e of events) {
      expect(e.clock.seq).toBe((lastSeq.get(e.actor.deviceId) ?? 0) + 1);
      lastSeq.set(e.actor.deviceId, e.clock.seq);
      for (const parent of e.parents) expect(byId.get(parent)!.clock.lamport).toBeLessThan(e.clock.lamport);
    }
    expect(events[0]?.parents).toEqual([]);
    expect(events.slice(1).every((e) => e.parents.length > 0)).toBe(true);
  });
});
