/**
 * Typed domain errors. Messages never contain incident content (report text, claims, names);
 * only a stable code and, where useful, an event id.
 */
export const DOMAIN_ERROR_CODES = [
  'invalid_event',
  'invalid_input',
  'incident_not_found',
  'incident_already_created',
  'incident_closed',
  'not_reporter',
  'not_participant',
  'not_recipient',
  'not_assignee',
  'cannot_accept_for_another',
  'not_authorized_to_resolve',
  'unknown_task',
  'task_not_open',
  'invalid_task_transition',
  'unknown_revision',
  'unknown_question',
  'question_not_open',
  'unknown_conflict',
  'conflict_not_open',
  'invalid_conflict',
  'value_mismatch',
  'unknown_capsule',
  'unknown_recipient',
  'unknown_packet',
  'receipt_mismatch',
  'duplicate_entity',
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly eventId: string | null;

  constructor(code: DomainErrorCode, eventId: string | null = null) {
    super(`PULSE domain error: ${code}`);
    this.name = 'DomainError';
    this.code = code;
    this.eventId = eventId;
  }
}

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}

export type Decision = { readonly ok: true } | { readonly ok: false; readonly code: DomainErrorCode };

export const ALLOW: Decision = { ok: true };

export function deny(code: DomainErrorCode): Decision {
  return { ok: false, code };
}
