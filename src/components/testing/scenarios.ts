import {
  acceptTask,
  acknowledge,
  addObservation,
  addReport,
  cancelIncident,
  createManualSOS,
  offerTask,
  recordSendAttempt,
  reportProgress,
  resolveIncident,
  type IncidentState,
} from '@/domain';
import { ALEX, deliverTo, makeWorld, MIKA, NOAH, packetFor, type World } from '@/domain/testing/fixtures';

/**
 * Test-only incident states, each produced by running the real domain commands so the ledger,
 * status and claims are exactly what the reducer derives. Alex is the reporter; Mika and Noah respond.
 */
export { ALEX, MIKA, NOAH };

const RECIPIENTS = [
  { ...MIKA, level: 'authorized' as const },
  { ...NOAH, level: 'trusted' as const },
];

export type Built = { world: World; state: IncidentState };

export function sosNoPeer(): Built {
  const world = makeWorld('ui');
  return { world, state: createManualSOS(world.as(ALEX), { recipients: [] }).state };
}

export function sosQueued(): Built {
  const world = makeWorld('ui');
  return { world, state: createManualSOS(world.as(ALEX), { recipients: RECIPIENTS }).state };
}

export function sosSendAttempted(): Built {
  const { world, state } = sosQueued();
  return { world, state: recordSendAttempt(state, world.as(ALEX), { packetId: packetFor(state, MIKA.deviceId) }).state };
}

export function sosDelivered(): Built {
  const { world, state } = sosQueued();
  return { world, state: deliverTo(world, state, MIKA) };
}

export function sosAcknowledged(): Built {
  const { world, state } = sosDelivered();
  return { world, state: acknowledge(state, world.as(MIKA)).state };
}

export function sosWithOpenTask(): Built & { taskId: string } {
  const { world, state } = sosAcknowledged();
  const offered = offerTask(state, world.as(ALEX), { kind: 'go_to_requester', title: 'Come to where I am' }).state;
  const taskId = offered.tasks[0]?.id;
  if (!taskId) throw new Error('scenario: task was not created');
  return { world, state: offered, taskId };
}

export function sosRoleTaken(): Built & { taskId: string } {
  const { world, state, taskId } = sosWithOpenTask();
  return { world, taskId, state: acceptTask(state, world.as(MIKA), { taskId }).state };
}

export function sosInProgress(): Built & { taskId: string } {
  const { world, state, taskId } = sosRoleTaken();
  return { world, taskId, state: reportProgress(state, world.as(MIKA), { taskId }).state };
}

export function sosResolved(): Built {
  const { world, state } = sosInProgress();
  return { world, state: resolveIncident(state, world.as(ALEX)).state };
}

export function sosCancelled(): Built {
  const { world, state } = sosQueued();
  return { world, state: cancelIncident(state, world.as(ALEX)).state };
}

/** The reporter says third floor, a responder says fourth: the rules flag it and keep both. */
export function sosFloorConflict(): Built {
  const { world, state } = sosAcknowledged();
  const reported = addReport(state, world.as(ALEX), { text: 'I fell near the stairs on the 3rd floor of Building B.' }).state;
  return { world, state: addObservation(reported, world.as(MIKA), { text: 'I am here now. She is on the 4th floor.' }).state };
}

/** The reporter says third floor and later writes that they moved to the fourth: a correction of their own statement. */
export function sosSelfCorrection(): Built {
  const { world, state } = sosAcknowledged();
  const reported = addReport(state, world.as(ALEX), { text: 'I fell near the stairs on the 3rd floor of Building B.' }).state;
  return { world, state: addReport(reported, world.as(ALEX), { text: 'I moved from the third floor to the fourth floor.' }).state };
}

/** The reporter says third floor and a responder says the same: a second source. */
export function sosSecondSource(): Built {
  const { world, state } = sosAcknowledged();
  const reported = addReport(state, world.as(ALEX), { text: 'I fell near the stairs on the 3rd floor of Building B.' }).state;
  return { world, state: addObservation(reported, world.as(MIKA), { text: 'I am here now. She is on the 3rd floor.' }).state };
}
