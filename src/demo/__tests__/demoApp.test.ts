import type { DemoDevice, IncidentView, PulseSnapshot } from '@/services/api';

import { createDemoApp, type DemoApp } from '../createDemoApp';
import { DEMO_PERSONAS, SAMPLE_REPORT } from '../personas';
import { DEMO_SCENARIOS } from '../scenarios';

let app: DemoApp;

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(async () => {
  await app.dispose();
  jest.useRealTimers();
});

async function ready(): Promise<void> {
  const done = app.internals.whenReady();
  await jest.advanceTimersByTimeAsync(10);
  await done;
}

async function run(key: string): Promise<void> {
  app.actions.demo.runScenario(key);
  expect(app.getSnapshot().demo?.runningScenario).toBe(key);
  const done = app.internals.scenarioFinished();
  await jest.advanceTimersByTimeAsync(120_000);
  await done;
  expect(app.getSnapshot().demo?.runningScenario).toBeNull();
}

function as(device: DemoDevice): PulseSnapshot {
  app.actions.demo.viewAs(device);
  return app.getSnapshot();
}

function incidentAs(device: DemoDevice, id: string | null): IncidentView {
  const view = as(device).incidents.find((i) => i.id === id);
  if (!view) throw new Error(`incident not on ${device}`);
  return view;
}

const fact = (view: IncidentView, field: string) => view.facts.find((f) => f.field === field);

describe('Demo app', () => {
  beforeEach(() => {
    app = createDemoApp({ aiDelayMs: 0 });
  });

  it('is not ready and shows nothing invented until the simulated world is seeded', async () => {
    const before = app.getSnapshot();
    expect(before).toMatchObject({ mode: 'demo', ready: false, incidents: [], peers: [], capabilities: null });
    expect(app.getSnapshot()).toBe(before);
    await ready();
    expect(app.getSnapshot().ready).toBe(true);
    expect(app.getSnapshot()).toBe(app.getSnapshot());
  });

  it('says demo and simulated everywhere, per device, and exposes the six scenarios', async () => {
    await ready();
    expect(app.internals.failures()).toEqual([]);
    const alex = as('alex');
    expect(alex.mode).toBe('demo');
    expect(alex.me).toMatchObject({ name: DEMO_PERSONAS.alex.name, onboarded: true, hardwareBackedKeys: false });
    expect(alex.capabilities).toMatchObject({ provider: 'Simulation', source: 'simulated', device: { model: 'iPhone 17 Pro Max' }, text: { state: 'ready' } });
    expect(alex.demo).toMatchObject({ viewingAs: 'alex', aiReady: true, links: { mika: true, noah: true }, runningScenario: null });
    expect(alex.demo?.scenarios.map((s) => s.key)).toEqual(['normal', 'intelligence', 'multi-responder', 'privacy', 'offline-recovery', 'complete']);
    expect(DEMO_SCENARIOS).toHaveLength(6);

    // Alex reaches Mika directly and Noah only through Mika.
    const reach = Object.fromEntries(alex.peers.map((p) => [p.name, [p.trusted, p.reach]]));
    expect(reach).toEqual({ 'Mika Santos': [true, 'connected'], 'Noah Cruz': [true, 'unreachable'] });

    for (const device of ['mika', 'noah'] as const) {
      const snapshot = as(device);
      expect(snapshot.mode).toBe('demo');
      expect(snapshot.me.name).toBe(DEMO_PERSONAS[device].name);
      // These phones do not run the text model, simulated or not.
      expect(snapshot.capabilities).toMatchObject({ source: 'simulated', provider: 'Simulation', text: { state: 'unavailable' } });
      expect(snapshot.demo?.viewingAs).toBe(device);
    }
    const ids = new Set((['alex', 'mika', 'noah'] as const).map((d) => as(d).me.deviceId));
    expect(ids.size).toBe(3);
  });

  it('seeds an open request, a resolved one and a cancelled one through real actions', async () => {
    await ready();
    const seedId = app.internals.seedIncidentId();
    const alex = as('alex');
    expect(alex.incidents.map((i) => [i.role, i.state.status.status])).toEqual([
      ['reporter', 'delivered'],
      ['responder', 'resolved'],
      ['reporter', 'cancelled'],
    ]);
    const open = incidentAs('alex', seedId);
    expect(open.originalReport).toBe(SAMPLE_REPORT);
    expect(open.pendingOutbox).toBe(0);
    expect(open.state.recipients.map((r) => [r.userName, r.level, r.delivery, r.capsuleDelivery, r.acknowledged])).toEqual([
      ['Mika Santos', 'trusted', 'delivered', 'delivered', false],
      ['Noah Cruz', 'authorized', 'delivered', 'delivered', false],
    ]);
    expect(open.state.tasks.map((t) => [t.kind, t.status])).toEqual([
      ['communicate', 'offered'],
      ['go_to_requester', 'offered'],
      ['confirm_location', 'in_progress'],
    ]);
    expect(fact(open, 'incidentType')).toMatchObject({ value: 'Possible slip or fall', tag: 'user_confirmed', by: 'You' });
    expect(fact(open, 'building')).toMatchObject({ value: 'Building B', tag: 'user_confirmed' });
    expect(fact(open, 'symptom')).toMatchObject({ value: 'Leg pain', tag: 'user_confirmed' });
    // The report never named a floor, so it stays unknown.
    expect(fact(open, 'floor')).toMatchObject({ value: null, tag: 'unknown', protected: false });
    expect(open.state.aiFindings.every((f) => f.provider === 'Simulation')).toBe(true);
    // Seeded history sits in the past.
    expect(Date.now() - (open.state.incident?.createdAtMs ?? 0)).toBeGreaterThanOrEqual(7 * 60_000);

    // Mika reads the summary; Noah, reached through Mika, reads everything Alex approved.
    const onMika = incidentAs('mika', seedId);
    expect(onMika).toMatchObject({ role: 'responder', access: 'trusted', originalReport: null, receivedViaName: null });
    expect(fact(onMika, 'symptom')).toMatchObject({ protected: true, value: null });
    expect(fact(onMika, 'building')).toMatchObject({ protected: false, value: 'Building B' });
    const onNoah = incidentAs('noah', seedId);
    expect(onNoah).toMatchObject({ role: 'responder', access: 'authorized', originalReport: SAMPLE_REPORT, receivedViaName: 'Mika Santos' });
    expect(fact(onNoah, 'symptom')).toMatchObject({ protected: false, value: 'Leg pain' });
    // Mika carried Noah's capsules and kept none of them.
    expect(app.internals.world()?.cores.mika.engine.relay.list()).toEqual([]);
  });

  it.each([
    ['normal', 'role_taken'],
    ['intelligence', 'delivered'],
    ['multi-responder', 'in_progress'],
    ['privacy', 'delivered'],
    ['offline-recovery', 'acknowledged'],
    ['complete', 'resolved'],
  ] as const)('runs the %s scenario to completion and ends %s on all three devices', async (key, status) => {
    await ready();
    await run(key);
    expect(app.internals.failures()).toEqual([]);
    const id = app.internals.lastIncidentId() ?? app.internals.seedIncidentId();
    for (const device of ['alex', 'mika', 'noah'] as const) {
      expect(incidentAs(device, id).state.status.status).toBe(status);
      expect(as(device).mode).toBe('demo');
      expect(as(device).capabilities?.source).toBe('simulated');
    }
    // Nothing is left waiting to be sent anywhere.
    for (const device of ['alex', 'mika', 'noah'] as const) expect(incidentAs(device, id).pendingOutbox).toBe(0);
  });

  it('normal: acknowledged first, then a role taken, and nothing implies arrival', async () => {
    await ready();
    app.actions.demo.runScenario('normal');
    const done = app.internals.scenarioFinished();
    await jest.advanceTimersByTimeAsync(1_000);
    const id = app.internals.lastIncidentId();
    expect(id).not.toBeNull();
    expect(incidentAs('alex', id).state.status.status).toBe('delivered');
    await jest.advanceTimersByTimeAsync(3_000);
    expect(incidentAs('alex', id).state.status.status).toBe('acknowledged');
    await jest.advanceTimersByTimeAsync(60_000);
    await done;
    const view = incidentAs('alex', id);
    expect(view.state.status).toEqual({ status: 'role_taken', reason: 'task_accepted' });
    expect(view.state.tasks.find((t) => t.kind === 'communicate')).toMatchObject({ status: 'accepted', assignee: { userName: 'Mika Santos' } });
    expect(view.state.tasks.find((t) => t.kind === 'go_to_requester')?.status).toBe('offered');
  });

  it('intelligence: clarified floor, a conflicting observation kept, resolved only by Alex', async () => {
    await ready();
    await run('intelligence');
    const id = app.internals.lastIncidentId();
    const view = incidentAs('alex', id);
    expect(fact(view, 'floor')).toMatchObject({ value: 'Second floor', tag: 'user_confirmed', candidates: [] });
    expect(view.state.contradictions).toEqual([expect.objectContaining({ field: 'floor', status: 'resolved', detectedBy: 'rule' })]);
    expect(view.state.contradictions[0]?.resolution?.resolvedBy.userName).toBe('Alex Rivera');
    expect(view.state.reports.map((r) => [r.author.userName, r.kind])).toEqual([
      ['Alex Rivera', 'report'],
      ['Mika Santos', 'observation'],
    ]);
    expect(view.state.claims.floor.revisions.map((r) => r.value)).toEqual(expect.arrayContaining(['First floor', 'Second floor']));
    expect(fact(incidentAs('mika', id), 'floor')).toMatchObject({ value: 'Second floor', tag: 'user_confirmed' });
    expect(fact(incidentAs('noah', id), 'symptom')).toMatchObject({ value: 'Leg pain', protected: false });
  });

  it('multi-responder: Mika communicates, Noah goes in person through the relay', async () => {
    await ready();
    await run('multi-responder');
    const view = incidentAs('alex', app.internals.seedIncidentId());
    expect(view.state.status).toEqual({ status: 'in_progress', reason: 'in_person_task_in_progress' });
    expect(view.state.tasks.find((t) => t.kind === 'communicate')).toMatchObject({ status: 'accepted', assignee: { userName: 'Mika Santos' } });
    expect(view.state.tasks.find((t) => t.kind === 'go_to_requester')).toMatchObject({
      status: 'in_progress',
      assignee: { userName: 'Noah Cruz' },
      declinedByDeviceIds: [as('mika').me.deviceId],
    });
    expect(view.state.recipients.every((r) => r.acknowledged)).toBe(true);
  });

  it('privacy: hiding symptoms protects them for everyone, sharing again restores the authorized view only', async () => {
    await ready();
    const id = app.internals.seedIncidentId();
    app.actions.demo.runScenario('privacy');
    const done = app.internals.scenarioFinished();
    await jest.advanceTimersByTimeAsync(8_000);
    expect(fact(incidentAs('noah', id), 'symptom')?.protected).toBe(true);
    expect(incidentAs('noah', id).originalReport).toBeNull();
    await jest.advanceTimersByTimeAsync(60_000);
    await done;
    expect(fact(incidentAs('noah', id), 'symptom')).toMatchObject({ protected: false, value: 'Leg pain' });
    expect(incidentAs('noah', id).originalReport).toBe(SAMPLE_REPORT);
    expect(fact(incidentAs('mika', id), 'symptom')?.protected).toBe(true);
    expect(incidentAs('mika', id).originalReport).toBeNull();
    expect(incidentAs('alex', id).state.capsules).toHaveLength(3);
  });

  it('offline-recovery: queued while Mika is out of range, delivered after reconnect, then acknowledged', async () => {
    await ready();
    app.actions.demo.runScenario('offline-recovery');
    const done = app.internals.scenarioFinished();
    await jest.advanceTimersByTimeAsync(2_000);
    const id = app.internals.lastIncidentId();
    expect(as('alex').demo?.links).toEqual({ mika: false, noah: true });
    expect(incidentAs('alex', id).state.status).toEqual({ status: 'queued', reason: 'awaiting_peer' });
    expect(incidentAs('alex', id).pendingOutbox).toBeGreaterThan(0);
    expect(as('mika').incidents.some((i) => i.id === id)).toBe(false);
    await jest.advanceTimersByTimeAsync(3_000);
    expect(as('alex').demo?.links).toEqual({ mika: true, noah: true });
    expect(incidentAs('alex', id).state.status.status).toBe('delivered');
    await jest.advanceTimersByTimeAsync(60_000);
    await done;
    expect(incidentAs('alex', id).state.status).toEqual({ status: 'acknowledged', reason: 'acknowledged_by_responder' });
    expect(incidentAs('alex', id).pendingOutbox).toBe(0);
  });

  it('complete: every role confirmed by Alex before Alex resolves', async () => {
    await ready();
    await run('complete');
    const view = incidentAs('alex', app.internals.lastIncidentId());
    expect(view.state.closure).toMatchObject({ kind: 'resolved', by: { userName: 'Alex Rivera' } });
    expect(view.state.tasks.filter((t) => t.kind !== 'confirm_location').map((t) => [t.kind, t.status, t.assignee?.userName])).toEqual([
      ['communicate', 'completion_confirmed', 'Mika Santos'],
      ['go_to_requester', 'completion_confirmed', 'Noah Cruz'],
    ]);
    const order = view.state.timeline.map((t) => t.type);
    const byMika = view.state.timeline.filter((t) => t.actor.userName === 'Mika Santos').map((t) => t.type);
    expect(byMika.indexOf('RESPONDER_ACKNOWLEDGED')).toBeLessThan(byMika.indexOf('TASK_ACCEPTED'));
    expect(order.lastIndexOf('TASK_COMPLETION_REPORTED')).toBeLessThan(order.lastIndexOf('TASK_COMPLETION_CONFIRMED'));
    expect(order[order.length - 1]).toBe('INCIDENT_RESOLVED');
    expect(view.pendingOutbox).toBe(0);
  });

  it('with the simulated model switched off the report still goes out as written', async () => {
    await ready();
    app.actions.demo.setAIReady(false);
    await jest.advanceTimersByTimeAsync(10);
    expect(as('alex').capabilities?.text.state).toBe('unavailable');
    expect(as('alex').demo?.aiReady).toBe(false);
    const id = app.internals.seedIncidentId() ?? '';
    const analysis = await app.actions.analyzeReport(id, incidentAs('alex', id).state.reports[0]?.id ?? '');
    expect(analysis).toMatchObject({ ok: false, state: 'unavailable', meta: { source: 'simulated' } });
    app.actions.demo.setAIReady(true);
    await jest.advanceTimersByTimeAsync(10);
    expect(as('alex').capabilities?.text.state).toBe('ready');
    expect(as('mika').capabilities?.text.state).toBe('unavailable');
  });

  it('actions go to the device being viewed, and link switches take effect', async () => {
    await ready();
    const id = app.internals.seedIncidentId() ?? '';
    app.actions.demo.viewAs('mika');
    expect((await app.actions.acknowledge(id)).ok).toBe(true);
    await app.internals.world()?.settle();
    expect(incidentAs('alex', id).state.recipients.map((r) => [r.userName, r.acknowledged])).toEqual([
      ['Mika Santos', true],
      ['Noah Cruz', false],
    ]);
    // Alex is the reporter and cannot acknowledge their own request.
    app.actions.demo.viewAs('alex');
    expect(await app.actions.acknowledge(id)).toMatchObject({ ok: false, code: 'not_recipient' });
    expect(app.actions.previewDisclosure(id, 'relay', { shareDetailedLocation: true, shareSymptoms: true, levels: {} }).every((f) => f.protected)).toBe(true);

    app.actions.demo.setLink('mika', false);
    await app.internals.world()?.settle();
    expect(as('alex').demo?.links.mika).toBe(false);
    expect(as('alex').peers.find((p) => p.name === 'Mika Santos')?.reach).toBe('unreachable');
    const sos = await app.actions.sendSOS();
    if (!sos.ok) throw new Error(sos.code);
    await app.internals.world()?.settle();
    expect(incidentAs('alex', sos.value.incidentId).state.status.status).toBe('queued');
    app.actions.demo.setLink('mika', true);
    await app.internals.world()?.settle();
    expect(incidentAs('alex', sos.value.incidentId).state.status.status).toBe('delivered');
    expect(incidentAs('noah', sos.value.incidentId).receivedViaName).toBe('Mika Santos');
  });

  it('reset restores the seed and cancels a running scenario', async () => {
    await ready();
    const seedView = (snapshot: PulseSnapshot) => snapshot.incidents.map((i) => [i.id, i.role, i.state.status.status, i.state.ledger.eventCount]);
    const seeded = seedView(as('alex'));

    app.actions.demo.runScenario('complete');
    await jest.advanceTimersByTimeAsync(9_000);
    expect(as('alex').incidents.length).toBeGreaterThan(seeded.length);
    app.actions.demo.viewAs('noah');
    app.actions.demo.setAIReady(false);
    app.actions.demo.reset();
    expect(app.getSnapshot().demo?.runningScenario).toBeNull();
    const rebuilt = app.internals.whenReady();
    await jest.advanceTimersByTimeAsync(120_000);
    await rebuilt;
    await app.internals.scenarioFinished();

    const after = app.getSnapshot();
    expect(after.demo).toMatchObject({ viewingAs: 'alex', aiReady: true, links: { mika: true, noah: true }, runningScenario: null });
    expect(seedView(after)).toEqual(seeded);
    expect(after.capabilities?.text.state).toBe('ready');
    expect(app.internals.failures()).toEqual([]);
    // The cancelled script did not keep going against the new world.
    expect(as('mika').incidents.map((i) => i.state.status.status).sort()).toEqual(['cancelled', 'delivered', 'resolved']);
  });

  it('notifies subscribers with a new snapshot only when the viewed device or demo state changes', async () => {
    await ready();
    const seen: PulseSnapshot[] = [];
    const unsubscribe = app.subscribe(() => seen.push(app.getSnapshot()));
    const before = app.getSnapshot();
    app.actions.demo.viewAs('alex');
    expect(app.getSnapshot()).toBe(before);
    expect(seen).toHaveLength(0);
    app.actions.demo.viewAs('mika');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(app.getSnapshot());
    expect(seen[0]).not.toBe(before);
    expect(Object.isFrozen(seen[0])).toBe(true);
    unsubscribe();
    app.actions.demo.viewAs('noah');
    expect(seen).toHaveLength(1);
  });
});
