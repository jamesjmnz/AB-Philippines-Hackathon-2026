import {
  acceptTask,
  confirmCompletion,
  declineRequest,
  declineTask,
  offerTask,
  reportCompletion,
  reportProgress,
} from '../commands';
import { TaskKindSchema } from '../events';
import { canAcceptTask, canConfirmCompletion } from '../policy';
import { applyEvents, replay } from '../reducer';
import { ALEX, MIKA, NOAH, STRANGER, codeOf, forgeEvent, makeWorld, sosWithPeers } from '../testing/fixtures';

function setup() {
  const world = makeWorld();
  let s = sosWithPeers(world).state;
  s = offerTask(s, world.as(ALEX), { kind: 'go_to_requester', title: 'Go to Alex', offeredToDeviceId: MIKA.deviceId }).state;
  return { world, state: s, taskId: s.tasks[0]!.id };
}

describe('task authorization (invariant 5)', () => {
  it('nobody can accept a task on behalf of another person', () => {
    const { world, state, taskId } = setup();

    // Alex (or Noah) authors an acceptance that names Mika.
    for (const author of [ALEX, NOAH]) {
      const forged = forgeEvent(state, world.as(author), {
        type: 'TASK_ACCEPTED',
        payload: { taskId, assignee: MIKA },
      });
      const after = applyEvents(state, [forged]);
      expect(after.notApplied).toEqual([
        { eventId: forged.id, type: 'TASK_ACCEPTED', actorDeviceId: author.deviceId, code: 'cannot_accept_for_another' },
      ]);
      expect(after.tasks[0]).toMatchObject({ status: 'offered', assignee: null });
    }
    expect(canAcceptTask(state, ALEX, taskId, MIKA.deviceId)).toEqual({ ok: false, code: 'cannot_accept_for_another' });
    expect(canAcceptTask(state, MIKA, taskId)).toEqual({ ok: true });
  });

  it('the accept command always names the actor', () => {
    const { world, state, taskId } = setup();
    const result = acceptTask(state, world.as(NOAH), { taskId });
    expect(result.state.tasks[0]?.assignee).toEqual(NOAH);
    const event = result.events[0];
    expect(event?.type === 'TASK_ACCEPTED' && event.payload.assignee).toEqual(NOAH);
  });

  it('a device outside the incident cannot accept', () => {
    const { world, state, taskId } = setup();
    expect(codeOf(() => acceptTask(state, world.as(STRANGER), { taskId }))).toBe('not_participant');
  });

  it('only the assignee reports progress or completion', () => {
    const { world, state, taskId } = setup();
    const s = acceptTask(state, world.as(MIKA), { taskId }).state;
    expect(codeOf(() => reportProgress(s, world.as(NOAH), { taskId }))).toBe('not_assignee');
    expect(codeOf(() => reportCompletion(s, world.as(ALEX), { taskId }))).toBe('not_assignee');
  });

  it('only the reporter confirms completion, and only after it was reported', () => {
    const { world, state, taskId } = setup();
    let s = acceptTask(state, world.as(MIKA), { taskId }).state;
    expect(codeOf(() => confirmCompletion(s, world.as(ALEX), { taskId }))).toBe('invalid_task_transition');
    s = reportCompletion(s, world.as(MIKA), { taskId }).state;
    expect(codeOf(() => confirmCompletion(s, world.as(MIKA), { taskId }))).toBe('not_reporter');
    expect(codeOf(() => confirmCompletion(s, world.as(NOAH), { taskId }))).toBe('not_reporter');
    expect(canConfirmCompletion(s, ALEX, taskId)).toEqual({ ok: true });
    expect(confirmCompletion(s, world.as(ALEX), { taskId }).state.tasks[0]?.status).toBe('completion_confirmed');
  });
});

describe('task state machine', () => {
  it('refuses skipped and backward transitions', () => {
    const { world, state, taskId } = setup();
    expect(codeOf(() => reportProgress(state, world.as(MIKA), { taskId }))).toBe('not_assignee');
    let s = acceptTask(state, world.as(MIKA), { taskId }).state;
    expect(codeOf(() => acceptTask(s, world.as(NOAH), { taskId }))).toBe('task_not_open');
    expect(codeOf(() => offerTask(s, world.as(ALEX), { taskId, offeredToDeviceId: NOAH.deviceId }))).toBe(
      'invalid_task_transition',
    );
    s = reportCompletion(s, world.as(MIKA), { taskId }).state;
    expect(codeOf(() => reportProgress(s, world.as(MIKA), { taskId }))).toBe('invalid_task_transition');
    expect(codeOf(() => declineTask(s, world.as(MIKA), { taskId }))).toBe('invalid_task_transition');
    expect(codeOf(() => acceptTask(s, world.as(MIKA), { taskId: 'task-missing' }))).toBe('unknown_task');
  });

  it('decline reopens the task and it can be re-offered and taken by someone else', () => {
    const { world, state, taskId } = setup();
    let s = declineTask(state, world.as(MIKA), { taskId }).state;
    expect(s.tasks[0]).toMatchObject({ status: 'unassigned', offeredToDeviceId: null, declinedByDeviceIds: [MIKA.deviceId] });

    s = offerTask(s, world.as(ALEX), { taskId, offeredToDeviceId: NOAH.deviceId }).state;
    expect(s.tasks).toHaveLength(1);
    expect(s.tasks[0]).toMatchObject({ status: 'offered', offeredToDeviceId: NOAH.deviceId, title: 'Go to Alex' });

    s = acceptTask(s, world.as(NOAH), { taskId }).state;
    expect(s.tasks[0]).toMatchObject({ status: 'accepted', assignee: NOAH });
  });

  it('an assignee can release a task before completion', () => {
    const { world, state, taskId } = setup();
    let s = acceptTask(state, world.as(MIKA), { taskId }).state;
    s = reportProgress(s, world.as(MIKA), { taskId }).state;
    s = declineTask(s, world.as(MIKA), { taskId }).state;
    expect(s.tasks[0]).toMatchObject({ status: 'unassigned', assignee: null });
    expect(s.status.status).toBe('queued');
  });

  it('declining the whole request reopens roles only offered to that responder', () => {
    const { world, state, taskId } = setup();
    let s = offerTask(state, world.as(ALEX), { kind: 'communicate', title: 'Call the front desk' }).state;
    const other = s.tasks[1]!.id;
    s = acceptTask(s, world.as(MIKA), { taskId: other }).state;
    s = declineRequest(s, world.as(MIKA)).state;

    expect(s.recipients.find((r) => r.deviceId === MIKA.deviceId)?.declined).toBe(true);
    expect(s.tasks.find((t) => t.id === taskId)).toMatchObject({ status: 'unassigned', offeredToDeviceId: null });
    expect(s.tasks.find((t) => t.id === other)).toMatchObject({ status: 'accepted', assignee: MIKA });
  });

  it('cannot offer to a device that is not a recipient', () => {
    const { world, state } = setup();
    expect(
      codeOf(() => offerTask(state, world.as(ALEX), { kind: 'other', title: 'Hold the door', offeredToDeviceId: STRANGER.deviceId })),
    ).toBe('unknown_recipient');
  });

  it('two devices accepting concurrently converge on one assignee', () => {
    const { world, state, taskId } = setup();
    const byMika = acceptTask(state, world.as(MIKA), { taskId }).events;
    const byNoah = acceptTask(state, world.as(NOAH), { taskId }).events;

    const one = replay(state.incidentId, [...state.events, ...byMika, ...byNoah]);
    const two = replay(state.incidentId, [...byNoah, ...byMika, ...state.events]);
    expect(one).toEqual(two);
    // Same lamport, so the device id breaks the tie: dev-mika sorts before dev-noah.
    expect(one.tasks[0]?.assignee).toEqual(MIKA);
    expect(one.notApplied.map((n) => [n.actorDeviceId, n.code])).toEqual([[NOAH.deviceId, 'task_not_open']]);
  });

  it('task kinds are non-medical coordination only', () => {
    expect(TaskKindSchema.options).toEqual(['communicate', 'go_to_requester', 'confirm_location', 'other']);
    for (const kind of ['first_aid', 'medical', 'triage', 'administer_medication']) {
      expect(TaskKindSchema.safeParse(kind).success).toBe(false);
    }
  });
});
