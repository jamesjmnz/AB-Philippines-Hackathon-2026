import {
  acceptTask,
  acknowledge,
  addObservation,
  addReport,
  confirmClaim,
  confirmCompletion,
  createManualSOS,
  offerTask,
  prepareCapsule,
  queueCapsule,
  recordAIProposal,
  recordPeerReceipt,
  recordSendAttempt,
  reportCompletion,
  reportProgress,
  requestClarification,
  resolveConflict,
  resolveIncident,
  type CommandContext,
  type ManualSOSResult,
} from '../commands';
import { isDomainError, type DomainErrorCode } from '../errors';
import { DomainEventSchema, type DomainEvent, type EventSpec } from '../events';
import type { OutboxMessage } from '../outbox';
import type { TrustedPeer } from '../people';
import { createFixedClock, createSequentialIds, type Actor, type Clock, type IdGenerator } from '../primitives';
import type { IncidentState } from '../state';

/** Synthetic fixtures for tests and the Demo store. No real people, no real incidents. */

export const ALEX: Actor = { deviceId: 'dev-alex', userName: 'Alex Rivera' };
export const MIKA: Actor = { deviceId: 'dev-mika', userName: 'Mika Santos' };
export const NOAH: Actor = { deviceId: 'dev-noah', userName: 'Noah Cruz' };
export const JORDAN: Actor = { deviceId: 'dev-jordan', userName: 'Jordan relay' };
export const STRANGER: Actor = { deviceId: 'dev-stranger', userName: 'Unknown device' };

export const PEERS: readonly TrustedPeer[] = [
  { ...MIKA, level: 'authorized' },
  { ...NOAH, level: 'trusted' },
  { ...JORDAN, level: 'relay' },
];

export const SAMPLE_REPORT = 'Nadulas ako sa hagdan sa Building B. Masakit paa ko at kailangan ko ng tulong.';
export const SAMPLE_SYMPTOM = 'Masakit paa ko';

export interface World {
  clock: Clock;
  ids: IdGenerator;
  as(actor: Actor): CommandContext;
}

export function makeWorld(namespace = 't'): World {
  const clock = createFixedClock(1_760_000_000_000);
  const ids = createSequentialIds(namespace);
  return { clock, ids, as: (actor) => ({ actor, clock, ids }) };
}

/** Runs `fn` and returns the DomainError code it threw, or null. Other errors propagate. */
export function codeOf(fn: () => unknown): DomainErrorCode | null {
  try {
    fn();
    return null;
  } catch (error) {
    if (isDomainError(error)) return error.code;
    throw error;
  }
}

/**
 * Builds a schema-valid event WITHOUT asking the reducer, the way a misbehaving or malicious
 * remote device could. Used to test that the reducer refuses it.
 */
export function forgeEvent(state: IncidentState, ctx: CommandContext, spec: EventSpec): DomainEvent {
  return DomainEventSchema.parse({
    id: ctx.ids.next('forged'),
    incidentId: state.incidentId,
    type: spec.type,
    actor: ctx.actor,
    clock: {
      seq: (state.ledger.seqByDevice[ctx.actor.deviceId] ?? 0) + 1,
      lamport: state.ledger.maxLamport + 1,
      wallClockMs: ctx.clock.nowMs(),
    },
    parents: [...state.ledger.heads],
    payload: spec.payload,
  });
}

export function sosWithPeers(world: World, peers: readonly TrustedPeer[] = PEERS): ManualSOSResult {
  return createManualSOS(world.as(ALEX), { recipients: peers });
}

export function packetFor(state: IncidentState, deviceId: string, kind: 'basic_alert' | 'capsule' = 'basic_alert'): string {
  const packet = state.packets.find((p) => p.recipientDeviceId === deviceId && p.kind === kind);
  if (!packet) throw new Error(`fixture: no ${kind} packet for ${deviceId}`);
  return packet.packetId;
}

/** Attempt + receipt for one recipient's basic alert. */
export function deliverTo(world: World, state: IncidentState, recipient: Actor): IncidentState {
  const packetId = packetFor(state, recipient.deviceId);
  const attempted = recordSendAttempt(state, world.as(ALEX), { packetId }).state;
  return recordPeerReceipt(attempted, world.as(ALEX), {
    receipt: { receiptId: world.ids.next('rcpt'), packetId, recipientDeviceId: recipient.deviceId },
  }).state;
}

export interface FullScenario {
  world: World;
  incidentId: string;
  state: IncidentState;
  events: DomainEvent[];
  outbox: OutboxMessage[];
  taskIds: { goToRequester: string; communicate: string };
}

/** A complete synthetic incident from SOS to resolution, touching every event type. */
export function fullScenario(): FullScenario {
  const world = makeWorld('full');
  const alex = world.as(ALEX);
  const mika = world.as(MIKA);
  const noah = world.as(NOAH);
  const sos = sosWithPeers(world);
  const outbox = [...sos.outbox];
  let s = sos.state;

  s = addReport(s, alex, {
    text: SAMPLE_REPORT,
    language: 'tl',
    claims: [{ field: 'symptom', value: SAMPLE_SYMPTOM }],
  }).state;
  const report = s.reports[0];
  s = recordAIProposal(s, alex, {
    provider: 'synthetic-test-model',
    ...(report ? { reportId: report.id } : {}),
    findings: [{ field: 'incidentType', value: 'Slip on stairs', evidence: { start: 0, end: 22, text: 'Nadulas ako sa hagdan ' } }],
  }).state;
  s = requestClarification(s, alex, { field: 'floor', prompt: 'Which floor are you on?', origin: 'ai' }).state;
  const question = s.questions[0];

  s = deliverTo(world, s, MIKA);
  s = deliverTo(world, s, NOAH);
  s = acknowledge(s, mika).state;

  s = offerTask(s, alex, { kind: 'go_to_requester', title: 'Go to Alex', offeredToDeviceId: MIKA.deviceId }).state;
  s = offerTask(s, alex, { kind: 'communicate', title: 'Tell building security' }).state;
  const goToRequester = s.tasks[0]?.id ?? '';
  const communicate = s.tasks[1]?.id ?? '';
  s = acceptTask(s, mika, { taskId: goToRequester }).state;
  s = acknowledge(s, noah).state;
  s = acceptTask(s, noah, { taskId: communicate }).state;

  s = confirmClaim(s, alex, {
    field: 'floor',
    value: 'Second floor',
    ...(question ? { questionId: question.id } : {}),
  }).state;
  s = addObservation(s, mika, { text: 'I think Alex is on the first floor.' }).state;
  const conflict = s.contradictions[0];
  const chosen = s.claims.floor.revisions.find((r) => r.authority === 'confirmation');
  if (conflict && chosen) {
    s = resolveConflict(s, alex, { conflictId: conflict.id, chosenRevisionId: chosen.id }).state;
  }

  const prepared = prepareCapsule(s, alex, {
    policy: {
      shareDetailedLocation: true,
      shareSymptoms: true,
      recipients: PEERS.map((p) => ({ deviceId: p.deviceId, level: p.level })),
    },
  });
  const queued = queueCapsule(prepared.state, alex, { capsuleId: prepared.capsuleId });
  outbox.push(...queued.outbox);
  s = queued.state;

  s = reportProgress(s, mika, { taskId: goToRequester, note: 'On my way up the stairs' }).state;
  s = reportCompletion(s, mika, { taskId: goToRequester }).state;
  s = confirmCompletion(s, alex, { taskId: goToRequester }).state;
  s = resolveIncident(s, alex).state;

  return { world, incidentId: sos.incidentId, state: s, events: s.events, outbox, taskIds: { goToRequester, communicate } };
}

/** Deterministic PRNG (mulberry32) for seeded shuffles. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const random = seededRandom(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) continue;
    out[i] = b;
    out[j] = a;
  }
  return out;
}
