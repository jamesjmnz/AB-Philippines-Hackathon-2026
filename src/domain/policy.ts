import { ALLOW, deny, type Decision } from './errors';
import type { Actor } from './primitives';
import { HELD_TASK_STATUSES, OPEN_TASK_STATUSES, type AssistanceTask, type IncidentState } from './state';

/**
 * Authorization policy. Pure functions over derived state; used by the command layer before it
 * emits an event, by the reducer when it validates every event (local or remote) during replay,
 * and by the UI to decide which actions to offer.
 *
 * Identity is the device identifier. Display names are never used for authorization.
 */
export type PolicyView = Pick<
  IncidentState,
  'incident' | 'closure' | 'recipients' | 'tasks' | 'contradictions' | 'questions'
>;

function requireOpen(view: PolicyView): Decision {
  if (!view.incident) return deny('incident_not_found');
  if (view.closure) return deny('incident_closed');
  return ALLOW;
}

export function isReporter(view: PolicyView, actor: Actor): boolean {
  return view.incident !== null && view.incident.reporter.deviceId === actor.deviceId;
}

export function isRecipient(view: PolicyView, actor: Actor): boolean {
  return view.recipients.some((r) => r.deviceId === actor.deviceId);
}

export function isParticipant(view: PolicyView, actor: Actor): boolean {
  return isReporter(view, actor) || isRecipient(view, actor);
}

function requireReporter(view: PolicyView, actor: Actor): Decision {
  const open = requireOpen(view);
  if (!open.ok) return open;
  return isReporter(view, actor) ? ALLOW : deny('not_reporter');
}

function requireParticipant(view: PolicyView, actor: Actor): Decision {
  const open = requireOpen(view);
  if (!open.ok) return open;
  return isParticipant(view, actor) ? ALLOW : deny('not_participant');
}

function requireResponder(view: PolicyView, actor: Actor): Decision {
  const open = requireOpen(view);
  if (!open.ok) return open;
  return isRecipient(view, actor) && !isReporter(view, actor) ? ALLOW : deny('not_recipient');
}

function findTask(view: PolicyView, taskId: string): AssistanceTask | undefined {
  return view.tasks.find((t) => t.id === taskId);
}

/** The reporter's own account is theirs alone; any participant may add an observation. */
export function canAddReport(view: PolicyView, actor: Actor, kind: 'report' | 'observation'): Decision {
  return kind === 'report' ? requireReporter(view, actor) : requireParticipant(view, actor);
}

export function canRecordAIProposal(view: PolicyView, actor: Actor): Decision {
  return requireParticipant(view, actor);
}

export function canRequestClarification(view: PolicyView, actor: Actor): Decision {
  return requireParticipant(view, actor);
}

/** Clarifications are put to the reporter, so only the reporter answers or skips them. */
export function canSkipClarification(view: PolicyView, actor: Actor, questionId: string): Decision {
  const base = requireReporter(view, actor);
  if (!base.ok) return base;
  const question = view.questions.find((q) => q.id === questionId);
  if (!question) return deny('unknown_question');
  return question.status === 'open' ? ALLOW : deny('question_not_open');
}

/** Only the reporter confirms a claim about their own incident. */
export function canConfirmClaim(view: PolicyView, actor: Actor): Decision {
  return requireReporter(view, actor);
}

export function canFlagConflict(view: PolicyView, actor: Actor): Decision {
  return requireParticipant(view, actor);
}

/** A responder may ask for clarification or leave a conflict open; only the reporter resolves it. */
export function canResolveConflict(view: PolicyView, actor: Actor, conflictId: string): Decision {
  const base = requireReporter(view, actor);
  if (!base.ok) return base;
  const conflict = view.contradictions.find((c) => c.id === conflictId);
  if (!conflict) return deny('unknown_conflict');
  return conflict.status === 'open' ? ALLOW : deny('conflict_not_open');
}

export function canPrepareCapsule(view: PolicyView, actor: Actor): Decision {
  return requireReporter(view, actor);
}

export function canQueueCapsule(view: PolicyView, actor: Actor): Decision {
  return requireReporter(view, actor);
}

/** Transport facts may still be recorded after the incident is closed. */
export function canRecordTransport(view: PolicyView, actor: Actor): Decision {
  if (!view.incident) return deny('incident_not_found');
  return isParticipant(view, actor) ? ALLOW : deny('not_participant');
}

export function canAcknowledge(view: PolicyView, actor: Actor): Decision {
  return requireResponder(view, actor);
}

export function canDeclineRequest(view: PolicyView, actor: Actor): Decision {
  return requireResponder(view, actor);
}

/** Offer a new task, or re-offer one that nobody currently holds. */
export function canOfferTask(
  view: PolicyView,
  actor: Actor,
  taskId: string,
  offeredToDeviceId: string | null,
): Decision {
  const base = requireParticipant(view, actor);
  if (!base.ok) return base;
  if (offeredToDeviceId !== null && !view.recipients.some((r) => r.deviceId === offeredToDeviceId)) {
    return deny('unknown_recipient');
  }
  const task = findTask(view, taskId);
  if (task && !OPEN_TASK_STATUSES.includes(task.status)) return deny('invalid_task_transition');
  return ALLOW;
}

/**
 * A task is accepted only by the person taking it. `assigneeDeviceId` is who the acceptance names;
 * it must be the actor, so nobody can accept on behalf of somebody else.
 */
export function canAcceptTask(
  view: PolicyView,
  actor: Actor,
  taskId: string,
  assigneeDeviceId: string = actor.deviceId,
): Decision {
  const base = requireParticipant(view, actor);
  if (!base.ok) return base;
  if (assigneeDeviceId !== actor.deviceId) return deny('cannot_accept_for_another');
  const task = findTask(view, taskId);
  if (!task) return deny('unknown_task');
  return OPEN_TASK_STATUSES.includes(task.status) ? ALLOW : deny('task_not_open');
}

/** Decline an open task, or release a task you hold before reporting completion. */
export function canDeclineTask(view: PolicyView, actor: Actor, taskId: string): Decision {
  const base = requireParticipant(view, actor);
  if (!base.ok) return base;
  const task = findTask(view, taskId);
  if (!task) return deny('unknown_task');
  if (OPEN_TASK_STATUSES.includes(task.status)) return ALLOW;
  const holds = task.assignee?.deviceId === actor.deviceId;
  if (holds && (task.status === 'accepted' || task.status === 'in_progress')) return ALLOW;
  return deny('invalid_task_transition');
}

function requireAssigneeIn(
  view: PolicyView,
  actor: Actor,
  taskId: string,
  statuses: readonly AssistanceTask['status'][],
): Decision {
  const base = requireParticipant(view, actor);
  if (!base.ok) return base;
  const task = findTask(view, taskId);
  if (!task) return deny('unknown_task');
  if (task.assignee?.deviceId !== actor.deviceId) return deny('not_assignee');
  return statuses.includes(task.status) ? ALLOW : deny('invalid_task_transition');
}

export function canReportProgress(view: PolicyView, actor: Actor, taskId: string): Decision {
  return requireAssigneeIn(view, actor, taskId, ['accepted', 'in_progress']);
}

export function canReportCompletion(view: PolicyView, actor: Actor, taskId: string): Decision {
  return requireAssigneeIn(view, actor, taskId, ['accepted', 'in_progress']);
}

/** Completion is confirmed by the reporter, and only after the assignee reported it. */
export function canConfirmCompletion(view: PolicyView, actor: Actor, taskId: string): Decision {
  const base = requireReporter(view, actor);
  if (!base.ok) return base;
  const task = findTask(view, taskId);
  if (!task) return deny('unknown_task');
  return task.status === 'completion_reported' ? ALLOW : deny('invalid_task_transition');
}

export function holdsAcceptedTask(view: PolicyView, actor: Actor): boolean {
  return view.tasks.some(
    (t) => t.assignee?.deviceId === actor.deviceId && HELD_TASK_STATUSES.includes(t.status),
  );
}

/** Resolution needs the reporter, or a responder who holds an accepted task. */
export function canResolveIncident(view: PolicyView, actor: Actor): Decision {
  const open = requireOpen(view);
  if (!open.ok) return open;
  if (isReporter(view, actor)) return ALLOW;
  if (isRecipient(view, actor) && holdsAcceptedTask(view, actor)) return ALLOW;
  return deny('not_authorized_to_resolve');
}

export function canCancelIncident(view: PolicyView, actor: Actor): Decision {
  return requireReporter(view, actor);
}
