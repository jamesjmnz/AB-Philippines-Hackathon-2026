import {
  CLAIM_FIELDS,
  isHumanRevision,
  type Claim,
  type ClaimEvidence,
  type ClaimExtraction,
  type ClaimField,
  type ClaimRevision,
  type ClaimSourceKind,
} from './claims';
import type { DisclosurePolicy } from './disclosure';
import type { DomainErrorCode } from './errors';
import { sortEvents, type DomainEvent } from './events';
import {
  canAcceptTask,
  canAcknowledge,
  canAddReport,
  canCancelIncident,
  canConfirmClaim,
  canConfirmCompletion,
  canDeclineRequest,
  canDeclineTask,
  canFlagConflict,
  canOfferTask,
  canPrepareCapsule,
  canQueueCapsule,
  canRecordAIProposal,
  canRecordTransport,
  canReportCompletion,
  canReportProgress,
  canRequestClarification,
  canResolveConflict,
  canResolveIncident,
  canSkipClarification,
  isReporter,
} from './policy';
import { normalizeValue, type TextSpan } from './primitives';
import type {
  AIFinding,
  AssistanceTask,
  CapsuleRecord,
  ClarificationQuestion,
  Closure,
  Contradiction,
  DeliveryState,
  Incident,
  IncidentState,
  LedgerMeta,
  NotAppliedEvent,
  OriginalReport,
  PacketState,
  RecipientState,
  TimelineEntry,
} from './state';
import { deriveStatus } from './status';

/**
 * The reducer. State is always derived by replaying the whole deduplicated ledger in the
 * deterministic order (lamport, deviceId, id). There is no incremental mutation path, so two
 * devices holding the same set of events derive the same state whatever order they arrived in.
 *
 * An event that cannot be applied (unauthorized actor, invalid transition, or a reference to
 * something that has not arrived yet) is skipped and listed in `notApplied`. It stays in the
 * ledger, so if the missing context arrives later the next replay applies it.
 */

interface Draft {
  incidentId: string;
  incident: Incident | null;
  reports: OriginalReport[];
  revisions: ClaimRevision[];
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
}

const DELIVERY_RANK: Record<DeliveryState, number> = {
  none: 0,
  queued: 1,
  send_attempted: 2,
  delivered: 3,
};

function emptyDraft(incidentId: string): Draft {
  return {
    incidentId,
    incident: null,
    reports: [],
    revisions: [],
    aiFindings: [],
    questions: [],
    contradictions: [],
    tasks: [],
    recipients: [],
    packets: [],
    disclosure: { shareDetailedLocation: false, shareSymptoms: false, recipients: [] },
    capsules: [],
    closure: null,
    timeline: [],
    notApplied: [],
  };
}

function toEvidence(span: TextSpan | undefined, reportId: string | null): ClaimEvidence | null {
  return span ? { start: span.start, end: span.end, text: span.text, reportId } : null;
}

function addRevision(
  d: Draft,
  e: DomainEvent,
  input: {
    id: string;
    field: ClaimField;
    value: string;
    kind: ClaimSourceKind;
    extraction: ClaimExtraction;
    authority: ClaimRevision['authority'];
    evidence: ClaimEvidence | null;
    confirmsRevisionId: string | null;
  },
): void {
  d.revisions.push({
    id: input.id,
    field: input.field,
    value: input.value,
    source: {
      actor: e.actor,
      role: input.kind === 'ai_proposal' ? 'device_ai' : isReporter(d, e.actor) ? 'reporter' : 'responder',
      kind: input.kind,
      eventId: e.id,
    },
    extraction: input.extraction,
    authority: input.authority,
    evidence: input.evidence,
    confirmsRevisionId: input.confirmsRevisionId,
    wallClockMs: e.clock.wallClockMs,
  });
}

function touchTask(task: AssistanceTask, e: DomainEvent): void {
  task.lastEventId = e.id;
  task.updatedAtMs = e.clock.wallClockMs;
}

function addDeclined(task: AssistanceTask, deviceId: string): void {
  if (!task.declinedByDeviceIds.includes(deviceId)) task.declinedByDeviceIds.push(deviceId);
}

/** Applies one event to the draft. Returns a code and leaves the draft untouched if it does not apply. */
function applyEvent(d: Draft, e: DomainEvent): DomainErrorCode | null {
  switch (e.type) {
    case 'INCIDENT_CREATED': {
      if (d.incident) return 'incident_already_created';
      d.incident = {
        id: e.incidentId,
        reporter: e.actor,
        source: e.payload.source,
        createdAtMs: e.clock.wallClockMs,
        createdEventId: e.id,
      };
      for (const r of e.payload.recipients) {
        if (r.deviceId === e.actor.deviceId) continue;
        if (d.recipients.some((x) => x.deviceId === r.deviceId)) continue;
        d.recipients.push({
          deviceId: r.deviceId,
          userName: r.userName,
          level: r.level,
          delivery: 'none',
          capsuleDelivery: 'none',
          acknowledged: false,
          acknowledgedEventId: null,
          declined: false,
        });
        d.disclosure.recipients.push({ deviceId: r.deviceId, level: r.level, userName: r.userName });
        if (!d.packets.some((p) => p.packetId === r.packetId)) {
          d.packets.push({
            packetId: r.packetId,
            recipientDeviceId: r.deviceId,
            kind: 'basic_alert',
            capsuleId: null,
            delivery: 'queued',
            attempts: 0,
            receiptId: null,
            viaDeviceId: null,
          });
        }
      }
      addRevision(d, e, {
        id: `${e.id}#incidentType`,
        field: 'incidentType',
        value: e.payload.incidentType,
        kind: 'report',
        extraction: 'explicit',
        authority: 'statement',
        evidence: null,
        confirmsRevisionId: null,
      });
      if (e.payload.assistanceRequested) {
        addRevision(d, e, {
          id: `${e.id}#assistanceRequested`,
          field: 'assistanceRequested',
          value: 'yes',
          kind: 'report',
          extraction: 'explicit',
          authority: 'statement',
          evidence: null,
          confirmsRevisionId: null,
        });
      }
      return null;
    }

    case 'REPORT_ADDED': {
      const auth = canAddReport(d, e.actor, e.payload.kind);
      if (!auth.ok) return auth.code;
      if (d.reports.some((r) => r.id === e.payload.reportId)) return 'duplicate_entity';
      d.reports.push({
        id: e.payload.reportId,
        eventId: e.id,
        author: e.actor,
        role: isReporter(d, e.actor) ? 'reporter' : 'responder',
        kind: e.payload.kind,
        text: e.payload.text,
        inputMode: e.payload.inputMode,
        language: e.payload.language ?? null,
        wallClockMs: e.clock.wallClockMs,
      });
      e.payload.claims.forEach((claim, index) => {
        addRevision(d, e, {
          id: `${e.id}#${index}`,
          field: claim.field,
          value: claim.value,
          kind: e.payload.kind,
          extraction: claim.extraction,
          authority: 'statement',
          evidence: toEvidence(claim.evidence, e.payload.reportId),
          confirmsRevisionId: null,
        });
      });
      return null;
    }

    case 'AI_PROPOSAL_CREATED': {
      const auth = canRecordAIProposal(d, e.actor);
      if (!auth.ok) return auth.code;
      if (d.aiFindings.some((f) => f.proposalId === e.payload.proposalId)) return 'duplicate_entity';
      const reportId = e.payload.reportId ?? null;
      const report = reportId === null ? undefined : d.reports.find((r) => r.id === reportId);
      e.payload.findings.forEach((finding, index) => {
        const revisionId = `${e.id}#${index}`;
        const evidence = toEvidence(finding.evidence, reportId);
        let evidenceVerified: boolean | null = null;
        if (evidence && report) {
          evidenceVerified = report.text.slice(evidence.start, evidence.end) === evidence.text;
        }
        d.aiFindings.push({
          id: finding.findingId,
          proposalId: e.payload.proposalId,
          revisionId,
          field: finding.field,
          value: finding.value,
          provider: e.payload.provider,
          evidence,
          evidenceVerified,
          eventId: e.id,
          confirmedByEventId: null,
        });
        addRevision(d, e, {
          id: revisionId,
          field: finding.field,
          value: finding.value,
          kind: 'ai_proposal',
          extraction: 'ai',
          authority: 'statement',
          evidence,
          confirmsRevisionId: null,
        });
      });
      return null;
    }

    case 'CLARIFICATION_REQUESTED': {
      const auth = canRequestClarification(d, e.actor);
      if (!auth.ok) return auth.code;
      if (d.questions.some((q) => q.id === e.payload.questionId)) return 'duplicate_entity';
      const conflictId = e.payload.conflictId ?? null;
      if (conflictId !== null && !d.contradictions.some((c) => c.id === conflictId)) return 'unknown_conflict';
      d.questions.push({
        id: e.payload.questionId,
        field: e.payload.field,
        prompt: e.payload.prompt,
        origin: e.payload.origin,
        askedBy: e.actor,
        conflictId,
        status: 'open',
        eventId: e.id,
        closedByEventId: null,
      });
      return null;
    }

    case 'CLARIFICATION_SKIPPED': {
      const auth = canSkipClarification(d, e.actor, e.payload.questionId);
      if (!auth.ok) return auth.code;
      const question = d.questions.find((q) => q.id === e.payload.questionId);
      if (!question) return 'unknown_question';
      question.status = 'skipped';
      question.closedByEventId = e.id;
      return null;
    }

    case 'CLAIM_CONFIRMED': {
      const auth = canConfirmClaim(d, e.actor);
      if (!auth.ok) return auth.code;
      const confirmsRevisionId = e.payload.confirmsRevisionId ?? null;
      if (confirmsRevisionId !== null) {
        const target = d.revisions.find((r) => r.id === confirmsRevisionId);
        if (!target || target.field !== e.payload.field) return 'unknown_revision';
        if (normalizeValue(target.value) !== normalizeValue(e.payload.value)) return 'value_mismatch';
      }
      const question =
        e.payload.questionId === undefined
          ? undefined
          : d.questions.find((q) => q.id === e.payload.questionId);
      if (e.payload.questionId !== undefined) {
        if (!question || question.field !== e.payload.field) return 'unknown_question';
      }
      if (question && question.status === 'open') {
        question.status = 'answered';
        question.closedByEventId = e.id;
      }
      if (confirmsRevisionId !== null) {
        const finding = d.aiFindings.find((f) => f.revisionId === confirmsRevisionId);
        if (finding && finding.confirmedByEventId === null) finding.confirmedByEventId = e.id;
      }
      addRevision(d, e, {
        id: `${e.id}#confirm`,
        field: e.payload.field,
        value: e.payload.value,
        kind: 'answer',
        extraction: 'explicit',
        authority: 'confirmation',
        evidence: null,
        confirmsRevisionId,
      });
      return null;
    }

    case 'CONFLICT_FLAGGED': {
      const auth = canFlagConflict(d, e.actor);
      if (!auth.ok) return auth.code;
      if (d.contradictions.some((c) => c.id === e.payload.conflictId)) return 'duplicate_entity';
      const ids = [...new Set(e.payload.revisionIds)];
      const revisions: ClaimRevision[] = [];
      for (const id of ids) {
        const revision = d.revisions.find((r) => r.id === id);
        if (!revision) return 'unknown_revision';
        revisions.push(revision);
      }
      // A conflict is between human statements about one field that actually differ.
      if (revisions.some((r) => r.field !== e.payload.field || !isHumanRevision(r))) return 'invalid_conflict';
      if (new Set(revisions.map((r) => normalizeValue(r.value))).size < 2) return 'invalid_conflict';
      d.contradictions.push({
        id: e.payload.conflictId,
        field: e.payload.field,
        revisionIds: ids,
        detectedBy: e.payload.detectedBy,
        flaggedBy: e.actor,
        eventId: e.id,
        status: 'open',
        resolution: null,
      });
      return null;
    }

    case 'CONFLICT_RESOLVED': {
      const auth = canResolveConflict(d, e.actor, e.payload.conflictId);
      if (!auth.ok) return auth.code;
      const conflict = d.contradictions.find((c) => c.id === e.payload.conflictId);
      if (!conflict) return 'unknown_conflict';
      const chosenRevisionId = e.payload.chosenRevisionId ?? null;
      if (chosenRevisionId !== null) {
        const chosen = d.revisions.find((r) => r.id === chosenRevisionId);
        if (!chosen || !conflict.revisionIds.includes(chosenRevisionId)) return 'unknown_revision';
        if (normalizeValue(chosen.value) !== normalizeValue(e.payload.value)) return 'value_mismatch';
      }
      const revisionId = `${e.id}#resolve`;
      // The resolution is a new confirmation. Nothing is removed: both statements stay in history.
      addRevision(d, e, {
        id: revisionId,
        field: conflict.field,
        value: e.payload.value,
        kind: 'answer',
        extraction: 'explicit',
        authority: 'confirmation',
        evidence: null,
        confirmsRevisionId: chosenRevisionId,
      });
      conflict.status = 'resolved';
      conflict.resolution = {
        value: e.payload.value,
        chosenRevisionId,
        revisionId,
        resolvedBy: e.actor,
        eventId: e.id,
      };
      return null;
    }

    case 'CAPSULE_PREPARED': {
      const auth = canPrepareCapsule(d, e.actor);
      if (!auth.ok) return auth.code;
      if (d.capsules.some((c) => c.id === e.payload.capsuleId)) return 'duplicate_entity';
      const policy = e.payload.policy;
      const recipients = policy.recipients.filter((r) => r.deviceId !== e.actor.deviceId);
      for (const r of recipients) {
        const existing = d.recipients.find((x) => x.deviceId === r.deviceId);
        if (existing) continue;
        d.recipients.push({
          deviceId: r.deviceId,
          userName: r.userName ?? r.deviceId,
          level: r.level,
          delivery: 'none',
          capsuleDelivery: 'none',
          acknowledged: false,
          acknowledgedEventId: null,
          declined: false,
        });
      }
      d.disclosure = {
        shareDetailedLocation: policy.shareDetailedLocation,
        shareSymptoms: policy.shareSymptoms,
        recipients: recipients.map((r) => ({ ...r })),
      };
      // The latest prepared policy decides each recipient's level; unlisted recipients read nothing.
      for (const recipient of d.recipients) {
        recipient.level = recipients.find((r) => r.deviceId === recipient.deviceId)?.level ?? 'relay';
      }
      d.capsules.push({ id: e.payload.capsuleId, eventId: e.id, policy: d.disclosure, queued: false });
      return null;
    }

    case 'CAPSULE_QUEUED': {
      const auth = canQueueCapsule(d, e.actor);
      if (!auth.ok) return auth.code;
      const capsule = d.capsules.find((c) => c.id === e.payload.capsuleId);
      if (!capsule) return 'unknown_capsule';
      for (const p of e.payload.packets) {
        if (!d.recipients.some((r) => r.deviceId === p.recipientDeviceId)) return 'unknown_recipient';
        if (d.packets.some((x) => x.packetId === p.packetId)) return 'duplicate_entity';
      }
      capsule.queued = true;
      for (const p of e.payload.packets) {
        d.packets.push({
          packetId: p.packetId,
          recipientDeviceId: p.recipientDeviceId,
          kind: 'capsule',
          capsuleId: capsule.id,
          delivery: 'queued',
          attempts: 0,
          receiptId: null,
          viaDeviceId: null,
        });
      }
      return null;
    }

    case 'PACKET_SENT_ATTEMPT': {
      const auth = canRecordTransport(d, e.actor);
      if (!auth.ok) return auth.code;
      const packet = d.packets.find((p) => p.packetId === e.payload.packetId);
      if (!packet) return 'unknown_packet';
      if (packet.recipientDeviceId !== e.payload.recipientDeviceId) return 'receipt_mismatch';
      packet.attempts += 1;
      // A send attempt never implies delivery.
      if (packet.delivery === 'queued') packet.delivery = 'send_attempted';
      if (e.payload.viaDeviceId !== undefined) packet.viaDeviceId = e.payload.viaDeviceId;
      return null;
    }

    case 'PACKET_RECEIVED_BY_PEER': {
      const auth = canRecordTransport(d, e.actor);
      if (!auth.ok) return auth.code;
      const packet = d.packets.find((p) => p.packetId === e.payload.packetId);
      if (!packet) return 'unknown_packet';
      if (
        packet.recipientDeviceId !== e.payload.recipientDeviceId ||
        e.payload.receipt.recipientDeviceId !== packet.recipientDeviceId ||
        e.payload.receipt.packetId !== packet.packetId
      ) {
        return 'receipt_mismatch';
      }
      if (packet.delivery !== 'delivered') {
        packet.delivery = 'delivered';
        packet.receiptId = e.payload.receipt.receiptId;
        if (e.payload.viaDeviceId !== undefined) packet.viaDeviceId = e.payload.viaDeviceId;
      }
      return null;
    }

    case 'RESPONDER_ACKNOWLEDGED': {
      const auth = canAcknowledge(d, e.actor);
      if (!auth.ok) return auth.code;
      const recipient = d.recipients.find((r) => r.deviceId === e.actor.deviceId);
      if (!recipient) return 'not_recipient';
      if (!recipient.acknowledged) {
        recipient.acknowledged = true;
        recipient.acknowledgedEventId = e.id;
      }
      return null;
    }

    case 'RESPONDER_DECLINED': {
      const auth = canDeclineRequest(d, e.actor);
      if (!auth.ok) return auth.code;
      const recipient = d.recipients.find((r) => r.deviceId === e.actor.deviceId);
      if (!recipient) return 'not_recipient';
      recipient.declined = true;
      // Roles still only offered to this person reopen. Roles they already hold are not touched.
      for (const task of d.tasks) {
        if (task.status === 'offered' && task.offeredToDeviceId === e.actor.deviceId) {
          task.status = 'unassigned';
          task.offeredToDeviceId = null;
          addDeclined(task, e.actor.deviceId);
          touchTask(task, e);
        }
      }
      return null;
    }

    case 'TASK_OFFERED': {
      const offeredTo = e.payload.offeredToDeviceId ?? null;
      const auth = canOfferTask(d, e.actor, e.payload.taskId, offeredTo);
      if (!auth.ok) return auth.code;
      const existing = d.tasks.find((t) => t.id === e.payload.taskId);
      if (existing) {
        // Re-offer: only who it is offered to changes.
        existing.offeredToDeviceId = offeredTo;
        existing.status = offeredTo === null ? 'unassigned' : 'offered';
        touchTask(existing, e);
        return null;
      }
      d.tasks.push({
        id: e.payload.taskId,
        kind: e.payload.kind,
        title: e.payload.title,
        inPerson: e.payload.inPerson,
        origin: e.payload.origin,
        status: offeredTo === null ? 'unassigned' : 'offered',
        offeredBy: e.actor,
        offeredToDeviceId: offeredTo,
        assignee: null,
        declinedByDeviceIds: [],
        progress: [],
        completionNote: null,
        lastEventId: e.id,
        updatedAtMs: e.clock.wallClockMs,
      });
      return null;
    }

    case 'TASK_ACCEPTED': {
      const auth = canAcceptTask(d, e.actor, e.payload.taskId, e.payload.assignee.deviceId);
      if (!auth.ok) return auth.code;
      const task = d.tasks.find((t) => t.id === e.payload.taskId);
      if (!task) return 'unknown_task';
      task.status = 'accepted';
      task.assignee = e.actor;
      touchTask(task, e);
      return null;
    }

    case 'TASK_DECLINED': {
      const auth = canDeclineTask(d, e.actor, e.payload.taskId);
      if (!auth.ok) return auth.code;
      const task = d.tasks.find((t) => t.id === e.payload.taskId);
      if (!task) return 'unknown_task';
      addDeclined(task, e.actor.deviceId);
      const releasing = task.assignee?.deviceId === e.actor.deviceId;
      if (releasing || task.offeredToDeviceId === e.actor.deviceId) {
        task.status = 'unassigned';
        task.offeredToDeviceId = null;
        task.assignee = null;
      }
      touchTask(task, e);
      return null;
    }

    case 'TASK_PROGRESS_REPORTED': {
      const auth = canReportProgress(d, e.actor, e.payload.taskId);
      if (!auth.ok) return auth.code;
      const task = d.tasks.find((t) => t.id === e.payload.taskId);
      if (!task) return 'unknown_task';
      task.status = 'in_progress';
      task.progress.push({ note: e.payload.note ?? null, eventId: e.id, wallClockMs: e.clock.wallClockMs });
      touchTask(task, e);
      return null;
    }

    case 'TASK_COMPLETION_REPORTED': {
      const auth = canReportCompletion(d, e.actor, e.payload.taskId);
      if (!auth.ok) return auth.code;
      const task = d.tasks.find((t) => t.id === e.payload.taskId);
      if (!task) return 'unknown_task';
      task.status = 'completion_reported';
      task.completionNote = e.payload.note ?? null;
      touchTask(task, e);
      return null;
    }

    case 'TASK_COMPLETION_CONFIRMED': {
      const auth = canConfirmCompletion(d, e.actor, e.payload.taskId);
      if (!auth.ok) return auth.code;
      const task = d.tasks.find((t) => t.id === e.payload.taskId);
      if (!task) return 'unknown_task';
      task.status = 'completion_confirmed';
      touchTask(task, e);
      return null;
    }

    case 'INCIDENT_RESOLVED': {
      const auth = canResolveIncident(d, e.actor);
      if (!auth.ok) return auth.code;
      d.closure = {
        kind: 'resolved',
        by: e.actor,
        eventId: e.id,
        wallClockMs: e.clock.wallClockMs,
        note: e.payload.note ?? null,
      };
      return null;
    }

    case 'INCIDENT_CANCELLED': {
      const auth = canCancelIncident(d, e.actor);
      if (!auth.ok) return auth.code;
      d.closure = {
        kind: 'cancelled',
        by: e.actor,
        eventId: e.id,
        wallClockMs: e.clock.wallClockMs,
        note: e.payload.note ?? null,
      };
      return null;
    }
  }
}

/** Distinct values in first-seen order, compared by normalized form. */
function distinctValues(revisions: readonly ClaimRevision[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of revisions) {
    const key = normalizeValue(r.value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r.value);
  }
  return out;
}

function last<T>(items: readonly T[]): T | undefined {
  return items[items.length - 1];
}

/**
 * The revision that would be displayed if no contradiction were open. Rank, highest first:
 * reporter confirmation, reporter statement, responder statement, AI proposal. Within a rank the
 * latest in replay order wins. An AI proposal can therefore never outrank or replace a human claim.
 */
export function leadingRevision(
  revisions: readonly ClaimRevision[],
): { revision: ClaimRevision; tag: Claim['tag'] } | null {
  const confirmation = last(revisions.filter((r) => r.authority === 'confirmation'));
  if (confirmation) return { revision: confirmation, tag: 'user_confirmed' };
  const human = revisions.filter(isHumanRevision);
  const reporter = last(human.filter((r) => r.source.role === 'reporter'));
  if (reporter) return { revision: reporter, tag: 'user_reported' };
  const responder = last(human);
  if (responder) return { revision: responder, tag: 'responder_reported' };
  const proposal = last(revisions);
  if (proposal) return { revision: proposal, tag: 'ai_proposed' };
  return null;
}

function deriveClaim(
  field: ClaimField,
  all: readonly ClaimRevision[],
  contradictions: readonly Contradiction[],
): Claim {
  const revisions = all.filter((r) => r.field === field);
  const open = contradictions.filter((c) => c.field === field && c.status === 'open');
  if (open.length > 0) {
    const ids = new Set(open.flatMap((c) => c.revisionIds));
    return {
      field,
      value: null,
      tag: 'unresolved',
      displayedRevisionId: null,
      candidates: distinctValues(revisions.filter((r) => ids.has(r.id))),
      revisions,
    };
  }
  const leading = leadingRevision(revisions);
  if (!leading) {
    return { field, value: null, tag: 'unknown', displayedRevisionId: null, candidates: [], revisions };
  }
  return {
    field,
    value: leading.revision.value,
    tag: leading.tag,
    displayedRevisionId: leading.revision.id,
    candidates: [],
    revisions,
  };
}

function deriveClaims(d: Draft): Record<ClaimField, Claim> {
  const entries = CLAIM_FIELDS.map((field) => [field, deriveClaim(field, d.revisions, d.contradictions)] as const);
  return Object.fromEntries(entries) as Record<ClaimField, Claim>;
}

function best(states: readonly DeliveryState[]): DeliveryState {
  let out: DeliveryState = 'none';
  for (const s of states) if (DELIVERY_RANK[s] > DELIVERY_RANK[out]) out = s;
  return out;
}

function deriveDelivery(d: Draft): void {
  const latestCapsule = last(d.capsules);
  for (const recipient of d.recipients) {
    const packets = d.packets.filter((p) => p.recipientDeviceId === recipient.deviceId);
    recipient.delivery = best(packets.map((p) => p.delivery));
    recipient.capsuleDelivery = latestCapsule
      ? best(packets.filter((p) => p.capsuleId === latestCapsule.id).map((p) => p.delivery))
      : 'none';
  }
}

function ledgerMeta(events: readonly DomainEvent[]): LedgerMeta {
  const ids = new Set(events.map((e) => e.id));
  const referenced = new Set<string>();
  const seqByDevice: Record<string, number> = {};
  let maxLamport = 0;
  for (const e of events) {
    for (const parent of e.parents) referenced.add(parent);
    if (e.clock.lamport > maxLamport) maxLamport = e.clock.lamport;
    const seen = seqByDevice[e.actor.deviceId] ?? 0;
    if (e.clock.seq > seen) seqByDevice[e.actor.deviceId] = e.clock.seq;
  }
  return {
    eventCount: events.length,
    maxLamport,
    seqByDevice,
    heads: events.filter((e) => !referenced.has(e.id)).map((e) => e.id),
    missingParents: [...referenced].filter((id) => !ids.has(id)).sort(),
  };
}

/** State of an incident with no events. */
export function emptyState(incidentId: string): IncidentState {
  return replay(incidentId, []);
}

/**
 * Derive the state of one incident from its events. Pure and deterministic: any ordering of the
 * same events, with any duplicates, gives a deeply equal result. Events of other incidents are ignored.
 */
export function replay(incidentId: string, events: readonly DomainEvent[]): IncidentState {
  const ordered = sortEvents(events.filter((e) => e.incidentId === incidentId));
  const d = emptyDraft(incidentId);
  for (const e of ordered) {
    const code = applyEvent(d, e);
    if (code === null) {
      d.timeline.push({
        eventId: e.id,
        type: e.type,
        actor: e.actor,
        wallClockMs: e.clock.wallClockMs,
        lamport: e.clock.lamport,
      });
    } else {
      d.notApplied.push({ eventId: e.id, type: e.type, actorDeviceId: e.actor.deviceId, code });
    }
  }
  deriveDelivery(d);
  return {
    incidentId,
    incident: d.incident,
    status: deriveStatus(d),
    reports: d.reports,
    claims: deriveClaims(d),
    aiFindings: d.aiFindings,
    questions: d.questions,
    contradictions: d.contradictions,
    tasks: d.tasks,
    recipients: d.recipients,
    packets: d.packets,
    disclosure: d.disclosure,
    capsules: d.capsules,
    closure: d.closure,
    timeline: d.timeline,
    notApplied: d.notApplied,
    ledger: ledgerMeta(ordered),
    events: ordered,
  };
}

/** Replay the state's ledger together with more events. */
export function applyEvents(state: IncidentState, events: readonly DomainEvent[]): IncidentState {
  return replay(state.incidentId, [...state.events, ...events]);
}
