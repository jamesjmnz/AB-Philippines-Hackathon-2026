import {
  acceptTask,
  acknowledge,
  confirmCompletion,
  declineRequest,
  offerTask,
  recordPeerReceipt,
  recordSendAttempt,
  reportCompletion,
  reportProgress,
  resolveIncident,
} from '../commands';
import { DomainEventSchema } from '../events';
import { applyEvents } from '../reducer';
import {
  ALEX,
  MIKA,
  NOAH,
  STRANGER,
  codeOf,
  deliverTo,
  forgeEvent,
  makeWorld,
  packetFor,
  sosWithPeers,
} from '../testing/fixtures';

function recipient(state: ReturnType<typeof sosWithPeers>['state'], deviceId: string) {
  const found = state.recipients.find((r) => r.deviceId === deviceId);
  if (!found) throw new Error('fixture: recipient missing');
  return found;
}

describe('delivery truth (invariant 7)', () => {
  it('a send attempt is not a delivery, however many times it is retried', () => {
    const world = makeWorld();
    let s = sosWithPeers(world).state;
    const packetId = packetFor(s, MIKA.deviceId);
    for (let i = 0; i < 5; i += 1) s = recordSendAttempt(s, world.as(ALEX), { packetId }).state;

    expect(recipient(s, MIKA.deviceId).delivery).toBe('send_attempted');
    expect(s.packets.find((p) => p.packetId === packetId)).toMatchObject({ attempts: 5, receiptId: null });
    expect(s.status).toEqual({ status: 'queued', reason: 'send_attempted_no_receipt' });
  });

  it('delivered needs a receipt from the recipient device', () => {
    const world = makeWorld();
    const s0 = sosWithPeers(world).state;
    const packetId = packetFor(s0, MIKA.deviceId);
    const s1 = recordPeerReceipt(s0, world.as(ALEX), {
      receipt: { receiptId: 'rcpt-1', packetId, recipientDeviceId: MIKA.deviceId },
    }).state;

    expect(recipient(s1, MIKA.deviceId).delivery).toBe('delivered');
    expect(recipient(s1, NOAH.deviceId).delivery).toBe('queued');
    expect(s1.packets.find((p) => p.packetId === packetId)?.receiptId).toBe('rcpt-1');
    expect(s1.status).toEqual({ status: 'delivered', reason: 'delivered_with_receipt' });
  });

  it('rejects a receipt without an id, for another packet, or from another device', () => {
    const world = makeWorld();
    const s = sosWithPeers(world).state;
    const packetId = packetFor(s, MIKA.deviceId);
    const base = forgeEvent(s, world.as(ALEX), {
      type: 'PACKET_RECEIVED_BY_PEER',
      payload: {
        packetId,
        recipientDeviceId: MIKA.deviceId,
        receipt: { receiptId: 'r', packetId, recipientDeviceId: MIKA.deviceId },
      },
    });
    const withPayload = (payload: unknown) => DomainEventSchema.safeParse({ ...base, payload }).success;

    expect(withPayload(base.payload)).toBe(true);
    expect(withPayload({ packetId, recipientDeviceId: MIKA.deviceId })).toBe(false);
    expect(
      withPayload({ packetId, recipientDeviceId: MIKA.deviceId, receipt: { receiptId: '', packetId, recipientDeviceId: MIKA.deviceId } }),
    ).toBe(false);
    expect(
      withPayload({ packetId, recipientDeviceId: MIKA.deviceId, receipt: { receiptId: 'r', packetId, recipientDeviceId: NOAH.deviceId } }),
    ).toBe(false);
    expect(
      withPayload({ packetId, recipientDeviceId: MIKA.deviceId, receipt: { receiptId: 'r', packetId: 'other', recipientDeviceId: MIKA.deviceId } }),
    ).toBe(false);

    // A receipt naming Noah for Mika's packet is well-formed but does not match the packet.
    expect(
      codeOf(() =>
        recordPeerReceipt(s, world.as(ALEX), {
          receipt: { receiptId: 'r', packetId, recipientDeviceId: NOAH.deviceId },
        }),
      ),
    ).toBe('receipt_mismatch');
    expect(
      codeOf(() =>
        recordPeerReceipt(s, world.as(ALEX), {
          receipt: { receiptId: 'r', packetId: 'pkt-unknown', recipientDeviceId: MIKA.deviceId },
        }),
      ),
    ).toBe('unknown_packet');
    expect(codeOf(() => recordSendAttempt(s, world.as(STRANGER), { packetId }))).toBe('not_participant');
  });

  it('a second receipt for the same packet changes nothing', () => {
    const world = makeWorld();
    const s0 = sosWithPeers(world).state;
    const packetId = packetFor(s0, MIKA.deviceId);
    const s1 = recordPeerReceipt(s0, world.as(ALEX), {
      receipt: { receiptId: 'rcpt-1', packetId, recipientDeviceId: MIKA.deviceId },
    }).state;
    const s2 = recordPeerReceipt(s1, world.as(ALEX), {
      receipt: { receiptId: 'rcpt-2', packetId, recipientDeviceId: MIKA.deviceId },
    }).state;
    expect(s2.packets).toEqual(s1.packets);
    expect(s2.recipients).toEqual(s1.recipients);
  });
});

describe('human states are distinct from delivery and from each other', () => {
  it('delivered -> acknowledged -> role_taken -> in_progress -> completion reported -> confirmed -> resolved', () => {
    const world = makeWorld();
    const alex = world.as(ALEX);
    const mika = world.as(MIKA);
    let s = deliverTo(world, sosWithPeers(world).state, MIKA);

    // Delivered is not acknowledged.
    expect(s.status.status).toBe('delivered');
    expect(recipient(s, MIKA.deviceId).acknowledged).toBe(false);

    // Acknowledged is not accepted.
    s = acknowledge(s, mika).state;
    s = offerTask(s, alex, { kind: 'go_to_requester', title: 'Go to Alex', offeredToDeviceId: MIKA.deviceId }).state;
    const taskId = s.tasks[0]!.id;
    expect(s.status.status).toBe('acknowledged');
    expect(s.tasks[0]).toMatchObject({ status: 'offered', assignee: null });

    // Accepted is not in progress and says nothing about arrival.
    s = acceptTask(s, mika, { taskId }).state;
    expect(s.status).toEqual({ status: 'role_taken', reason: 'task_accepted' });
    expect(s.tasks[0]).toMatchObject({ status: 'accepted', progress: [] });

    s = reportProgress(s, mika, { taskId, note: 'Leaving the library now' }).state;
    expect(s.status).toEqual({ status: 'in_progress', reason: 'in_person_task_in_progress' });
    expect(s.tasks[0]?.progress.map((p) => p.note)).toEqual(['Leaving the library now']);

    // Completion reported is not confirmed.
    s = reportCompletion(s, mika, { taskId }).state;
    expect(s.tasks[0]?.status).toBe('completion_reported');
    expect(s.status.status).toBe('role_taken');

    // Confirmed is not resolved.
    s = confirmCompletion(s, alex, { taskId }).state;
    expect(s.tasks[0]?.status).toBe('completion_confirmed');
    expect(s.closure).toBeNull();
    expect(s.status.status).toBe('role_taken');

    s = resolveIncident(s, alex).state;
    expect(s.status.status).toBe('resolved');
    expect(s.closure).toMatchObject({ kind: 'resolved', by: ALEX });
  });

  it('accepting a task does not acknowledge, and acknowledging does not deliver', () => {
    const world = makeWorld();
    let s = sosWithPeers(world).state;
    s = offerTask(s, world.as(ALEX), { kind: 'communicate', title: 'Call the front desk' }).state;
    s = acceptTask(s, world.as(MIKA), { taskId: s.tasks[0]!.id }).state;
    expect(recipient(s, MIKA.deviceId)).toMatchObject({ acknowledged: false, delivery: 'queued' });

    s = acknowledge(s, world.as(NOAH)).state;
    expect(recipient(s, NOAH.deviceId)).toMatchObject({ acknowledged: true, delivery: 'queued' });
  });

  it('a non in-person task in progress stays role_taken', () => {
    const world = makeWorld();
    let s = sosWithPeers(world).state;
    s = offerTask(s, world.as(ALEX), { kind: 'communicate', title: 'Call the front desk' }).state;
    const taskId = s.tasks[0]!.id;
    s = acceptTask(s, world.as(MIKA), { taskId }).state;
    s = reportProgress(s, world.as(MIKA), { taskId }).state;
    expect(s.tasks[0]?.status).toBe('in_progress');
    expect(s.status.status).toBe('role_taken');
  });

  it('only a recipient acknowledges or declines; the reporter and strangers cannot', () => {
    const world = makeWorld();
    const s = sosWithPeers(world).state;
    expect(codeOf(() => acknowledge(s, world.as(ALEX)))).toBe('not_recipient');
    expect(codeOf(() => acknowledge(s, world.as(STRANGER)))).toBe('not_recipient');
    expect(codeOf(() => declineRequest(s, world.as(STRANGER)))).toBe('not_recipient');
  });

  it('transport facts may still be recorded after closure, human actions may not', () => {
    const world = makeWorld();
    let s = sosWithPeers(world).state;
    s = resolveIncident(s, world.as(ALEX)).state;
    s = deliverTo(world, s, MIKA);
    expect(recipient(s, MIKA.deviceId).delivery).toBe('delivered');
    expect(s.status.status).toBe('resolved');
    expect(codeOf(() => acknowledge(s, world.as(MIKA)))).toBe('incident_closed');

    const late = forgeEvent(s, world.as(MIKA), { type: 'RESPONDER_ACKNOWLEDGED', payload: {} });
    const after = applyEvents(s, [late]);
    expect(after.notApplied.map((n) => n.code)).toEqual(['incident_closed']);
    expect(recipient(after, MIKA.deviceId).acknowledged).toBe(false);
  });
});
