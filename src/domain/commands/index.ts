import { assessmentIdFor } from '../assessments';
import type { ClaimField } from '../claims';
import type { DisclosurePolicy } from '../disclosure';
import { DomainError } from '../errors';
import type { ClaimInput, EventSpec, PayloadOf, TaskKind } from '../events';
import { newOutboxMessage, type PacketReceipt } from '../outbox';
import type { TextSpan } from '../primitives';
import { detectFieldConflicts } from '../rules/conflicts';
import { extractBuilding, extractFloorTransition, extractStatedFloor } from '../rules/location';
import type { IncidentState } from '../state';
import { buildEvent, buildEvents, type CommandContext, type CommandResult } from './build';

export { buildEvent, buildEvents, type CommandContext, type CommandResult } from './build';
export { createManualSOS, type ManualSOSInput, type ManualSOSResult } from './createManualSOS';

/**
 * Commands validate an intent against the current state and the authorization policy and return
 * the events to append. They never write anything themselves and never call AI, transport or
 * crypto. A refused intent throws a DomainError with a stable code.
 */

export interface StatementInput {
  text: string;
  inputMode?: 'typed' | 'transcribed';
  language?: string;
  /** Fields the person filled in explicitly. */
  claims?: readonly { field: ClaimField; value: string; evidence?: TextSpan }[];
  /** Run the deterministic floor/building rules over the text. Default true. */
  deriveLocation?: boolean;
}

function statementClaims(input: StatementInput, kind: 'report' | 'observation'): ClaimInput[] {
  const claims: ClaimInput[] = (input.claims ?? []).map((c) => ({
    field: c.field,
    value: c.value,
    extraction: 'explicit',
    ...(c.evidence ? { evidence: c.evidence } : {}),
  }));
  if (input.deriveLocation !== false) {
    const explicit = new Set(claims.map((c) => c.field));
    // "I moved from the first floor to the second floor": the destination is the floor stated,
    // and its span is the evidence. The movement rule is first person, so in an observation it
    // describes the observer's own movement, not the requester's floor: no floor is taken from it.
    const floor =
      kind === 'observation' && extractFloorTransition(input.text) ? null : extractStatedFloor(input.text);
    if (floor && !explicit.has('floor')) {
      claims.push({ field: 'floor', value: floor.value, extraction: 'rule', evidence: floor.span });
    }
    const building = extractBuilding(input.text);
    if (building && !explicit.has('building')) {
      claims.push({ field: 'building', value: building.value, extraction: 'rule', evidence: building.span });
    }
  }
  return claims;
}

/** Appends CONFLICT_FLAGGED for every human disagreement the rules find in `result.state`. */
function withRuleConflicts(ctx: CommandContext, result: CommandResult): CommandResult {
  let current = result.state;
  const events = [...result.events];
  for (const proposal of detectFieldConflicts(current)) {
    const built = buildEvent(current, ctx, {
      type: 'CONFLICT_FLAGGED',
      payload: {
        conflictId: proposal.conflictId,
        field: proposal.field,
        revisionIds: proposal.revisionIds,
        detectedBy: 'rule',
      },
    });
    events.push(built.event);
    current = built.state;
  }
  return { events, outbox: result.outbox, state: current };
}

function addStatement(
  state: IncidentState,
  ctx: CommandContext,
  kind: 'report' | 'observation',
  input: StatementInput,
): CommandResult {
  const result = buildEvents(state, ctx, [
    {
      type: 'REPORT_ADDED',
      payload: {
        reportId: ctx.ids.next('rpt'),
        kind,
        text: input.text,
        inputMode: input.inputMode ?? 'typed',
        ...(input.language ? { language: input.language } : {}),
        claims: statementClaims(input, kind),
      },
    },
  ]);
  return withRuleConflicts(ctx, result);
}

/** The reporter's own account, verbatim. Rule-detected conflicts are flagged in the same result. */
export function addReport(state: IncidentState, ctx: CommandContext, input: StatementInput): CommandResult {
  return addStatement(state, ctx, 'report', input);
}

/** A statement from any participant. It never overwrites the reporter's claim; a disagreement is flagged. */
export function addObservation(state: IncidentState, ctx: CommandContext, input: StatementInput): CommandResult {
  return addStatement(state, ctx, 'observation', input);
}

/** Records model output as proposals. It changes no displayed human claim. */
export function recordAIProposal(
  state: IncidentState,
  ctx: CommandContext,
  input: {
    provider: string;
    reportId?: string;
    findings: readonly { field: ClaimField; value: string; evidence?: TextSpan }[];
  },
): CommandResult {
  return buildEvents(state, ctx, [
    {
      type: 'AI_PROPOSAL_CREATED',
      payload: {
        proposalId: ctx.ids.next('prop'),
        provider: input.provider,
        ...(input.reportId ? { reportId: input.reportId } : {}),
        findings: input.findings.map((f) => ({
          findingId: ctx.ids.next('find'),
          field: f.field,
          value: f.value,
          ...(f.evidence ? { evidence: f.evidence } : {}),
        })),
      },
    },
  ]);
}

export interface AssessmentInput {
  reportId: string;
  /** Version of the prompt that produced the verdict; part of the assessment's identity. */
  promptVersion: string;
  provider: string;
  overall: PayloadOf<'STATEMENT_ASSESSED'>['overall'];
  items: readonly {
    field: ClaimField;
    class: PayloadOf<'STATEMENT_ASSESSED'>['items'][number]['class'];
    againstRevisionId?: string;
    evidence?: TextSpan;
  }[];
}

/**
 * Records the on-device model's verdict on how a statement relates to earlier evidence. It is a
 * proposal: no claim, contradiction or status changes. The id comes from the statement and the
 * prompt version, so assessing the same statement twice with the same prompt is refused as a duplicate.
 */
export function recordAssessment(state: IncidentState, ctx: CommandContext, input: AssessmentInput): CommandResult {
  return buildEvents(state, ctx, [
    {
      type: 'STATEMENT_ASSESSED',
      payload: {
        assessmentId: assessmentIdFor(input.reportId, input.promptVersion),
        reportId: input.reportId,
        provider: input.provider,
        overall: input.overall,
        items: input.items.map((i) => ({
          field: i.field,
          class: i.class,
          ...(i.againstRevisionId ? { againstRevisionId: i.againstRevisionId } : {}),
          ...(i.evidence ? { evidence: i.evidence } : {}),
        })),
      },
    },
  ]);
}

export function requestClarification(
  state: IncidentState,
  ctx: CommandContext,
  input: { field: ClaimField; prompt: string; origin: 'ai' | 'rule' | 'human'; conflictId?: string },
): CommandResult {
  return buildEvents(state, ctx, [
    {
      type: 'CLARIFICATION_REQUESTED',
      payload: {
        questionId: ctx.ids.next('q'),
        field: input.field,
        prompt: input.prompt,
        origin: input.origin,
        ...(input.conflictId ? { conflictId: input.conflictId } : {}),
      },
    },
  ]);
}

/** The reporter declines to answer. The field keeps whatever it had, including unknown. */
export function skipClarification(
  state: IncidentState,
  ctx: CommandContext,
  input: { questionId: string },
): CommandResult {
  return buildEvents(state, ctx, [{ type: 'CLARIFICATION_SKIPPED', payload: { questionId: input.questionId } }]);
}

/**
 * The reporter confirms a value: an existing statement or AI proposal (`confirmsRevisionId`), an
 * answer to a clarification (`questionId`), or a value they state directly.
 */
export function confirmClaim(
  state: IncidentState,
  ctx: CommandContext,
  input: { field: ClaimField; value?: string; confirmsRevisionId?: string; questionId?: string },
): CommandResult {
  let value = input.value;
  if (value === undefined && input.confirmsRevisionId !== undefined) {
    value = state.claims[input.field].revisions.find((r) => r.id === input.confirmsRevisionId)?.value;
    if (value === undefined) throw new DomainError('unknown_revision');
  }
  if (value === undefined) throw new DomainError('invalid_input');
  return buildEvents(state, ctx, [
    {
      type: 'CLAIM_CONFIRMED',
      payload: {
        field: input.field,
        value,
        ...(input.confirmsRevisionId ? { confirmsRevisionId: input.confirmsRevisionId } : {}),
        ...(input.questionId ? { questionId: input.questionId } : {}),
      },
    },
  ]);
}

/** Flags a disagreement between human statements. `detectedBy: 'ai'` is still only a flag. */
export function flagConflict(
  state: IncidentState,
  ctx: CommandContext,
  input: { field: ClaimField; revisionIds: readonly string[]; detectedBy: 'rule' | 'ai'; conflictId?: string },
): CommandResult {
  return buildEvents(state, ctx, [
    {
      type: 'CONFLICT_FLAGGED',
      payload: {
        conflictId: input.conflictId ?? ctx.ids.next('conflict'),
        field: input.field,
        revisionIds: [...input.revisionIds],
        detectedBy: input.detectedBy,
      },
    },
  ]);
}

/** Flags everything the deterministic rules find, for example after merging remote events. */
export function flagDetectedConflicts(state: IncidentState, ctx: CommandContext): CommandResult {
  return withRuleConflicts(ctx, { events: [], outbox: [], state });
}

/** Reporter only. Pick one of the statements (`chosenRevisionId`) or state the value directly. */
export function resolveConflict(
  state: IncidentState,
  ctx: CommandContext,
  input: { conflictId: string; chosenRevisionId?: string; value?: string },
): CommandResult {
  let value = input.value;
  if (value === undefined && input.chosenRevisionId !== undefined) {
    const conflict = state.contradictions.find((c) => c.id === input.conflictId);
    if (!conflict) throw new DomainError('unknown_conflict');
    value = state.claims[conflict.field].revisions.find((r) => r.id === input.chosenRevisionId)?.value;
    if (value === undefined) throw new DomainError('unknown_revision');
  }
  if (value === undefined) throw new DomainError('invalid_input');
  return buildEvents(state, ctx, [
    {
      type: 'CONFLICT_RESOLVED',
      payload: {
        conflictId: input.conflictId,
        value,
        ...(input.chosenRevisionId ? { chosenRevisionId: input.chosenRevisionId } : {}),
      },
    },
  ]);
}

/** A responder saw the request. This is not an acceptance of anything. */
export function acknowledge(state: IncidentState, ctx: CommandContext): CommandResult {
  return buildEvents(state, ctx, [{ type: 'RESPONDER_ACKNOWLEDGED', payload: {} }]);
}

/** A responder cannot help with this request. Roles only offered to them reopen. */
export function declineRequest(state: IncidentState, ctx: CommandContext): CommandResult {
  return buildEvents(state, ctx, [{ type: 'RESPONDER_DECLINED', payload: {} }]);
}

/** Offer a new task, or re-offer an open one by passing its `taskId`. */
export function offerTask(
  state: IncidentState,
  ctx: CommandContext,
  input: {
    taskId?: string;
    kind?: TaskKind;
    title?: string;
    inPerson?: boolean;
    offeredToDeviceId?: string;
    origin?: 'human' | 'ai_suggested' | 'default';
  },
): CommandResult {
  const existing = input.taskId === undefined ? undefined : state.tasks.find((t) => t.id === input.taskId);
  const kind = existing?.kind ?? input.kind;
  const title = existing?.title ?? input.title;
  if (kind === undefined || title === undefined) throw new DomainError('invalid_input');
  return buildEvents(state, ctx, [
    {
      type: 'TASK_OFFERED',
      payload: {
        taskId: input.taskId ?? ctx.ids.next('task'),
        kind,
        title,
        inPerson: existing?.inPerson ?? input.inPerson ?? kind === 'go_to_requester',
        origin: existing?.origin ?? input.origin ?? 'human',
        ...(input.offeredToDeviceId ? { offeredToDeviceId: input.offeredToDeviceId } : {}),
      },
    },
  ]);
}

/** The issuing actor takes the task for themselves. There is no way to name anyone else. */
export function acceptTask(state: IncidentState, ctx: CommandContext, input: { taskId: string }): CommandResult {
  return buildEvents(state, ctx, [
    { type: 'TASK_ACCEPTED', payload: { taskId: input.taskId, assignee: ctx.actor } },
  ]);
}

export function declineTask(state: IncidentState, ctx: CommandContext, input: { taskId: string }): CommandResult {
  return buildEvents(state, ctx, [{ type: 'TASK_DECLINED', payload: { taskId: input.taskId } }]);
}

/** Assignee only. The note is what the person reported; arrival is never inferred. */
export function reportProgress(
  state: IncidentState,
  ctx: CommandContext,
  input: { taskId: string; note?: string },
): CommandResult {
  return buildEvents(state, ctx, [
    { type: 'TASK_PROGRESS_REPORTED', payload: { taskId: input.taskId, ...(input.note ? { note: input.note } : {}) } },
  ]);
}

export function reportCompletion(
  state: IncidentState,
  ctx: CommandContext,
  input: { taskId: string; note?: string },
): CommandResult {
  return buildEvents(state, ctx, [
    {
      type: 'TASK_COMPLETION_REPORTED',
      payload: { taskId: input.taskId, ...(input.note ? { note: input.note } : {}) },
    },
  ]);
}

/** Reporter only, and only after the assignee reported completion. Does not resolve the incident. */
export function confirmCompletion(
  state: IncidentState,
  ctx: CommandContext,
  input: { taskId: string },
): CommandResult {
  return buildEvents(state, ctx, [{ type: 'TASK_COMPLETION_CONFIRMED', payload: { taskId: input.taskId } }]);
}

/** Reporter reviewed recipients and disclosure. A later call replaces the policy (capsule update). */
export function prepareCapsule(
  state: IncidentState,
  ctx: CommandContext,
  input: { policy: DisclosurePolicy },
): CommandResult & { capsuleId: string } {
  const capsuleId = ctx.ids.next('cap');
  const result = buildEvents(state, ctx, [{ type: 'CAPSULE_PREPARED', payload: { capsuleId, policy: input.policy } }]);
  return { ...result, capsuleId };
}

/** Places the capsule in the outbox: one packet per recipient of the capsule's policy (or the given subset). */
export function queueCapsule(
  state: IncidentState,
  ctx: CommandContext,
  input: { capsuleId: string; recipientDeviceIds?: readonly string[] },
): CommandResult {
  const capsule = state.capsules.find((c) => c.id === input.capsuleId);
  if (!capsule) throw new DomainError('unknown_capsule');
  const targets = input.recipientDeviceIds ?? capsule.policy.recipients.map((r) => r.deviceId);
  if (targets.length === 0) throw new DomainError('unknown_recipient');
  const packets = [...new Set(targets)].map((recipientDeviceId) => ({
    packetId: ctx.ids.next('pkt'),
    recipientDeviceId,
  }));
  const result = buildEvents(state, ctx, [
    { type: 'CAPSULE_QUEUED', payload: { capsuleId: capsule.id, packets } },
  ]);
  const queued = result.events[0];
  const outbox = packets.map((p) =>
    newOutboxMessage({
      packetId: p.packetId,
      incidentId: state.incidentId,
      recipientDeviceId: p.recipientDeviceId,
      kind: 'capsule',
      eventIds: result.state.events.map((e) => e.id).slice(0, 500),
      capsuleId: capsule.id,
      createdAtMs: queued?.clock.wallClockMs ?? 0,
    }),
  );
  return { events: result.events, outbox, state: result.state };
}

/** The transport was asked to send. This never marks anything delivered. */
export function recordSendAttempt(
  state: IncidentState,
  ctx: CommandContext,
  input: { packetId: string; viaDeviceId?: string },
): CommandResult {
  const packet = state.packets.find((p) => p.packetId === input.packetId);
  if (!packet) throw new DomainError('unknown_packet');
  return buildEvents(state, ctx, [
    {
      type: 'PACKET_SENT_ATTEMPT',
      payload: {
        packetId: packet.packetId,
        recipientDeviceId: packet.recipientDeviceId,
        attempt: packet.attempts + 1,
        ...(input.viaDeviceId ? { viaDeviceId: input.viaDeviceId } : {}),
      },
    },
  ]);
}

/**
 * A receipt from the recipient device arrived. The caller (transport + crypto) must have verified
 * the receipt's signature before calling this; the domain checks that it names this packet and recipient.
 */
export function recordPeerReceipt(
  state: IncidentState,
  ctx: CommandContext,
  input: { receipt: PacketReceipt; viaDeviceId?: string },
): CommandResult {
  const spec: EventSpec = {
    type: 'PACKET_RECEIVED_BY_PEER',
    payload: {
      packetId: input.receipt.packetId,
      recipientDeviceId: input.receipt.recipientDeviceId,
      receipt: input.receipt,
      ...(input.viaDeviceId ? { viaDeviceId: input.viaDeviceId } : {}),
    },
  };
  return buildEvents(state, ctx, [spec]);
}

/** The reporter, or a responder holding an accepted task. */
export function resolveIncident(state: IncidentState, ctx: CommandContext, input: { note?: string } = {}): CommandResult {
  return buildEvents(state, ctx, [
    { type: 'INCIDENT_RESOLVED', payload: input.note ? { note: input.note } : {} },
  ]);
}

/** Reporter only. */
export function cancelIncident(state: IncidentState, ctx: CommandContext, input: { note?: string } = {}): CommandResult {
  return buildEvents(state, ctx, [
    { type: 'INCIDENT_CANCELLED', payload: input.note ? { note: input.note } : {} },
  ]);
}
