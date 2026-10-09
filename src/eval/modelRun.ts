import type { ScenarioInput } from '../../ml/datasets/schema';
import type { CallRecord, ScenarioRecord } from '../../ml/evaluation/result-schema';
import type { AIState, LocalAIService, ProposalField } from '../ai';
import { recordAIProposal } from '../domain';
import { analyzeStatement, type StatementAnalysis } from '../services/deltaPipeline';
import { openConflicts, ruleFields, startScenario } from './rulesRun';

/**
 * Runs one evaluation scenario through the same pipeline the app uses, against whatever
 * LocalAIService it is handed, and records outputs and timings. The scenario lives in memory only.
 * Statement text is never copied into the record: only what the pipeline produced from it.
 */

type Source = CallRecord['source'];

const callState = (state: AIState): CallRecord['state'] => state;

function callsOf(analysis: StatementAnalysis, statementId: string, first: boolean): CallRecord[] {
  const { model } = analysis;
  if (model.state === 'not_run') return [];
  const source: Source = model.meta?.source ?? 'none';
  const calls: CallRecord[] = [
    { op: first ? 'extract' : 'assess', statementId, state: callState(model.state), source, latencyMs: model.latenciesMs[0] ?? model.meta?.latencyMs ?? 0, proposed: model.proposed, kept: model.kept },
  ];
  if (model.relation !== 'skipped') {
    calls.push({ op: 'assess', statementId, state: callState(model.relation), source, latencyMs: model.latenciesMs[1] ?? 0, proposed: 0, kept: 0 });
  }
  return calls;
}

export interface ModelRunOptions {
  /** Also ask for one clarifying question after the first statement. */
  clarify: boolean;
  /** Extraction only, through `extractIncidentReport`: the arm that compares output shapes. */
  extractionOnly?: boolean;
}

export async function runScenarioWithModel(ai: LocalAIService, scenario: ScenarioInput, options: ModelRunOptions): Promise<ScenarioRecord> {
  const session = startScenario(scenario);
  const record: ScenarioRecord = { scenarioId: scenario.id, calls: [], extraction: [], deltas: [], conflicts: [] };
  const modelConflicts: ScenarioRecord['conflicts'] = [];
  const statementOfReport = new Map<string, string>();

  for (const [index, statement] of scenario.statements.entries()) {
    const step = session.add(statement);
    statementOfReport.set(step.reportId, statement.id);
    const fields = ruleFields(step);

    if (options.extractionOnly) {
      if (index > 0) continue;
      const result = await ai.extractIncidentReport({ text: statement.text }, { cache: 'bypass', priority: 'batch' });
      const proposed = result.ok ? Object.keys(result.value.fields).length + result.value.dropped.length : 0;
      const kept = result.ok ? Object.keys(result.value.fields).length : 0;
      record.calls.push({ op: 'extract', statementId: statement.id, state: result.ok ? 'ready' : result.state, source: result.meta.source, latencyMs: result.meta.latencyMs, proposed, kept });
      if (result.ok) {
        for (const [field, value] of Object.entries(result.value.fields)) {
          if (value && fields[field as ProposalField] === undefined) fields[field as ProposalField] = value;
        }
      }
      record.extraction.push({ statementId: statement.id, fields });
      continue;
    }

    const analysis = await analyzeStatement(ai, session.state, step.reportId);
    if (!analysis) continue;
    record.calls.push(...callsOf(analysis, statement.id, index === 0));
    for (const finding of analysis.findings) fields[finding.field] = { value: finding.value, evidence: finding.evidence.text };
    record.extraction.push({ statementId: statement.id, fields });

    if (index > 0) {
      record.deltas.push({ statementId: statement.id, overall: analysis.overall, fields: Object.fromEntries(analysis.items.map((i) => [i.field, i.class])) });
      for (const item of analysis.items) {
        const against = item.againstReportId ? statementOfReport.get(item.againstReportId) : undefined;
        if (item.source === 'model' && item.class === 'possible_contradiction' && against) modelConflicts.push({ field: item.field, statementIds: [against, statement.id] });
      }
    }
    // Later statements are compared with what the model proposed earlier, exactly as in the app.
    if (analysis.findings.length > 0) {
      session.apply(statement.id, recordAIProposal(session.state, session.as('reporter'), { provider: 'evaluation', reportId: step.reportId, findings: analysis.findings }));
    }

    if (index === 0 && options.clarify) {
      const known = Object.fromEntries(Object.entries(fields).map(([field, value]) => [field, value?.value ?? '']));
      const asked = await ai.suggestClarification({ report: statement.text, known, skipped: [] }, { cache: 'bypass', priority: 'batch' });
      record.calls.push({ op: 'clarify', statementId: statement.id, state: asked.ok ? 'ready' : asked.state, source: asked.meta.source, latencyMs: asked.meta.latencyMs, proposed: 0, kept: 0 });
      if (asked.ok) record.clarification = asked.value;
    }
  }

  const seen = new Set<string>();
  for (const conflict of [...openConflicts({ final: session.state, statementOfEvent: session.statementOfEvent }), ...modelConflicts]) {
    const key = `${conflict.field}|${[...conflict.statementIds].sort().join('+')}`;
    if (!seen.has(key)) record.conflicts.push(conflict);
    seen.add(key);
  }
  return record;
}
