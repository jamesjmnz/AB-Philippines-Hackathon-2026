import { createFakeCapsuleCrypto } from '@/crypto/testing';
import type { CapsuleCrypto } from '@/crypto/types';
import { createSequentialIds } from '@/domain';
import { SimulatedAI } from '@/demo/SimulatedAI';
import { createMemoryIncidentRepository } from '@/storage';
import { utf8ToBytes } from '@/transport/base64';

import { createMemoryKeyValueStore } from '../kv';
import { PulseCore } from '../PulseCore';
import { createInertTimers, createTestNet, dev, must, type TestNet } from '../testing/harness';

let net: TestNet;
let extra: PulseCore[] = [];
afterEach(async () => {
  await Promise.all(extra.map((core) => core.dispose()));
  extra = [];
  await net.dispose();
});

describe('pairing', () => {
  it('trusts a peer only after both people confirmed the same code', async () => {
    net = await createTestNet({ devices: ['a', 'b'] });
    const a = dev(net, 'a');
    const b = dev(net, 'b');
    // Discovered but unpaired: visible as a nameless nearby device, never as a trusted identity.
    expect(a.core.getSnapshot().peers).toEqual([{ deviceId: b.id, name: 'Nearby iPhone', trusted: false, reach: 'discovered', lastSeenMs: net.clock.nowMs() }]);

    must(await a.core.actions.startPairing(b.id));
    await net.settle();
    const onA = a.core.getSnapshot().pairing;
    const onB = b.core.getSnapshot().pairing;
    expect(onA).toMatchObject({ peerDeviceId: b.id, peerName: 'b', stage: 'compare', error: null });
    expect(onB).toMatchObject({ peerDeviceId: a.id, peerName: 'a', stage: 'compare', error: null });
    expect(onA?.code).toMatch(/^\d{6}$/);
    expect(onA?.code).toBe(onB?.code);

    // One-sided confirmation: nobody is trusted yet.
    must(await a.core.actions.confirmPairing());
    await net.settle();
    expect(a.core.getSnapshot().pairing?.stage).toBe('awaiting_peer');
    expect(b.core.getSnapshot().pairing?.stage).toBe('compare');
    expect(a.core.getSnapshot().peers.some((p) => p.trusted)).toBe(false);
    expect(b.core.getSnapshot().peers.some((p) => p.trusted)).toBe(false);

    // Until then an SOS has no recipient and b ignores anything a sends.
    const early = must(await a.core.actions.sendSOS());
    await net.settle();
    expect(a.incident(early.incidentId)?.state.status.reason).toBe('no_trusted_peer');
    expect(await b.repo.allIncidentIds()).toEqual([]);

    must(await b.core.actions.confirmPairing());
    await net.settle();
    expect(a.core.getSnapshot().pairing).toBeNull();
    expect(b.core.getSnapshot().pairing).toBeNull();
    expect(a.core.getSnapshot().peers).toEqual([expect.objectContaining({ deviceId: b.id, name: 'b', trusted: true, reach: 'connected' })]);
    expect(b.core.getSnapshot().peers).toEqual([expect.objectContaining({ deviceId: a.id, name: 'a', trusted: true, reach: 'connected' })]);
    expect(a.kv.dump().peers).toContain(b.id);

    // The pairing is usable: a new SOS is delivered and receipted.
    const { incidentId } = must(await a.core.actions.sendSOS());
    await net.settle();
    expect(a.incident(incidentId)?.state.status.status).toBe('delivered');
    expect(b.incident(incidentId)?.access).toBe('trusted');

    // Rename is a local label; removal ends trust.
    await a.core.actions.renamePeer(b.id, 'Bea');
    expect(a.core.getSnapshot().peers[0]?.name).toBe('Bea');
    await a.core.actions.removePeer(b.id);
    await net.settle();
    expect(a.core.getSnapshot().peers.some((p) => p.trusted)).toBe(false);
  });

  it('cancelling leaves both sides untrusted', async () => {
    net = await createTestNet({ devices: ['a', 'b'] });
    const a = dev(net, 'a');
    const b = dev(net, 'b');
    must(await a.core.actions.startPairing(b.id));
    await net.settle();
    must(await a.core.actions.confirmPairing());
    await net.settle();
    await b.core.actions.cancelPairing();
    await net.settle();
    expect(b.core.getSnapshot().pairing).toBeNull();
    expect(a.core.getSnapshot().pairing).toMatchObject({ stage: 'failed', error: 'pairing_cancelled' });
    expect(a.core.getSnapshot().peers.some((p) => p.trusted)).toBe(false);
    // Confirming after the other side left does nothing.
    expect(await a.core.actions.confirmPairing()).toMatchObject({ ok: false, code: 'pairing_no_session' });
    await a.core.actions.cancelPairing();
    expect(a.core.getSnapshot().pairing).toBeNull();
  });

  it('fails when the key material does not belong to the device that sent it', async () => {
    net = await createTestNet({ devices: ['a'] });
    const a = dev(net, 'a');
    // An impostor answering with someone else's keys under its own link.
    const honest = createFakeCapsuleCrypto(net.realm, 'test-mallory');
    const victim = await createFakeCapsuleCrypto(net.realm, 'test-victim').exportPublicPairingMaterial();
    const lying: CapsuleCrypto = { ...honest, exportPublicPairingMaterial: async () => victim };
    const mallory = new PulseCore({
      mode: 'live',
      repo: createMemoryIncidentRepository(),
      ai: new SimulatedAI({ device: { model: 'x', osVersion: '0' }, textCapable: false }),
      transport: net.hub.createTransport(),
      crypto: lying,
      kv: createMemoryKeyValueStore(),
      clock: net.clock,
      ids: createSequentialIds('mallory'),
      deviceInfo: { model: 'x', osVersion: '0' },
      timers: createInertTimers(),
      seed: { name: 'b', onboarded: true },
    });
    extra.push(mallory);
    await mallory.start();
    await net.settle();
    const malloryId = mallory.getSnapshot().me.deviceId;

    const result = await a.core.actions.startPairing(malloryId);
    await net.settle();
    expect(result).toMatchObject({ ok: false, code: 'pairing_material_mismatch' });
    expect(a.core.getSnapshot().pairing).toMatchObject({ stage: 'failed', error: 'pairing_material_mismatch' });
    expect(a.core.getSnapshot().peers.some((p) => p.trusted)).toBe(false);
  });

  it('fails on a confirmation that was not signed by the peer key, and on malformed material', async () => {
    net = await createTestNet({ devices: ['a', 'b'] });
    const a = dev(net, 'a');
    const b = dev(net, 'b');
    must(await a.core.actions.startPairing(b.id));
    await net.settle();
    must(await a.core.actions.confirmPairing());
    await net.settle();
    net.hub.inject(b.id, a.id, utf8ToBytes(JSON.stringify({ v: 1, packetId: 'pair-forged', kind: 'pair_confirm', hops: 0, to: a.id, pairing: { signature: 'sim-sig-forged-forged-forged' } })));
    await net.settle();
    expect(a.core.getSnapshot().pairing).toMatchObject({ stage: 'failed', error: 'pairing_bad_confirmation' });
    expect(a.core.getSnapshot().peers.some((p) => p.trusted)).toBe(false);

    // A hello whose device id is not derived from its keys.
    await a.core.actions.cancelPairing();
    await b.core.actions.cancelPairing();
    await net.settle();
    const forged = { ...b.material, signKey: `${b.material.signKey}ff` };
    const starting = a.core.actions.startPairing(b.id);
    net.hub.setFault(b.id, a.id, { drop: true });
    await net.settle();
    net.hub.inject(b.id, a.id, utf8ToBytes(JSON.stringify({ v: 1, packetId: 'pair-forged-2', kind: 'pair_hello', hops: 0, to: a.id, pairing: { material: forged, name: 'b' } })));
    await net.settle();
    expect(await starting).toMatchObject({ ok: false, code: 'pairing_material_mismatch' });
    expect(a.core.getSnapshot().pairing?.stage).toBe('failed');
  });

  it('reports an unreachable device instead of hanging', async () => {
    net = await createTestNet({ devices: ['a', 'b'], links: [] });
    const result = await dev(net, 'a').core.actions.startPairing(dev(net, 'b').id);
    expect(result).toMatchObject({ ok: false, code: 'peer_unreachable' });
    expect(dev(net, 'a').core.getSnapshot().pairing).toBeNull();
  });
});
