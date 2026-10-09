import { CLAIM_FIELDS, isHumanRevision, type ClaimField, type ClaimRevision } from '../claims';
import { normalizeValue } from '../primitives';
import { leadingRevision } from '../reducer';
import type { IncidentState } from '../state';

/**
 * Explicit-field conflict detection. Deterministic and model-free: it compares the values humans
 * stated for the same field. It only proposes; a CONFLICT_FLAGGED event records the conflict and
 * only the reporter's CONFLICT_RESOLVED closes it.
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

  const proposals: ConflictProposal[] = [];
  const proposedValues = new Set<string>();
  human.forEach((r, i) => {
    if (i <= baseline || r.id === reference.id) return;
    const key = normalizeValue(r.value);
    if (key === referenceKey) return;
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
