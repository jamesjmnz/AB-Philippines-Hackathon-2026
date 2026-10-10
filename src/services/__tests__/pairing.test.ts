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

  it('waits for the link before sending its hello when connect returns early', async () => {
    net = await createTestNet({ devices: ['a', 'b'] });
    const a = dev(net, 'a');
    const b = dev(net, 'b');
    // The native transport resolves `connect` as soon as the dial is requested; the link comes up later.
    const dial = a.transport.connect.bind(a.transport);
    let finishDial: (() => Promise<void>) | null = null;
    a.transport.connect = async (peerId) => {
      finishDial = () => dial(peerId);
    };

    const started = a.core.actions.startPairing(b.id);
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(finishDial).not.toBeNull();
    await finishDial!();
    must(await started);
    await net.settle();
    expect(a.core.getSnapshot().pairing).toMatchObject({ peerDeviceId: b.id, stage: 'compare' });
    expect(b.core.getSnapshot().pairing).toMatchObject({ peerDeviceId: a.id, stage: 'compare' });
  });

  it('gives up when the link never comes up', async () => {
    net = await createTestNet({ devices: ['a', 'b'] });
    const a = dev(net, 'a');
    a.transport.connect = async () => undefined;
    const started = a.core.actions.startPairing(dev(net, 'b').id);
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    a.timers.fireTimeouts();
    expect(await started).toMatchObject({ ok: false, code: 'peer_unreachable' });
    expect(a.core.getSnapshot().pairing).toBeNull();
  });

  describe('a lost confirmation', () => {
    const confirms = (from?: string) => net.wire.filter((p) => p.packet?.kind === 'pair_confirm' && (from === undefined || p.from === from));
    const trusts = (name: string, other: string) =>
      dev(net, name).core.getSnapshot().peers.some((p) => p.deviceId === dev(net, other).id && p.trusted);

    /** Both compare, a confirms, then b's confirmation is lost: b trusts a, a is still waiting. */
    async function oneSided(): Promise<void> {
      net = await createTestNet({ devices: ['a', 'b', 'c'], trust: [['b', 'c', 'trusted', 'trusted']] });
      const a = dev(net, 'a');
      const b = dev(net, 'b');
      must(await a.core.actions.startPairing(b.id));
      await net.settle();
      must(await a.core.actions.confirmPairing());
      await net.settle();
      net.hub.setFault(b.id, a.id, { drop: true });
      must(await b.core.actions.confirmPairing());
      await net.settle();
      net.hub.setFault(b.id, a.id, {});
      expect(trusts('b', 'a')).toBe(true);
      expect(trusts('a', 'b')).toBe(false);
      expect(a.core.getSnapshot().pairing?.stage).toBe('awaiting_peer');
    }

    it('is repeated on the retry tick until both sides trust each other, and then stops', async () => {
      await oneSided();
      const a = dev(net, 'a');
      const b = dev(net, 'b');
      a.timers.fireIntervals();
      await net.settle();
      expect(trusts('a', 'b')).toBe(true);
      expect(trusts('b', 'a')).toBe(true);
      expect(a.core.getSnapshot().pairing).toBeNull();
      expect(b.core.getSnapshot().pairing).toBeNull();
      // a's confirmation, b's lost one, a's repeat, b's answer. An answer is never answered.
      expect(confirms()).toHaveLength(4);
      a.timers.fireIntervals();
      b.timers.fireIntervals();
      await net.settle();
      expect(confirms()).toHaveLength(4);

      // A duplicated repeat arriving after both finished is answered, and the answers end there.
      const repeat = confirms(a.id)[1];
      net.hub.inject(a.id, b.id, repeat?.bytes ?? new Uint8Array());
      await net.settle();
      expect(confirms()).toHaveLength(5);

      const { incidentId } = must(await a.core.actions.sendSOS());
      await net.settle();
      expect(a.incident(incidentId)?.state.status.status).toBe('delivered');
    });

    it('is repeated when the link comes back', async () => {
      await oneSided();
      const a = dev(net, 'a');
      const b = dev(net, 'b');
      net.hub.setLink(a.id, b.id, false);
      await net.settle();
      net.hub.setLink(a.id, b.id, true);
      await net.settle();
      expect(trusts('a', 'b')).toBe(true);
      expect(trusts('b', 'a')).toBe(true);
      expect(a.core.getSnapshot().pairing).toBeNull();
    });

    it('converges when the first confirmation is the one that was lost', async () => {
      net = await createTestNet({ devices: ['a', 'b'] });
      const a = dev(net, 'a');
      const b = dev(net, 'b');
      must(await a.core.actions.startPairing(b.id));
      await net.settle();
      net.hub.setFault(a.id, b.id, { drop: true });
      must(await a.core.actions.confirmPairing());
      await net.settle();
      net.hub.setFault(a.id, b.id, {});
      must(await b.core.actions.confirmPairing());
      await net.settle();
      // a finished on b's confirmation; b never saw a's.
      expect(trusts('a', 'b')).toBe(true);
      expect(trusts('b', 'a')).toBe(false);
      expect(b.core.getSnapshot().pairing?.stage).toBe('awaiting_peer');

      b.timers.fireIntervals();
      await net.settle();
      expect(trusts('b', 'a')).toBe(true);
      expect(b.core.getSnapshot().pairing).toBeNull();
    });

    it('is not answered, and creates no trust, when the repeat is forged or belongs to another pairing', async () => {
      await oneSided();
      const a = dev(net, 'a');
      const b = dev(net, 'b');
      const c = dev(net, 'c');
      const fromA = confirms(a.id)[0];
      const fromB = confirms(b.id)[0];
      const before = net.wire.length;
      const peersOf = (name: string) => dev(net, name).kv.dump().peers;
      const stored = { b: peersOf('b'), c: peersOf('c') };
      const packet = (to: string, pairing: unknown, kind = 'pair_confirm') =>
        utf8ToBytes(JSON.stringify({ v: 1, packetId: `pair-x-${net.wire.length}-${Math.random().toString(16).slice(2, 8)}`, kind, hops: 0, to, pairing }));

      // Not signed by the stored key of the device b trusts.
      net.hub.inject(a.id, b.id, packet(b.id, { signature: 'sim-sig-forged-forged-forged' }));
      // b's real confirmation of its pairing with a, replayed at c (which trusts b): another transcript.
      net.hub.inject(b.id, c.id, packet(c.id, (fromB?.packet as { pairing?: unknown } | null)?.pairing));
      // a's real confirmation replayed at c, which never paired with a.
      net.hub.inject(a.id, c.id, packet(c.id, (fromA?.packet as { pairing?: unknown } | null)?.pairing));
      // A hello for a's device id with other keys does not replace what b stored.
      net.hub.inject(a.id, b.id, packet(b.id, { material: { ...a.material, signKey: `${a.material.signKey}ff` }, name: 'a' }, 'pair_hello'));
      await net.settle();

      expect(net.wire).toHaveLength(before);
      expect(peersOf('b')).toBe(stored.b);
      expect(peersOf('c')).toBe(stored.c);
      expect(trusts('c', 'a')).toBe(false);
      expect(trusts('a', 'b')).toBe(false);
      expect(trusts('a', 'c')).toBe(false);
      expect(b.core.getSnapshot().pairing).toBeNull();
      expect(c.core.getSnapshot().pairing).toBeNull();

      // A forged answer fails the waiting side instead of completing it.
      net.hub.inject(b.id, a.id, packet(a.id, { signature: 'sim-sig-forged-forged-forged', answer: true }));
      await net.settle();
      expect(a.core.getSnapshot().pairing).toMatchObject({ stage: 'failed', error: 'pairing_bad_confirmation' });
      expect(trusts('a', 'b')).toBe(false);
    });
  });

  it('reports an unreachable device instead of hanging', async () => {
    net = await createTestNet({ devices: ['a', 'b'], links: [] });
    const result = await dev(net, 'a').core.actions.startPairing(dev(net, 'b').id);
    expect(result).toMatchObject({ ok: false, code: 'peer_unreachable' });
    expect(dev(net, 'a').core.getSnapshot().pairing).toBeNull();
  });
});
