import { HELD_TASK_STATUSES, type IncidentState, type IncidentStatusInfo } from './state';

type StatusView = Pick<IncidentState, 'incident' | 'closure' | 'tasks' | 'recipients'>;

/**
 * Derived incident status. Precedence: cancelled, resolved, in_progress, role_taken, acknowledged,
 * delivered, queued. Each level needs its own evidence: a send attempt is not a delivery, a
 * delivery is not an acknowledgment, an acknowledgment is not an acceptance, and arrival is never
 * inferred.
 */
export function deriveStatus(view: StatusView): IncidentStatusInfo {
  if (!view.incident) return { status: 'queued', reason: 'not_created' };
  if (view.closure?.kind === 'cancelled') return { status: 'cancelled', reason: 'cancelled_by_reporter' };
  if (view.closure?.kind === 'resolved') {
    return { status: 'resolved', reason: 'resolved_by_authorized_person' };
  }

  const reporterId = view.incident.reporter.deviceId;
  const held = view.tasks.filter(
    (t) => t.assignee !== null && t.assignee.deviceId !== reporterId && HELD_TASK_STATUSES.includes(t.status),
  );
  if (held.some((t) => t.inPerson && t.status === 'in_progress')) {
    return { status: 'in_progress', reason: 'in_person_task_in_progress' };
  }
  if (held.length > 0) return { status: 'role_taken', reason: 'task_accepted' };
  if (view.recipients.some((r) => r.acknowledged)) {
    return { status: 'acknowledged', reason: 'acknowledged_by_responder' };
  }
  if (view.recipients.some((r) => r.delivery === 'delivered')) {
    return { status: 'delivered', reason: 'delivered_with_receipt' };
  }
  if (view.recipients.length === 0) return { status: 'queued', reason: 'no_trusted_peer' };
  if (view.recipients.some((r) => r.delivery === 'send_attempted')) {
    return { status: 'queued', reason: 'send_attempted_no_receipt' };
  }
  return { status: 'queued', reason: 'awaiting_peer' };
}
