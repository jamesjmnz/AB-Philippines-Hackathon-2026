import type { AIFailureState, ProposalField, ProposedField } from './types';

/**
 * Model stage of Incident Delta Intelligence: what one new statement says, and how the details code
 * cannot compare by itself relate to what is already known. The model never names a delta class and
 * never sees who said what or the history; classes are computed in code from these relations.
 */

/** Details compared by the model. Floor and building are compared by the deterministic rules instead. */
export const RELATED_FIELDS = ['locationText', 'incidentType', 'symptom'] as const;
export type RelatedField = (typeof RELATED_FIELDS)[number];

export type FieldRelation = 'same' | 'different' | 'adds_detail';

export type StatementAssessmentInput = {
  /** The new statement, verbatim. */
  statement: string;
  /** What is currently known, in the words on record. Fields with no value are omitted. */
  known: Partial<Record<ProposalField, string>>;
};

export type StatementAssessmentProposal = {
  /** Phrases the new statement states, each with the exact words they were taken from. */
  fields: Partial<Record<ProposalField, ProposedField>>;
  dropped: ProposalField[];
  unknown: ProposalField[];
  /** Only for fields that are both stated by the new statement and already known. */
  relations: Partial<Record<RelatedField, FieldRelation>>;
  /** 'unrelated' is only ever reported when the statement states no field at all. */
  topic: 'about_request' | 'unrelated';
  /** 'skipped' when code needed no comparison from the model; a failure state when that call failed. */
  relationCall: 'ready' | 'skipped' | AIFailureState;
  /** Latency of each generation this assessment used, in order. */
  latenciesMs: number[];
};

/** staged: copy phrases, then (only if needed) one comparison call. single: one call doing both. */
export type AssessmentVariant = 'staged' | 'single';
