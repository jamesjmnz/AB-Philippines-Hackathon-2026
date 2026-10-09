import { SimulatedAI } from '@/demo/SimulatedAI';
import { createFakeCapsuleCrypto } from '@/crypto/testing';
import { createSequentialIds } from '@/domain';

import type { PulseSnapshot } from '../api';
import { PulseCore } from '../PulseCore';
import { createInertTimers, createTestNet, dev, must, type TestNet } from '../testing/harness';

let net: TestNet;
afterEach(async () => {
  await net.dispose();
});

describe('snapshot', () => {
  it('keeps the same reference until something changes, and notifies only after the new one is in place', async () => {
    net = await createTestNet({ devices: ['a', 'b'], trust: [['a', 'b', 'authorized', 'trusted']] });
    const a = dev(net, 'a');
    const seen: PulseSnapshot[] = [];
    const unsubscribe = a.core.subscribe(() => seen.push(a.core.getSnapshot()));

    const first = a.core.getSnapshot();
    expect(a.core.getSnapshot()).toBe(first);
    expect(first.ready).toBe(true);
    expect(first.mode).toBe('live');
    expect(Object.isFrozen(first)).toBe(true);

    // Rebuilding with nothing new neither replaces the snapshot nor wakes subscribers.
    await a.core.refresh();
    await a.core.actions.retryDelivery();
    await a.core.actions.updateSettings({ relayEnabled: true });
    await net.settle();
    expect(a.core.getSnapshot()).toBe(first);
    expect(seen).toHaveLength(0);

    const { incidentId } = must(await a.core.actions.sendSOS());
    const afterSOS = a.core.getSnapshot();
    expect(afterSOS).not.toBe(first);
    expect(first.incidents).toHaveLength(0);
    expect(afterSOS.incidents.map((i) => i.id)).toEqual([incidentId]);
    // Parts that did not change keep their identity, so selectors do not re-render for nothing.
    expect(afterSOS.settings).toBe(first.settings);
    expect(afterSOS.me).toBe(first.me);
    expect(seen.length).toBeGreaterThan(0);
    // Every notification handed out the snapshot that was current at that moment, each a new object.
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen[seen.length - 1]).toBe(afterSOS);

    await net.settle();
    const settled = a.core.getSnapshot();
    expect(settled.incidents[0]?.state.status.status).toBe('delivered');
    expect(afterSOS.incidents[0]?.state.status.status).toBe('queued');
    expect(a.core.getSnapshot()).toBe(settled);
    await a.core.refresh();
    expect(a.core.getSnapshot()).toBe(settled);

    // A settings change replaces settings only.
    await a.core.actions.updateSettings({ showTechnicalDetails: true });
    const afterSettings = a.core.getSnapshot();
    expect(afterSettings).not.toBe(settled);
    expect(afterSettings.settings.showTechnicalDetails).toBe(true);
    expect(afterSettings.incidents).toBe(settled.incidents);
    expect(afterSettings.peers).toBe(settled.peers);

    unsubscribe();
    const count = seen.length;
    await a.core.actions.updateSettings({ showTechnicalDetails: false });
    expect(seen).toHaveLength(count);
  });

  it('restores profile, settings, pairings and incidents from storage after a restart', async () => {
    net = await createTestNet({ devices: ['a', 'b'], trust: [['a', 'b', 'authorized', 'trusted']] });
    const a = dev(net, 'a');
    await a.core.actions.completeOnboarding({ name: '  Alex R  ' });
    await a.core.actions.updateSettings({ sosCountdownSeconds: 9, relayEnabled: false });
    const { incidentId } = must(await a.core.actions.sendSOS());
    await net.settle();
    await a.core.dispose();

    const restarted = new PulseCore({
      mode: 'live',
      repo: a.repo,
      ai: new SimulatedAI({ device: { model: 'Test iPhone', osVersion: '0' }, textCapable: true }),
      transport: net.hub.createTransport(),
      crypto: createFakeCapsuleCrypto(net.realm, 'test-a'),
      kv: a.kv,
      clock: net.clock,
      ids: createSequentialIds('a2'),
      deviceInfo: { model: 'Test iPhone', osVersion: '0' },
      timers: createInertTimers(),
    });
    await restarted.start();
    await restarted.whenIdle();
    const snapshot = restarted.getSnapshot();
    expect(snapshot.me).toMatchObject({ deviceId: a.id, name: 'Alex R', onboarded: true });
    expect(snapshot.settings).toMatchObject({ sosCountdownSeconds: 9, relayEnabled: false });
    expect(snapshot.peers.filter((p) => p.trusted).map((p) => p.deviceId)).toEqual([dev(net, 'b').id]);
    expect(snapshot.incidents.map((i) => [i.id, i.role, i.state.status.status])).toEqual([[incidentId, 'reporter', 'delivered']]);
    await restarted.dispose();
  });

  it('deleting all incidents keeps identity and pairings', async () => {
    net = await createTestNet({ devices: ['a', 'b'], trust: [['a', 'b', 'authorized', 'trusted']] });
    const a = dev(net, 'a');
    must(await a.core.actions.sendSOS());
    await net.settle();
    await a.core.actions.deleteAllIncidents();
    const snapshot = a.core.getSnapshot();
    expect(snapshot.incidents).toEqual([]);
    expect(snapshot.me.deviceId).toBe(a.id);
    expect(snapshot.peers.filter((p) => p.trusted)).toHaveLength(1);
    expect(await a.repo.allIncidentIds()).toEqual([]);
  });

  it('reports discovery state and turns it off without touching stored incidents', async () => {
    net = await createTestNet({ devices: ['a', 'b'], trust: [['a', 'b', 'authorized', 'trusted']] });
    const a = dev(net, 'a');
    expect(a.core.getSnapshot().network).toEqual({ discovery: 'on', error: null });
    expect(a.core.getSnapshot().peers[0]?.reach).toBe('connected');
    await a.core.actions.setDiscovery(false);
    await net.settle();
    expect(a.core.getSnapshot().network.discovery).toBe('off');
    expect(a.core.getSnapshot().settings.discoveryEnabled).toBe(false);
    expect(a.core.getSnapshot().peers[0]?.reach).toBe('unreachable');
    const { incidentId } = must(await a.core.actions.sendSOS());
    await net.settle();
    expect(a.incident(incidentId)?.state.status.reason).toBe('awaiting_peer');
    await a.core.actions.setDiscovery(true);
    await net.settle();
    expect(a.incident(incidentId)?.state.status.status).toBe('delivered');
  });
});
