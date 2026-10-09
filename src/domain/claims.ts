import { z } from 'zod';

import type { Actor, TextSpan } from './primitives';

/**
 * The only structured facts an incident carries. There is deliberately no severity, priority,
 * triage or diagnosis field, and `symptom` holds the person's own words.
 */
export const CLAIM_FIELDS = [
  'incidentType',
  'building',
  'floor',
  'locationText',
  'symptom',
  'assistanceRequested',
] as const;
export const ClaimFieldSchema = z.enum(CLAIM_FIELDS);
export type ClaimField = z.infer<typeof ClaimFieldSchema>;

export const CLAIM_SOURCE_KINDS = ['report', 'observation', 'answer', 'ai_proposal'] as const;
export type ClaimSourceKind = (typeof CLAIM_SOURCE_KINDS)[number];

/** How the value was obtained from the statement. */
export type ClaimExtraction = 'explicit' | 'rule' | 'ai';

export type ClaimRole = 'reporter' | 'responder' | 'device_ai';

/** Tag shown next to a field. Derived, never stored. */
export const PROVENANCE_TAGS = [
  'user_reported',
  'ai_proposed',
  'user_confirmed',
  'responder_reported',
  'unresolved',
  'unknown',
] as const;
export type ProvenanceTag = (typeof PROVENANCE_TAGS)[number];

export interface ClaimSource {
  readonly actor: Actor;
  readonly role: ClaimRole;
  readonly kind: ClaimSourceKind;
  readonly eventId: string;
}

export interface ClaimEvidence extends TextSpan {
  readonly reportId: string | null;
}

/** One statement about one field. Revisions are only ever appended. */
export interface ClaimRevision {
  readonly id: string;
  readonly field: ClaimField;
  readonly value: string;
  readonly source: ClaimSource;
  readonly extraction: ClaimExtraction;
  /** `confirmation` = an explicit CLAIM_CONFIRMED / CONFLICT_RESOLVED by the reporter. */
  readonly authority: 'statement' | 'confirmation';
  readonly evidence: ClaimEvidence | null;
  /** For a confirmation that promotes an earlier revision (for example an AI proposal). */
  readonly confirmsRevisionId: string | null;
  readonly wallClockMs: number;
}

export interface Claim {
  readonly field: ClaimField;
  /** Displayed value. `null` when unknown or unresolved. */
  readonly value: string | null;
  readonly tag: ProvenanceTag;
  readonly displayedRevisionId: string | null;
  /** The competing values while `tag` is `unresolved`; empty otherwise. */
  readonly candidates: readonly string[];
  /** Full history in replay order, including superseded, losing and AI-proposed statements. */
  readonly revisions: readonly ClaimRevision[];
}

export function isHumanRevision(revision: ClaimRevision): boolean {
  return revision.source.kind !== 'ai_proposal';
}
