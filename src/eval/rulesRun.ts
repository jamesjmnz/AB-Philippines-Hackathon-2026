import type { ScenarioInput } from '../../ml/datasets/schema';
import type { ScenarioRecord } from '../../ml/evaluation/result-schema';
import {
  CLAIM_FIELDS,
  addObservation,
  addReport,
  classifyStatementDelta,
  confirmClaim,
  createFixedClock,
  createManualSOS,
  createSequentialIds,
  type Actor,
  type ClaimField,
  type CommandContext,
  type IncidentState,
  type TrustedPeer,
} from '../domain';

/**
 * Replays an evaluation scenario through the real domain commands, in memory. Nothing is stored or
 * sent: the incident exists only for the duration of the call. This is the deterministic baseline
 * (rules only) and the state the model stages are run against.
 */

const REPORTER: Actor = { deviceId: 'eval-reporter', userName: 'Evaluation reporter' };
const RESPONDERS: Record<'responder_a' | 'responder_b', TrustedPeer> = {
  responder_a: { deviceId: 'eval-responder-a', userName: 'Evaluation responder A', level: 'authorized' },
  responder_b: { deviceId: 'eval-responder-b', userName: 'Evaluation responder B', level: 'authorized' },
};

export interface ScenarioStep {
  statementId: string;
  reportId: string;
  /** State right after this statement, its rule conflicts and any confirmation that follows it. */
  state: IncidentState;
}

export interface ScenarioWorld {
  steps: ScenarioStep[];
  final: IncidentState;
  /** Which statement produced each event, so a revision can be traced back to its statement. */
  statementOfEvent: Map<string, string>;
  as(author: ScenarioInput['statements'][number]['author']): CommandContext;
}

export function buildScenario(scenario: ScenarioInput): ScenarioWorld {
  const clock = createFixedClock(1_760_000_000_000);
  const ids = createSequentialIds(`eval-${scenario.id}`);
  const actorOf = ({ deviceId, userName }: TrustedPeer): Actor => ({ deviceId, userName });
  const as: ScenarioWorld['as'] = (author) => ({ actor: author === 'reporter' ? REPORTER : actorOf(RESPONDERS[author]), clock, ids });

  let state = createManualSOS(as('reporter'), { recipients: Object.values(RESPONDERS) }).state;
  const steps: ScenarioStep[] = [];
  const statementOfEvent = new Map<string, string>();

  for (const statement of scenario.statements) {
    const add = statement.author === 'reporter' ? addReport : addObservation;
    const added = add(state, as(statement.author), { text: statement.text });
    state = added.state;
    added.events.forEach((e) => statementOfEvent.set(e.id, statement.id));
    const reportId = state.reports[state.reports.length - 1]?.id ?? '';
    for (const [field, value] of Object.entries(statement.confirms ?? {})) {
      const confirmed = confirmClaim(state, as('reporter'), { field: field as ClaimField, value });
      state = confirmed.state;
      confirmed.events.forEach((e) => statementOfEvent.set(e.id, statement.id));
    }
    steps.push({ statementId: statement.id, reportId, state });
  }
  return { steps, final: state, statementOfEvent, as };
}

/** Open contradictions as pairs of statement ids, the form the reference answers use. */
export function openConflicts(world: ScenarioWorld): ScenarioRecord['conflicts'] {
  const conflicts: ScenarioRecord['conflicts'] = [];
  for (const c of world.final.contradictions) {
    if (c.status !== 'open') continue;
    const statements = c.revisionIds
      .map((id) => world.final.claims[c.field].revisions.find((r) => r.id === id))
      .map((r) => (r ? world.statementOfEvent.get(r.source.eventId) : undefined));
    const [a, b] = [...new Set(statements.filter((s): s is string => s !== undefined))];
    if (a !== undefined && b !== undefined) conflicts.push({ field: c.field, statementIds: [a, b] });
  }
  return conflicts;
}

/** What the rules alone extracted from one statement: the floor and building they could read. */
export function ruleFields(step: ScenarioStep): ScenarioRecord['extraction'][number]['fields'] {
  const fields: ScenarioRecord['extraction'][number]['fields'] = {};
  for (const field of CLAIM_FIELDS) {
    const revision = step.state.claims[field].revisions.find((r) => r.evidence?.reportId === step.reportId && r.extraction === 'rule');
    if (revision?.evidence) fields[field] = { value: revision.value, evidence: revision.evidence.text };
  }
  return fields;
}

export function ruleDelta(step: ScenarioStep): ScenarioRecord['deltas'][number] | null {
  const delta = classifyStatementDelta(step.state, step.reportId);
  if (!delta) return null;
  return { statementId: step.statementId, overall: delta.overall, fields: Object.fromEntries(delta.fields.map((f) => [f.field, f.class])) };
}

/**
 * The deterministic baseline: location rules, the delta classifier and the conflict rule, no model.
 * Its clarification is the fixed fallback: ask for the floor if unknown, then the building, else nothing.
 */
export function runRules(scenario: ScenarioInput): ScenarioRecord {
  const world = buildScenario(scenario);
  const extraction = world.steps.map((step) => ({ statementId: step.statementId, fields: ruleFields(step) }));
  const first = extraction[0]?.fields ?? {};
  const missing = (['floor', 'building'] as const).find((f) => first[f] === undefined);
  return {
    scenarioId: scenario.id,
    calls: extraction.map((e) => {
      const n = Object.keys(e.fields).length;
      return { op: 'extract' as const, statementId: e.statementId, state: 'ready' as const, source: 'rules' as const, latencyMs: 0, proposed: n, kept: n };
    }),
    extraction,
    deltas: world.steps.slice(1).flatMap((step) => ruleDelta(step) ?? []),
    conflicts: openConflicts(world),
    clarification: missing ? { field: missing, question: '' } : null,
  };
}
