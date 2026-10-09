import { RELATED_FIELDS, groundValue, locateEvidence, type AIMeta, type AIState, type LocalAIService, type ProposalField, type RelatedField, type StatementAssessmentProposal } from '@/ai';
import {
  CLAIM_FIELDS,
  classifyStatementDelta,
  isHumanRevision,
  leadingRevision,
  normalizeValue,
  type ClaimField,
  type ClaimRevision,
  type DeltaClass,
  type FieldDeltaClass,
  type IncidentState,
  type StatementDelta,
  type TextSpan,
} from '@/domain';

/**
 * Incident Delta pipeline for one statement. Pure apart from the model call it is handed:
 * it reads a replayed state and returns what to record, and never writes anything itself.
 *
 * Order of authority: the deterministic rules decide every field they can read (floor and building).
 * The model adds only what rules cannot see, and it reports relations ("same", "different"), never a
 * class. Classes are computed here from the relation and from who said what, so the model cannot turn a
 * self-correction into a contradiction or the reverse. Nothing here changes a human claim.
 */

export interface AssessedItem {
  field: ClaimField;
  class: FieldDeltaClass;
  /** The earlier human statement it was compared with, when there is one. */
  againstRevisionId: string | null;
  /** The report that earlier value came from, human or proposed. */
  againstReportId: string | null;
  evidence: TextSpan | null;
  source: 'rule' | 'model';
  /** A person has to look at this: two people disagree, or a confirmed detail is being contradicted. */
  needsVerification: boolean;
}

export interface StatementAnalysis {
  reportId: string;
  overall: DeltaClass | 'not_assessed';
  items: AssessedItem[];
  /**
   * Values the model read from this statement for fields the rules did not read. Only those marked
   * `record` may become an AI proposal: a first value for the field, or the same person revising their
   * own. A different person's differing value is never recorded as the field's proposal, because it
   * would then be displayed in place of what the first person said; it is raised as a question instead.
   */
  findings: { field: ClaimField; value: string; evidence: TextSpan; record: boolean }[];
  /** What the rules alone concluded, kept so a failed model call still leaves a deterministic answer. */
  rule: StatementDelta;
  /** How the model stage went. 'not_run' when no model was asked. */
  model: {
    /** State of the phrase-copying call; 'not_run' when no model was asked. */
    state: AIState | 'not_run';
    /** State of the comparison call, when one was made. */
    relation: AIState | 'skipped';
    meta: AIMeta | null;
    latenciesMs: number[];
    proposed: number;
    kept: number;
  };
  /** What each compared field looked like when the analysis started; see `basisStillHolds`. */
  basis: Partial<Record<ClaimField, string>>;
}

const PRIORITY: readonly FieldDeltaClass[] = ['possible_contradiction', 'correction', 'new_information', 'confirmation', 'no_meaningful_change'];
/** Fields where two people saying different things is a disagreement to settle. Others are just more observations. */
const LOCATION_FIELDS: readonly ClaimField[] = ['floor', 'building', 'locationText'];

interface Prior {
  value: string;
  revision: ClaimRevision;
  authorDeviceId: string;
  human: boolean;
  confirmed: boolean;
}

/** Who made the statement a revision came from. For a model finding that is the author of the text it read. */
function authorOf(state: IncidentState, revision: ClaimRevision): string {
  if (isHumanRevision(revision)) return revision.source.actor.deviceId;
  const report = state.reports.find((r) => r.id === revision.evidence?.reportId);
  return report?.author.deviceId ?? revision.source.actor.deviceId;
}

function reportOf(state: IncidentState, revision: ClaimRevision): string | null {
  return state.reports.find((r) => r.id === revision.evidence?.reportId || r.eventId === revision.source.eventId)?.id ?? null;
}

/**
 * What is on record for a field apart from this statement: the leading human value, else the latest
 * model proposal. Position in replay order is deliberately not used. A responder who has not received
 * the requester's events writes with a lower logical clock, so their statement can sort ahead of a
 * report made earlier; "what else is on record" is the comparison that holds on every device.
 */
function priorFor(state: IncidentState, field: ClaimField, report: { id: string; eventId: string }): Prior | null {
  const others = state.claims[field].revisions.filter((r) => {
    if (r.source.eventId === report.eventId || r.evidence?.reportId === report.id) return false;
    // Values set by the SOS itself ("Manual SOS", assistance requested) are defaults, not statements.
    return !r.id.endsWith('#incidentType') && !r.id.endsWith('#assistanceRequested');
  });
  const leading = leadingRevision(others);
  if (!leading) return null;
  const revision = leading.revision;
  return {
    value: revision.value,
    revision,
    authorDeviceId: authorOf(state, revision),
    human: isHumanRevision(revision),
    confirmed: revision.authority === 'confirmation',
  };
}

function classify(field: ClaimField, relation: 'same' | 'different' | 'adds_detail', prior: Prior, authorDeviceId: string): { class: FieldDeltaClass; needsVerification: boolean } {
  const sameAuthor = prior.authorDeviceId === authorDeviceId;
  if (relation === 'adds_detail') return { class: 'new_information', needsVerification: false };
  if (relation === 'same') return { class: sameAuthor ? 'no_meaningful_change' : 'confirmation', needsVerification: false };
  if (sameAuthor && !prior.confirmed) return { class: 'correction', needsVerification: false };
  // What happened and how someone feels are observations: a second person's different words add to the picture.
  if (!LOCATION_FIELDS.includes(field)) return { class: 'new_information', needsVerification: false };
  return { class: 'possible_contradiction', needsVerification: true };
}

function basisOf(state: IncidentState, field: ClaimField): string {
  const leading = leadingRevision(state.claims[field].revisions.filter(isHumanRevision));
  const open = state.contradictions.filter((c) => c.field === field && c.status === 'open').map((c) => c.id).sort();
  return `${leading?.revision.id ?? '-'}|${open.join(',')}`;
}

/** True while nothing a human said about these fields has changed since the analysis was made. */
export function basisStillHolds(state: IncidentState, analysis: StatementAnalysis, field: ClaimField): boolean {
  return analysis.basis[field] === basisOf(state, field);
}

function overallOf(items: readonly AssessedItem[]): FieldDeltaClass | null {
  return PRIORITY.find((c) => items.some((i) => i.class === c)) ?? null;
}

function ruleItems(state: IncidentState, rule: StatementDelta, reportText: string): AssessedItem[] {
  return rule.fields.map((f) => {
    const revision = state.claims[f.field].revisions.find((r) => r.id === f.revisionId);
    const span = revision?.evidence ? { start: revision.evidence.start, end: revision.evidence.end, text: revision.evidence.text } : locateEvidence(reportText, f.value);
    const against = state.claims[f.field].revisions.find((r) => r.id === f.againstRevisionId);
    return {
      field: f.field,
      class: f.class,
      againstRevisionId: against && isHumanRevision(against) ? against.id : null,
      againstReportId: against ? reportOf(state, against) : null,
      evidence: span,
      source: 'rule' as const,
      needsVerification: f.needsVerification,
    };
  });
}

/** The deterministic answer alone. This is what every device computes, with or without a model. */
export function analyzeWithRules(state: IncidentState, reportId: string): StatementAnalysis | null {
  const report = state.reports.find((r) => r.id === reportId);
  const rule = classifyStatementDelta(state, reportId);
  if (!report || !rule) return null;
  const items = ruleItems(state, rule, report.text);
  return {
    reportId,
    overall: rule.overall,
    items,
    findings: [],
    rule,
    model: { state: 'not_run', relation: 'skipped', meta: null, latenciesMs: [], proposed: 0, kept: 0 },
    basis: Object.fromEntries(CLAIM_FIELDS.map((f) => [f, basisOf(state, f)])),
  };
}

function modelItems(state: IncidentState, proposal: StatementAssessmentProposal, reportText: string, authorDeviceId: string, priors: Partial<Record<ClaimField, Prior>>, ruled: ReadonlySet<ClaimField>): { items: AssessedItem[]; findings: StatementAnalysis['findings'] } {
  const items: AssessedItem[] = [];
  const findings: StatementAnalysis['findings'] = [];
  for (const field of CLAIM_FIELDS) {
    const proposed = proposal.fields[field as ProposalField];
    if (!proposed || ruled.has(field)) continue;
    // Second line of defence, whatever service produced this: the phrase must be in the statement and
    // the value must follow from it, with no severity or diagnosis wording.
    const evidence = locateEvidence(reportText, proposed.evidence);
    const grounded = evidence ? groundValue(field as ProposalField, proposed.value, evidence.text) : null;
    if (!evidence || !grounded?.ok) continue;
    const value = grounded.value;

    const prior = priors[field];
    findings.push({ field, value, evidence, record: !prior || (prior.authorDeviceId === authorDeviceId && !prior.confirmed) });
    if (!prior) {
      items.push({ field, class: 'new_information', againstRevisionId: null, againstReportId: null, evidence, source: 'model', needsVerification: false });
      continue;
    }
    let relation: 'same' | 'different' | 'adds_detail' | undefined;
    if (field === 'floor' || field === 'building') relation = normalizeValue(prior.value) === normalizeValue(value) ? 'same' : 'different';
    else if ((RELATED_FIELDS as readonly string[]).includes(field)) relation = proposal.relations[field as RelatedField];
    // No comparison available (the comparison call failed, or the field is not one the model compares):
    // the value is still proposed, but nothing is claimed about how it relates.
    if (!relation) continue;
    const verdict = classify(field, relation, prior, authorDeviceId);
    items.push({ field, ...verdict, againstRevisionId: prior.human ? prior.revision.id : null, againstReportId: reportOf(state, prior.revision), evidence, source: 'model' });
  }
  return { items, findings };
}

/**
 * Rules first, then the model for what they cannot see. If the model is unavailable, times out or
 * returns nothing usable, the deterministic analysis is returned unchanged with the failure recorded.
 */
export async function analyzeStatement(ai: Pick<LocalAIService, 'assessStatement'>, state: IncidentState, reportId: string): Promise<StatementAnalysis | null> {
  const base = analyzeWithRules(state, reportId);
  const report = state.reports.find((r) => r.id === reportId);
  if (!base || !report || !ai.assessStatement) return base;

  const priors: Partial<Record<ClaimField, Prior>> = {};
  for (const field of CLAIM_FIELDS) {
    const prior = priorFor(state, field, report);
    if (prior) priors[field] = prior;
  }

  const result = await ai.assessStatement({
    statement: report.text,
    known: Object.fromEntries(Object.entries(priors).map(([field, prior]) => [field, prior.value])),
  });
  if (!result.ok) return { ...base, model: { state: result.state, relation: 'skipped', meta: result.meta, latenciesMs: [result.meta.latencyMs], proposed: 0, kept: 0 } };

  const proposal = result.value;
  const ruled = new Set(base.items.map((i) => i.field));
  const added = modelItems(state, proposal, report.text, report.author.deviceId, priors, ruled);
  const items = [...base.items, ...added.items];
  const strongest = overallOf(items);
  const overall: StatementAnalysis['overall'] =
    strongest ??
    // Nothing structured in it. The rules may still know it repeats an earlier message; otherwise the
    // model says whether it is about the request at all.
    (base.rule.overall !== 'not_assessed' ? base.rule.overall : proposal.topic === 'unrelated' ? 'unrelated' : 'no_meaningful_change');

  const kept = Object.keys(proposal.fields).length;
  return {
    ...base,
    overall,
    items,
    findings: added.findings,
    model: { state: 'ready', relation: proposal.relationCall, meta: result.meta, latenciesMs: proposal.latenciesMs, proposed: kept + proposal.dropped.length, kept },
  };
}
