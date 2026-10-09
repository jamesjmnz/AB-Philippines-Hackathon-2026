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

/** A scenario being replayed one statement at a time, so a model stage can run between statements. */
export interface ScenarioSession {
  state: IncidentState;
  steps: ScenarioStep[];
  statementOfEvent: Map<string, string>;
  as: ScenarioWorld['as'];
  /** Applies a command result that belongs to `statementId` (a recorded proposal, for example). */
  apply(statementId: string, result: { state: IncidentState; events: readonly { id: string }[] }): void;
  /** Adds the statement, its rule conflicts and any confirmation that follows it. */
  add(statement: ScenarioInput['statements'][number]): ScenarioStep;
}

export function startScenario(scenario: ScenarioInput): ScenarioSession {
  const clock = createFixedClock(1_760_000_000_000);
  const ids = createSequentialIds(`eval-${scenario.id}`);
  const actorOf = ({ deviceId, userName }: TrustedPeer): Actor => ({ deviceId, userName });
  const session: ScenarioSession = {
    state: createManualSOS({ actor: REPORTER, clock, ids }, { recipients: Object.values(RESPONDERS) }).state,
    steps: [],
    statementOfEvent: new Map(),
    as: (author) => ({ actor: author === 'reporter' ? REPORTER : actorOf(RESPONDERS[author]), clock, ids }),
    apply(statementId, result) {
      session.state = result.state;
      result.events.forEach((e) => session.statementOfEvent.set(e.id, statementId));
    },
    add(statement) {
      const add = statement.author === 'reporter' ? addReport : addObservation;
      session.apply(statement.id, add(session.state, session.as(statement.author), { text: statement.text }));
      const reportId = session.state.reports[session.state.reports.length - 1]?.id ?? '';
      for (const [field, value] of Object.entries(statement.confirms ?? {})) {
        session.apply(statement.id, confirmClaim(session.state, session.as('reporter'), { field: field as ClaimField, value }));
      }
      const step = { statementId: statement.id, reportId, state: session.state };
      session.steps.push(step);
      return step;
    },
  };
  return session;
}

export function buildScenario(scenario: ScenarioInput): ScenarioWorld {
  const session = startScenario(scenario);
  scenario.statements.forEach((statement) => session.add(statement));
  return { steps: session.steps, final: session.state, statementOfEvent: session.statementOfEvent, as: session.as };
}

/** Open contradictions as pairs of statement ids, the form the reference answers use. */
export function openConflicts(world: Pick<ScenarioWorld, 'final' | 'statementOfEvent'>): ScenarioRecord['conflicts'] {
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
    // No model is called, so there are no calls to report: completion and validation rates do not apply.
    calls: [],
    extraction,
    deltas: world.steps.slice(1).flatMap((step) => ruleDelta(step) ?? []),
    conflicts: openConflicts(world),
    clarification: missing ? { field: missing, question: '' } : null,
  };
}
