import { DELTA_CLASSES, FIELDS, type Language, type Scenario } from '../datasets/schema';
import type { RunResult } from './result-schema';
import { ratio, scoreByLanguage, type Rate, type Score } from './scoring';

/** Markdown for one run. Every rate is printed as hits/total so the sample size is never hidden. */

export const fmt = (r: Rate): string => {
  const value = ratio(r);
  return value === null ? 'n/a (0)' : `${r.hits}/${r.total} (${(value * 100).toFixed(1)}%)`;
};

const LANGUAGE_LABEL: Record<Language, string> = { en: 'English', taglish: 'Taglish' };

function table(header: string[], rows: string[][]): string {
  return [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

function confusion(score: Score): string {
  const predicted = [...DELTA_CLASSES, 'not_assessed', 'missing'];
  const rows = DELTA_CLASSES.filter((c) => score.delta.confusion[c]).map((c) => [c, ...predicted.map((p) => String(score.delta.confusion[c]?.[p] ?? 0))]);
  return rows.length === 0 ? '_No delta references in this subset._' : table(['reference \\ predicted', ...predicted], rows);
}

/** A device row is only what it claims if every model call came from the real provider on a real phone. */
export function deviceClaimProblems(run: RunResult): string[] {
  const problems: string[] = [];
  if (run.header.runner !== 'device') return problems;
  if (!run.header.device.isPhysicalDevice) problems.push('header says this was not a physical device');
  const sources = new Set(run.records.flatMap((r) => r.calls.map((c) => c.source)));
  for (const s of sources) if (s !== 'callstack-apple' && s !== 'rules') problems.push(`contains ${s} calls`);
  if (!sources.has('callstack-apple')) problems.push('contains no call from the on-device provider');
  if (!run.records.some((r) => r.calls.some((c) => c.source === 'callstack-apple' && c.state === 'ready'))) problems.push('contains no completed model call');
  return problems;
}

export function renderRun(scenarios: readonly Scenario[], run: RunResult, file: string): string {
  const h = run.header;
  const scores = scoreByLanguage(scenarios, run);
  const languages = (['en', 'taglish'] as const).filter((l) => scores[l].scenarios > 0);
  const metric = (label: string, pick: (s: Score) => string) => [label, ...languages.map((l) => pick(scores[l]))];
  const out: string[] = [];

  out.push(`### ${h.runner} · ${h.variant} · ${h.split}`);
  out.push('');
  out.push(`Source file \`${file}\`. ${h.device.model}, OS ${h.device.osVersion}, physical device: ${h.device.isPhysicalDevice ? 'yes' : 'no'}. Commit \`${h.commit}\`, prompt version \`${h.promptVersion}\`, started ${h.startedAt}.`);
  out.push(`Conditions: ${h.conditions || 'not recorded'}.`);
  out.push('');
  out.push(
    table(
      ['metric', ...languages.map((l) => `${LANGUAGE_LABEL[l]} (${scores[l].scenarios} scenarios)`)],
      [
        metric('Field correctness (stated fields proposed correctly)', (s) => fmt(s.extraction.correct)),
        metric('Unknown kept unknown', (s) => fmt(s.extraction.unknownKept)),
        metric('Unsupported-fact rate (of proposed values)', (s) => fmt(s.extraction.unsupported)),
        metric('Delta class accuracy', (s) => fmt(s.delta.accuracy)),
        metric('Delta macro-F1', (s) => (s.delta.macroF1 === null ? 'n/a' : s.delta.macroF1.toFixed(3))),
        metric('Delta field-level accuracy', (s) => fmt(s.delta.fieldAccuracy)),
        metric('Conflict precision', (s) => fmt(s.conflictPrecision)),
        metric('Conflict recall', (s) => fmt(s.conflictRecall)),
        metric('Clarification relevant', (s) => fmt(s.clarificationRelevant)),
        metric('Scenarios leaking forbidden content', (s) => fmt(s.forbiddenLeaks)),
        metric('Schema validation passed', (s) => fmt(s.schemaValid)),
        metric('Evidence check passed (of proposed fields)', (s) => fmt(s.evidenceKept)),
        metric('Calls completed', (s) => fmt(s.completed)),
        metric('Failures by state', (s) => Object.entries(s.failuresByState).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none'),
        ...(h.runner === 'device'
          ? [
              metric('Latency p50 / p90 / max, ms (n)', (s) => (s.latency ? `${s.latency.p50} / ${s.latency.p90} / ${s.latency.max} (${s.latency.n})` : 'no completed model call')),
              metric('First model call, ms', (s) => (s.latency?.firstCallMs != null ? String(s.latency.firstCallMs) : 'n/a')),
            ]
          : []),
      ],
    ),
  );
  out.push('');
  out.push(table(['field', ...languages.map((l) => LANGUAGE_LABEL[l])], FIELDS.map((f) => [f, ...languages.map((l) => fmt(scores[l].extraction.perField[f]))])));
  for (const l of languages) {
    out.push('');
    out.push(`Delta confusion, ${LANGUAGE_LABEL[l]}:`);
    out.push('');
    out.push(confusion(scores[l]));
  }
  return out.join('\n');
}
