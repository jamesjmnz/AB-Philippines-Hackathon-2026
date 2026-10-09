import { newOutboxMessage } from '../outbox';
import type { TrustedPeer } from '../people';
import { emptyState } from '../reducer';
import { buildEvents, type CommandContext, type CommandResult } from './build';

export interface ManualSOSInput {
  /** Trusted peers to alert. May be empty: the SOS is still created and stays queued. */
  recipients: readonly TrustedPeer[];
  incidentType?: string;
}

export interface ManualSOSResult extends CommandResult {
  incidentId: string;
}

/**
 * The manual SOS. It needs the reporter's identity, a recipient list and the injected clock and id
 * generator, and nothing else: no AI, no transport, no permission, no crypto. It returns
 * INCIDENT_CREATED and one outbox row per recipient; `IncidentRepository.commit` writes them in one
 * transaction, after which the SOS is durable.
 */
export function createManualSOS(ctx: CommandContext, input: ManualSOSInput): ManualSOSResult {
  const incidentId = ctx.ids.next('inc');
  const seen = new Set<string>([ctx.actor.deviceId]);
  const recipients = input.recipients
    .filter((peer) => {
      if (seen.has(peer.deviceId)) return false;
      seen.add(peer.deviceId);
      return true;
    })
    .map((peer) => ({
      deviceId: peer.deviceId,
      userName: peer.userName,
      level: peer.level,
      packetId: ctx.ids.next('pkt'),
    }));

  const result = buildEvents(emptyState(incidentId), ctx, [
    {
      type: 'INCIDENT_CREATED',
      payload: {
        source: 'manual_sos',
        incidentType: input.incidentType ?? 'Manual SOS',
        assistanceRequested: true,
        recipients,
      },
    },
  ]);
  const created = result.events[0];
  const createdAtMs = created?.clock.wallClockMs ?? 0;
  const eventIds = created ? [created.id] : [];
  const outbox = recipients.map((r) =>
    newOutboxMessage({
      packetId: r.packetId,
      incidentId,
      recipientDeviceId: r.deviceId,
      kind: 'basic_alert',
      eventIds,
      createdAtMs,
    }),
  );
  return { incidentId, events: result.events, outbox, state: result.state };
}
