import type { IncidentProposal, ProposalField } from '@/ai';
import type { TaskKind } from '@/domain';
import type { ActionResult, DemoDevice, IncidentView, RecipientPolicyInput } from '@/services/api';

import { DELTA_STATEMENTS, DEMO_PERSONAS, SAMPLE_REPORT } from './personas';
import type { DemoWorld } from './world';

/**
 * The six scripted Demo Lab scenarios from the design, and one more for incident updates. Each step
 * drives one of the three simulated devices through the same actions a person would tap; nothing
 * writes state directly.
 */

export interface ScenarioContext {
  world: DemoWorld;
  /** The incident the seed left open on Alex's device. */
  seedIncidentId: string;
  /** The incident created by this run, once there is one. */
  incidentId: string | null;
  /** Report and proposal carried between steps of the report flow. */
  reportId: string | null;
  proposal: IncidentProposal | null;
  setLink(device: Exclude<DemoDevice, 'alex'>, connected: boolean): void;
  /** Records a step that was refused, by code only. */
  failures: string[];
}

export interface ScenarioStep {
  afterMs: number;
  label: string;
  run(ctx: ScenarioContext): Promise<void>;
}

export interface DemoScenario {
  key: string;
  title: string;
  description: string;
  steps: ScenarioStep[];
}

export function incidentOn(world: DemoWorld, device: DemoDevice, incidentId: string): IncidentView | undefined {
  return world.cores[device].getSnapshot().incidents.find((i) => i.id === incidentId);
}

function taskIdOf(world: DemoWorld, device: DemoDevice, incidentId: string, kind: TaskKind): string | null {
  return incidentOn(world, device, incidentId)?.state.tasks.find((t) => t.kind === kind)?.id ?? null;
}

async function check(ctx: Pick<ScenarioContext, 'failures' | 'world'>, label: string, action: Promise<ActionResult<unknown>>): Promise<boolean> {
  const result = await action;
  if (!result.ok) ctx.failures.push(`${label}:${result.code}`);
  await ctx.world.settle();
  return result.ok;
}

export function defaultPolicy(world: DemoWorld, overrides: Partial<Pick<RecipientPolicyInput, 'shareDetailedLocation' | 'shareSymptoms'>> = {}): RecipientPolicyInput {
  return {
    shareDetailedLocation: true,
    shareSymptoms: true,
    ...overrides,
    levels: { [world.deviceIds.mika]: 'trusted', [world.deviceIds.noah]: 'authorized' },
  };
}

/** The three roles the design opens on every new request: communicate, go in person, confirm location. */
export async function offerDefaultTasks(ctx: Pick<ScenarioContext, 'failures' | 'world'>, reporter: DemoDevice, incidentId: string): Promise<void> {
  const { world } = ctx;
  const actions = world.cores[reporter].actions;
  const others = (['mika', 'noah', 'alex'] as const).filter((d) => d !== reporter);
  const first = others[0];
  const second = others[1];
  if (!first || !second) return;
  await check(ctx, 'offer:communicate', actions.offerTask(incidentId, { kind: 'communicate', title: 'Communicate with staff', toDeviceId: world.deviceIds[first] }));
  await check(
    ctx,
    'offer:go',
    actions.offerTask(incidentId, { kind: 'go_to_requester', title: `Go to ${DEMO_PERSONAS[reporter].firstName}`, toDeviceId: world.deviceIds[second] }),
  );
  await check(ctx, 'offer:location', actions.offerTask(incidentId, { kind: 'confirm_location', title: 'Confirm location' }));
  const locationTask = taskIdOf(world, reporter, incidentId, 'confirm_location');
  if (locationTask) {
    await check(ctx, 'accept:location', actions.acceptTask(incidentId, locationTask));
    await check(ctx, 'start:location', actions.startTask(incidentId, locationTask));
  }
}

const respond = (device: DemoDevice, label: string, afterMs: number, action: (ctx: ScenarioContext, id: string) => Promise<ActionResult<unknown>>, target: 'new' | 'seed' = 'new'): ScenarioStep => ({
  afterMs,
  label: `${device}:${label}`,
  async run(ctx) {
    const id = target === 'seed' ? ctx.seedIncidentId : ctx.incidentId;
    if (!id) {
      ctx.failures.push(`${device}:${label}:no_incident`);
      return;
    }
    await check(ctx, `${device}:${label}`, action(ctx, id));
  },
});

const taskStep = (
  device: DemoDevice,
  verb: 'accept' | 'decline' | 'start' | 'report' | 'confirm',
  kind: TaskKind,
  afterMs: number,
  target: 'new' | 'seed' = 'new',
): ScenarioStep =>
  respond(
    device,
    `${verb}:${kind}`,
    afterMs,
    async (ctx, id) => {
      const taskId = taskIdOf(ctx.world, device, id, kind);
      if (!taskId) return { ok: false, code: 'task_not_synced', message: '' };
      const actions = ctx.world.cores[device].actions;
      if (verb === 'accept') return actions.acceptTask(id, taskId);
      if (verb === 'decline') return actions.declineTask(id, taskId);
      if (verb === 'start') return actions.startTask(id, taskId);
      if (verb === 'report') return actions.reportTaskComplete(id, taskId);
      return actions.confirmTaskComplete(id, taskId);
    },
    target,
  );

const createSOS = (afterMs: number): ScenarioStep => ({
  afterMs,
  label: 'alex:sos',
  async run(ctx) {
    const result = await ctx.world.cores.alex.actions.sendSOS();
    await ctx.world.settle();
    if (!result.ok) {
      ctx.failures.push(`alex:sos:${result.code}`);
      return;
    }
    ctx.incidentId = result.value.incidentId;
    await offerDefaultTasks(ctx, 'alex', result.value.incidentId);
  },
});

/** SOS first, then the spoken report, the simulated interpretation, one clarification, and the reviewed capsule. */
const reportFlow: ScenarioStep[] = [
  createSOS(1200),
  respond('alex', 'report', 1700, async (ctx, id) => {
    const result = await ctx.world.cores.alex.actions.addReport(id, SAMPLE_REPORT, 'transcribed');
    if (result.ok) ctx.reportId = result.value.reportId;
    return result;
  }),
  {
    afterMs: 800,
    label: 'alex:analyze',
    async run(ctx) {
      if (!ctx.incidentId || !ctx.reportId) return;
      const result = await ctx.world.cores.alex.actions.analyzeReport(ctx.incidentId, ctx.reportId);
      // With the simulated model switched off there is no interpretation; the report still goes out as written.
      ctx.proposal = result.ok ? result.value : null;
      await ctx.world.settle();
    },
  },
  respond('alex', 'answer:floor', 3800, (ctx, id) => ctx.world.cores.alex.actions.answerClarification(id, 'floor', 'Second floor')),
  {
    afterMs: 1600,
    label: 'alex:confirm',
    async run(ctx) {
      const id = ctx.incidentId;
      if (!id) return;
      const actions = ctx.world.cores.alex.actions;
      if (ctx.proposal && ctx.reportId) {
        await check(ctx, 'alex:attach', actions.attachProposal(id, ctx.reportId, ctx.proposal));
        for (const field of Object.keys(ctx.proposal.fields) as ProposalField[]) {
          const proposed = ctx.proposal.fields[field];
          if (proposed && field !== 'floor') await check(ctx, `alex:confirm:${field}`, actions.confirmFact(id, field, proposed.value));
        }
      }
      await check(ctx, 'alex:capsule', actions.updateCapsule(id, defaultPolicy(ctx.world)));
    },
  },
];

const mikaConflict = (afterMs: number) =>
  respond('mika', 'observe', afterMs, (ctx, id) => ctx.world.cores.mika.actions.addObservation(id, 'I think Alex is on the first floor.'));

const alexResolveConflict = (afterMs: number, value = 'Second floor') =>
  respond('alex', 'resolve-conflict', afterMs, async (ctx, id) => {
    const open = incidentOn(ctx.world, 'alex', id)?.state.contradictions.find((c) => c.status === 'open');
    if (!open) return { ok: false, code: 'no_open_conflict', message: '' };
    return ctx.world.cores.alex.actions.resolveConflict(id, open.id, value);
  });

/** A typed statement by the requester. The first is the report; later ones are updates to it. */
const alexStates = (label: string, text: string, afterMs: number) => respond('alex', label, afterMs, (ctx, id) => ctx.world.cores.alex.actions.addReport(id, text, 'typed'));

/** Responders read a statement by the requester only once it is in a capsule the requester sent them. */
const shareCapsule = (afterMs: number) => respond('alex', 'capsule', afterMs, (ctx, id) => ctx.world.cores.alex.actions.updateCapsule(id, defaultPolicy(ctx.world)));

const observes = (device: Exclude<DemoDevice, 'alex'>, label: string, text: string, afterMs: number) =>
  respond(device, label, afterMs, (ctx, id) => ctx.world.cores[device].actions.addObservation(id, text));

const preview = (level: 'relay' | 'trusted' | 'authorized', afterMs: number): ScenarioStep => ({
  afterMs,
  label: `alex:preview:${level}`,
  async run(ctx) {
    ctx.world.cores.alex.actions.previewDisclosure(ctx.seedIncidentId, level, defaultPolicy(ctx.world));
  },
});

export const DEMO_SCENARIOS: readonly DemoScenario[] = [
  {
    key: 'normal',
    title: 'Normal SOS',
    description: 'Basic SOS, acknowledgment, acceptance',
    steps: [
      createSOS(0),
      respond('mika', 'ack', 3200, (ctx, id) => ctx.world.cores.mika.actions.acknowledge(id)),
      taskStep('mika', 'accept', 'communicate', 2900),
    ],
  },
  {
    key: 'intelligence',
    title: 'CareChain Intelligence',
    description: 'Interpretation, clarification, conflict resolution',
    steps: [...reportFlow, mikaConflict(3700), alexResolveConflict(3400)],
  },
  {
    key: 'multi-responder',
    title: 'Multi-Responder Assistance',
    description: 'Mika communicates, Noah goes in person',
    steps: [
      respond('mika', 'ack', 1400, (ctx, id) => ctx.world.cores.mika.actions.acknowledge(id), 'seed'),
      taskStep('mika', 'accept', 'communicate', 1400, 'seed'),
      taskStep('mika', 'decline', 'go_to_requester', 1400, 'seed'),
      {
        // In the design Mika forwards by hand. Here the relay is automatic; this step only nudges the queue.
        afterMs: 1400,
        label: 'alex:retry',
        async run(ctx) {
          await ctx.world.cores.alex.actions.retryDelivery(ctx.seedIncidentId);
          await ctx.world.settle();
        },
      },
      respond('noah', 'ack', 2800, (ctx, id) => ctx.world.cores.noah.actions.acknowledge(id), 'seed'),
      taskStep('noah', 'accept', 'go_to_requester', 1400, 'seed'),
      taskStep('noah', 'start', 'go_to_requester', 1400, 'seed'),
    ],
  },
  {
    key: 'privacy',
    title: 'Rescue Capsule Privacy',
    description: 'Relay vs trusted vs authorized views',
    steps: [
      preview('relay', 1200),
      preview('trusted', 2200),
      preview('authorized', 2200),
      respond('alex', 'capsule:hide-symptoms', 2200, (ctx, id) => ctx.world.cores.alex.actions.updateCapsule(id, defaultPolicy(ctx.world, { shareSymptoms: false })), 'seed'),
      respond('alex', 'capsule:share-symptoms', 3600, (ctx, id) => ctx.world.cores.alex.actions.updateCapsule(id, defaultPolicy(ctx.world)), 'seed'),
    ],
  },
  {
    key: 'offline-recovery',
    title: 'Offline Network Recovery',
    description: 'Disconnect, queue, reconnect, deliver',
    steps: [
      {
        afterMs: 0,
        label: 'link:mika:down',
        async run(ctx) {
          ctx.setLink('mika', false);
          await ctx.world.settle();
        },
      },
      createSOS(400),
      {
        afterMs: 3600,
        label: 'link:mika:up',
        async run(ctx) {
          ctx.setLink('mika', true);
          await ctx.world.settle();
        },
      },
      respond('mika', 'ack', 4300, (ctx, id) => ctx.world.cores.mika.actions.acknowledge(id)),
    ],
  },
  {
    key: 'complete',
    title: 'Complete PULSE Experience',
    description: 'SOS to verified resolution',
    steps: [
      ...reportFlow,
      preview('relay', 3500),
      preview('trusted', 1800),
      respond('mika', 'ack', 2700, (ctx, id) => ctx.world.cores.mika.actions.acknowledge(id)),
      taskStep('mika', 'accept', 'communicate', 1300),
      taskStep('mika', 'decline', 'go_to_requester', 1300),
      respond('noah', 'ack', 4200, (ctx, id) => ctx.world.cores.noah.actions.acknowledge(id)),
      taskStep('noah', 'accept', 'go_to_requester', 1300),
      mikaConflict(2700),
      alexResolveConflict(3000),
      taskStep('noah', 'start', 'go_to_requester', 2800),
      taskStep('noah', 'report', 'go_to_requester', 1800),
      taskStep('alex', 'confirm', 'go_to_requester', 1400),
      taskStep('mika', 'report', 'communicate', 1200),
      taskStep('alex', 'confirm', 'communicate', 1200),
      respond('alex', 'resolve', 3000, (ctx, id) => ctx.world.cores.alex.actions.resolveIncident(id)),
    ],
  },
  {
    key: 'incident-updates',
    title: 'Incident updates: correction, second source, disagreement',
    description: 'Same floor twice, a move, a different floor, resolved by Alex',
    steps: [
      createSOS(0),
      alexStates('report', DELTA_STATEMENTS.report, 1700),
      shareCapsule(1200),
      observes('mika', 'observe:same-floor', DELTA_STATEMENTS.sameFloor, 3200),
      alexStates('report:moved', DELTA_STATEMENTS.moved, 3400),
      shareCapsule(1200),
      observes('noah', 'observe:other-floor', DELTA_STATEMENTS.otherFloor, 3600),
      alexResolveConflict(3400, DELTA_STATEMENTS.resolvedFloor),
    ],
  },
];

/**
 * History and one open request, built by running real actions on the three devices with the clock
 * pinned in the past. Returns the id of the open request (the design's "PULSE-2048").
 */
export async function seedDemoWorld(world: DemoWorld, now: number): Promise<{ seedIncidentId: string; failures: string[] }> {
  const MIN = 60_000;
  const ctx = { world, failures: [] as string[] };
  const { alex, mika } = world.cores;

  // An SOS Alex cancelled a day ago.
  world.clock.set(now - 1350 * MIN);
  const cancelled = await alex.actions.sendSOS({ incidentType: 'Manual SOS test' });
  await world.settle();
  if (cancelled.ok) {
    world.clock.advance(20_000);
    await check(ctx, 'seed:cancel', alex.actions.cancelIncident(cancelled.value.incidentId));
  } else ctx.failures.push(`seed:sos:${cancelled.code}`);

  // A request from Mika that Alex helped with and Mika resolved.
  world.clock.set(now - 210 * MIN);
  const helped = await mika.actions.sendSOS({ incidentType: 'Slip near stairwell' });
  await world.settle();
  if (helped.ok) {
    const id = helped.value.incidentId;
    world.clock.advance(MIN);
    await check(ctx, 'seed:ack', alex.actions.acknowledge(id));
    await check(ctx, 'seed:offer', mika.actions.offerTask(id, { kind: 'go_to_requester', title: 'Go to Mika', toDeviceId: world.deviceIds.alex }));
    world.clock.advance(MIN);
    const taskId = taskIdOf(world, 'alex', id, 'go_to_requester');
    if (taskId) {
      await check(ctx, 'seed:accept', alex.actions.acceptTask(id, taskId));
      world.clock.advance(2 * MIN);
      await check(ctx, 'seed:start', alex.actions.startTask(id, taskId));
      world.clock.advance(12 * MIN);
      await check(ctx, 'seed:report', alex.actions.reportTaskComplete(id, taskId));
      world.clock.advance(2 * MIN);
      await check(ctx, 'seed:confirm', mika.actions.confirmTaskComplete(id, taskId));
    } else ctx.failures.push('seed:task_not_synced');
    world.clock.advance(2 * MIN);
    await check(ctx, 'seed:resolve', mika.actions.resolveIncident(id));
  } else ctx.failures.push(`seed:sos:${helped.code}`);

  // The open request: SOS, spoken report, simulated interpretation reviewed by Alex, capsule sent.
  world.clock.set(now - 7 * MIN);
  const open = await alex.actions.sendSOS();
  await world.settle();
  let seedIncidentId = '';
  if (open.ok) {
    seedIncidentId = open.value.incidentId;
    world.clock.advance(30_000);
    const report = await alex.actions.addReport(seedIncidentId, SAMPLE_REPORT, 'transcribed');
    await world.settle();
    world.clock.advance(90_000);
    await offerDefaultTasks(ctx, 'alex', seedIncidentId);
    if (report.ok) {
      const analysis = await alex.actions.analyzeReport(seedIncidentId, report.value.reportId);
      if (analysis.ok) {
        await check(ctx, 'seed:attach', alex.actions.attachProposal(seedIncidentId, report.value.reportId, analysis.value));
        for (const field of Object.keys(analysis.value.fields) as ProposalField[]) {
          const proposed = analysis.value.fields[field];
          if (proposed) await check(ctx, `seed:confirm:${field}`, alex.actions.confirmFact(seedIncidentId, field, proposed.value));
        }
      } else ctx.failures.push(`seed:analyze:${analysis.state}`);
    } else ctx.failures.push(`seed:report:${report.code}`);
    world.clock.advance(15_000);
    await check(ctx, 'seed:capsule', alex.actions.updateCapsule(seedIncidentId, defaultPolicy(world)));
  } else ctx.failures.push(`seed:sos:${open.code}`);

  world.clock.set(null);
  await world.settle();
  return { seedIncidentId, failures: ctx.failures };
}
