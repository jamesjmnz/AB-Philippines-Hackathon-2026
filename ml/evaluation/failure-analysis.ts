import { FIELDS, type Scenario } from '../datasets/schema';
import type { RunResult } from './result-schema';
import { matches } from './scoring';

/**
 * Lists every scenario a run got wrong and how, so failures are read rather than averaged away.
 * Output names scenario ids and values only; it is written for development and validation splits.
 * For the held-out split it prints counts by kind and tag, never the cases, so nobody tunes on them.
 */

export interface Failure {
  scenarioId: string;
  language: string;
  tags: readonly string[];
  kind: 'extraction_wrong' | 'extraction_missed' | 'unsupported_fact' | 'delta_wrong' | 'conflict_missed' | 'conflict_false' | 'forbidden_leak' | 'call_failed';
  detail: string;
}

const key = (field: string, ids: readonly string[]) => `${field}|${[...ids].sort().join('+')}`;

export function findFailures(scenarios: readonly Scenario[], run: RunResult): Failure[] {
  const byId = new Map(run.records.map((r) => [r.scenarioId, r]));
  const failures: Failure[] = [];
  for (const s of scenarios) {
    const record = byId.get(s.id);
    const push = (kind: Failure['kind'], detail: string) => failures.push({ scenarioId: s.id, language: s.language, tags: s.tags, kind, detail });

    for (const ref of s.reference.extraction) {
      const got = record?.extraction.find((e) => e.statementId === ref.statementId)?.fields ?? {};
      for (const field of FIELDS) {
        const expected = ref.fields[field];
        const proposed = got[field];
        if (expected.status === 'optional') continue;
        if (expected.status === 'unknown') {
          if (proposed) push('unsupported_fact', `${ref.statementId} ${field}: proposed "${proposed.value}", reference says not stated`);
        } else if (!proposed) push('extraction_missed', `${ref.statementId} ${field}: nothing proposed, expected one of ${JSON.stringify(expected.anyOf)}`);
        else if (!matches(field, proposed.value, expected.anyOf)) push('extraction_wrong', `${ref.statementId} ${field}: proposed "${proposed.value}", expected one of ${JSON.stringify(expected.anyOf)}`);
      }
    }

    for (const ref of s.reference.deltas) {
      const predicted = record?.deltas.find((d) => d.statementId === ref.statementId)?.overall ?? 'missing';
      if (predicted !== ref.overall) push('delta_wrong', `${ref.statementId}: predicted ${predicted}, reference ${ref.overall}`);
    }

    if (s.statements.length > 1) {
      const expected = new Set(s.reference.conflicts.map((c) => key(c.field, c.statementIds)));
      const predicted = new Set((record?.conflicts ?? []).map((c) => key(c.field, c.statementIds)));
      for (const k of expected) if (!predicted.has(k)) push('conflict_missed', k);
      for (const k of predicted) if (!expected.has(k)) push('conflict_false', k);
    }

    const produced = [...(record?.extraction ?? []).flatMap((e) => Object.values(e.fields).map((f) => f?.value ?? '')), record?.clarification?.question ?? ''].join('\n').toLowerCase();
    for (const fragment of s.reference.forbidden) if (produced.includes(fragment.toLowerCase())) push('forbidden_leak', `output contains "${fragment}"`);

    for (const call of record?.calls ?? []) if (call.state !== 'ready') push('call_failed', `${call.op} ${call.statementId}: ${call.state}`);
  }
  return failures;
}

export function renderFailures(scenarios: readonly Scenario[], run: RunResult): string {
  const failures = findFailures(scenarios, run);
  const lines = [`## Failure analysis: ${run.header.runner} · ${run.header.variant} · ${run.header.split}`, ''];
  if (failures.length === 0) return [...lines, 'No failures.'].join('\n');

  const count = (of: (f: Failure) => string[]) => {
    const totals = new Map<string, number>();
    for (const f of failures) for (const k of of(f)) totals.set(k, (totals.get(k) ?? 0) + 1);
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `- ${k}: ${n}`);
  };
  lines.push('By kind:', ...count((f) => [f.kind]), '', 'By language:', ...count((f) => [f.language]), '', 'By tag:', ...count((f) => [...f.tags]), '');

  if (run.header.split === 'held_out') {
    lines.push('Individual held-out cases are not listed, so they cannot be tuned against.');
    return lines.join('\n');
  }
  lines.push('Cases:', ...failures.map((f) => `- \`${f.scenarioId}\` (${f.language}; ${f.tags.join(', ')}) ${f.kind}: ${f.detail}`));
  return lines.join('\n');
}
