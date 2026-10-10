import { MAX_PACKET_BYTES } from '@/sync/packet';

import { createTestNet, dev, must, type TestNet } from '../testing/harness';

let net: TestNet;
afterEach(async () => {
  await net.dispose();
});

describe('an update too large to send', () => {
  it('is reported on the incident when the packet exceeds the byte cap, and clears once it fits', async () => {
    net = await createTestNet({ devices: ['a', 'b'], trust: [['a', 'b', 'authorized', 'trusted']] });
    const a = dev(net, 'a');
    const b = dev(net, 'b');
    const { incidentId } = must(await a.core.actions.sendSOS());
    await net.settle();
    expect(a.incident(incidentId)?.state.status.status).toBe('delivered');
    expect(a.incident(incidentId)?.sendFailure).toBeNull();
    expect(b.incident(incidentId)?.sendFailure).toBeNull();

    // The fake crypto keeps plaintext out of the envelope, so the ciphertext is padded to stand in for a huge ledger.
    const seal = a.crypto.encryptForRecipients.bind(a.crypto);
    a.crypto.encryptForRecipients = async (input) => {
      const sealed = await seal(input);
      if (!sealed.ok) return sealed;
      const sections = sealed.value.sections.map((s) => ({ ...s, ct: s.ct + 'A'.repeat(MAX_PACKET_BYTES) }));
      return { ok: true, value: { ...sealed.value, sections } };
    };
    const sentBefore = net.wire.length;
    const heldBefore = (await b.repo.eventsForIncident(incidentId)).length;
    must(await a.core.actions.offerTask(incidentId, { kind: 'communicate', title: 'Call the front desk' }));
    await net.settle();
    expect(a.incident(incidentId)?.sendFailure).toBe('packet_too_large');
    expect(a.incident(incidentId)?.pendingOutbox).toBe(1);
    // Never dressed up as sent: nothing went on the wire and no attempt was recorded.
    expect(net.wire).toHaveLength(sentBefore);
    expect((await a.repo.getPendingOutbox(incidentId))[0]?.attempts).toBe(0);
    expect((await b.repo.eventsForIncident(incidentId)).length).toBe(heldBefore);
    // Other incidents are unaffected.
    a.crypto.encryptForRecipients = seal;
    const other = must(await a.core.actions.sendSOS());
    await net.settle();
    expect(a.incident(other.incidentId)?.sendFailure).toBeNull();
    expect(a.incident(other.incidentId)?.state.status.status).toBe('delivered');

    a.timers.fireIntervals();
    await net.settle();
    expect(a.incident(incidentId)?.sendFailure).toBeNull();
    expect(a.incident(incidentId)?.pendingOutbox).toBe(0);
    expect(b.incident(incidentId)?.state.tasks).toHaveLength(1);
  });

  it('is reported when a section would carry more events than a recipient accepts', async () => {
    net = await createTestNet({
      devices: ['a', 'b'],
      trust: [['a', 'b', 'authorized', 'trusted']],
      perDevice: { a: { config: { maxSectionEvents: 6 } } },
    });
    const a = dev(net, 'a');
    const b = dev(net, 'b');
    const { incidentId } = must(await a.core.actions.sendSOS());
    await net.settle();
    expect(a.incident(incidentId)?.sendFailure).toBeNull();
    for (let i = 0; i < 6; i += 1) {
      must(await a.core.actions.offerTask(incidentId, { kind: 'other', title: `Role ${i}` }));
      await net.settle();
    }
    const view = a.incident(incidentId);
    expect(view?.state.events.length).toBeGreaterThan(6);
    expect(view?.sendFailure).toBe('packet_too_large');
    expect(view?.pendingOutbox).toBeGreaterThan(0);
    expect(view?.state.status.status).toBe('delivered');
    expect((await b.repo.eventsForIncident(incidentId)).length).toBeLessThanOrEqual(6);
    expect(b.incident(incidentId)?.state.tasks.length).toBeLessThan(6);
  });
});
