import { z } from 'zod';

import { ClaimFieldSchema } from './claims';
import { DisclosureLevelSchema, DisclosurePolicySchema } from './disclosure';
import { PacketReceiptSchema } from './outbox';
import {
  ActorSchema,
  EventClockSchema,
  EventSignatureSchema,
  IdSchema,
  NameSchema,
  TextSpanSchema,
} from './primitives';

/**
 * The CareChain event vocabulary: the 20 events of the master specification plus two additions
 * (`CLARIFICATION_SKIPPED`, `RESPONDER_DECLINED`) documented in docs/DOMAIN_MODEL.md.
 *
 * Every payload is a strict object: an unknown key (for example `severity`, `priority`,
 * `diagnosis`) fails validation.
 */

const ShortText = z.string().min(1).max(500);
const ReportText = z.string().min(1).max(4000);
const NoteText = z.string().min(1).max(500);

/** Non-medical coordination only. */
export const TASK_KINDS = ['communicate', 'go_to_requester', 'confirm_location', 'other'] as const;
export const TaskKindSchema = z.enum(TASK_KINDS);
export type TaskKind = z.infer<typeof TaskKindSchema>;

/** A value a human stated for a field, with where in their text it came from. */
export const ClaimInputSchema = z.strictObject({
  field: ClaimFieldSchema,
  value: ShortText,
  /** `explicit`: the person filled the field in. `rule`: deterministic extraction from their text. */
  extraction: z.enum(['explicit', 'rule']),
  evidence: TextSpanSchema.optional(),
});
export type ClaimInput = z.infer<typeof ClaimInputSchema>;

/** One proposed field value from the local model. It has no authority. */
export const AIFindingInputSchema = z.strictObject({
  findingId: IdSchema,
  field: ClaimFieldSchema,
  value: ShortText,
  evidence: TextSpanSchema.optional(),
});
export type AIFindingInput = z.infer<typeof AIFindingInputSchema>;

export const IncidentRecipientSchema = z.strictObject({
  deviceId: IdSchema,
  userName: NameSchema,
  level: DisclosureLevelSchema,
  /** The basic-alert packet queued for this recipient in the same transaction. */
  packetId: IdSchema,
});
export type IncidentRecipient = z.infer<typeof IncidentRecipientSchema>;

const payloads = {
  INCIDENT_CREATED: z.strictObject({
    source: z.enum(['manual_sos', 'guided_report']),
    incidentType: z.string().min(1).max(80),
    assistanceRequested: z.boolean(),
    recipients: z.array(IncidentRecipientSchema).max(32),
  }),
  REPORT_ADDED: z.strictObject({
    reportId: IdSchema,
    /** `report`: the reporter's own account. `observation`: a statement from another participant. */
    kind: z.enum(['report', 'observation']),
    text: ReportText,
    inputMode: z.enum(['typed', 'transcribed']),
    language: z.string().min(2).max(16).optional(),
    claims: z.array(ClaimInputSchema).max(12),
  }),
  AI_PROPOSAL_CREATED: z.strictObject({
    proposalId: IdSchema,
    reportId: IdSchema.optional(),
    provider: z.string().min(1).max(64),
    findings: z.array(AIFindingInputSchema).max(12),
  }),
  CLARIFICATION_REQUESTED: z.strictObject({
    questionId: IdSchema,
    field: ClaimFieldSchema,
    prompt: ShortText,
    origin: z.enum(['ai', 'rule', 'human']),
    conflictId: IdSchema.optional(),
  }),
  CLARIFICATION_SKIPPED: z.strictObject({
    questionId: IdSchema,
  }),
  CLAIM_CONFIRMED: z.strictObject({
    field: ClaimFieldSchema,
    value: ShortText,
    /** Set when the human is confirming an existing statement or AI proposal as-is. */
    confirmsRevisionId: IdSchema.optional(),
    /** Set when this answers a clarification question. */
    questionId: IdSchema.optional(),
  }),
  CONFLICT_FLAGGED: z.strictObject({
    conflictId: IdSchema,
    field: ClaimFieldSchema,
    revisionIds: z.array(IdSchema).min(2).max(8),
    detectedBy: z.enum(['rule', 'ai']),
  }),
  CONFLICT_RESOLVED: z.strictObject({
    conflictId: IdSchema,
    value: ShortText,
    chosenRevisionId: IdSchema.optional(),
  }),
  CAPSULE_PREPARED: z.strictObject({
    capsuleId: IdSchema,
    policy: DisclosurePolicySchema,
  }),
  CAPSULE_QUEUED: z.strictObject({
    capsuleId: IdSchema,
    packets: z
      .array(z.strictObject({ packetId: IdSchema, recipientDeviceId: IdSchema }))
      .min(1)
      .max(32),
  }),
  PACKET_SENT_ATTEMPT: z.strictObject({
    packetId: IdSchema,
    recipientDeviceId: IdSchema,
    attempt: z.number().int().min(1),
    /** Set when a relay device is forwarding the packet. */
    viaDeviceId: IdSchema.optional(),
  }),
  PACKET_RECEIVED_BY_PEER: z
    .strictObject({
      packetId: IdSchema,
      recipientDeviceId: IdSchema,
      receipt: PacketReceiptSchema,
      viaDeviceId: IdSchema.optional(),
    })
    .refine(
      (p) => p.receipt.packetId === p.packetId && p.receipt.recipientDeviceId === p.recipientDeviceId,
      { message: 'receipt does not match packet and recipient' },
    ),
  RESPONDER_ACKNOWLEDGED: z.strictObject({}),
  RESPONDER_DECLINED: z.strictObject({}),
  TASK_OFFERED: z.strictObject({
    taskId: IdSchema,
    kind: TaskKindSchema,
    title: z.string().min(1).max(120),
    /** Whether the task means going to the requester in person. */
    inPerson: z.boolean(),
    /** Absent = open to any recipient. */
    offeredToDeviceId: IdSchema.optional(),
    origin: z.enum(['human', 'ai_suggested', 'default']),
  }),
  TASK_ACCEPTED: z.strictObject({
    taskId: IdSchema,
    /** Must equal the event's actor: a task is only ever accepted by the person taking it. */
    assignee: ActorSchema,
  }),
  TASK_DECLINED: z.strictObject({
    taskId: IdSchema,
  }),
  TASK_PROGRESS_REPORTED: z.strictObject({
    taskId: IdSchema,
    note: NoteText.optional(),
  }),
  TASK_COMPLETION_REPORTED: z.strictObject({
    taskId: IdSchema,
    note: NoteText.optional(),
  }),
  TASK_COMPLETION_CONFIRMED: z.strictObject({
    taskId: IdSchema,
  }),
  INCIDENT_RESOLVED: z.strictObject({
    note: NoteText.optional(),
  }),
  INCIDENT_CANCELLED: z.strictObject({
    note: NoteText.optional(),
  }),
} as const;

export const EVENT_TYPES = [
  'INCIDENT_CREATED',
  'REPORT_ADDED',
  'AI_PROPOSAL_CREATED',
  'CLARIFICATION_REQUESTED',
  'CLAIM_CONFIRMED',
  'CONFLICT_FLAGGED',
  'CONFLICT_RESOLVED',
  'CAPSULE_PREPARED',
  'CAPSULE_QUEUED',
  'PACKET_SENT_ATTEMPT',
  'PACKET_RECEIVED_BY_PEER',
  'RESPONDER_ACKNOWLEDGED',
  'TASK_OFFERED',
  'TASK_ACCEPTED',
  'TASK_DECLINED',
  'TASK_PROGRESS_REPORTED',
  'TASK_COMPLETION_REPORTED',
  'TASK_COMPLETION_CONFIRMED',
  'INCIDENT_RESOLVED',
  'INCIDENT_CANCELLED',
  // Additions to the minimum vocabulary (see docs/DOMAIN_MODEL.md):
  'CLARIFICATION_SKIPPED',
  'RESPONDER_DECLINED',
] as const satisfies readonly (keyof typeof payloads)[];
export type EventType = (typeof EVENT_TYPES)[number];

/** The 20 names fixed by the master specification. */
export const CORE_EVENT_TYPES: readonly EventType[] = EVENT_TYPES.slice(0, 20);
export const ADDED_EVENT_TYPES: readonly EventType[] = EVENT_TYPES.slice(20);

const envelope = {
  id: IdSchema,
  incidentId: IdSchema,
  actor: ActorSchema,
  clock: EventClockSchema,
  /** Causal parents: the ledger heads the author had seen. Empty only for INCIDENT_CREATED. */
  parents: z.array(IdSchema).max(64),
  signature: EventSignatureSchema.optional(),
};

function eventSchema<T extends keyof typeof payloads>(type: T) {
  return z.strictObject({ ...envelope, type: z.literal(type), payload: payloads[type] });
}

export const DomainEventSchema = z.discriminatedUnion('type', [
  eventSchema('INCIDENT_CREATED'),
  eventSchema('REPORT_ADDED'),
  eventSchema('AI_PROPOSAL_CREATED'),
  eventSchema('CLARIFICATION_REQUESTED'),
  eventSchema('CLARIFICATION_SKIPPED'),
  eventSchema('CLAIM_CONFIRMED'),
  eventSchema('CONFLICT_FLAGGED'),
  eventSchema('CONFLICT_RESOLVED'),
  eventSchema('CAPSULE_PREPARED'),
  eventSchema('CAPSULE_QUEUED'),
  eventSchema('PACKET_SENT_ATTEMPT'),
  eventSchema('PACKET_RECEIVED_BY_PEER'),
  eventSchema('RESPONDER_ACKNOWLEDGED'),
  eventSchema('RESPONDER_DECLINED'),
  eventSchema('TASK_OFFERED'),
  eventSchema('TASK_ACCEPTED'),
  eventSchema('TASK_DECLINED'),
  eventSchema('TASK_PROGRESS_REPORTED'),
  eventSchema('TASK_COMPLETION_REPORTED'),
  eventSchema('TASK_COMPLETION_CONFIRMED'),
  eventSchema('INCIDENT_RESOLVED'),
  eventSchema('INCIDENT_CANCELLED'),
]);

export type DomainEvent = z.infer<typeof DomainEventSchema>;
export type EventOf<T extends EventType> = Extract<DomainEvent, { type: T }>;
export type PayloadOf<T extends EventType> = EventOf<T>['payload'];
export type EventOrigin = 'local' | 'remote';

/** A type together with its payload; what a command hands to the event builder. */
export type EventSpec = { [T in EventType]: { type: T; payload: PayloadOf<T> } }[EventType];

/** Events to sync for one incident. Each event is validated on its own so one bad event does not void the batch. */
export const EventBatchSchema = z.strictObject({
  version: z.literal(1),
  incidentId: IdSchema,
  fromDeviceId: IdSchema,
  events: z.array(z.unknown()).max(1000),
});
export type EventBatch = z.infer<typeof EventBatchSchema>;

/** Deterministic total order used for replay: (lamport, deviceId, id). Wall clock is not consulted. */
export function compareEvents(a: DomainEvent, b: DomainEvent): number {
  if (a.clock.lamport !== b.clock.lamport) return a.clock.lamport - b.clock.lamport;
  if (a.actor.deviceId !== b.actor.deviceId) return a.actor.deviceId < b.actor.deviceId ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/** Deduplicate by id (first occurrence wins) and sort into replay order. */
export function sortEvents(events: readonly DomainEvent[]): DomainEvent[] {
  const seen = new Set<string>();
  const unique: DomainEvent[] = [];
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    unique.push(event);
  }
  return unique.sort(compareEvents);
}
