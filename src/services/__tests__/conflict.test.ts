import { createTestNet, dev, must, type TestNet } from '../testing/harness';

let net: TestNet;
afterEach(async () => {
  await net.dispose();
});

const REPORT = 'I fell near the stairs in Building B, second floor.';
const OBSERVATION = 'I think they are on the first floor.';

async function setup(levelOfB: 'trusted' | 'authorized'): Promise<{ net: TestNet; incidentId: string }> {
  const created = await createTestNet({
    devices: ['a', 'b', 'c'],
    trust: [
      ['a', 'b', levelOfB, 'trusted'],
      ['a', 'c', 'authorized', 'trusted'],
      ['b', 'c', 'trusted', 'trusted'],
    ],
  });
  const a = dev(created, 'a');
  const { incidentId } = must(await a.core.actions.sendSOS());
  must(await a.core.actions.addReport(incidentId, REPORT, 'typed'));
  must(
    await a.core.actions.updateCapsule(incidentId, {
      shareDetailedLocation: true,
      shareSymptoms: true,
      levels: { [dev(created, 'b').id]: levelOfB, [dev(created, 'c').id]: 'authorized' },
    }),
  );
  await created.settle();
  return { net: created, incidentId };
}

describe('conflicting statements', () => {
  it.each(['authorized', 'trusted'] as const)(
    'keeps both floors, flags the conflict, lets only the reporter resolve it, and converges (%s responder)',
    async (levelOfB) => {
      const made = await setup(levelOfB);
      net = made.net;
      const id = made.incidentId;
      const a = dev(net, 'a');
      const b = dev(net, 'b');
      const c = dev(net, 'c');
      expect(a.incident(id)?.state.claims.floor).toMatchObject({ value: 'Second floor', tag: 'user_reported' });

      must(await b.core.actions.addObservation(id, OBSERVATION));
      await net.settle();

      // Reporter's device: unresolved, both values kept, nothing chosen automatically.
      const flagged = a.incident(id)?.state;
      expect(flagged?.contradictions).toHaveLength(1);
      expect(flagged?.contradictions[0]).toMatchObject({ field: 'floor', status: 'open', detectedBy: 'rule' });
      expect(flagged?.claims.floor).toMatchObject({ value: null, tag: 'unresolved' });
      expect([...(flagged?.claims.floor.candidates ?? [])].sort()).toEqual(['First floor', 'Second floor']);
      const fact = a.incident(id)?.facts.find((f) => f.field === 'floor');
      expect(fact?.candidates).toEqual(
        expect.arrayContaining([
          { value: 'Second floor', by: 'You' },
          { value: 'First floor', by: 'b' },
        ]),
      );

      // Every device that may read the floor shows it as disputed, with both candidates.
      for (const device of [b, c]) {
        const seen = device.incident(id)?.facts.find((f) => f.field === 'floor');
        expect(seen).toMatchObject({ value: null, tag: 'unresolved', protected: false });
        expect(seen?.candidates.map((x) => x.value).sort()).toEqual(['First floor', 'Second floor']);
      }

      // A responder cannot settle it, whichever value they pick.
      const conflictId = flagged?.contradictions[0]?.id ?? '';
      for (const device of [b, c]) {
        const refused = await device.core.actions.resolveConflict(id, conflictId, 'First floor');
        expect(refused.ok).toBe(false);
      }
      await net.settle();
      expect(a.incident(id)?.state.contradictions[0]?.status).toBe('open');

      // A responder may ask the reporter to clarify, even one that cannot read the reporter's statement.
      must(await b.core.actions.requestConflictClarification(id, conflictId));
      await net.settle();
      expect(a.incident(id)?.state.questions.some((q) => q.field === 'floor' && q.status === 'open' && q.origin === 'human')).toBe(true);

      must(await a.core.actions.resolveConflict(id, conflictId, 'Second floor'));
      await net.settle();
      const resolved = a.incident(id)?.state;
      expect(resolved?.contradictions[0]).toMatchObject({ status: 'resolved', resolution: { value: 'Second floor' } });
      expect(resolved?.claims.floor).toMatchObject({ value: 'Second floor', tag: 'user_confirmed', candidates: [] });
      // History is intact: the losing statement is still there.
      expect(resolved?.claims.floor.revisions.map((r) => r.value)).toEqual(expect.arrayContaining(['First floor', 'Second floor']));
      expect(resolved?.reports.map((r) => r.text)).toEqual([REPORT, OBSERVATION]);

      for (const device of [b, c]) {
        expect(device.incident(id)?.facts.find((f) => f.field === 'floor')).toMatchObject({
          value: 'Second floor',
          tag: 'user_confirmed',
          candidates: [],
        });
      }
      // The authorized device holds every event and derives the identical claim history.
      expect(c.incident(id)?.state.claims.floor).toEqual(resolved?.claims.floor);
      expect(c.incident(id)?.state.contradictions).toEqual(resolved?.contradictions);
    },
  );

  it('never lets an AI-flagged conflict resolve anything or duplicate a rule flag', async () => {
    const made = await setup('authorized');
    net = made.net;
    const id = made.incidentId;
    const a = dev(net, 'a');
    must(await dev(net, 'b').core.actions.addObservation(id, OBSERVATION));
    await net.settle();
    // The simulated model also sees two floors; the rule flag already covers them.
    const state = a.incident(id)?.state;
    expect(state?.contradictions).toHaveLength(1);
    expect(state?.contradictions[0]?.detectedBy).toBe('rule');
    expect(state?.claims.floor.tag).toBe('unresolved');
    expect(state?.events.filter((e) => e.type === 'CONFLICT_RESOLVED')).toHaveLength(0);
  });
});
