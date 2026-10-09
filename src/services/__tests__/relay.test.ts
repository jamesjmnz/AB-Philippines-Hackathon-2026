import { utf8ToBytes } from '@/transport/base64';

import { createTestNet, dev, must, type TestNet } from '../testing/harness';

let net: TestNet;
afterEach(async () => {
  await net.dispose();
});

const REPORT = 'I slipped on the stairs in Building B, second floor. My leg hurts and I need help.';

async function relayNet(config: { hopLimit?: number } = {}): Promise<TestNet> {
  // a — b — c. a and c are never in range of each other. a grants b nothing but routing.
  return createTestNet({
    devices: ['a', 'b', 'c'],
    trust: [
      ['a', 'b', 'relay', 'trusted'],
      ['a', 'c', 'authorized', 'trusted'],
      ['b', 'c', 'trusted', 'trusted'],
    ],
    links: [
      ['a', 'b'],
      ['b', 'c'],
    ],
    ...(config.hopLimit === undefined ? {} : { perDevice: { a: { config: { hopLimit: config.hopLimit } } } }),
  });
}

describe('store-and-forward relay', () => {
  it('carries a capsule a → b → c and the receipt back, without the relay ever holding plaintext', async () => {
    net = await relayNet();
    const a = dev(net, 'a');
    const b = dev(net, 'b');
    const c = dev(net, 'c');

    const { incidentId } = must(await a.core.actions.sendSOS());
    must(await a.core.actions.addReport(incidentId, REPORT, 'typed'));
    must(
      await a.core.actions.updateCapsule(incidentId, { shareDetailedLocation: true, shareSymptoms: true, levels: { [c.id]: 'authorized', [b.id]: 'relay' } }),
    );
    await net.settle();

    // c has it, and knows it came through b.
    const onC = c.incident(incidentId);
    expect(onC?.access).toBe('authorized');
    expect(onC?.originalReport).toBe(REPORT);
    expect(onC?.receivedViaName).toBe('b');
    expect(onC?.facts.find((f) => f.field === 'floor')).toMatchObject({ value: 'Second floor', protected: false });

    // The receipt came back through b, and only then did a call it delivered.
    const onA = a.incident(incidentId);
    expect(onA?.state.status.status).toBe('delivered');
    // b is named in the policy as relay-only: it is never sent a packet of its own and nothing counts as delivered to it.
    expect(onA?.state.recipients.map((r) => [r.deviceId, r.level, r.delivery])).toEqual([
      [c.id, 'authorized', 'delivered'],
      [b.id, 'relay', 'none'],
    ]);
    expect(onA?.state.packets.every((p) => p.recipientDeviceId === c.id)).toBe(true);
    expect(net.wire.some((p) => p.packet?.kind === 'capsule' && p.packet.to === b.id)).toBe(false);
    expect(onA?.state.packets.every((p) => p.delivery === 'delivered' && p.viaDeviceId === b.id)).toBe(true);
    expect(await a.repo.getPendingOutbox()).toHaveLength(0);
    expect(net.wire.some((p) => p.from === a.id && p.to === c.id)).toBe(false);
    expect(net.wire.some((p) => p.from === c.id && p.to === b.id && p.packet?.kind === 'receipt' && p.packet.to === a.id)).toBe(true);
    expect(net.wire.some((p) => p.from === b.id && p.to === a.id && p.packet?.kind === 'receipt' && p.packet.hops === 1)).toBe(true);

    // The relay: no incident, no events, nothing listed, nothing quarantined, nothing left in its queue.
    expect(await b.repo.allIncidentIds()).toEqual([]);
    expect(await b.repo.eventsForIncident(incidentId)).toEqual([]);
    expect(await b.repo.quarantined()).toEqual([]);
    expect(b.core.getSnapshot().incidents).toEqual([]);
    expect(b.core.engine.relay.list()).toEqual([]);
    expect(JSON.stringify(b.kv.dump())).not.toContain('slipped');

    // Everything that crossed b's radio was sealed for somebody else, and b's key opens none of it.
    const throughB = net.wire.filter((p) => p.to === b.id && p.packet?.kind === 'capsule');
    expect(throughB.length).toBeGreaterThan(0);
    for (const seen of throughB) {
      expect(new TextDecoder().decode(seen.bytes)).not.toContain('slipped');
      if (seen.packet?.kind !== 'capsule') continue;
      expect(seen.packet.envelope.wraps.some((w) => w.recipientId === b.id)).toBe(false);
      const opened = await b.crypto.decryptAuthorized(seen.packet.envelope, a.material, net.clock.nowMs());
      expect(opened).toMatchObject({ ok: false, reason: 'not_a_recipient' });
    }
  });

  it('holds a packet for an unreachable recipient and forwards it when the link returns', async () => {
    net = await relayNet();
    const a = dev(net, 'a');
    const b = dev(net, 'b');
    const c = dev(net, 'c');
    net.hub.setLink(b.id, c.id, false);
    await net.settle();

    const { incidentId } = must(await a.core.actions.sendSOS());
    await net.settle();
    expect(c.incident(incidentId)).toBeUndefined();
    expect(a.incident(incidentId)?.state.status).toEqual({ status: 'queued', reason: 'send_attempted_no_receipt' });
    const held = b.core.engine.relay.list();
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ to: c.id, origin: a.id, kind: 'capsule' });
    expect(held[0]?.json).not.toContain('Manual SOS');

    net.hub.setLink(b.id, c.id, true);
    await net.settle();
    expect(c.incident(incidentId)?.state.status.status).toBe('delivered');
    expect(a.incident(incidentId)?.state.status.status).toBe('delivered');
    expect(b.core.engine.relay.list()).toHaveLength(0);
  });

  it('does not relay when relaying is switched off', async () => {
    net = await relayNet();
    const a = dev(net, 'a');
    const b = dev(net, 'b');
    const c = dev(net, 'c');
    await b.core.actions.updateSettings({ relayEnabled: false });
    const { incidentId } = must(await a.core.actions.sendSOS());
    await net.settle();
    expect(c.incident(incidentId)).toBeUndefined();
    expect(b.core.engine.relay.list()).toHaveLength(0);
    expect(a.incident(incidentId)?.state.status.status).toBe('queued');
  });

  it('enforces the signed hop limit at the relay and at the recipient', async () => {
    net = await relayNet({ hopLimit: 0 });
    const a = dev(net, 'a');
    const b = dev(net, 'b');
    const c = dev(net, 'c');
    const { incidentId } = must(await a.core.actions.sendSOS());
    await net.settle();

    // The relay refuses: forwarding would be hop 1 of an envelope signed for 0.
    expect(b.core.engine.relay.list()).toHaveLength(0);
    expect(net.wire.some((p) => p.from === b.id && p.to === c.id)).toBe(false);
    expect(c.incident(incidentId)).toBeUndefined();
    expect(a.incident(incidentId)?.state.status.status).toBe('queued');

    // A relay that forwards anyway (or lies about the count) is refused by the recipient: no ingest, no receipt.
    const sent = net.wire.find((p) => p.from === a.id && p.packet?.kind === 'capsule');
    expect(sent?.packet).toBeTruthy();
    net.hub.inject(b.id, c.id, utf8ToBytes(JSON.stringify({ ...sent?.packet, hops: 1 })));
    await net.settle();
    expect(await c.repo.allIncidentIds()).toEqual([]);
    expect(net.wire.some((p) => p.from === c.id)).toBe(false);

    // The same envelope within its limit (hop 0, as if a were in range) is accepted.
    net.hub.inject(a.id, c.id, sent?.bytes ?? new Uint8Array());
    await net.settle();
    expect(await c.repo.allIncidentIds()).toEqual([incidentId]);
  });
});
