import type { IncidentState } from '@/domain';

import { createTestNet, dev, must, type TestNet } from '../testing/harness';

let net: TestNet;
afterEach(async () => {
  await net.dispose();
});

function received(state: IncidentState | undefined, packetId: string): number {
  return (state?.events ?? []).filter((e) => e.type === 'PACKET_RECEIVED_BY_PEER' && e.payload.packetId === packetId).length;
}

describe('SOS delivery', () => {
  it('stays queued with no trusted peer and still succeeds', async () => {
    net = await createTestNet({ devices: ['a'] });
    const a = dev(net, 'a');
    const { incidentId } = must(await a.core.actions.sendSOS());
    await net.settle();
    const view = a.incident(incidentId);
    expect(view?.state.status).toEqual({ status: 'queued', reason: 'no_trusted_peer' });
    expect(view?.role).toBe('reporter');
    expect(view?.pendingOutbox).toBe(0);
  });

  it('is queued while the peer is out of range and delivered only after a signed receipt', async () => {
    net = await createTestNet({ devices: ['a', 'b'], trust: [['a', 'b', 'authorized', 'trusted']], links: [] });
    const a = dev(net, 'a');
    const b = dev(net, 'b');
    const { incidentId } = must(await a.core.actions.sendSOS());
    await net.settle();
    expect(a.incident(incidentId)?.state.status).toEqual({ status: 'queued', reason: 'awaiting_peer' });
    expect(a.incident(incidentId)?.pendingOutbox).toBe(1);
    expect(b.incident(incidentId)).toBeUndefined();
    expect(net.wire).toHaveLength(0);

    // The link is up but the receipt never makes it back: a send attempt is not a delivery.
    net.hub.setFault(b.id, a.id, { drop: true });
    net.hub.setLink(a.id, b.id, true);
    await net.settle();
    expect(b.incident(incidentId)).toBeDefined();
    expect(a.incident(incidentId)?.state.status).toEqual({ status: 'queued', reason: 'send_attempted_no_receipt' });
    expect(a.incident(incidentId)?.state.recipients[0]?.delivery).toBe('send_attempted');
    expect(a.incident(incidentId)?.pendingOutbox).toBeGreaterThan(0);

    // Receipts can flow again; the retry timer resends once the backoff has passed.
    net.hub.setFault(b.id, a.id, {});
    net.clock.advance(5_000);
    a.timers.fireIntervals();
    await net.settle();
    expect(a.incident(incidentId)?.state.status).toEqual({ status: 'delivered', reason: 'delivered_with_receipt' });
    expect(a.incident(incidentId)?.pendingOutbox).toBe(0);
    expect(b.incident(incidentId)?.state.status.status).toBe('delivered');
  });

  it('reconnect delivers exactly once; a replayed packet changes nothing and is receipted again', async () => {
    net = await createTestNet({ devices: ['a', 'b'], trust: [['a', 'b', 'authorized', 'trusted']], links: [] });
    const a = dev(net, 'a');
    const b = dev(net, 'b');
    const { incidentId } = must(await a.core.actions.sendSOS());
    await net.settle();
    expect(await a.repo.getPendingOutbox(incidentId)).toHaveLength(1);

    net.hub.setLink(a.id, b.id, true);
    await net.settle();
    const alert = net.wire.find((p) => p.from === a.id && p.packet?.kind === 'capsule');
    expect(alert?.packet).toBeTruthy();
    const packetId = alert?.packet?.packetId ?? '';
    expect(a.incident(incidentId)?.state.status.status).toBe('delivered');
    expect(await a.repo.getPendingOutbox()).toHaveLength(0);
    expect(b.core.getSnapshot().incidents).toHaveLength(1);
    expect(received(a.incident(incidentId)?.state, packetId)).toBe(1);

    const eventsBefore = (await b.repo.eventsForIncident(incidentId)).length;
    const receiptsBefore = net.wire.filter((p) => p.from === b.id && p.packet?.kind === 'receipt').length;
    net.hub.inject(a.id, b.id, alert?.bytes ?? new Uint8Array());
    net.hub.inject(a.id, b.id, alert?.bytes ?? new Uint8Array());
    await net.settle();
    expect((await b.repo.eventsForIncident(incidentId)).length).toBe(eventsBefore);
    expect(b.core.getSnapshot().incidents).toHaveLength(1);
    expect(net.wire.filter((p) => p.from === b.id && p.packet?.kind === 'receipt').length).toBe(receiptsBefore + 2);
    // The extra receipts are for a packet already cleared: no second delivery record, nothing re-queued.
    expect(received(a.incident(incidentId)?.state, packetId)).toBe(1);
    expect(await a.repo.getPendingOutbox()).toHaveLength(0);
    expect(await b.repo.quarantined()).toHaveLength(0);
  });

  it('tolerates duplicated and reordered packets', async () => {
    net = await createTestNet({ devices: ['a', 'b'], trust: [['a', 'b', 'authorized', 'authorized']] });
    const a = dev(net, 'a');
    const b = dev(net, 'b');
    net.hub.setFault(a.id, b.id, { duplicate: true });
    const { incidentId } = must(await a.core.actions.sendSOS());
    await net.settle();
    expect(b.core.getSnapshot().incidents).toHaveLength(1);

    net.hub.setFault(a.id, b.id, { hold: true });
    must(await a.core.actions.offerTask(incidentId, { kind: 'communicate', title: 'Call the front desk', toDeviceId: b.id }));
    must(await a.core.actions.offerTask(incidentId, { kind: 'go_to_requester', title: 'Come over', toDeviceId: b.id }));
    await net.settle();
    expect(b.incident(incidentId)?.state.tasks).toHaveLength(0);
    net.hub.setFault(a.id, b.id, {});
    net.hub.release(a.id, b.id, 'reverse');
    await net.settle();
    expect(b.incident(incidentId)?.state.tasks.map((t) => t.kind).sort()).toEqual(['communicate', 'go_to_requester']);
    expect(b.incident(incidentId)?.state.tasks).toEqual(a.incident(incidentId)?.state.tasks);
    expect(await a.repo.getPendingOutbox()).toHaveLength(0);
  });
});

describe('CareChain between two devices', () => {
  it('keeps delivered, acknowledged, accepted, in progress, completion reported, confirmed and resolved distinct on both devices', async () => {
    net = await createTestNet({ devices: ['a', 'b'], trust: [['a', 'b', 'authorized', 'trusted']] });
    const a = dev(net, 'a');
    const b = dev(net, 'b');
    const both = (id: string) => [a.incident(id)?.state, b.incident(id)?.state] as const;
    const expectBoth = (id: string, status: string, taskStatus?: string) => {
      for (const state of both(id)) {
        expect(state?.status.status).toBe(status);
        if (taskStatus !== undefined) expect(state?.tasks[0]?.status).toBe(taskStatus);
      }
    };

    const { incidentId } = must(await a.core.actions.sendSOS());
    await net.settle();
    expectBoth(incidentId, 'delivered');
    expect(b.incident(incidentId)?.role).toBe('responder');
    expect(b.incident(incidentId)?.access).toBe('authorized');
    expect(a.incident(incidentId)?.state.recipients[0]?.acknowledged).toBe(false);

    must(await b.core.actions.acknowledge(incidentId));
    await net.settle();
    expectBoth(incidentId, 'acknowledged');
    expect(a.incident(incidentId)?.state.tasks).toHaveLength(0);

    must(await a.core.actions.offerTask(incidentId, { kind: 'go_to_requester', title: 'Come to me', toDeviceId: b.id }));
    await net.settle();
    // An offer is not an acceptance.
    expectBoth(incidentId, 'acknowledged', 'offered');
    const taskId = b.incident(incidentId)?.state.tasks[0]?.id ?? '';

    must(await b.core.actions.acceptTask(incidentId, taskId));
    await net.settle();
    expectBoth(incidentId, 'role_taken', 'accepted');

    must(await b.core.actions.startTask(incidentId, taskId, 'On my way'));
    await net.settle();
    expectBoth(incidentId, 'in_progress', 'in_progress');

    must(await b.core.actions.reportTaskComplete(incidentId, taskId));
    await net.settle();
    expectBoth(incidentId, 'role_taken', 'completion_reported');

    // Only the reporter confirms completion.
    const refused = await b.core.actions.confirmTaskComplete(incidentId, taskId);
    expect(refused).toMatchObject({ ok: false, code: 'not_reporter' });
    must(await a.core.actions.confirmTaskComplete(incidentId, taskId));
    await net.settle();
    expectBoth(incidentId, 'role_taken', 'completion_confirmed');

    must(await a.core.actions.resolveIncident(incidentId, 'All good'));
    await net.settle();
    expectBoth(incidentId, 'resolved', 'completion_confirmed');

    const [sa, sb] = both(incidentId);
    expect(sb?.recipients).toEqual(sa?.recipients);
    expect(sb?.tasks).toEqual(sa?.tasks);
    expect(sb?.closure).toEqual(sa?.closure);
    expect(await a.repo.getPendingOutbox()).toHaveLength(0);
    expect(await b.repo.getPendingOutbox()).toHaveLength(0);
  });

  it('a responder declining the request is not an acknowledgment of help, and cancel reaches the responder', async () => {
    net = await createTestNet({ devices: ['a', 'b'], trust: [['a', 'b', 'trusted', 'trusted']] });
    const a = dev(net, 'a');
    const b = dev(net, 'b');
    const { incidentId } = must(await a.core.actions.sendSOS());
    await net.settle();
    must(await b.core.actions.declineRequest(incidentId));
    await net.settle();
    expect(a.incident(incidentId)?.state.recipients[0]).toMatchObject({ declined: true, acknowledged: false });
    expect(a.incident(incidentId)?.state.status.status).toBe('delivered');
    must(await a.core.actions.cancelIncident(incidentId));
    await net.settle();
    expect(b.incident(incidentId)?.state.status.status).toBe('cancelled');
  });
});
