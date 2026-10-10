import { z } from 'zod';

import {
  PROVENANCE_TAGS,
  TASK_KINDS,
  canReadItem,
  projectForLevel,
  type AccessLevel,
  type ClaimField,
  type DisclosurePolicy,
  type DomainEvent,
  type IncidentProjection,
  type IncidentState,
} from '@/domain';

import type { CapsuleSectionName } from './types';

/**
 * What goes into each ciphertext of a capsule. Everything here is deterministic and model-free:
 * the same ledger and policy always produce the same split, and nothing an AI wrote decides who
 * can read what.
 *
 * - `summary` is readable by `trusted` and `authorized` recipients.
 * - `detail` is readable by `authorized` recipients only.
 * - `withheld` events are never sent to anyone but the reporter.
 */

export type EventTier = 'summary' | 'detail' | 'withheld';

type SharePolicy = Pick<DisclosurePolicy, 'shareDetailedLocation' | 'shareSymptoms'>;

function fieldTier(field: ClaimField, policy: SharePolicy): EventTier {
  if (canReadItem('trusted', field, policy)) return 'summary';
  if (canReadItem('authorized', field, policy)) return 'detail';
  return 'withheld';
}

function restrictedTier(policy: SharePolicy): EventTier {
  return canReadItem('authorized', 'originalReport', policy) ? 'detail' : 'withheld';
}

/**
 * The tier of one event under the incident's current disclosure policy.
 *
 * Detail tier: the requester's own words (reports, and observations they add themselves), AI
 * proposals (they quote the report), and any claim, clarification or conflict event about a field
 * the `trusted` level may not read. Everything else coordinates the response and is summary tier.
 */
export function eventTier(event: DomainEvent, state: IncidentState, policy: SharePolicy = state.disclosure): EventTier {
  const reporterId = state.incident?.reporter.deviceId ?? null;
  switch (event.type) {
    case 'REPORT_ADDED':
      return event.actor.deviceId === reporterId ? restrictedTier(policy) : 'summary';
    case 'AI_PROPOSAL_CREATED':
      return restrictedTier(policy);
    case 'STATEMENT_ASSESSED':
      // A model verdict about the requester's statement, with a span of it: restricted like a
      // proposal. The default branch would hand it to summary-level recipients.
      return restrictedTier(policy);
    case 'CLAIM_CONFIRMED':
    case 'CLARIFICATION_REQUESTED':
    case 'CONFLICT_FLAGGED':
      return fieldTier(event.payload.field, policy);
    case 'CONFLICT_RESOLVED': {
      const conflict = state.contradictions.find((c) => c.id === event.payload.conflictId);
      // A resolution names a value. Without the conflict we cannot tell which field, so it is restricted.
      return conflict ? fieldTier(conflict.field, policy) : restrictedTier(policy);
    }
    default:
      return 'summary';
  }
}

/** Sections a recipient of this level gets a wrapped key for. Relay-only recipients get none. */
export function sectionsForLevel(level: AccessLevel): CapsuleSectionName[] {
  if (level === 'relay') return [];
  if (level === 'trusted') return ['summary'];
  return ['summary', 'detail'];
}

const ProjectedFieldSchema = z.strictObject({
  value: z.string().max(500).nullable(),
  tag: z.enum(PROVENANCE_TAGS),
  candidates: z.array(z.string().max(500)).max(16),
});

const SummaryFieldName = z.enum(['incidentType', 'building', 'assistanceRequested', 'floor', 'locationText']);

const RoutingSchema = z.strictObject({
  incidentId: z.string().min(1).max(128),
  reporterDeviceId: z.string().max(128).nullable(),
  recipientDeviceIds: z.array(z.string().max(128)).max(64),
});

const SummarySchema = z.strictObject({
  reporterName: z.string().max(80).nullable(),
  status: z.strictObject({ status: z.string().max(32), reason: z.string().max(48) }),
  fields: z.partialRecord(SummaryFieldName, ProjectedFieldSchema),
  unresolvedFields: z.array(SummaryFieldName).max(8),
  tasks: z
    .array(
      z.strictObject({
        id: z.string().max(128),
        kind: z.enum(TASK_KINDS),
        title: z.string().max(120),
        inPerson: z.boolean(),
        status: z.string().max(32),
        offeredToDeviceId: z.string().max(128).nullable(),
        assigneeDeviceId: z.string().max(128).nullable(),
        assigneeName: z.string().max(80).nullable(),
      }),
    )
    .max(64),
});

const DetailSchema = z.strictObject({
  symptom: ProjectedFieldSchema,
  reports: z
    .array(
      z.strictObject({
        id: z.string().max(128),
        kind: z.enum(['report', 'observation']),
        authorName: z.string().max(80),
        text: z.string().max(4000),
      }),
    )
    .max(64),
});

/** A projection as it travels in a capsule: only the two readable levels are ever sent. */
export const SentProjectionSchema = z.discriminatedUnion('level', [
  z.strictObject({ level: z.literal('trusted'), routing: RoutingSchema, summary: SummarySchema }),
  z.strictObject({
    level: z.literal('authorized'),
    routing: RoutingSchema,
    summary: SummarySchema,
    detail: DetailSchema.optional(),
  }),
]);
export type SentProjection = z.infer<typeof SentProjectionSchema>;

const SectionPayloadSchema = z.strictObject({
  incidentId: z.string().min(1).max(128),
  projection: SentProjectionSchema.nullable(),
  events: z.array(z.unknown()).max(1000),
});

export interface CapsuleContent {
  incidentId: string;
  /** Events from every section this device could open, summary first. Not yet validated as domain events. */
  events: unknown[];
  /** The most detailed projection this device could open, or null when the sender is not the reporter. */
  projection: SentProjection | null;
}

function toSent(projection: IncidentProjection): SentProjection | null {
  const parsed = SentProjectionSchema.safeParse(JSON.parse(JSON.stringify(projection)));
  return parsed.success ? parsed.data : null;
}

export interface BuildSectionsInput {
  state: IncidentState;
  /** The device sealing the capsule. */
  senderDeviceId: string;
  /** What the recipient may read. `owner` means the recipient is the reporter. */
  recipientLevel: AccessLevel;
}

/**
 * Builds the plaintext of each section for one recipient.
 *
 * The reporter sends the whole eligible ledger plus the domain projection for each level. Any other
 * participant sends only the events it authored, and no projection: the reporter's device is the
 * single source of what each level reads.
 */
export function buildCapsuleSections(input: BuildSectionsInput): Partial<Record<CapsuleSectionName, string>> {
  const { state, senderDeviceId, recipientLevel } = input;
  const incidentId = state.incidentId;
  const senderIsReporter = state.incident?.reporter.deviceId === senderDeviceId;
  const toOwner = recipientLevel === 'owner';
  const readable = sectionsForLevel(recipientLevel);

  const summaryEvents: DomainEvent[] = [];
  const detailEvents: DomainEvent[] = [];
  if (readable.length > 0) {
    for (const event of state.events) {
      if (!senderIsReporter && event.actor.deviceId !== senderDeviceId) continue;
      const tier = eventTier(event, state);
      if (tier === 'summary') summaryEvents.push(event);
      else if (toOwner || tier === 'detail') detailEvents.push(event);
    }
  }

  const summaryProjection = senderIsReporter && readable.includes('summary') ? toSent(projectForLevel(state, 'trusted')) : null;
  const sections: Partial<Record<CapsuleSectionName, string>> = {
    summary: JSON.stringify({ incidentId, projection: summaryProjection, events: summaryEvents }),
  };
  if (readable.includes('detail')) {
    const detailProjection = senderIsReporter && !toOwner ? toSent(projectForLevel(state, 'authorized')) : null;
    if (detailEvents.length > 0 || detailProjection !== null) {
      sections.detail = JSON.stringify({ incidentId, projection: detailProjection, events: detailEvents });
    }
  }
  return sections;
}

/** Parses the sections a device managed to open. Returns null if any opened section is malformed. */
export function parseCapsuleSections(opened: Partial<Record<CapsuleSectionName, string>>): CapsuleContent | null {
  let incidentId: string | null = null;
  let projection: SentProjection | null = null;
  const events: unknown[] = [];
  for (const name of ['summary', 'detail'] as const) {
    const text = opened[name];
    if (text === undefined) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return null;
    }
    const parsed = SectionPayloadSchema.safeParse(raw);
    if (!parsed.success) return null;
    if (incidentId !== null && incidentId !== parsed.data.incidentId) return null;
    incidentId = parsed.data.incidentId;
    events.push(...parsed.data.events);
    // `detail` is read after `summary`, so the more detailed projection wins when both are present.
    if (parsed.data.projection !== null) projection = parsed.data.projection;
  }
  if (incidentId === null) return null;
  if (projection !== null && projection.routing.incidentId !== incidentId) return null;
  return { incidentId, events, projection };
}

/** Fields of a projection, in display order; a missing entry means this level may not read the field. */
export function projectionField(
  projection: SentProjection | IncidentProjection,
  field: ClaimField,
): { value: string | null; tag: (typeof PROVENANCE_TAGS)[number]; candidates: string[] } | null {
  if (projection.level === 'relay' || projection.level === 'owner') return null;
  if (field === 'symptom') {
    if (projection.level !== 'authorized' || !projection.detail) return null;
    const s = projection.detail.symptom;
    return { value: s.value, tag: s.tag, candidates: [...s.candidates] };
  }
  const f = projection.summary.fields[field];
  return f ? { value: f.value, tag: f.tag, candidates: [...f.candidates] } : null;
}

/** The requester's own words in a projection, or null when this level may not read them. */
export function projectionReportText(projection: SentProjection | IncidentProjection): string | null {
  if (projection.level !== 'authorized' || !projection.detail) return null;
  const texts = projection.detail.reports.filter((r) => r.kind === 'report').map((r) => r.text);
  return texts.length > 0 ? texts.join('\n') : null;
}
