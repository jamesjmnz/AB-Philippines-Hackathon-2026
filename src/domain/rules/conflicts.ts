import { CLAIM_FIELDS, isHumanRevision, type ClaimField, type ClaimRevision } from '../claims';
import { normalizeValue } from '../primitives';
import { leadingRevision } from '../reducer';
import type { IncidentState } from '../state';
import { extractFloorTransition } from './location';

/**
 * Explicit-field conflict detection. Deterministic and model-free: it compares the values
 * different humans stated for the same field, plus any statement that differs from a
 * reporter-confirmed value. It only proposes; a CONFLICT_FLAGGED event records the conflict and
 * only the reporter's CONFLICT_RESOLVED closes it. It never closes or withdraws a contradiction
 * that is already recorded.
 */

export interface ConflictProposal {
  conflictId: string;
  field: ClaimField;
  /** [the statement currently leading the field, the statement that disagrees with it] */
  revisionIds: [string, string];
}

/** Same pair of statements gives the same id on every device, so concurrent flags collapse into one. */
export function conflictIdFor(field: ClaimField, revisionIds: readonly string[]): string {
  return `conflict:${field}:${[...revisionIds].sort().join('|')}`.slice(0, 128);
}

/**
 * When `revision` is the destination of an explicit move ("I moved from the first floor to the
 * second floor"), the normalized floor the same text says the person came from; otherwise null.
 * Read from the stored text of the statement that produced the revision, so every device derives
 * the same answer. Only floors have a movement rule.
 */
export function movedFromValue(state: IncidentState, revision: ClaimRevision): string | null {
  if (revision.field !== 'floor' || revision.authority !== 'statement' || !isHumanRevision(revision)) return null;
  const report = state.reports.find((r) => r.eventId === revision.source.eventId);
  if (!report) return null;
  const transition = extractFloorTransition(report.text);
  if (!transition || normalizeValue(transition.to.value) !== normalizeValue(revision.value)) return null;
  return normalizeValue(transition.from.value);
}

/**
 * True when the difference between `latest` (an author's current statement) and `other` (somebody
 * else's plain statement) is explained by that author having moved.
 *
 * It is when the author of `latest` made an explicit move after `other` was said, no later than
 * `latest`, and `other` names a floor that author had stated before the move or the floor the
 * move says they left. `other` then described where the person was; the move, and any later move
 * or self-correction by the same author, explains the difference.
 *
 * Never explained: a confirmation, a statement made after the author's last move, and a floor
 * the author never stated or left. `sequence` is the field's human revisions in replay order.
 */
export function explainedByMove(
  state: IncidentState,
  sequence: readonly ClaimRevision[],
  latest: ClaimRevision,
  other: ClaimRevision,
): boolean {
  if (other.authority !== 'statement') return false;
  const author = latest.source.actor.deviceId;
  if (other.source.actor.deviceId === author) return false;
  const otherIndex = sequence.indexOf(other);
  const latestIndex = sequence.indexOf(latest);
  if (otherIndex < 0 || latestIndex < 0) return false;
  const otherKey = normalizeValue(other.value);
  const statedByAuthor = new Set<string>();
  for (let i = 0; i <= latestIndex; i += 1) {
    const r = sequence[i];
    if (!r || r.source.actor.deviceId !== author) continue;
    if (i > otherIndex) {
      const origin = movedFromValue(state, r);
      if (origin !== null && (origin === otherKey || statedByAuthor.has(otherKey))) return true;
    }
    statedByAuthor.add(normalizeValue(r.value));
  }
  return false;
}

/**
 * Every pair the rule holds to disagree on this field right now: the statement leading the field
 * against each other author's latest statement since the last confirmation, with a different
 * value that no move explains. This is before the bookkeeping that keeps one recorded
 * contradiction per disagreement.
 */
function disagreements(state: IncidentState, field: ClaimField): { reference: ClaimRevision; other: ClaimRevision }[] {
  const human = state.claims[field].revisions.filter(isHumanRevision);
  const leading = leadingRevision(human);
  if (!leading) return [];
  const reference = leading.revision;
  const referenceKey = normalizeValue(reference.value);

  // Statements made before the latest confirmation were settled by it.
  let baseline = -1;
  human.forEach((r, i) => {
    if (r.authority === 'confirmation') baseline = i;
  });

  // Only each author's latest statement since the baseline counts. An earlier one was superseded
  // by its own author: a different value from the same person is a correction, not a
  // contradiction. A confirmation is never superseded this way: it is the baseline, so a later
  // statement that differs from it, even by the reporter, is still compared and flagged.
  const latestByAuthor = new Map<string, string>();
  human.forEach((r, i) => {
    if (i > baseline) latestByAuthor.set(r.source.actor.deviceId, r.id);
  });

  const out: { reference: ClaimRevision; other: ClaimRevision }[] = [];
  human.forEach((r, i) => {
    if (i <= baseline || r.id === reference.id) return;
    if (latestByAuthor.get(r.source.actor.deviceId) !== r.id) return;
    if (normalizeValue(r.value) === referenceKey) return;
    // An explicit move does not conflict with somebody's earlier statement of where the person was.
    if (explainedByMove(state, human, reference, r) || explainedByMove(state, human, r, reference)) return;
    out.push({ reference, other: r });
  });
  return out;
}

/**
 * Revisions of `field` that are in dispute right now: members of an open contradiction, and both
 * sides of every disagreement the rule currently finds, whether or not a CONFLICT_FLAGGED event
 * already covers it.
 */
export function disputedRevisionIds(state: IncidentState, field: ClaimField): Set<string> {
  const ids = new Set<string>();
  for (const c of state.contradictions) {
    if (c.field === field && c.status === 'open') for (const id of c.revisionIds) ids.add(id);
  }
  for (const { reference, other } of disagreements(state, field)) {
    ids.add(reference.id);
    ids.add(other.id);
  }
  return ids;
}

function detectForField(state: IncidentState, field: ClaimField): ConflictProposal[] {
  const revisions = state.claims[field].revisions;
  const contradictions = state.contradictions.filter((c) => c.field === field);
  const byId = new Map<string, ClaimRevision>(revisions.map((r) => [r.id, r]));
  const covered = new Set(contradictions.flatMap((c) => c.revisionIds));
  const openValues = new Set<string>();
  for (const c of contradictions) {
    if (c.status !== 'open') continue;
    for (const id of c.revisionIds) {
      const r = byId.get(id);
      if (r) openValues.add(normalizeValue(r.value));
    }
  }

  // One recorded contradiction per disagreement: skip a statement or a value already in one.
  const proposals: ConflictProposal[] = [];
  const proposedValues = new Set<string>();
  for (const { reference, other } of disagreements(state, field)) {
    const key = normalizeValue(other.value);
    if (covered.has(other.id) || openValues.has(key) || proposedValues.has(key)) continue;
    proposedValues.add(key);
    const revisionIds: [string, string] = [reference.id, other.id];
    proposals.push({ conflictId: conflictIdFor(field, revisionIds), field, revisionIds });
  }
  return proposals;
}

/** Conflicts between human statements that no CONFLICT_FLAGGED event covers yet. */
export function detectFieldConflicts(state: IncidentState): ConflictProposal[] {
  return CLAIM_FIELDS.flatMap((field) => detectForField(state, field));
}
