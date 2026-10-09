import type { AIResult, LocalAIService, StatementAssessmentInput, StatementAssessmentProposal } from '@/ai';
import { addObservation, addReport, confirmClaim, recordAIProposal, type IncidentState } from '@/domain';
import { ALEX, MIKA, makeWorld, sosWithPeers, type World } from '@/domain/testing/fixtures';

import { analyzeStatement, analyzeWithRules, basisStillHolds } from '../deltaPipeline';

/** Synthetic statements only. ALEX is the reporter, MIKA a responder. */

type Scripted = Partial<Pick<StatementAssessmentProposal, 'fields' | 'relations' | 'topic' | 'relationCall'>>;

function modelSaying(script: Scripted, seen: StatementAssessmentInput[] = []): Pick<LocalAIService, 'assessStatement'> {
  return {
    assessStatement: async (input): Promise<AIResult<StatementAssessmentProposal>> => {
      seen.push(input);
      return {
        ok: true,
        value: { fields: {}, dropped: [], unknown: [], relations: {}, topic: 'about_request', relationCall: 'skipped', latenciesMs: [10], ...script },
        meta: { source: 'simulated', latencyMs: 10 },
      };
    },
  };
}

const failingModel: Pick<LocalAIService, 'assessStatement'> = {
  assessStatement: async () => ({ ok: false, state: 'timeout', message: 'timed out', meta: { source: 'simulated', latencyMs: 20000 } }),
};

function start(): { world: World; state: IncidentState } {
  const world = makeWorld('pipe');
  return { world, state: sosWithPeers(world).state };
}

const lastReport = (state: IncidentState): string => state.reports[state.reports.length - 1]?.id ?? '';

/** Records what the model proposed for the latest statement, as the app does, so later statements can be compared with it. */
async function propose(world: World, state: IncidentState, script: Scripted): Promise<IncidentState> {
  const analysis = await analyzeStatement(modelSaying(script), state, lastReport(state));
  if (!analysis || analysis.findings.length === 0) throw new Error('fixture: nothing to propose');
  return recordAIProposal(state, world.as(ALEX), { provider: 'test', reportId: analysis.reportId, findings: analysis.findings }).state;
}

describe('analyzeStatement', () => {
  it('lets the rules decide a floor even when the model says something else', async () => {
    const { world, state } = start();
    let s = addReport(state, world.as(ALEX), { text: 'I am on the second floor.' }).state;
    s = addObservation(s, world.as(MIKA), { text: 'I think they are on the first floor.' }).state;
    const analysis = await analyzeStatement(modelSaying({ fields: { floor: { value: 'Ninth floor', evidence: 'first floor' } } }), s, lastReport(s));
    expect(analysis?.overall).toBe('possible_contradiction');
    expect(analysis?.items).toEqual([expect.objectContaining({ field: 'floor', class: 'possible_contradiction', source: 'rule', needsVerification: true })]);
    expect(analysis?.findings).toEqual([]);
  });

  it('adds a detail the rules cannot read as new information, with its exact span', async () => {
    const { world, state } = start();
    const s = addReport(state, world.as(ALEX), { text: 'I slipped near the canteen. My ankle hurts.' }).state;
    const analysis = await analyzeStatement(modelSaying({ fields: { locationText: { value: 'near the canteen', evidence: 'near the canteen' }, symptom: { value: 'My ankle hurts', evidence: 'My ankle hurts' } } }), s, lastReport(s));
    expect(analysis?.overall).toBe('new_information');
    expect(analysis?.findings).toEqual([
      { field: 'locationText', value: 'near the canteen', evidence: { start: 10, end: 26, text: 'near the canteen' } },
      { field: 'symptom', value: 'My ankle hurts', evidence: { start: 28, end: 42, text: 'My ankle hurts' } },
    ]);
    expect(analysis?.items.every((i) => i.source === 'model' && !i.needsVerification)).toBe(true);
  });

  it('computes the class from authorship: the model only says same or different', async () => {
    const { world, state } = start();
    let s = addReport(state, world.as(ALEX), { text: 'I am near the canteen.' }).state;
    s = await propose(world, s, { fields: { locationText: { value: 'near the canteen', evidence: 'near the canteen' } } });

    const place = { locationText: { value: 'by the gym', evidence: 'by the gym' } };
    const responder = addObservation(s, world.as(MIKA), { text: 'They are by the gym.' }).state;
    const seen: StatementAssessmentInput[] = [];
    const disagreement = await analyzeStatement(modelSaying({ fields: place, relations: { locationText: 'different' } }, seen), responder, lastReport(responder));
    expect(seen[0]?.known).toEqual({ locationText: 'near the canteen' });
    expect(disagreement?.items[0]).toMatchObject({ field: 'locationText', class: 'possible_contradiction', needsVerification: true, againstRevisionId: null, againstReportId: s.reports[0]?.id });
    expect(disagreement?.overall).toBe('possible_contradiction');

    const reporter = addReport(s, world.as(ALEX), { text: 'Sorry, I am by the gym.' }).state;
    const correction = await analyzeStatement(modelSaying({ fields: place, relations: { locationText: 'different' } }), reporter, lastReport(reporter));
    expect(correction?.items[0]).toMatchObject({ class: 'correction', needsVerification: false });

    const same = await analyzeStatement(modelSaying({ fields: place, relations: { locationText: 'same' } }), responder, lastReport(responder));
    expect(same?.items[0]?.class).toBe('confirmation');
    const repeated = await analyzeStatement(modelSaying({ fields: place, relations: { locationText: 'same' } }), reporter, lastReport(reporter));
    expect(repeated?.items[0]?.class).toBe('no_meaningful_change');
  });

  it('treats a different feeling from another person as more information, never a contradiction', async () => {
    const { world, state } = start();
    let s = addReport(state, world.as(ALEX), { text: 'My ankle hurts.' }).state;
    s = await propose(world, s, { fields: { symptom: { value: 'My ankle hurts', evidence: 'My ankle hurts' } } });
    s = addObservation(s, world.as(MIKA), { text: 'They look dizzy.' }).state;
    const analysis = await analyzeStatement(modelSaying({ fields: { symptom: { value: 'They look dizzy', evidence: 'They look dizzy' } }, relations: { symptom: 'different' } }), s, lastReport(s));
    expect(analysis?.items[0]).toMatchObject({ field: 'symptom', class: 'new_information', needsVerification: false });
  });

  it('flags a model-read detail that differs from a confirmed one, even from the same person', async () => {
    const { world, state } = start();
    let s = addReport(state, world.as(ALEX), { text: 'I am near the canteen.' }).state;
    s = confirmClaim(s, world.as(ALEX), { field: 'locationText', value: 'near the canteen' }).state;
    s = addReport(s, world.as(ALEX), { text: 'I am by the gym.' }).state;
    const analysis = await analyzeStatement(modelSaying({ fields: { locationText: { value: 'by the gym', evidence: 'by the gym' } }, relations: { locationText: 'different' } }), s, lastReport(s));
    expect(analysis?.items[0]).toMatchObject({ class: 'possible_contradiction', needsVerification: true });
    expect(typeof analysis?.items[0]?.againstRevisionId).toBe('string');
  });

  it('says unrelated only when nothing is stated and the model says so', async () => {
    const { world, state } = start();
    let s = addReport(state, world.as(ALEX), { text: 'I am on the second floor.' }).state;
    s = addObservation(s, world.as(MIKA), { text: 'anyone seen my charger?' }).state;
    expect((await analyzeStatement(modelSaying({ topic: 'unrelated' }), s, lastReport(s)))?.overall).toBe('unrelated');
    expect((await analyzeStatement(modelSaying({ topic: 'about_request' }), s, lastReport(s)))?.overall).toBe('no_meaningful_change');
    expect(analyzeWithRules(s, lastReport(s))?.overall).toBe('not_assessed');
  });

  it('proposes a value but claims no relation when the comparison is missing', async () => {
    const { world, state } = start();
    let s = addReport(state, world.as(ALEX), { text: 'I am near the canteen.' }).state;
    s = await propose(world, s, { fields: { locationText: { value: 'near the canteen', evidence: 'near the canteen' } } });
    s = addObservation(s, world.as(MIKA), { text: 'They are by the gym.' }).state;
    const analysis = await analyzeStatement(modelSaying({ fields: { locationText: { value: 'by the gym', evidence: 'by the gym' } }, relationCall: 'timeout' }), s, lastReport(s));
    expect(analysis?.findings).toHaveLength(1);
    expect(analysis?.items).toEqual([]);
    expect(analysis?.model).toMatchObject({ state: 'ready', relation: 'timeout' });
  });

  it('drops a proposed phrase that is not in the statement', async () => {
    const { world, state } = start();
    const s = addReport(state, world.as(ALEX), { text: 'I am near the canteen.' }).state;
    const analysis = await analyzeStatement(modelSaying({ fields: { locationText: { value: 'in the library', evidence: 'in the library' } } }), s, lastReport(s));
    expect(analysis?.findings).toEqual([]);
    expect(analysis?.items).toEqual([]);
  });

  it('returns the deterministic analysis unchanged when the model fails or is absent', async () => {
    const { world, state } = start();
    let s = addReport(state, world.as(ALEX), { text: 'I am on the second floor.' }).state;
    s = addObservation(s, world.as(MIKA), { text: 'Second floor, I see them.' }).state;
    const rules = analyzeWithRules(s, lastReport(s));
    const failed = await analyzeStatement(failingModel, s, lastReport(s));
    expect(failed?.overall).toBe('confirmation');
    expect(failed?.items).toEqual(rules?.items);
    expect(failed?.model).toMatchObject({ state: 'timeout' });
    expect(await analyzeStatement({}, s, lastReport(s))).toEqual(rules);
    expect(await analyzeStatement(failingModel, s, 'no-such-report')).toBeNull();
  });

  it('never changes the state it reads', async () => {
    const { world, state } = start();
    const s = addReport(state, world.as(ALEX), { text: 'I slipped near the canteen on the second floor.' }).state;
    const before = JSON.stringify(s);
    await analyzeStatement(modelSaying({ fields: { locationText: { value: 'near the canteen', evidence: 'near the canteen' } } }), s, lastReport(s));
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('basisStillHolds', () => {
  it('goes false for a field once a human says something new about it, and stays true for the others', async () => {
    const { world, state } = start();
    const s = addReport(state, world.as(ALEX), { text: 'I am on the second floor.' }).state;
    const analysis = analyzeWithRules(s, lastReport(s));
    if (!analysis) throw new Error('fixture');
    expect(basisStillHolds(s, analysis, 'floor')).toBe(true);
    const later = addObservation(s, world.as(MIKA), { text: 'I think they are on the first floor.' }).state;
    expect(basisStillHolds(later, analysis, 'floor')).toBe(false);
    expect(basisStillHolds(later, analysis, 'building')).toBe(true);
  });
});
