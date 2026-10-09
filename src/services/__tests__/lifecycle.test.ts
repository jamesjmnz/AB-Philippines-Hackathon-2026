import type { IncidentState } from '@/domain';

import { createTestNet, dev, must, type TestNet } from '../testing/harness';

let net: TestNet;
afterEach(async () => {
  await net.dispose();
});

function received(state: IncidentState | undefined): number {
  return (state?.events ?? []).filter((e) => e.type === 'PACKET_RECEIVED_BY_PEER').length;
}

describe('app lifecycle', () => {
  it('drops the radio in the background, keeps an SOS queued, and delivers it once after foreground', async () => {
    net = await createTestNet({ devices: ['a', 'b'], trust: [['a', 'b', 'authorized', 'trusted']] });
    const a = dev(net, 'a');
    const b = dev(net, 'b');
    expect(a.core.getSnapshot().peers[0]?.reach).toBe('connected');

    await a.core.setAppActive(false);
    await net.settle();
    expect(a.core.getSnapshot().network.discovery).toBe('off');
    expect(a.core.getSnapshot().peers[0]?.reach).toBe('unreachable');
    expect(b.core.getSnapshot().peers[0]?.reach).toBe('unreachable');
    // The person's choice is untouched: only the radio is paused.
    expect(a.core.getSnapshot().settings.discoveryEnabled).toBe(true);

    const { incidentId } = must(await a.core.actions.sendSOS());
    net.clock.advance(5_000);
    a.timers.fireIntervals();
    await net.settle();
    expect(a.incident(incidentId)?.state.status).toEqual({ status: 'queued', reason: 'awaiting_peer' });
    expect(a.incident(incidentId)?.pendingOutbox).toBe(1);
    expect(b.incident(incidentId)).toBeUndefined();
    expect(net.wire).toHaveLength(0);

    await a.core.setAppActive(true);
    await net.settle();
    expect(a.core.getSnapshot().network.discovery).toBe('on');
    expect(a.core.getSnapshot().peers[0]?.reach).toBe('connected');
    expect(a.incident(incidentId)?.state.status).toEqual({ status: 'delivered', reason: 'delivered_with_receipt' });
    expect(a.incident(incidentId)?.pendingOutbox).toBe(0);
    expect(received(a.incident(incidentId)?.state)).toBe(1);
    expect(b.core.getSnapshot().incidents).toHaveLength(1);
    // The alert itself crossed the radio once (what follows it is the sync of the receipt event).
    const alertId = net.wire.find((p) => p.from === a.id && p.packet?.kind === 'capsule')?.packet?.packetId;
    expect(net.wire.filter((p) => p.packet?.packetId === alertId)).toHaveLength(1);
    expect(a.incident(incidentId)?.state.packets.filter((p) => p.delivery === 'delivered').map((p) => p.packetId)).toContain(alertId);
  });

  it('is idempotent and never restarts a radio the person switched off', async () => {
    net = await createTestNet({ devices: ['a', 'b'], trust: [['a', 'b', 'authorized', 'trusted']] });
    const a = dev(net, 'a');
    const starts = jest.spyOn(a.transport, 'startDiscovery');
    const stops = jest.spyOn(a.transport, 'stopDiscovery');

    // Already active: nothing to do.
    await a.core.setAppActive(true);
    expect(starts).not.toHaveBeenCalled();
    await Promise.all([a.core.setAppActive(false), a.core.setAppActive(false)]);
    expect(stops).toHaveBeenCalledTimes(1);
    await Promise.all([a.core.setAppActive(true), a.core.setAppActive(true)]);
    await net.settle();
    expect(starts).toHaveBeenCalledTimes(1);
    expect(a.core.getSnapshot().peers[0]?.reach).toBe('connected');

    await a.core.actions.setDiscovery(false);
    starts.mockClear();
    await a.core.setAppActive(false);
    await a.core.setAppActive(true);
    await net.settle();
    expect(starts).not.toHaveBeenCalled();
    expect(a.core.getSnapshot().network.discovery).toBe('off');
  });

  it('does not hold an SOS back while the radio is hanging on a lifecycle change', async () => {
    net = await createTestNet({ devices: ['a', 'b'], trust: [['a', 'b', 'authorized', 'trusted']] });
    const a = dev(net, 'a');
    a.transport.stopDiscovery = () => new Promise<void>(() => undefined);
    void a.core.setAppActive(false);
    const { incidentId } = must(await a.core.actions.sendSOS());
    expect(await a.repo.allIncidentIds()).toEqual([incidentId]);
    expect(a.incident(incidentId)?.state.status.status).toBe('queued');
  });
});
