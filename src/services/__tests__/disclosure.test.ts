import { utf8ToBytes } from '@/transport/base64';

import { createTestNet, dev, must, type TestNet } from '../testing/harness';

let net: TestNet;
afterEach(async () => {
  await net.dispose();
});

const REPORT = 'I slipped on the stairs in Building B, second floor. My leg hurts and I need help.';

async function shared(): Promise<{ net: TestNet; incidentId: string }> {
  const created = await createTestNet({
    devices: ['a', 'b', 'c'],
    trust: [
      ['a', 'b', 'trusted', 'trusted'],
      ['a', 'c', 'authorized', 'trusted'],
      ['b', 'c', 'trusted', 'trusted'],
    ],
  });
  const a = dev(created, 'a');
  const { incidentId } = must(await a.core.actions.sendSOS());
  must(await a.core.actions.addReport(incidentId, REPORT, 'typed'));
  must(await a.core.actions.confirmFact(incidentId, 'symptom', 'Leg pain'));
  await created.settle();
  return { net: created, incidentId };
}

describe('disclosure levels', () => {
  it('sends nothing restricted before the reporter has reviewed a capsule', async () => {
    const made = await shared();
    net = made.net;
    for (const name of ['b', 'c']) {
      const view = dev(net, name).incident(made.incidentId);
      expect(view?.originalReport).toBeNull();
      expect(view?.facts.find((f) => f.field === 'symptom')).toMatchObject({ protected: true, value: null });
      expect(view?.facts.find((f) => f.field === 'floor')).toMatchObject({ protected: true, value: null });
      expect(view?.facts.find((f) => f.field === 'building')).toMatchObject({ protected: false, value: 'Building B' });
      expect(JSON.stringify(await dev(net, name).repo.eventsForIncident(made.incidentId))).not.toContain('slipped');
    }
  });

  it('gives a trusted recipient the summary only and an authorized recipient both sections', async () => {
    const made = await shared();
    net = made.net;
    const a = dev(net, 'a');
    const b = dev(net, 'b');
    const c = dev(net, 'c');
    const policy = { shareDetailedLocation: true, shareSymptoms: true, levels: { [b.id]: 'trusted' as const, [c.id]: 'authorized' as const } };

    // What the reporter is shown before sealing is the same projection the encryptor uses.
    const preview = a.core.actions.previewDisclosure(made.incidentId, 'trusted', policy);
    expect(preview.find((f) => f.field === 'symptom')?.protected).toBe(true);
    expect(preview.find((f) => f.field === 'floor')).toMatchObject({ protected: false, value: 'Second floor' });
    expect(a.core.actions.previewDisclosure(made.incidentId, 'relay', policy).every((f) => f.protected)).toBe(true);
    expect(a.core.actions.previewDisclosure(made.incidentId, 'authorized', policy).find((f) => f.field === 'symptom')).toMatchObject({
      protected: false,
      value: 'Leg pain',
    });

    must(await a.core.actions.updateCapsule(made.incidentId, policy));
    await net.settle();

    const trusted = b.incident(made.incidentId);
    expect(trusted?.access).toBe('trusted');
    expect(trusted?.originalReport).toBeNull();
    expect(trusted?.facts.find((f) => f.field === 'symptom')).toMatchObject({ protected: true, value: null });
    expect(trusted?.facts.find((f) => f.field === 'floor')).toMatchObject({ protected: false, value: 'Second floor' });
    expect(trusted?.facts.find((f) => f.field === 'building')).toMatchObject({ protected: false, value: 'Building B' });
    // Not merely hidden: the restricted events are not on the device at all.
    const heldByB = JSON.stringify([await b.repo.eventsForIncident(made.incidentId), b.kv.dump()]);
    expect(heldByB).not.toContain('slipped');
    expect(heldByB).not.toContain('Leg pain');
    expect((await b.repo.eventsForIncident(made.incidentId)).some((e) => e.type === 'REPORT_ADDED')).toBe(false);

    const authorized = c.incident(made.incidentId);
    expect(authorized?.access).toBe('authorized');
    expect(authorized?.originalReport).toBe(REPORT);
    expect(authorized?.facts.find((f) => f.field === 'symptom')).toMatchObject({ protected: false, value: 'Leg pain', tag: 'user_confirmed' });
    expect(authorized?.state.reports.map((r) => r.text)).toEqual([REPORT]);

    // The packets themselves: b's carry a summary section only; c's detail section cannot be opened by b.
    const toB = net.wire.filter((p) => p.from === a.id && p.packet?.kind === 'capsule' && p.packet.to === b.id);
    const toC = net.wire.filter((p) => p.from === a.id && p.packet?.kind === 'capsule' && p.packet.to === c.id);
    for (const seen of toB) {
      if (seen.packet?.kind !== 'capsule') continue;
      expect(seen.packet.envelope.sections.map((s) => s.name)).toEqual(['summary']);
      expect(seen.packet.envelope.wraps.map((w) => w.section)).toEqual(['summary']);
    }
    const withDetail = toC.filter((p) => p.packet?.kind === 'capsule' && p.packet.envelope.sections.some((s) => s.name === 'detail'));
    expect(withDetail.length).toBeGreaterThan(0);
    for (const seen of withDetail) {
      if (seen.packet?.kind !== 'capsule') continue;
      expect(await b.crypto.decryptAuthorized(seen.packet.envelope, a.material, net.clock.nowMs())).toMatchObject({
        ok: false,
        reason: 'not_a_recipient',
      });
      const opened = await c.crypto.decryptAuthorized(seen.packet.envelope, a.material, net.clock.nowMs());
      expect(opened.ok && opened.value.detail !== undefined && opened.value.summary !== undefined).toBe(true);
    }
  });

  it('withholds symptoms from everyone and narrows location when the reporter says so', async () => {
    const made = await shared();
    net = made.net;
    const a = dev(net, 'a');
    const b = dev(net, 'b');
    const c = dev(net, 'c');
    must(
      await a.core.actions.updateCapsule(made.incidentId, {
        shareDetailedLocation: false,
        shareSymptoms: false,
        levels: { [b.id]: 'trusted', [c.id]: 'authorized' },
      }),
    );
    await net.settle();
    for (const device of [b, c]) {
      const view = device.incident(made.incidentId);
      expect(view?.originalReport).toBeNull();
      expect(view?.facts.find((f) => f.field === 'symptom')?.protected).toBe(true);
      expect(view?.facts.find((f) => f.field === 'floor')?.protected).toBe(true);
      expect(view?.facts.find((f) => f.field === 'building')).toMatchObject({ protected: false, value: 'Building B' });
      expect(JSON.stringify(await device.repo.eventsForIncident(made.incidentId))).not.toContain('slipped');
    }
  });

  it('refuses to seal for a device that is not a trusted peer', async () => {
    const made = await shared();
    net = made.net;
    const result = await dev(net, 'a').core.actions.updateCapsule(made.incidentId, {
      shareDetailedLocation: true,
      shareSymptoms: true,
      levels: { 'dev-00000000000000000000': 'authorized' },
    });
    expect(result).toMatchObject({ ok: false, code: 'peer_not_trusted' });
  });
});

describe('packets that must be dropped', () => {
  it('ignores tampered, re-labelled, expired and oversized packets and never receipts them', async () => {
    net = await createTestNet({ devices: ['a', 'b'], trust: [['a', 'b', 'authorized', 'trusted']] });
    const a = dev(net, 'a');
    const b = dev(net, 'b');
    // Capture a genuine packet that never reaches b.
    net.hub.setFault(a.id, b.id, { drop: true });
    const { incidentId } = must(await a.core.actions.sendSOS());
    await net.settle();
    const genuine = net.wire.find((p) => p.from === a.id && p.packet?.kind === 'capsule');
    if (genuine?.packet?.kind !== 'capsule') throw new Error('expected a capsule packet');
    const packet = genuine.packet;
    const inject = async (mutated: unknown) => {
      net.hub.inject(a.id, b.id, utf8ToBytes(typeof mutated === 'string' ? mutated : JSON.stringify(mutated)));
      await net.settle();
    };
    const nothingAccepted = async () => {
      expect(await b.repo.allIncidentIds()).toEqual([]);
      expect(net.wire.filter((p) => p.from === b.id)).toHaveLength(0);
    };

    const section = packet.envelope.sections[0];
    if (!section) throw new Error('expected a section');
    await inject({ ...packet, envelope: { ...packet.envelope, sections: [{ ...section, ct: `${section.ct}00` }] } });
    await nothingAccepted();
    await inject({ ...packet, envelope: { ...packet.envelope, header: { ...packet.envelope.header, expiresAtMs: packet.envelope.header.expiresAtMs + 1 } } });
    await nothingAccepted();
    await inject({ ...packet, envelope: { ...packet.envelope, header: { ...packet.envelope.header, hopLimit: 4 } } });
    await nothingAccepted();
    await inject({ ...packet, envelope: { ...packet.envelope, wraps: [...packet.envelope.wraps, { recipientId: b.id, section: 'detail', wrappedKey: 'forged' }] } });
    await nothingAccepted();
    // The same envelope under a different packet id (a replay dressed as new).
    await inject({ ...packet, packetId: 'pkt-forged-0001' });
    await nothingAccepted();
    await inject({ ...packet, v: 2 });
    await nothingAccepted();
    await inject('not json at all');
    await nothingAccepted();
    await inject({ ...packet, padding: 'x'.repeat(600 * 1024) });
    await nothingAccepted();

    // Expired: the genuine bytes, but b's clock is past the envelope's expiry.
    net.clock.advance(7 * 60 * 60 * 1000);
    net.hub.inject(a.id, b.id, genuine.bytes);
    await net.settle();
    await nothingAccepted();
    expect(a.incident(incidentId)?.state.status.status).toBe('queued');

    // Control: an untampered, unexpired resend is accepted and receipted.
    net.hub.setFault(a.id, b.id, {});
    await a.core.actions.retryDelivery(incidentId);
    await net.settle();
    expect(await b.repo.allIncidentIds()).toEqual([incidentId]);
    expect(a.incident(incidentId)?.state.status.status).toBe('delivered');
  });

  it('ignores a sender it has not paired with, even one that trusts it', async () => {
    net = await createTestNet({ devices: ['a', 'b', 'x'], trust: [['a', 'b', 'authorized', 'trusted'], ['x', 'b', 'authorized', null]] });
    const b = dev(net, 'b');
    const x = dev(net, 'x');
    const { incidentId } = must(await x.core.actions.sendSOS());
    await x.transport.connect(b.id);
    await x.core.actions.retryDelivery(incidentId);
    await net.settle();
    expect(net.wire.some((p) => p.from === x.id && p.to === b.id && p.packet?.kind === 'capsule')).toBe(true);
    expect(await b.repo.allIncidentIds()).toEqual([]);
    expect(net.wire.filter((p) => p.from === b.id)).toHaveLength(0);
    expect(x.incident(incidentId)?.state.status.status).toBe('queued');
  });

  it('does not accept a receipt forged by someone other than the recipient', async () => {
    net = await createTestNet({
      devices: ['a', 'b', 'm'],
      trust: [['a', 'b', 'authorized', 'trusted'], ['a', 'm', 'relay', 'trusted']],
      links: [['a', 'm']],
    });
    const a = dev(net, 'a');
    const b = dev(net, 'b');
    const m = dev(net, 'm');
    const { incidentId } = must(await a.core.actions.sendSOS());
    await net.settle();
    const packetId = a.incident(incidentId)?.state.packets[0]?.packetId ?? '';
    // m is trusted by a (as a relay) and tries to claim b received the packet.
    const receipt = { receiptId: 'rcpt-forged-1', packetId, recipientDeviceId: b.id, receivedAtMs: net.clock.nowMs() };
    const sealed = await m.crypto.encryptForRecipients({
      capsuleId: receipt.receiptId,
      incidentRef: incidentId,
      createdAtMs: net.clock.nowMs(),
      expiresAtMs: net.clock.nowMs() + 60_000,
      hopLimit: 2,
      sections: { summary: JSON.stringify({ receipt, signature: await m.crypto.signEvent('anything') }) },
      recipients: [{ material: a.material, sections: ['summary'] }],
    });
    if (!sealed.ok) throw new Error('seal failed');
    net.hub.inject(m.id, a.id, utf8ToBytes(JSON.stringify({ v: 1, packetId: receipt.receiptId, kind: 'receipt', hops: 0, to: a.id, envelope: sealed.value })));
    await net.settle();
    expect(a.incident(incidentId)?.state.status.status).toBe('queued');
    expect(a.incident(incidentId)?.state.recipients[0]?.delivery).not.toBe('delivered');
    expect(await a.repo.getPendingOutbox(incidentId)).toHaveLength(1);
  });
});
