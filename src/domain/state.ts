import type { Claim, ClaimEvidence, ClaimField } from './claims';
import type { DisclosureLevel, DisclosurePolicy } from './disclosure';
import type { DomainErrorCode } from './errors';
import type { DomainEvent, EventType, TaskKind } from './events';
import type { Actor } from './primitives';

/**
 * Derived state of one incident. Nothing here is stored: it is recomputed by `replay` from the
 * ledger, so it cannot drift from the events.
 */

export interface Incident {
  id: string;
  reporter: Actor;
  source: 'manual_sos' | 'guided_report';
  createdAtMs: number;
  createdEventId: string;
}

/** The person's own words. Never edited. */
export interface OriginalReport {
  id: string;
  eventId: string;
  author: Actor;
  role: 'reporter' | 'responder';
  kind: 'report' | 'observation';
  text: string;
  inputMode: 'typed' | 'transcribed';
  language: string | null;
  wallClockMs: number;
}

/** A model proposal for one field. It is kept in the claim history but has no authority. */
export interface AIFinding {
  id: string;
  proposalId: string;
  revisionId: string;
  field: ClaimField;
  value: string;
  provider: string;
  evidence: ClaimEvidence | null;
  /** true/false when the evidence span could be checked against the stored report text; null when it could not. */
  evidenceVerified: boolean | null;
  eventId: string;
  /** The human CLAIM_CONFIRMED event that promoted this finding, if any. */
  confirmedByEventId: string | null;
}

/** One optional question put to the reporter. */
export interface ClarificationQuestion {
  id: string;
  field: ClaimField;
  prompt: string;
  origin: 'ai' | 'rule' | 'human';
  askedBy: Actor;
  conflictId: string | null;
  status: 'open' | 'answered' | 'skipped';
  eventId: string;
  closedByEventId: string | null;
}

export interface ContradictionResolution {
  value: string;
  chosenRevisionId: string | null;
  /** The confirmation revision the resolution added to the claim history. */
  revisionId: string;
  resolvedBy: Actor;
  eventId: string;
}

/** Human statements that disagree about one field. Every statement stays in the claim history. */
export interface Contradiction {
  id: string;
  field: ClaimField;
  revisionIds: string[];
  detectedBy: 'rule' | 'ai';
  flaggedBy: Actor;
  eventId: string;
  status: 'open' | 'resolved';
  resolution: ContradictionResolution | null;
}

export type TaskStatus =
  | 'unassigned'
  | 'offered'
  | 'accepted'
  | 'in_progress'
  | 'completion_reported'
  | 'completion_confirmed';

export const OPEN_TASK_STATUSES: readonly TaskStatus[] = ['unassigned', 'offered'];
export const HELD_TASK_STATUSES: readonly TaskStatus[] = [
  'accepted',
  'in_progress',
  'completion_reported',
  'completion_confirmed',
];

export interface TaskProgressNote {
  note: string | null;
  eventId: string;
  wallClockMs: number;
}

export interface AssistanceTask {
  id: string;
  kind: TaskKind;
  title: string;
  inPerson: boolean;
  origin: 'human' | 'ai_suggested' | 'default';
  status: TaskStatus;
  offeredBy: Actor;
  offeredToDeviceId: string | null;
  assignee: Actor | null;
  /** Devices that declined this task (or released it after accepting). */
  declinedByDeviceIds: string[];
  /** Human-reported progress. Arrival is never inferred. */
  progress: TaskProgressNote[];
  completionNote: string | null;
  lastEventId: string;
  updatedAtMs: number;
}

/** Transport-level delivery, per packet and per recipient. `delivered` needs a recipient receipt. */
export type DeliveryState = 'none' | 'queued' | 'send_attempted' | 'delivered';

export interface PacketState {
  packetId: string;
  recipientDeviceId: string;
  kind: 'basic_alert' | 'capsule';
  capsuleId: string | null;
  delivery: Exclude<DeliveryState, 'none'>;
  attempts: number;
  receiptId: string | null;
  viaDeviceId: string | null;
}

export interface RecipientState {
  deviceId: string;
  userName: string;
  level: DisclosureLevel;
  /** Best delivery state of any packet addressed to this recipient. */
  delivery: DeliveryState;
  /** Delivery state of the most recently prepared capsule for this recipient. */
  capsuleDelivery: DeliveryState;
  /** Human acknowledgment. Independent of delivery and of task acceptance. */
  acknowledged: boolean;
  acknowledgedEventId: string | null;
  /** The responder said they cannot help with this request. */
  declined: boolean;
}

export interface CapsuleRecord {
  id: string;
  eventId: string;
  policy: DisclosurePolicy;
  queued: boolean;
}

export interface Closure {
  kind: 'resolved' | 'cancelled';
  by: Actor;
  eventId: string;
  wallClockMs: number;
  note: string | null;
}

export type IncidentStatus =
  | 'cancelled'
  | 'resolved'
  | 'in_progress'
  | 'role_taken'
  | 'acknowledged'
  | 'delivered'
  | 'queued';

export type StatusReason =
  | 'not_created'
  | 'cancelled_by_reporter'
  | 'resolved_by_authorized_person'
  | 'in_person_task_in_progress'
  | 'task_accepted'
  | 'acknowledged_by_responder'
  | 'delivered_with_receipt'
  | 'no_trusted_peer'
  | 'awaiting_peer'
  | 'send_attempted_no_receipt';

export interface IncidentStatusInfo {
  status: IncidentStatus;
  reason: StatusReason;
}

export interface TimelineEntry {
  eventId: string;
  type: EventType;
  actor: Actor;
  /** Display only. */
  wallClockMs: number;
  lamport: number;
}

/** An event that is in the ledger but was not applied, and why. */
export interface NotAppliedEvent {
  eventId: string;
  type: EventType;
  actorDeviceId: string;
  code: DomainErrorCode;
}

export interface LedgerMeta {
  eventCount: number;
  maxLamport: number;
  seqByDevice: Record<string, number>;
  /** Events no other known event names as a parent. */
  heads: string[];
  /** Parent ids referenced by stored events that have not arrived yet. */
  missingParents: string[];
}

export interface IncidentState {
  incidentId: string;
  incident: Incident | null;
  status: IncidentStatusInfo;
  reports: OriginalReport[];
  claims: Record<ClaimField, Claim>;
  aiFindings: AIFinding[];
  questions: ClarificationQuestion[];
  contradictions: Contradiction[];
  tasks: AssistanceTask[];
  recipients: RecipientState[];
  packets: PacketState[];
  disclosure: DisclosurePolicy;
  capsules: CapsuleRecord[];
  closure: Closure | null;
  timeline: TimelineEntry[];
  notApplied: NotAppliedEvent[];
  ledger: LedgerMeta;
  /** The deduplicated ledger in replay order. */
  events: DomainEvent[];
}
