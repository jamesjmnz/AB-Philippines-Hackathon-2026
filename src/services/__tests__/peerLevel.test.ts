import { createDemoApp } from '@/demo/createDemoApp';

import { createTestNet, dev, must, type TestNet } from '../testing/harness';

let net: TestNet | null = null;
afterEach(async () => {
  await net?.dispose();
  net = null;
});

describe('peer disclosure level', () => {
  it('decides what the next SOS seals for that peer, and a relay-level peer gets no packet of its own', async () => {
    const made = await createTestNet({ devices: ['a', 'b'], trust: [['a', 'b', 'trusted', 'trusted']] });
    net = made;
    const a = dev(made, 'a');
    const b = dev(made, 'b');
    const alertFor = (incidentId: string) =>
      made.wire.filter((p) => p.from === a.id && p.packet?.kind === 'capsule' && p.packet.envelope.header.incidentRef === incidentId);
    const wrapped = (incidentId: string) => alertFor(incidentId)[0]?.packet;
    const sectionsFor = (incidentId: string) => {
      const packet = wrapped(incidentId);
      return packet?.kind === 'capsule' ? packet.envelope.wraps.filter((w) => w.recipientId === b.id).map((w) => w.section).sort() : null;
    };
    expect(a.core.getSnapshot().peers).toEqual([expect.objectContaining({ deviceId: b.id, trusted: true, level: 'trusted' })]);

    const first = must(await a.core.actions.sendSOS());
    await made.settle();
    expect(b.incident(first.incidentId)?.access).toBe('trusted');
    expect(sectionsFor(first.incidentId)).toEqual(['summary']);

    must(await a.core.actions.setPeerLevel(b.id, 'authorized'));
    expect(a.core.getSnapshot().peers[0]?.level).toBe('authorized');
    expect(a.kv.dump().peers).toContain('"level":"authorized"');
    // An incident already sent keeps the level it was sent with.
    expect(a.incident(first.incidentId)?.state.recipients[0]?.level).toBe('trusted');
    const second = must(await a.core.actions.sendSOS());
    await made.settle();
    expect(a.incident(second.incidentId)?.state.recipients[0]?.level).toBe('authorized');
    expect(b.incident(second.incidentId)?.access).toBe('authorized');
    expect(sectionsFor(second.incidentId)).toEqual(['detail', 'summary']);

    must(await a.core.actions.setPeerLevel(b.id, 'relay'));
    expect(a.core.getSnapshot().peers[0]).toMatchObject({ trusted: true, level: 'relay' });
    const third = must(await a.core.actions.sendSOS());
    await made.settle();
    expect(a.incident(third.incidentId)?.state.recipients).toEqual([]);
    expect(a.incident(third.incidentId)?.state.status).toEqual({ status: 'queued', reason: 'no_trusted_peer' });
    expect(a.incident(third.incidentId)?.pendingOutbox).toBe(0);
    expect(alertFor(third.incidentId)).toEqual([]);
    expect(b.incident(third.incidentId)).toBeUndefined();
  });

  it('refuses an unknown device or level and leaves unpaired devices without one', async () => {
    const made = await createTestNet({ devices: ['a', 'b', 'c'], trust: [['a', 'b', 'trusted', 'trusted']] });
    net = made;
    const a = dev(made, 'a');
    expect(await a.core.actions.setPeerLevel(dev(made, 'c').id, 'authorized')).toMatchObject({ ok: false, code: 'peer_not_trusted' });
    expect(await a.core.actions.setPeerLevel(dev(made, 'b').id, 'owner' as never)).toMatchObject({ ok: false, code: 'invalid_input' });
    const nearby = a.core.getSnapshot().peers.find((p) => p.deviceId === dev(made, 'c').id);
    expect(nearby).toMatchObject({ trusted: false });
    expect(nearby && 'level' in nearby).toBe(false);
    expect(a.core.getSnapshot().peers.find((p) => p.trusted)?.level).toBe('trusted');
  });

  it('is available in the Demo Lab on the viewed device', async () => {
    const app = createDemoApp({ aiDelayMs: 0 });
    try {
      await app.internals.whenReady();
      const peer = app.getSnapshot().peers.find((p) => p.trusted);
      if (!peer) throw new Error('demo has no trusted peer');
      const next = peer.level === 'authorized' ? 'trusted' : 'authorized';
      must(await app.actions.setPeerLevel(peer.deviceId, next));
      expect(app.getSnapshot()).toMatchObject({ mode: 'demo' });
      expect(app.getSnapshot().peers.find((p) => p.deviceId === peer.deviceId)?.level).toBe(next);
    } finally {
      await app.dispose();
    }
  });
});
