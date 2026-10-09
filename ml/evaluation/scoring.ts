import { DELTA_CLASSES, FIELDS, type DeltaClass, type Field, type Language, type Scenario } from '../datasets/schema';
import type { RunResult, ScenarioRecord } from './result-schema';

/**
 * Pure scoring. Every rate is returned as a count pair so reports can always print n beside it.
 * Failed calls count against the pipeline: a field the model never produced is a miss, not a skip.
 */

export interface Rate {
  hits: number;
  total: number;
}
export const rate = (hits: number, total: number): Rate => ({ hits, total });
export const ratio = (r: Rate): number | null => (r.total === 0 ? null : r.hits / r.total);

// ---- value matching ---------------------------------------------------------------------------

const ORDINALS: [RegExp, string][] = [
  [/\b(ground|g\/f|gf)\b/g, 'g'],
  [/\b(first|1st|una|unang|isa)\b/g, '1'],
  [/\b(second|2nd|ikalawa|ikalawang|pangalawa|pangalawang|dalawa)\b/g, '2'],
  [/\b(third|3rd|ikatlo|ikatlong|pangatlo|pangatlong|tatlo)\b/g, '3'],
  [/\b(fourth|4th|ikaapat|ikaapat na|pang-apat|apat)\b/g, '4'],
  [/\b(fifth|5th|ikalima|ikalimang|panglima|lima)\b/g, '5'],
  [/\b(sixth|6th|ikaanim|anim)\b/g, '6'],
  [/\b(seventh|7th|ikapito|pito)\b/g, '7'],
];
const FILLER = /\b(the|floor|flr|fl|palapag|level|building|bldg|gusali|na|sa|ng|of|on|at)\b/g;

/** Canonical form used only for comparison: lower-case, ordinals as digits, place words removed. */
export function canon(value: string): string {
  let s = value.normalize('NFKC').toLowerCase();
  s = s.replace(/(\d+)\s*(st|nd|rd|th)\b/g, '$1').replace(/\b(\d+)f\b/g, '$1');
  for (const [pattern, digit] of ORDINALS) s = s.replace(pattern, digit);
  return s
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(FILLER, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Floor and building must equal an acceptable answer after canonicalisation: "2nd Floor" matches
 * "second floor", "Building B, second floor" does not match a building answer of "B".
 * Free-text fields match when the value contains an acceptable fragment.
 */
export function matches(field: Field, value: string, anyOf: readonly string[]): boolean {
  const v = canon(value);
  if (v === '') return false;
  if (field === 'floor' || field === 'building') return anyOf.some((a) => canon(a) === v);
  return anyOf.some((a) => {
    const c = canon(a);
    return c !== '' && v.includes(c);
  });
}

// ---- metrics ----------------------------------------------------------------------------------

export interface ExtractionScore {
  /** Fields the reference states that were proposed with an acceptable value. */
  correct: Rate;
  /** Fields the reference marks unknown that were left unproposed. */
  unknownKept: Rate;
  /** Proposed values that are wrong or have no basis in the text, out of all proposed values. */
  unsupported: Rate;
  perField: Record<Field, Rate>;
}

export interface DeltaScore {
  accuracy: Rate;
  fieldAccuracy: Rate;
  /** confusion[reference][predicted]; predicted may also be 'not_assessed' or 'missing'. */
  confusion: Record<string, Record<string, number>>;
  perClass: Record<string, { precision: Rate; recall: Rate }>;
  macroF1: number | null;
}

export interface Score {
  scenarios: number;
  extraction: ExtractionScore;
  delta: DeltaScore;
  conflictPrecision: Rate;
  conflictRecall: Rate;
  clarificationRelevant: Rate;
  /** Scenarios where a forbidden fragment reached a proposed value or question. */
  forbiddenLeaks: Rate;
  /** Calls whose output passed the schema, out of calls where the model answered at all. */
  schemaValid: Rate;
  /** Proposed fields that passed the evidence and grounding checks. */
  evidenceKept: Rate;
  completed: Rate;
  failuresByState: Record<string, number>;
  latency: Latency | null;
}

export interface Latency {
  n: number;
  p50: number;
  p90: number;
  max: number;
  /** First model call of the run, reported apart because the model may not be loaded yet. */
  firstCallMs: number | null;
}

const emptyFieldRates = (): Record<Field, Rate> =>
  Object.fromEntries(FIELDS.map((f) => [f, rate(0, 0)])) as Record<Field, Rate>;

const add = (r: Rate, hit: boolean): void => {
  r.total += 1;
  if (hit) r.hits += 1;
};

/** Nearest-rank percentile on a sorted copy. */
export function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] ?? 0;
}

const conflictKey = (field: string, ids: readonly string[]): string => `${field}|${[...ids].sort().join('+')}`;

function scoreExtraction(scenario: Scenario, record: ScenarioRecord | undefined, out: ExtractionScore): void {
  for (const ref of scenario.reference.extraction) {
    const got = record?.extraction.find((e) => e.statementId === ref.statementId)?.fields ?? {};
    for (const field of FIELDS) {
      const expected = ref.fields[field];
      const proposed = got[field];
      if (expected.status === 'optional') continue;
      if (expected.status === 'stated') {
        const ok = proposed !== undefined && matches(field, proposed.value, expected.anyOf);
        add(out.correct, ok);
        add(out.perField[field], ok);
        if (proposed !== undefined) add(out.unsupported, !ok);
      } else {
        add(out.unknownKept, proposed === undefined);
        if (proposed !== undefined) add(out.unsupported, true);
      }
    }
  }
}

function scoreDeltas(scenario: Scenario, record: ScenarioRecord | undefined, out: DeltaScore): void {
  for (const ref of scenario.reference.deltas) {
    const got = record?.deltas.find((d) => d.statementId === ref.statementId);
    const predicted = got?.overall ?? 'missing';
    add(out.accuracy, predicted === ref.overall);
    const row = (out.confusion[ref.overall] ??= {});
    row[predicted] = (row[predicted] ?? 0) + 1;
    for (const field of FIELDS) {
      const expected = ref.fields[field];
      if (expected !== undefined) add(out.fieldAccuracy, got?.fields[field] === expected);
    }
  }
}

function finishDelta(out: DeltaScore): void {
  const f1s: number[] = [];
  for (const cls of DELTA_CLASSES) {
    const row = out.confusion[cls] ?? {};
    const support = Object.values(row).reduce((a, b) => a + b, 0);
    const tp = row[cls] ?? 0;
    const predictedAs = Object.values(out.confusion).reduce((sum, r) => sum + (r[cls] ?? 0), 0);
    out.perClass[cls] = { precision: rate(tp, predictedAs), recall: rate(tp, support) };
    if (support === 0) continue;
    const p = predictedAs === 0 ? 0 : tp / predictedAs;
    const r = tp / support;
    f1s.push(p + r === 0 ? 0 : (2 * p * r) / (p + r));
  }
  out.macroF1 = f1s.length === 0 ? null : f1s.reduce((a, b) => a + b, 0) / f1s.length;
}

function leaksForbidden(scenario: Scenario, record: ScenarioRecord | undefined): boolean {
  if (!record) return false;
  const produced = [
    ...record.extraction.flatMap((e) => Object.values(e.fields).map((f) => f?.value ?? '')),
    record.clarification?.question ?? '',
  ]
    .join('\n')
    .toLowerCase();
  return scenario.reference.forbidden.some((fragment) => produced.includes(fragment.toLowerCase()));
}

/** Score one run against the scenarios of its split. Scenarios with no record count as not completed. */
export function scoreRun(scenarios: readonly Scenario[], run: RunResult): Score {
  const byId = new Map(run.records.map((r) => [r.scenarioId, r]));
  const extraction: ExtractionScore = {
    correct: rate(0, 0),
    unknownKept: rate(0, 0),
    unsupported: rate(0, 0),
    perField: emptyFieldRates(),
  };
  const delta: DeltaScore = { accuracy: rate(0, 0), fieldAccuracy: rate(0, 0), confusion: {}, perClass: {}, macroF1: null };
  const conflictPrecision = rate(0, 0);
  const conflictRecall = rate(0, 0);
  const clarificationRelevant = rate(0, 0);
  const forbiddenLeaks = rate(0, 0);
  const schemaValid = rate(0, 0);
  const evidenceKept = rate(0, 0);
  const completed = rate(0, 0);
  const failuresByState: Record<string, number> = {};
  const latencies: number[] = [];
  let firstCallMs: number | null = null;

  for (const scenario of scenarios) {
    const record = byId.get(scenario.id);
    scoreExtraction(scenario, record, extraction);
    scoreDeltas(scenario, record, delta);

    if (scenario.statements.length > 1) {
      const expected = new Set(scenario.reference.conflicts.map((c) => conflictKey(c.field, c.statementIds)));
      const predicted = new Set((record?.conflicts ?? []).map((c) => conflictKey(c.field, c.statementIds)));
      for (const key of predicted) add(conflictPrecision, expected.has(key));
      for (const key of expected) add(conflictRecall, predicted.has(key));
    }

    const clarification = scenario.reference.clarification;
    if (clarification && record && record.clarification !== undefined) {
      const asked = record.clarification;
      add(clarificationRelevant, asked === null ? clarification.noneAcceptable : clarification.acceptable.includes(asked.field));
    }

    if (scenario.reference.forbidden.length > 0) add(forbiddenLeaks, leaksForbidden(scenario, record));

    for (const call of record?.calls ?? []) {
      add(completed, call.state === 'ready');
      if (call.state !== 'ready') failuresByState[call.state] = (failuresByState[call.state] ?? 0) + 1;
      if (call.state === 'ready' || call.state === 'invalid_output') add(schemaValid, call.state === 'ready');
      evidenceKept.hits += call.kept;
      evidenceKept.total += call.proposed;
      if (call.source === 'callstack-apple' && call.state === 'ready') {
        if (firstCallMs === null) firstCallMs = call.latencyMs;
        else latencies.push(call.latencyMs);
      }
    }
  }
  finishDelta(delta);

  const latency: Latency | null =
    latencies.length === 0
      ? null
      : { n: latencies.length, p50: percentile(latencies, 50), p90: percentile(latencies, 90), max: Math.max(...latencies), firstCallMs };

  return {
    scenarios: scenarios.length,
    extraction,
    delta,
    conflictPrecision,
    conflictRecall,
    clarificationRelevant,
    forbiddenLeaks,
    schemaValid,
    evidenceKept,
    completed,
    failuresByState,
    latency,
  };
}

/** English and Taglish are always scored apart; there is no pooled headline number. */
export function scoreByLanguage(scenarios: readonly Scenario[], run: RunResult): Record<Language, Score> {
  const of = (language: Language) => scoreRun(scenarios.filter((s) => s.language === language), run);
  return { en: of('en'), taglish: of('taglish') };
}

export type { DeltaClass };
