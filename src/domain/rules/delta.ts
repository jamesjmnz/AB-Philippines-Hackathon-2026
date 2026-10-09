import { CLAIM_FIELDS, isHumanRevision, type ClaimField, type ClaimRevision } from '../claims';
import { normalizeValue } from '../primitives';
import type { IncidentState, OriginalReport } from '../state';
import { disputedRevisionIds, explainedByMove, movedFromValue } from './conflicts';

/**
 * Deterministic statement delta: how one stored statement relates to what was already known when
 * it was made. Model-free and read-only. It writes no event, changes no claim and never resolves,
 * closes or opens a contradiction; `detectFieldConflicts` and the human events stay the authority
 * for that.
 *
 * It is incremental: it looks only at the claim revisions the statement's own event created and
 * compares them with earlier human revisions of the same field in replay order. No other report's
 * text is read, except by the duplicate check for a statement that produced no revision at all.
 */

export const DELTA_CLASSES = [
  'new_information',
  'confirmation',
  'correction',
  'possible_contradiction',
  'unrelated',
  'no_meaningful_change',
] as const;
export type DeltaClass = (typeof DELTA_CLASSES)[number];

/** `unrelated` is a judgement about a whole statement and only a later model stage may make it. */
export type FieldDeltaClass = Exclude<DeltaClass, 'unrelated'>;

export type FieldDeltaReason =
  | 'first_value'
  | 'second_source'
  | 'restated'
  | 'moved'
  | 'self_correction'
  | 'differs_from_other'
  | 'differs_from_confirmed';

export interface FieldDelta {
  field: ClaimField;
  class: FieldDeltaClass;
  /** The new statement's revision. */
  revisionId: string;
  /** The earlier revision it was compared with; null when there was none. */
  againstRevisionId: string | null;
  value: string;
  previousValue: string | null;
  reason: FieldDeltaReason;
  needsVerification: boolean;
}

export interface StatementDelta {
  reportId: string;
  /** `not_assessed`: the rules found nothing to compare. Never `unrelated` from this layer. */
  overall: DeltaClass | 'not_assessed';
  fields: FieldDelta[];
  needsVerification: boolean;
  /** Set only when the statement produced no revision and repeats an earlier one by its author. */
  duplicateOfReportId: string | null;
}

/** Highest first. */
const CLASS_PRIORITY: readonly FieldDeltaClass[] = [
  'possible_contradiction',
  'correction',
  'new_information',
  'confirmation',
  'no_meaningful_change',
];

/** Lower-cased runs of letters and digits in any script. */
function tokens(text: string): string {
  return (text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(' ');
}

/**
 * The nearest earlier statement by the same author with exactly the same words in the same order,
 * ignoring case, spacing and punctuation. Nothing looser: dropping "not", changing a number or
 * swapping two names changes the meaning, and a word-overlap measure cannot see that.
 */
function findDuplicate(state: IncidentState, report: OriginalReport): string | null {
  const index = state.reports.indexOf(report);
  const own = tokens(report.text);
  if (own === '') return null;
  for (let i = index - 1; i >= 0; i -= 1) {
    const earlier = state.reports[i];
    if (!earlier || earlier.author.deviceId !== report.author.deviceId) continue;
    if (tokens(earlier.text) === own) return earlier.id;
  }
  return null;
}

function last<T>(items: readonly T[]): T | undefined {
  return items[items.length - 1];
}

function sameValue(a: ClaimRevision, b: ClaimRevision): boolean {
  return normalizeValue(a.value) === normalizeValue(b.value);
}

function fieldDelta(
  revision: ClaimRevision,
  against: ClaimRevision | null,
  cls: FieldDeltaClass,
  reason: FieldDeltaReason,
): FieldDelta {
  return {
    field: revision.field,
    class: cls,
    revisionId: revision.id,
    againstRevisionId: against?.id ?? null,
    value: revision.value,
    previousValue: against?.value ?? null,
    reason,
    // Filled in by classifyStatementDelta from the incident's contradictions.
    needsVerification: false,
  };
}

/**
 * Classifies one new revision against the earlier human revisions of its field.
 *
 * Which earlier revision it is compared with, first match wins:
 *
 * 1. The latest reporter confirmation (`CLAIM_CONFIRMED` / `CONFLICT_RESOLVED`). A confirmed value
 *    never changes silently, so a different value is `differs_from_confirmed` whoever says it,
 *    including the reporter.
 * 2. The same author's latest earlier statement when it has the same value: `restated`.
 * 3. For anyone but the reporter whose value differs from their own earlier statement: the
 *    leading statement by somebody else (the reporter's latest, otherwise the latest) when that
 *    also differs. A responder who changes their mind to something the reporter did not say is
 *    still disagreeing with the reporter, so it is `differs_from_other`, not a quiet correction.
 * 4. The same author's latest earlier statement: a correction. The reason is `moved` when the
 *    statement is an explicit move whose stated origin is that earlier value, otherwise
 *    `self_correction` (including a move whose origin is not what the author had said).
 * 5. With no earlier statement by this author, the leading statement by somebody else:
 *    `second_source` or `differs_from_other`.
 * 6. Nothing earlier: `first_value`.
 *
 * Rules 3 and 5 use the conflict rule's own test (`explainedByMove`): somebody else's earlier
 * statement of where the author was before an explicit move is not a disagreement. In rule 5 such
 * a statement gives `new_information` / `moved`.
 */
function classifyRevision(state: IncidentState, revision: ClaimRevision, earlier: readonly ClaimRevision[]): FieldDelta {
  const author = revision.source.actor.deviceId;

  const confirmed = last(earlier.filter((r) => r.authority === 'confirmation'));
  if (confirmed) {
    if (!sameValue(revision, confirmed)) {
      return fieldDelta(revision, confirmed, 'possible_contradiction', 'differs_from_confirmed');
    }
    return confirmed.source.actor.deviceId === author
      ? fieldDelta(revision, confirmed, 'no_meaningful_change', 'restated')
      : fieldDelta(revision, confirmed, 'confirmation', 'second_source');
  }

  const own = last(earlier.filter((r) => r.source.actor.deviceId === author));
  const others = earlier.filter((r) => r.source.actor.deviceId !== author);
  const other = last(others.filter((r) => r.source.role === 'reporter')) ?? last(others);
  const sequence = [...earlier, revision];
  const disagrees = (r: ClaimRevision): boolean =>
    !sameValue(revision, r) && !explainedByMove(state, sequence, revision, r);

  if (own) {
    if (sameValue(revision, own)) return fieldDelta(revision, own, 'no_meaningful_change', 'restated');
    if (revision.source.role !== 'reporter' && other && disagrees(other)) {
      return fieldDelta(revision, other, 'possible_contradiction', 'differs_from_other');
    }
    const movedFromOwn = movedFromValue(state, revision) === normalizeValue(own.value);
    return fieldDelta(revision, own, 'correction', movedFromOwn ? 'moved' : 'self_correction');
  }
  if (other) {
    if (sameValue(revision, other)) return fieldDelta(revision, other, 'confirmation', 'second_source');
    return disagrees(other)
      ? fieldDelta(revision, other, 'possible_contradiction', 'differs_from_other')
      : fieldDelta(revision, other, 'new_information', 'moved');
  }
  return fieldDelta(revision, null, 'new_information', 'first_value');
}

/**
 * How the statement `reportId` relates to what was known before it. Null when the incident has no
 * such report.
 *
 * - Only revisions created by the statement's own REPORT_ADDED event are classified. The
 *   incident-creation revisions and AI proposals are neither classified nor compared against.
 * - `overall` is the highest-priority field class: possible_contradiction > correction >
 *   new_information > confirmation > no_meaningful_change.
 * - `needsVerification` on a field is read from the incident as it stands, not predicted: it is
 *   true while that revision is in dispute (`disputedRevisionIds`), which means it is in an open
 *   contradiction or the conflict rule currently finds it disagreeing with another statement. It
 *   therefore agrees with what CONFLICT_FLAGGED records, and it clears when the reporter resolves.
 * - A statement that produced no revision is `no_meaningful_change` when its words are exactly
 *   those of an earlier statement by the same author (same token sequence), otherwise `not_assessed`.
 * - The result is a pure function of the replayed state, so every device that holds the same
 *   events computes the same delta.
 */
export function classifyStatementDelta(state: IncidentState, reportId: string): StatementDelta | null {
  const report = state.reports.find((r) => r.id === reportId);
  if (!report) return null;
  const createdEventId = state.incident?.createdEventId ?? null;

  const fields: FieldDelta[] = [];
  for (const field of CLAIM_FIELDS) {
    const revisions = state.claims[field].revisions;
    let disputed: Set<string> | undefined;
    revisions.forEach((revision, index) => {
      if (revision.source.eventId !== report.eventId || !isHumanRevision(revision)) return;
      const earlier = revisions
        .slice(0, index)
        .filter(
          (r) => isHumanRevision(r) && r.source.eventId !== report.eventId && r.source.eventId !== createdEventId,
        );
      const delta = classifyRevision(state, revision, earlier);
      disputed ??= disputedRevisionIds(state, field);
      fields.push({ ...delta, needsVerification: disputed.has(revision.id) });
    });
  }

  if (fields.length === 0) {
    const duplicateOfReportId = findDuplicate(state, report);
    return {
      reportId,
      overall: duplicateOfReportId === null ? 'not_assessed' : 'no_meaningful_change',
      fields,
      needsVerification: false,
      duplicateOfReportId,
    };
  }

  const overall = CLASS_PRIORITY.find((cls) => fields.some((f) => f.class === cls)) ?? 'no_meaningful_change';
  return {
    reportId,
    overall,
    fields,
    needsVerification: fields.some((f) => f.needsVerification),
    duplicateOfReportId: null,
  };
}
