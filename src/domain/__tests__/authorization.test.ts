import { acceptTask, cancelIncident, offerTask, resolveIncident } from '../commands';
import { canCancelIncident, canResolveIncident } from '../policy';
import { applyEvents } from '../reducer';
import { ALEX, MIKA, NOAH, STRANGER, codeOf, forgeEvent, makeWorld, sosWithPeers } from '../testing/fixtures';

describe('resolution and cancellation (invariant 10)', () => {
  it('a responder without an accepted task cannot resolve', () => {
    const world = makeWorld();
    const s = sosWithPeers(world).state;
    expect(codeOf(() => resolveIncident(s, world.as(MIKA)))).toBe('not_authorized_to_resolve');
    expect(codeOf(() => resolveIncident(s, world.as(STRANGER)))).toBe('not_authorized_to_resolve');
    expect(canResolveIncident(s, MIKA)).toEqual({ ok: false, code: 'not_authorized_to_resolve' });
    expect(canResolveIncident(s, ALEX)).toEqual({ ok: true });
  });

  it('a responder holding an accepted task can resolve; another responder still cannot', () => {
    const world = makeWorld();
    let s = sosWithPeers(world).state;
    s = offerTask(s, world.as(ALEX), { kind: 'go_to_requester', title: 'Go to Alex' }).state;
    s = acceptTask(s, world.as(MIKA), { taskId: s.tasks[0]!.id }).state;
    expect(codeOf(() => resolveIncident(s, world.as(NOAH)))).toBe('not_authorized_to_resolve');
    const resolved = resolveIncident(s, world.as(MIKA), { note: 'Alex is with me and fine' }).state;
    expect(resolved.closure).toMatchObject({ kind: 'resolved', by: MIKA });
  });

  it('nothing resolves an incident implicitly', () => {
    const world = makeWorld();
    let s = sosWithPeers(world).state;
    s = offerTask(s, world.as(ALEX), { kind: 'go_to_requester', title: 'Go to Alex' }).state;
    s = acceptTask(s, world.as(MIKA), { taskId: s.tasks[0]!.id }).state;
    expect(s.closure).toBeNull();
    expect(s.events.some((e) => e.type === 'INCIDENT_RESOLVED')).toBe(false);
  });

  it('only the reporter cancels', () => {
    const world = makeWorld();
    let s = sosWithPeers(world).state;
    s = offerTask(s, world.as(ALEX), { kind: 'go_to_requester', title: 'Go to Alex' }).state;
    s = acceptTask(s, world.as(MIKA), { taskId: s.tasks[0]!.id }).state;
    for (const actor of [MIKA, NOAH, STRANGER]) {
      expect(codeOf(() => cancelIncident(s, world.as(actor)))).toBe('not_reporter');
      expect(canCancelIncident(s, actor).ok).toBe(false);
    }
    const cancelled = cancelIncident(s, world.as(ALEX)).state;
    expect(cancelled.status).toEqual({ status: 'cancelled', reason: 'cancelled_by_reporter' });
  });

  it('forged remote resolution and cancellation are stored but never applied', () => {
    const world = makeWorld();
    const s = sosWithPeers(world).state;
    const forged = [
      forgeEvent(s, world.as(NOAH), { type: 'INCIDENT_RESOLVED', payload: {} }),
      forgeEvent(s, world.as(MIKA), { type: 'INCIDENT_CANCELLED', payload: {} }),
      forgeEvent(s, world.as(STRANGER), { type: 'INCIDENT_CANCELLED', payload: {} }),
    ];
    const after = applyEvents(s, forged);
    expect(after.closure).toBeNull();
    expect(after.status.status).toBe('queued');
    expect(after.events).toHaveLength(s.events.length + 3);
    expect(after.notApplied.map((n) => n.code).sort()).toEqual(['not_authorized_to_resolve', 'not_reporter', 'not_reporter']);
  });

  it('a closed incident accepts no further human events, and a second incident creation is refused', () => {
    const world = makeWorld();
    const s = cancelIncident(sosWithPeers(world).state, world.as(ALEX)).state;
    expect(codeOf(() => resolveIncident(s, world.as(ALEX)))).toBe('incident_closed');
    expect(codeOf(() => offerTask(s, world.as(ALEX), { kind: 'other', title: 'Anything' }))).toBe('incident_closed');

    const takeover = forgeEvent(s, world.as(MIKA), {
      type: 'INCIDENT_CREATED',
      payload: { source: 'manual_sos', incidentType: 'Manual SOS', assistanceRequested: true, recipients: [] },
    });
    const after = applyEvents(s, [takeover]);
    expect(after.incident?.reporter).toEqual(ALEX);
    expect(after.notApplied.map((n) => n.code)).toEqual(['incident_already_created']);
  });
});
