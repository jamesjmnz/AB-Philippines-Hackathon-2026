import {
  acknowledge,
  addObservation,
  addReport,
  confirmClaim,
  createFixedClock,
  createManualSOS,
  createSequentialIds,
  prepareCapsule,
  recordAIProposal,
  type CommandContext,
  type CommandResult,
  type DisclosurePolicy,
  type IncidentState,
} from '@/domain';

import { buildCapsuleSections, eventTier, parseCapsuleSections, sectionsForLevel } from '../capsule';
import { createFakeCapsuleCrypto, createFakeCryptoRealm } from '../testing';

const REPORT = 'I slipped in Building B on the second floor and my leg hurts.';
const clock = createFixedClock(1_000);
const ALEX: CommandContext = { actor: { deviceId: 'dev-alex', userName: 'Alex' }, clock, ids: createSequentialIds('alex') };
const MIKA: CommandContext = { actor: { deviceId: 'dev-mika', userName: 'Mika' }, clock, ids: createSequentialIds('mika') };

function incident(policy: Pick<DisclosurePolicy, 'shareDetailedLocation' | 'shareSymptoms'>): IncidentState {
  const steps: ((s: IncidentState) => CommandResult)[] = [
    (s) => addReport(s, ALEX, { text: REPORT }),
    (s) => recordAIProposal(s, ALEX, { provider: 'Simulation', findings: [{ field: 'symptom', value: 'Leg pain' }] }),
    (s) => confirmClaim(s, ALEX, { field: 'symptom', value: 'Leg pain' }),
    (s) => confirmClaim(s, ALEX, { field: 'floor', value: 'Second floor' }),
    (s) =>
      prepareCapsule(s, ALEX, {
        policy: {
          ...policy,
          recipients: [
            { deviceId: 'dev-mika', level: 'trusted', userName: 'Mika' },
            { deviceId: 'dev-noah', level: 'authorized', userName: 'Noah' },
          ],
        },
      }),
    (s) => acknowledge(s, MIKA),
    (s) => addObservation(s, MIKA, { text: 'I can see them near the stairs.' }),
  ];
  let state = createManualSOS(ALEX, {
    recipients: [
      { deviceId: 'dev-mika', userName: 'Mika', level: 'trusted' },
      { deviceId: 'dev-noah', userName: 'Noah', level: 'authorized' },
    ],
  }).state;
  for (const step of steps) state = step(state).state;
  return state;
}

const tiers = (state: IncidentState) => Object.fromEntries(state.events.map((e) => [`${e.type}:${e.actor.deviceId}`, eventTier(e, state)]));

describe('event tiers', () => {
  it('puts the requester words, AI proposals and symptom claims in detail, coordination in summary', () => {
    const state = incident({ shareDetailedLocation: true, shareSymptoms: true });
    expect(tiers(state)).toMatchObject({
      'INCIDENT_CREATED:dev-alex': 'summary',
      'REPORT_ADDED:dev-alex': 'detail',
      'AI_PROPOSAL_CREATED:dev-alex': 'detail',
      'CAPSULE_PREPARED:dev-alex': 'summary',
      'RESPONDER_ACKNOWLEDGED:dev-mika': 'summary',
      'REPORT_ADDED:dev-mika': 'summary',
    });
    const confirmations = state.events.filter((e) => e.type === 'CLAIM_CONFIRMED');
    expect(confirmations.map((e) => [e.payload.field, eventTier(e, state)])).toEqual([
      ['symptom', 'detail'],
      ['floor', 'summary'],
    ]);
  });

  it('withholds what the policy shares with nobody', () => {
    const state = incident({ shareDetailedLocation: false, shareSymptoms: false });
    expect(tiers(state)).toMatchObject({ 'REPORT_ADDED:dev-alex': 'withheld', 'AI_PROPOSAL_CREATED:dev-alex': 'withheld' });
    expect(state.events.filter((e) => e.type === 'CLAIM_CONFIRMED').map((e) => eventTier(e, state))).toEqual(['withheld', 'withheld']);
  });
});

describe('capsule sections', () => {
  it('maps levels to sections', () => {
    expect(sectionsForLevel('relay')).toEqual([]);
    expect(sectionsForLevel('trusted')).toEqual(['summary']);
    expect(sectionsForLevel('authorized')).toEqual(['summary', 'detail']);
    expect(sectionsForLevel('owner')).toEqual(['summary', 'detail']);
  });

  it('builds a summary with no restricted content and a detail section only for authorized recipients', () => {
    const state = incident({ shareDetailedLocation: true, shareSymptoms: true });
    const forTrusted = buildCapsuleSections({ state, senderDeviceId: 'dev-alex', recipientLevel: 'trusted' });
    expect(Object.keys(forTrusted)).toEqual(['summary']);
    expect(forTrusted.summary).not.toContain('slipped');
    expect(forTrusted.summary).not.toContain('Leg pain');
    expect(forTrusted.summary).toContain('Second floor');

    const forAuthorized = buildCapsuleSections({ state, senderDeviceId: 'dev-alex', recipientLevel: 'authorized' });
    expect(Object.keys(forAuthorized).sort()).toEqual(['detail', 'summary']);
    expect(forAuthorized.summary).toBe(forTrusted.summary);
    expect(forAuthorized.detail).toContain('slipped');
    expect(forAuthorized.detail).toContain('Leg pain');

    const parsed = parseCapsuleSections(forAuthorized);
    expect(parsed?.incidentId).toBe(state.incidentId);
    expect(parsed?.events).toHaveLength(state.events.length);
    expect(parsed?.projection?.level).toBe('authorized');
    expect(parseCapsuleSections(forTrusted)?.projection?.level).toBe('trusted');
    expect(parseCapsuleSections(forTrusted)?.events.length).toBeLessThan(state.events.length);
  });

  it('gives a relay-only recipient nothing to read', () => {
    const state = incident({ shareDetailedLocation: true, shareSymptoms: true });
    const sections = buildCapsuleSections({ state, senderDeviceId: 'dev-alex', recipientLevel: 'relay' });
    expect(Object.keys(sections)).toEqual(['summary']);
    expect(parseCapsuleSections(sections)).toEqual({ incidentId: state.incidentId, events: [], projection: null });
  });

  it('with sharing off, authorized recipients get building-level summary and no detail events', () => {
    const state = incident({ shareDetailedLocation: false, shareSymptoms: false });
    const sections = buildCapsuleSections({ state, senderDeviceId: 'dev-alex', recipientLevel: 'authorized' });
    const all = JSON.stringify(sections);
    expect(all).not.toContain('slipped');
    expect(all).not.toContain('Leg pain');
    expect(all).not.toContain('Second floor');
    expect(all).toContain('Building B');
  });

  it('a responder sends only the events it authored, without a projection; the reporter gets all of them', () => {
    const state = incident({ shareDetailedLocation: true, shareSymptoms: true });
    const toReporter = parseCapsuleSections(buildCapsuleSections({ state, senderDeviceId: 'dev-mika', recipientLevel: 'owner' }));
    expect(toReporter?.projection).toBeNull();
    expect(toReporter?.events).toHaveLength(2);
    expect(JSON.stringify(toReporter?.events)).not.toContain('dev-alex"');
    const toPeer = parseCapsuleSections(buildCapsuleSections({ state, senderDeviceId: 'dev-mika', recipientLevel: 'trusted' }));
    expect(toPeer?.events).toHaveLength(2);
  });

  it('rejects malformed or mismatched sections', () => {
    expect(parseCapsuleSections({})).toBeNull();
    expect(parseCapsuleSections({ summary: 'not json' })).toBeNull();
    expect(parseCapsuleSections({ summary: JSON.stringify({ incidentId: 'a', events: [] }) })).toBeNull();
    expect(
      parseCapsuleSections({
        summary: JSON.stringify({ incidentId: 'inc-a', projection: null, events: [] }),
        detail: JSON.stringify({ incidentId: 'inc-b', projection: null, events: [] }),
      }),
    ).toBeNull();
    expect(parseCapsuleSections({ summary: JSON.stringify({ incidentId: 'inc-a', projection: null, events: [], extra: 1 }) })).toBeNull();
  });
});

describe('fake CapsuleCrypto enforces access', () => {
  const NOW = 1_000;
  async function world() {
    const realm = createFakeCryptoRealm();
    const names = ['alex', 'mika', 'noah', 'jordan'] as const;
    const cryptos = Object.fromEntries(names.map((n) => [n, createFakeCapsuleCrypto(realm, n)])) as Record<(typeof names)[number], ReturnType<typeof createFakeCapsuleCrypto>>;
    const material = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await cryptos[n].exportPublicPairingMaterial()] as const))) as Record<
      (typeof names)[number],
      Awaited<ReturnType<(typeof cryptos)['alex']['exportPublicPairingMaterial']>>
    >;
    const sealed = await cryptos.alex.encryptForRecipients({
      capsuleId: 'capsule-1',
      incidentRef: 'incident-1',
      createdAtMs: NOW,
      expiresAtMs: NOW + 60_000,
      hopLimit: 2,
      sections: { summary: 'SUMMARY TEXT', detail: 'DETAIL TEXT' },
      recipients: [
        { material: material.mika, sections: ['summary'] },
        { material: material.noah, sections: ['summary', 'detail'] },
        { material: material.jordan, sections: [] },
      ],
    });
    if (!sealed.ok) throw new Error('seal failed');
    return { realm, cryptos, material, envelope: sealed.value };
  }

  it('opens exactly the sections each recipient was given and keeps plaintext out of the envelope', async () => {
    const { cryptos, material, envelope } = await world();
    expect(JSON.stringify(envelope)).not.toContain('SUMMARY TEXT');
    expect(JSON.stringify(envelope)).not.toContain('DETAIL TEXT');
    expect(await cryptos.mika.decryptAuthorized(envelope, material.alex, NOW)).toEqual({ ok: true, value: { summary: 'SUMMARY TEXT' } });
    expect(await cryptos.noah.decryptAuthorized(envelope, material.alex, NOW)).toEqual({ ok: true, value: { summary: 'SUMMARY TEXT', detail: 'DETAIL TEXT' } });
    // The relay can verify and route, and cannot read.
    expect(await cryptos.jordan.verifyEnvelope(envelope, material.alex, NOW)).toEqual({ ok: true, value: true });
    expect(await cryptos.jordan.decryptAuthorized(envelope, material.alex, NOW)).toMatchObject({ ok: false, reason: 'not_a_recipient' });
    expect(envelope.wraps.some((w) => w.recipientId === material.jordan.deviceId)).toBe(false);
  });

  it('detects tampering, forged wraps, expiry, wrong sender, unknown versions and foreign realms', async () => {
    const { cryptos, material, envelope } = await world();
    const mikaWrap = envelope.wraps.find((w) => w.recipientId === material.mika.deviceId);
    if (!mikaWrap) throw new Error('missing wrap');
    const forgedWrap = { ...envelope, wraps: [...envelope.wraps, { ...mikaWrap, section: 'detail' }] };
    expect(await cryptos.mika.decryptAuthorized(forgedWrap, material.alex, NOW)).toMatchObject({ ok: false, reason: 'bad_signature' });
    const swapped = { ...envelope, sections: envelope.sections.map((s) => (s.name === 'summary' ? { ...s, ct: envelope.sections[1]?.ct ?? '' } : s)) };
    expect(await cryptos.mika.decryptAuthorized(swapped, material.alex, NOW)).toMatchObject({ ok: false, reason: 'bad_signature' });
    expect(await cryptos.mika.verifyEnvelope({ ...envelope, header: { ...envelope.header, hopLimit: 4 } }, material.alex, NOW)).toMatchObject({ ok: false, reason: 'bad_signature' });
    expect(await cryptos.mika.verifyEnvelope(envelope, material.alex, NOW + 60_000)).toMatchObject({ ok: false, reason: 'expired' });
    expect(await cryptos.mika.verifyEnvelope(envelope, material.noah, NOW)).toMatchObject({ ok: false, reason: 'untrusted_sender' });
    expect(await cryptos.mika.verifyEnvelope({ ...envelope, v: 2 } as never, material.alex, NOW)).toMatchObject({ ok: false, reason: 'unsupported_version' });

    const elsewhere = createFakeCapsuleCrypto(createFakeCryptoRealm(), 'mika');
    expect(await elsewhere.decryptAuthorized(envelope, material.alex, NOW)).toMatchObject({ ok: false });
  });

  it('derives the same pairing code on both sides, a different one for other pairs, and rejects forged material', async () => {
    const { cryptos, material } = await world();
    const ab = await cryptos.alex.verifyPeerPairing(material.mika);
    const ba = await cryptos.mika.verifyPeerPairing(material.alex);
    const ac = await cryptos.alex.verifyPeerPairing(material.noah);
    if (!ab.ok || !ba.ok || !ac.ok) throw new Error('pairing failed');
    expect(ab.value.code).toMatch(/^\d{6}$/);
    expect(ab.value.code).toBe(ba.value.code);
    expect(ab.value.deviceId).toBe(material.mika.deviceId);
    expect(ac.value.code).not.toBe(ab.value.code);
    expect(await cryptos.alex.verifyPeerPairing({ ...material.mika, agreeKey: `${material.mika.agreeKey}00` })).toMatchObject({ ok: false, reason: 'malformed' });
    expect(await cryptos.alex.verifyPeerPairing(material.alex)).toMatchObject({ ok: false });
  });

  it('signs events with the device key only', async () => {
    const { cryptos, material } = await world();
    const signature = await cryptos.alex.signEvent('hello');
    expect(await cryptos.mika.verifyEventSignature('hello', signature, material.alex)).toBe(true);
    expect(await cryptos.mika.verifyEventSignature('hello!', signature, material.alex)).toBe(false);
    expect(await cryptos.mika.verifyEventSignature('hello', signature, material.noah)).toBe(false);
    expect(await cryptos.mika.signEvent('hello')).not.toBe(signature);
  });
});
