import { scenarioSchema, type Scenario } from '../../datasets/schema';
import type { RunResult, ScenarioRecord } from '../result-schema';
import { canon, matches, percentile, ratio, scoreByLanguage, scoreRun } from '../scoring';

const unknown = { status: 'unknown' as const };

const scenario: Scenario = scenarioSchema.parse({
  id: 'test-001',
  split: 'development',
  language: 'en',
  tags: ['conflict'],
  statements: [
    { id: 's1', author: 'reporter', text: 'I fell in Building B, second floor. My ankle hurts.' },
    { id: 's2', author: 'responder_a', text: 'I think they are on the first floor.' },
  ],
  reference: {
    extraction: [
      {
        statementId: 's1',
        fields: {
          incidentType: { status: 'stated', anyOf: ['fell', 'fall'] },
          building: { status: 'stated', anyOf: ['B'] },
          floor: { status: 'stated', anyOf: ['2'] },
          locationText: { status: 'optional' },
          symptom: { status: 'stated', anyOf: ['ankle'] },
          assistanceRequested: unknown,
        },
      },
    ],
    deltas: [{ statementId: 's2', overall: 'possible_contradiction', fields: { floor: 'possible_contradiction' } }],
    conflicts: [{ field: 'floor', statementIds: ['s1', 's2'] }],
    clarification: { acceptable: ['assistanceRequested'], noneAcceptable: true },
    forbidden: ['fracture'],
  },
  notes: 'test',
});

const header: RunResult['header'] = {
  runner: 'mac-baseline',
  variant: 'rules',
  split: 'development',
  inputsSha256: 'x',
  promptVersion: 'none',
  commit: 'test',
  startedAt: '2026-10-10T00:00:00Z',
  device: { model: 'Mac', osVersion: 'n/a', isPhysicalDevice: false },
  packageVersion: 'n/a',
  conditions: 'unit test',
};

const run = (record: Partial<ScenarioRecord>): RunResult => ({
  header,
  records: [{ scenarioId: 'test-001', calls: [], extraction: [], deltas: [], conflicts: [], ...record }],
});

describe('value matching', () => {
  it('treats ordinal spellings of a floor as the same answer', () => {
    expect(canon('2nd Floor')).toBe('2');
    expect(canon('ikalawang palapag')).toBe('2');
    expect(matches('floor', 'Second floor', ['2'])).toBe(true);
    expect(matches('floor', 'third floor', ['2'])).toBe(false);
  });

  it('requires floor and building to be the answer alone, not a longer phrase', () => {
    expect(matches('building', 'Building B', ['B'])).toBe(true);
    expect(matches('building', 'Building B, second floor', ['B'])).toBe(false);
  });

  it('accepts a free-text value that contains an acceptable fragment', () => {
    expect(matches('symptom', 'My ankle hurts', ['ankle'])).toBe(true);
    expect(matches('symptom', 'headache', ['ankle'])).toBe(false);
    expect(matches('symptom', '', ['ankle'])).toBe(false);
  });

  it('does not reward copying a whole sentence into a free-text field', () => {
    const sentence = 'I fell in Building B on the second floor near the stairs and my ankle hurts a lot please help';
    expect(matches('symptom', sentence, ['ankle'])).toBe(false);
    expect(matches('symptom', 'my ankle hurts a lot', ['ankle'])).toBe(true);
  });
});

describe('scoreRun', () => {
  it('scores a perfect record', () => {
    const score = scoreRun(
      [scenario],
      run({
        extraction: [
          {
            statementId: 's1',
            fields: {
              incidentType: { value: 'fell', evidence: 'I fell' },
              building: { value: 'Building B', evidence: 'Building B' },
              floor: { value: 'second floor', evidence: 'second floor' },
              symptom: { value: 'ankle hurts', evidence: 'My ankle hurts' },
            },
          },
        ],
        deltas: [{ statementId: 's2', overall: 'possible_contradiction', fields: { floor: 'possible_contradiction' } }],
        conflicts: [{ field: 'floor', statementIds: ['s2', 's1'] }],
        clarification: null,
      }),
    );
    expect(score.extraction.correct).toEqual({ hits: 4, total: 4 });
    expect(score.extraction.unknownKept).toEqual({ hits: 1, total: 1 });
    expect(score.extraction.unsupported).toEqual({ hits: 0, total: 4 });
    expect(score.delta.accuracy).toEqual({ hits: 1, total: 1 });
    expect(score.delta.fieldAccuracy).toEqual({ hits: 1, total: 1 });
    expect(score.delta.macroF1).toBe(1);
    expect(score.conflictPrecision).toEqual({ hits: 1, total: 1 });
    expect(score.conflictRecall).toEqual({ hits: 1, total: 1 });
    expect(score.clarificationRelevant).toEqual({ hits: 1, total: 1 });
    expect(score.forbiddenLeaks).toEqual({ hits: 0, total: 1 });
  });

  it('counts wrong values and invented fields as unsupported, and optional fields nowhere', () => {
    const score = scoreRun(
      [scenario],
      run({
        extraction: [
          {
            statementId: 's1',
            fields: {
              floor: { value: 'third floor', evidence: 'second floor' },
              assistanceRequested: { value: 'ambulance', evidence: '' },
              locationText: { value: 'near the stairs', evidence: '' },
              symptom: { value: 'ankle fracture', evidence: 'ankle' },
            },
          },
        ],
      }),
    );
    expect(score.extraction.correct).toEqual({ hits: 1, total: 4 });
    expect(score.extraction.unsupported).toEqual({ hits: 2, total: 3 });
    expect(score.extraction.unknownKept).toEqual({ hits: 0, total: 1 });
    expect(score.extraction.perField.floor).toEqual({ hits: 0, total: 1 });
    expect(score.forbiddenLeaks).toEqual({ hits: 1, total: 1 });
  });

  it('counts a missing record as misses, not as skipped', () => {
    const score = scoreRun([scenario], { header, records: [] });
    expect(score.extraction.correct).toEqual({ hits: 0, total: 4 });
    expect(score.delta.accuracy).toEqual({ hits: 0, total: 1 });
    expect(score.delta.confusion.possible_contradiction).toEqual({ missing: 1 });
    expect(score.conflictRecall).toEqual({ hits: 0, total: 1 });
    expect(score.clarificationRelevant.total).toBe(0);
    expect(score.delta.macroF1).toBe(0);
  });

  it('records a wrong class in the confusion matrix and a false conflict in precision', () => {
    const score = scoreRun(
      [scenario],
      run({
        deltas: [{ statementId: 's2', overall: 'not_assessed', fields: {} }],
        conflicts: [{ field: 'building', statementIds: ['s1', 's2'] }],
        clarification: { field: 'floor', question: 'Which floor?' },
      }),
    );
    expect(score.delta.confusion.possible_contradiction).toEqual({ not_assessed: 1 });
    expect(score.conflictPrecision).toEqual({ hits: 0, total: 1 });
    expect(score.conflictRecall).toEqual({ hits: 0, total: 1 });
    expect(score.clarificationRelevant).toEqual({ hits: 0, total: 1 });
  });

  it('separates completion, schema validity, evidence and latency, and keeps the first call apart', () => {
    const call = (state: 'ready' | 'timeout' | 'invalid_output', latencyMs: number) => ({
      op: 'extract' as const,
      statementId: 's1',
      state,
      source: 'callstack-apple' as const,
      latencyMs,
      proposed: state === 'ready' ? 4 : 0,
      kept: state === 'ready' ? 3 : 0,
    });
    const score = scoreRun(
      [scenario],
      run({ calls: [call('ready', 5000), call('ready', 1000), call('ready', 3000), call('timeout', 20000), call('invalid_output', 900)] }),
    );
    expect(score.completed).toEqual({ hits: 3, total: 5 });
    expect(score.failuresByState).toEqual({ timeout: 1, invalid_output: 1 });
    expect(score.schemaValid).toEqual({ hits: 3, total: 4 });
    expect(score.evidenceKept).toEqual({ hits: 9, total: 12 });
    expect(score.latency).toEqual({ n: 2, p50: 1000, p90: 3000, max: 3000, firstCallMs: 5000 });
  });

  it('counts a failed clarification call as a miss', () => {
    const failed = { op: 'clarify' as const, statementId: 's1', state: 'timeout' as const, source: 'callstack-apple' as const, latencyMs: 20000, proposed: 0, kept: 0 };
    expect(scoreRun([scenario], run({ calls: [failed] })).clarificationRelevant).toEqual({ hits: 0, total: 1 });
    expect(scoreRun([scenario], run({})).clarificationRelevant.total).toBe(0);
  });

  it('reports no latency for a run with no model calls', () => {
    expect(scoreRun([scenario], run({})).latency).toBeNull();
  });

  it('scores each language on its own', () => {
    const byLanguage = scoreByLanguage([scenario], run({}));
    expect(byLanguage.en.scenarios).toBe(1);
    expect(byLanguage.taglish.scenarios).toBe(0);
    expect(ratio(byLanguage.taglish.delta.accuracy)).toBeNull();
  });
});

describe('percentile', () => {
  it('uses nearest rank', () => {
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
    expect(percentile([10, 20, 30, 40], 90)).toBe(40);
    expect(percentile([7], 90)).toBe(7);
  });
});

describe('scenario schema', () => {
  it('rejects a scenario whose first statement is not the reporter', () => {
    const bad = { ...scenario, statements: [{ id: 's1', author: 'responder_a', text: 'x' }], reference: { ...scenario.reference, deltas: [], conflicts: [] } };
    expect(scenarioSchema.safeParse(bad).success).toBe(false);
  });

  it('requires one delta per later statement', () => {
    const bad = { ...scenario, reference: { ...scenario.reference, deltas: [] } };
    expect(scenarioSchema.safeParse(bad).success).toBe(false);
  });
});
