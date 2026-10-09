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
 * True when the difference between `move` and `older` is explained by the move itself: `older` is
 * a plain statement by somebody else, made before the move, naming the floor the move started
 * from. It described the origin; it does not contradict the destination. A confirmation is never
 * explained away, and neither is a statement made after the move.
 */
export function explainedByMove(
  older: ClaimRevision,
  olderIsEarlier: boolean,
  move: ClaimRevision,
  moveOrigin: string | null,
): boolean {
  return (
    moveOrigin !== null &&
    olderIsEarlier &&
    older.authority === 'statement' &&
    older.source.actor.deviceId !== move.source.actor.deviceId &&
    normalizeValue(older.value) === moveOrigin
  );
}

function detectForField(state: IncidentState, field: ClaimField): ConflictProposal[] {
  const revisions = state.claims[field].revisions;
  const human = revisions.filter(isHumanRevision);
  const leading = leadingRevision(human);
  if (!leading) return [];
  const reference = leading.revision;
  const referenceKey = normalizeValue(reference.value);

  // Statements made before the latest confirmation were settled by it.
  let baseline = -1;
  human.forEach((r, i) => {
    if (r.authority === 'confirmation') baseline = i;
  });

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

  // Only each author's latest statement since the baseline counts. An earlier one was superseded
  // by its own author: a different value from the same person is a correction, not a
  // contradiction. A confirmation is never superseded this way: it is the baseline, so a later
  // statement that differs from it, even by the reporter, is still compared and flagged.
  const latestByAuthor = new Map<string, string>();
  human.forEach((r, i) => {
    if (i > baseline) latestByAuthor.set(r.source.actor.deviceId, r.id);
  });

  const referenceIndex = human.indexOf(reference);
  const referenceOrigin = movedFromValue(state, reference);

  const proposals: ConflictProposal[] = [];
  const proposedValues = new Set<string>();
  human.forEach((r, i) => {
    if (i <= baseline || r.id === reference.id) return;
    if (latestByAuthor.get(r.source.actor.deviceId) !== r.id) return;
    const key = normalizeValue(r.value);
    if (key === referenceKey) return;
    // An explicit move does not conflict with somebody's earlier statement of where it started.
    if (explainedByMove(r, i < referenceIndex, reference, referenceOrigin)) return;
    if (explainedByMove(reference, referenceIndex < i, r, movedFromValue(state, r))) return;
    if (covered.has(r.id) || openValues.has(key) || proposedValues.has(key)) return;
    proposedValues.add(key);
    const revisionIds: [string, string] = [reference.id, r.id];
    proposals.push({ conflictId: conflictIdFor(field, revisionIds), field, revisionIds });
  });
  return proposals;
}

/** Conflicts between human statements that no CONFLICT_FLAGGED event covers yet. */
export function detectFieldConflicts(state: IncidentState): ConflictProposal[] {
  return CLAIM_FIELDS.flatMap((field) => detectForField(state, field));
}
