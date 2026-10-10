import type { AIResult, CapabilityMatrix, LocalAIService, StatementAssessmentInput, StatementAssessmentProposal } from '@/ai';
import { SimulatedAI } from '@/demo/SimulatedAI';
import { assessmentIdFor, createSequentialIds, type DomainEvent, type IncidentState } from '@/domain';
import { forgeEvent } from '@/domain/testing/fixtures';
import { createMemoryIncidentRepository } from '@/storage';
import { createMemoryHub } from '@/transport/testing';
import { createFakeCapsuleCrypto, createFakeCryptoRealm } from '@/crypto/testing';

import { createMemoryKeyValueStore } from '../kv';
import { PulseCore } from '../PulseCore';
import { ManualClock, createInertTimers, createTestNet, dev, must, type TestDevice, type TestNet, type TestNetOptions } from '../testing/harness';

/**
 * Safety properties of the background Incident Delta analysis, the model lane and the fixed wording,
 * exercised through whole device cores. Synthetic statements only. `a` is the requester (owner),
 * `b` a responder. The model is a scripted stub: nothing here measures a real model.
 */

// ---- scripted model ------------------------------------------------------------------------------

const META = { source: 'callstack-apple' as const, latencyMs: 5 };

const READY: CapabilityMatrix = {
  provider: 'Callstack Apple',
  source: 'callstack-apple',
  packageVersion: 'test',
  device: { model: 'Test iPhone', osVersion: '0' },
  text: { state: 'ready' },
  embeddings: { state: 'ready', language: 'en' },
  transcription: { state: 'ready', locale: 'en-US' },
  speech: { state: 'ready' },
};

type Assessed = AIResult<StatementAssessmentProposal>;
type Script = Partial<Pick<StatementAssessmentProposal, 'fields' | 'relations' | 'topic' | 'relationCall'>>;
type Assess = (input: StatementAssessmentInput) => Promise<Assessed>;

const answer = (script: Script = {}): Assessed => ({
  ok: true,
  value: { fields: {}, dropped: [], unknown: [], relations: {}, topic: 'about_request', relationCall: 'ready', latenciesMs: [5], ...script },
  meta: META,
});

const refusal = (): Assessed => ({ ok: false, state: 'guardrail_refusal', message: 'stub refusal', meta: META });

const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

function deferred<T = void>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface Stub {
  ai: LocalAIService;
  /** Every input `assessStatement` was called with, in order. */
  seen: StatementAssessmentInput[];
  /** Every generation method called, by name, in order. */
  calls: string[];
  callsFor(statement: string): number;
}

/** A model whose statement assessment is scripted; every other generation answers a typed failure unless overridden. */
function stubAI(assess: Assess, overrides: Partial<LocalAIService> = {}): Stub {
  const seen: StatementAssessmentInput[] = [];
  const calls: string[] = [];
  const down = (name: string) => async () => {
    calls.push(name);
    return { ok: false as const, state: 'native_error' as const, message: 'stub', meta: META };
  };
  const ai: LocalAIService = {
    inspectCapabilities: async () => READY,
    extractIncidentReport: down('extract'),
    suggestClarification: down('clarify'),
    findConflicts: down('conflicts'),
    proposeNonMedicalTasks: down('tasks'),
    compareSemanticReports: down('compare'),
    transcribeLocal: down('transcribe'),
    assessStatement: (input) => {
      calls.push('assess');
      seen.push(input);
      return assess(input);
    },
    ...overrides,
  };
  return { ai, seen, calls, callsFor: (statement) => seen.filter((s) => s.statement === statement).length };
}

const PLACES = ['near the canteen', 'by the gym', 'at the parking lot', 'in the chapel', 'behind the main gate', 'beside the library'] as const;

/** Reads a place the statement names word for word, and says it differs from whatever place is known. */
const readsPlace: Assess = async (input) => {
  const place = PLACES.find((p) => input.statement.includes(p));
  if (!place) return answer();
  return answer({ fields: { locationText: { value: place, evidence: place } }, relations: input.known.locationText ? { locationText: 'different' } : {} });
};

// ---- harness helpers -----------------------------------------------------------------------------

const nets: TestNet[] = [];
const cores: PulseCore[] = [];

async function make(options: TestNetOptions): Promise<TestNet> {
  const net = await createTestNet(options);
  nets.push(net);
  return net;
}

afterEach(async () => {
  await Promise.all(nets.splice(0).map((n) => n.dispose()));
  await Promise.all(cores.splice(0).map((c) => c.dispose()));
});

async function turns(count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) await Promise.resolve();
}

/**
 * Waits for a condition using microtasks and the simulated radio only. For the cases where a device
 * holds a model call that has not answered, so `net.settle()` (which waits for every device) cannot be used.
 */
async function waitFor(net: TestNet, condition: () => boolean | Promise<boolean>, label: string): Promise<void> {
  for (let round = 0; round < 4000; round += 1) {
    if (await condition()) return;
    await net.hub.idle();
    await turns(5);
  }
  throw new Error(`never happened: ${label}`);
}

/** Lets everything that can still happen without the pending model call happen. */
async function drain(net: TestNet): Promise<void> {
  const all = Object.values(net.devices);
  let previous = '';
  let quiet = 0;
  for (let round = 0; round < 4000 && quiet < 40; round += 1) {
    await net.hub.idle();
    await turns(10);
    const now = all.map((d) => d.core.busy).join(',');
    quiet = net.hub.pending === 0 && now === previous ? quiet + 1 : 0;
    previous = now;
  }
}

/** Resolves with the value only if the promise settles on microtasks alone: no timer, radio or model answer. */
async function settlesPromptly<T>(promise: Promise<T>): Promise<T> {
  const box: { done: boolean; value?: T; error?: unknown } = { done: false };
  promise.then(
    (value) => {
      box.done = true;
      box.value = value;
    },
    (error: unknown) => {
      box.done = true;
      box.error = error;
    },
  );
  for (let i = 0; i < 2000 && !box.done; i += 1) await Promise.resolve();
  if (!box.done) throw new Error('still pending: it is waiting on something other than local storage');
  if (box.error !== undefined) throw box.error;
  return box.value as T;
}

const stateOf = (device: TestDevice, incidentId: string): IncidentState => {
  const state = device.incident(incidentId)?.state;
  if (!state) throw new Error(`incident not on ${device.name}`);
  return state;
};

const eventsOf = <T extends DomainEvent['type']>(state: IncidentState, type: T): Extract<DomainEvent, { type: T }>[] =>
  state.events.filter((e): e is Extract<DomainEvent, { type: T }> => e.type === type);

const reportIdOf = (state: IncidentState, text: string): string => {
  const report = state.reports.find((r) => r.text === text);
  if (!report) throw new Error(`no statement "${text}"`);
  return report.id;
};

const factOf = (device: TestDevice, incidentId: string, field: string) => device.incident(incidentId)?.facts.find((f) => f.field === field);
const updateOf = (device: TestDevice, incidentId: string, reportId: string) => device.incident(incidentId)?.updates.find((u) => u.reportId === reportId);

/** Another trigger of the background analysis, as the sync engine and the report actions make. */
const trigger = (device: TestDevice, incidentId: string): void => {
  (device.core as unknown as { scheduleAnalysis(id: string): void }).scheduleAnalysis(incidentId);
};

/** What only a person may change. */
const humanSide = (state: IncidentState) => ({
  status: state.status,
  closure: state.closure,
  contradictions: state.contradictions,
  tasks: state.tasks,
  questions: state.questions,
  claims: Object.fromEntries(Object.entries(state.claims).map(([field, claim]) => [field, claim.revisions.filter((r) => r.source.kind !== 'ai_proposal')])),
});

const AB: TestNetOptions['trust'] = [['a', 'b', 'authorized', 'authorized']];

const REPORT = 'I am near the canteen.';
const OBSERVATION = 'She is by the gym.';
const WHERE = 'Where exactly are you?';

// ---- 1. background write path ---------------------------------------------------------------------

describe('background analysis of the reporter’s own statement', () => {
  const TEXT = 'I slipped near the canteen and hit my head. My ankle hurts.';

  it('records one grounded proposal and one assessment, changes nothing a person said, and records nothing more when triggered again', async () => {
    const gate = deferred();
    const model = stubAI(async (input) => {
      if (input.statement !== TEXT) return answer();
      await gate.promise;
      return answer({
        fields: {
          // Backed by the person's own words.
          locationText: { value: 'near the canteen', evidence: 'near the canteen' },
          // A severity judgement hung on real words.
          symptom: { value: 'Critical head trauma, severe concussion', evidence: 'my head' },
          // Words that are not in the statement at all.
          incidentType: { value: 'Emergency services have been contacted', evidence: 'in the library' },
          // A value the quoted words do not say.
          building: { value: 'Building Z', evidence: 'near the canteen' },
        },
      });
    });
    const net = await make({ devices: ['a', 'b'], trust: AB, perDevice: { a: { ai: model.ai } } });
    const a = dev(net, 'a');
    const { incidentId } = must(await a.core.actions.sendSOS());
    await net.settle();
    const { reportId } = must(await a.core.actions.addReport(incidentId, TEXT, 'typed'));
    await waitFor(net, () => model.callsFor(TEXT) === 1, 'the model was asked about the report');
    await drain(net);

    // The model has not answered yet: the report is stored and nothing waits for it.
    const before = stateOf(a, incidentId);
    expect(before.reports.map((r) => r.text)).toEqual([TEXT]);
    expect(eventsOf(before, 'AI_PROPOSAL_CREATED')).toHaveLength(0);
    expect(eventsOf(before, 'STATEMENT_ASSESSED')).toHaveLength(0);

    gate.resolve();
    await net.settle();

    const after = stateOf(a, incidentId);
    const proposals = eventsOf(after, 'AI_PROPOSAL_CREATED');
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.payload.reportId).toBe(reportId);
    const start = TEXT.indexOf('near the canteen');
    expect(proposals[0]?.payload.findings).toEqual([
      expect.objectContaining({ field: 'locationText', value: 'near the canteen', evidence: { start, end: start + 'near the canteen'.length, text: 'near the canteen' } }),
    ]);
    expect(after.aiFindings).toEqual([expect.objectContaining({ field: 'locationText', value: 'near the canteen', evidenceVerified: true, confirmedByEventId: null })]);

    const assessments = eventsOf(after, 'STATEMENT_ASSESSED');
    expect(assessments).toHaveLength(1);
    expect(assessments[0]?.payload).toMatchObject({ reportId, overall: 'new_information', items: [expect.objectContaining({ field: 'locationText', class: 'new_information' })] });
    expect(assessments[0]?.actor.deviceId).toBe(a.id);

    // Proposals only: no human claim, contradiction, task, question or status moved.
    expect(humanSide(after)).toEqual(humanSide(before));
    expect(after.contradictions).toEqual([]);
    expect(after.tasks).toEqual([]);
    expect(after.claims.locationText).toMatchObject({ value: 'near the canteen', tag: 'ai_proposed' });
    expect(after.claims.symptom).toMatchObject({ value: null, tag: 'unknown' });
    expect(after.claims.building).toMatchObject({ value: null, tag: 'unknown' });
    expect(after.claims.incidentType).toMatchObject({ value: 'Manual SOS', tag: 'user_reported' });
    expect(factOf(a, incidentId, 'locationText')).toMatchObject({ value: 'near the canteen', tag: 'ai_proposed', by: 'You', evidence: 'near the canteen' });
    // Nothing the stub invented is anywhere in the ledger.
    const ledger = JSON.stringify(after.events);
    for (const invented of ['Critical head trauma', 'Emergency services', 'Building Z', 'in the library']) expect(ledger).not.toContain(invented);

    // More triggers for the same statement: nothing is recorded and the model is not asked again.
    const settled = after.events.map((e) => e.id);
    for (let i = 0; i < 4; i += 1) {
      trigger(a, incidentId);
      await net.settle();
    }
    expect(stateOf(a, incidentId).events.map((e) => e.id)).toEqual(settled);
    expect(model.callsFor(TEXT)).toBe(1);

    // A later statement is a trigger too. It gets its own assessment; the first statement gets no second one.
    must(await a.core.actions.addReport(incidentId, 'Still waiting here.', 'typed'));
    await net.settle();
    const later = stateOf(a, incidentId);
    expect(eventsOf(later, 'AI_PROPOSAL_CREATED').filter((e) => e.payload.reportId === reportId)).toHaveLength(1);
    expect(eventsOf(later, 'STATEMENT_ASSESSED').filter((e) => e.payload.reportId === reportId)).toHaveLength(1);
    expect(eventsOf(later, 'STATEMENT_ASSESSED')).toHaveLength(2);
    expect(model.callsFor(TEXT)).toBe(1);
  });
});

// ---- 2. receive path --------------------------------------------------------------------------------

describe('a responder’s observation arriving on the owner’s device', () => {
  it('is analysed on the owner’s device and never on the responder’s', async () => {
    const owner = stubAI(readsPlace);
    const responder = stubAI(readsPlace);
    const net = await make({ devices: ['a', 'b'], trust: AB, perDevice: { a: { ai: owner.ai }, b: { ai: responder.ai } } });
    const a = dev(net, 'a');
    const b = dev(net, 'b');
    expect(b.core.getSnapshot().capabilities?.text.state).toBe('ready');
    const { incidentId } = must(await a.core.actions.sendSOS());
    await net.settle();
    must(await a.core.actions.addReport(incidentId, REPORT, 'typed'));
    await net.settle();
    expect(owner.callsFor(OBSERVATION)).toBe(0);

    must(await b.core.actions.addObservation(incidentId, OBSERVATION));
    await net.settle();

    expect(owner.callsFor(OBSERVATION)).toBe(1);
    const observationId = reportIdOf(stateOf(a, incidentId), OBSERVATION);
    expect(stateOf(a, incidentId).assessments.map((x) => x.reportId)).toContain(observationId);
    expect(stateOf(a, incidentId).assessments.every((x) => x.recordedBy.deviceId === a.id)).toBe(true);
    // The responder's phone can run the model and holds the statement, and still analyses nothing.
    expect(responder.seen).toEqual([]);
    expect(responder.calls).toEqual([]);
    expect(eventsOf(stateOf(b, incidentId), 'STATEMENT_ASSESSED').every((e) => e.actor.deviceId === a.id)).toBe(true);
  });

  const BROKEN: Record<string, () => Promise<Assessed>> = {
    'throws synchronously': () => {
      throw new Error('assess exploded');
    },
    'never answers': () => never<Assessed>(),
    rejects: () => Promise.reject(new Error('assess rejected')),
  };

  it.each(Object.keys(BROKEN))('still completes the sync when the owner’s model %s', async (mode) => {
    const broken = BROKEN[mode];
    if (!broken) throw new Error('fixture');
    const owner = stubAI((input) => (input.statement === OBSERVATION ? broken() : readsPlace(input)));
    const net = await make({ devices: ['a', 'b'], trust: AB, perDevice: { a: { ai: owner.ai } } });
    const a = dev(net, 'a');
    const b = dev(net, 'b');
    const { incidentId } = must(await a.core.actions.sendSOS());
    await net.settle();
    must(await a.core.actions.addReport(incidentId, REPORT, 'typed'));
    await net.settle();

    expect((await b.core.actions.addObservation(incidentId, OBSERVATION)).ok).toBe(true);
    // The arrival did ask the model, which then failed in this way.
    await waitFor(net, () => owner.callsFor(OBSERVATION) >= 1, 'the owner’s model was asked about the observation');
    // Stored on the owner's device, and acknowledged back: nothing is left to send on either side.
    await waitFor(net, () => a.incident(incidentId)?.state.reports.some((r) => r.text === OBSERVATION) === true, 'the observation reached the owner');
    await waitFor(net, async () => (await b.repo.getPendingOutbox(incidentId)).length === 0, 'the responder’s packet was acknowledged');
    await drain(net);

    const state = stateOf(a, incidentId);
    expect(state.reports.map((r) => r.text)).toEqual(expect.arrayContaining([REPORT, OBSERVATION]));
    expect(updateOf(a, incidentId, reportIdOf(state, OBSERVATION))).toMatchObject({ by: 'b', kind: 'observation' });
    expect(await b.repo.getPendingOutbox(incidentId)).toEqual([]);
    // No assessment of it, and nothing invented in its place.
    expect(state.assessments.map((x) => x.reportId)).not.toContain(reportIdOf(state, OBSERVATION));
    expect(state.questions).toEqual([]);
    // The owner's device still works: it can take another statement and act on the incident.
    expect((await settlesPromptly(a.core.actions.addReport(incidentId, 'I am still here.', 'typed'))).ok).toBe(true);
  });
});

// ---- 3. stale results ------------------------------------------------------------------------------

describe('a model answer that arrives after a person acted', () => {
  const SECOND = 'Sorry, I am by the gym. My ankle hurts.';

  /** The reporter says where they are, then says somewhere else; the model's answer for the second statement is held. */
  async function reportTwice() {
    const gate = deferred();
    const model = stubAI(async (input) => {
      if (input.statement !== SECOND) return readsPlace(input);
      await gate.promise;
      return answer({
        fields: { locationText: { value: 'by the gym', evidence: 'by the gym' }, symptom: { value: 'My ankle hurts', evidence: 'My ankle hurts' } },
        relations: { locationText: 'different' },
      });
    });
    const net = await make({ devices: ['a'], perDevice: { a: { ai: model.ai } } });
    const a = dev(net, 'a');
    const { incidentId } = must(await a.core.actions.sendSOS());
    must(await a.core.actions.addReport(incidentId, REPORT, 'typed'));
    await net.settle();
    expect(stateOf(a, incidentId).claims.locationText).toMatchObject({ value: 'near the canteen', tag: 'ai_proposed' });
    const { reportId } = must(await a.core.actions.addReport(incidentId, SECOND, 'typed'));
    await waitFor(net, () => model.callsFor(SECOND) === 1, 'the model was asked about the second statement');
    return { net, a, incidentId, reportId, gate, model };
  }

  it('records the correction when nobody acted in the meantime (control)', async () => {
    const { net, a, incidentId, reportId, gate } = await reportTwice();
    gate.resolve();
    await net.settle();
    const state = stateOf(a, incidentId);
    const assessed = state.assessments.find((x) => x.reportId === reportId);
    expect(assessed?.items.map((i) => [i.field, i.class]).sort()).toEqual([['locationText', 'correction'], ['symptom', 'new_information']]);
    const proposed = eventsOf(state, 'AI_PROPOSAL_CREATED').filter((e) => e.payload.reportId === reportId).flatMap((e) => e.payload.findings.map((f) => f.field));
    expect(proposed.sort()).toEqual(['locationText', 'symptom']);
  });

  it('drops the item and the finding for a field the reporter confirmed while the model was running, and keeps the rest', async () => {
    const { net, a, incidentId, reportId, gate } = await reportTwice();
    must(await a.core.actions.confirmFact(incidentId, 'locationText', 'near the canteen'));
    gate.resolve();
    await net.settle();

    const state = stateOf(a, incidentId);
    // The confirmed detail is untouched and nothing about that field was recorded from the stale answer.
    expect(state.claims.locationText).toMatchObject({ value: 'near the canteen', tag: 'user_confirmed' });
    expect(factOf(a, incidentId, 'locationText')).toMatchObject({ value: 'near the canteen', tag: 'user_confirmed', by: 'You' });
    const assessed = state.assessments.find((x) => x.reportId === reportId);
    expect(assessed?.items.map((i) => i.field)).toEqual(['symptom']);
    expect(assessed?.overall).toBe('new_information');
    const findings = eventsOf(state, 'AI_PROPOSAL_CREATED').filter((e) => e.payload.reportId === reportId).flatMap((e) => e.payload.findings);
    expect(findings.map((f) => f.field)).toEqual(['symptom']);
    expect(state.claims.locationText.revisions.some((r) => r.value === 'by the gym')).toBe(false);
    expect(state.aiFindings.some((f) => f.value === 'by the gym')).toBe(false);
    expect(state.questions).toEqual([]);
    expect(state.contradictions).toEqual([]);
    expect(updateOf(a, incidentId, reportId)?.fields.some((f) => f.field === 'locationText')).toBe(false);
  });

  it.each(['resolveIncident', 'cancelIncident'] as const)('records nothing at all when the incident was closed (%s) while the model was running', async (close) => {
    const { net, a, incidentId, reportId, gate } = await reportTwice();
    must(await a.core.actions[close](incidentId));
    const closed = stateOf(a, incidentId);
    expect(closed.closure).not.toBeNull();
    const ids = closed.events.map((e) => e.id);

    gate.resolve();
    await net.settle();

    const state = stateOf(a, incidentId);
    expect(state.events.map((e) => e.id)).toEqual(ids);
    expect(state.assessments.some((x) => x.reportId === reportId)).toBe(false);
    expect(eventsOf(state, 'AI_PROPOSAL_CREATED').some((e) => e.payload.reportId === reportId)).toBe(false);
    expect(state.claims.locationText).toMatchObject({ value: 'near the canteen', tag: 'ai_proposed' });
    expect(state.questions).toEqual([]);
    // A later trigger does not bring it back either.
    trigger(a, incidentId);
    await net.settle();
    expect(stateOf(a, incidentId).events.map((e) => e.id)).toEqual(ids);
  });
});

// ---- 4. manual SOS ---------------------------------------------------------------------------------

describe('manual SOS with the model lane unusable', () => {
  const METHODS = ['inspectCapabilities', 'extractIncidentReport', 'suggestClarification', 'findConflicts', 'proposeNonMedicalTasks', 'compareSemanticReports', 'transcribeLocal', 'assessStatement', 'probeOutputShapes'] as const;

  function brokenAI(behave: (method: (typeof METHODS)[number]) => unknown): { ai: LocalAIService; calls: string[] } {
    const calls: string[] = [];
    const ai = Object.fromEntries(
      METHODS.map((method) => [
        method,
        () => {
          calls.push(method);
          return behave(method);
        },
      ]),
    ) as unknown as LocalAIService;
    return { ai, calls };
  }

  async function expectSOS(a: TestDevice, calls: string[]): Promise<string> {
    const callsBefore = calls.length;
    const result = await settlesPromptly(a.core.actions.sendSOS());
    if (!result.ok) throw new Error(result.code);
    // No AI method was started, let alone awaited, between the tap and the answer.
    expect(calls).toHaveLength(callsBefore);
    const incidentId = result.value.incidentId;
    const stored = await a.repo.replay(incidentId);
    expect(stored.incident?.source).toBe('manual_sos');
    expect(stored.events.map((e) => e.type)).toEqual(['INCIDENT_CREATED']);
    expect(stored.status).toEqual({ status: 'queued', reason: 'awaiting_peer' });
    // Queued for the trusted peer, and honestly so: the radio is unlinked, nothing was sent.
    const outbox = await a.repo.getPendingOutbox(incidentId);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.recipientDeviceId).toBe(a.core.getSnapshot().peers[0]?.deviceId);
    expect(a.incident(incidentId)).toMatchObject({ role: 'reporter', access: 'owner', pendingOutbox: 1 });
    return incidentId;
  }

  it('returns, persists and queues while the lane is full of generations that never finish', async () => {
    const { ai, calls } = brokenAI((method) => (method === 'inspectCapabilities' ? Promise.resolve(READY) : never()));
    const net = await make({ devices: ['a', 'b'], trust: AB, links: [], perDevice: { a: { ai } } });
    const a = dev(net, 'a');
    const first = await expectSOS(a, calls);

    // A background analysis takes the lane and never gives it back...
    for (let i = 0; i < 3; i += 1) must(await settlesPromptly(a.core.actions.addReport(first, `I am waiting, message ${i}.`, 'typed')));
    await drain(net);
    expect(calls.filter((c) => c === 'assessStatement')).toHaveLength(1);
    // ...and more interactive calls than the queue holds (six) pile up behind it; the rest are turned away.
    for (let i = 0; i < 12; i += 1) void a.core.actions.diagnoseExtraction(`synthetic text ${i}`);
    await drain(net);
    const stats = a.core.actions.aiDiagnostics().stats;
    expect(stats.queueHighWater).toBe(6);
    expect(stats.byState.queue_full ?? 0).toBeGreaterThanOrEqual(6);
    expect(calls.filter((c) => c === 'extractIncidentReport')).toHaveLength(0);

    const second = await expectSOS(a, calls);
    expect(second).not.toBe(first);
    expect(a.core.busy).toBeGreaterThan(0); // the analyses are still stuck, and the SOS did not care
  });

  it('returns, persists and queues when every AI method throws synchronously', async () => {
    const { ai, calls } = brokenAI(() => {
      throw new Error('ai exploded');
    });
    const net = await make({ devices: ['a', 'b'], trust: AB, links: [], perDevice: { a: { ai } } });
    const a = dev(net, 'a');
    expect(a.core.getSnapshot().capabilities?.text.state).toBe('native_error');
    const incidentId = await expectSOS(a, calls);
    // The report flow that needs no model still works, and the model failures stay typed.
    must(await settlesPromptly(a.core.actions.addReport(incidentId, 'I am on the second floor.', 'typed')));
    expect((await a.repo.replay(incidentId)).claims.floor).toMatchObject({ value: 'Second floor', tag: 'user_reported' });
    expect(await a.core.actions.suggestTasks(incidentId)).toMatchObject({ ok: false, state: 'native_error' });
    await expectSOS(a, calls);
  });

  it('returns, persists and queues when every AI method hangs, including the capability probe', async () => {
    const { ai, calls } = brokenAI(() => never());
    // Startup never finishes on its own with a probe that hangs, so it is not awaited.
    const net = await make({ devices: ['a', 'b'], trust: AB, links: [], perDevice: { a: { ai, start: false } } });
    const a = dev(net, 'a');
    void a.core.start().catch(() => undefined);
    await drain(net);
    expect(calls).toEqual(['inspectCapabilities']);
    expect(a.core.getSnapshot().ready).toBe(false);
    const incidentId = await expectSOS(a, calls);
    must(await settlesPromptly(a.core.actions.addReport(incidentId, 'I am on the second floor.', 'typed')));
    await expectSOS(a, calls);
    expect(calls).toEqual(['inspectCapabilities']);
  });
});

// ---- 5. another person's differing reading ---------------------------------------------------------

describe('a responder reads a place differently from the requester', () => {
  function expectDisagreementKept(a: TestDevice, incidentId: string): void {
    const state = stateOf(a, incidentId);
    const observationId = reportIdOf(state, OBSERVATION);

    // The displayed detail is still what the requester said, attributed to the requester.
    expect(state.claims.locationText).toMatchObject({ value: 'near the canteen', tag: 'ai_proposed' });
    expect(factOf(a, incidentId, 'locationText')).toMatchObject({ value: 'near the canteen', tag: 'ai_proposed', by: 'You', evidence: 'near the canteen', candidates: [] });
    // The responder's reading never became a value of the field.
    expect(state.claims.locationText.revisions.map((r) => r.value)).toEqual(['near the canteen']);
    expect(state.aiFindings.map((f) => f.value)).toEqual(['near the canteen']);

    // The update row says what it is and that a person has to look.
    expect(updateOf(a, incidentId, observationId)).toMatchObject({ by: 'b', kind: 'observation', overall: 'possible_contradiction', basis: 'model', needsVerification: true });
    expect(updateOf(a, incidentId, observationId)?.fields).toEqual([{ field: 'locationText', class: 'possible_contradiction' }]);

    // The person is asked, in the app's words.
    expect(state.questions).toEqual([expect.objectContaining({ field: 'locationText', origin: 'ai', status: 'open', prompt: WHERE, conflictId: null })]);
    expect(state.questions[0]?.askedBy.deviceId).toBe(a.id);

    // Nothing was opened or settled on anyone's behalf.
    expect(state.contradictions).toEqual([]);
    expect(eventsOf(state, 'CONFLICT_FLAGGED')).toEqual([]);
    expect(eventsOf(state, 'CONFLICT_RESOLVED')).toEqual([]);
    expect(eventsOf(state, 'CLAIM_CONFIRMED')).toEqual([]);
    expect(state.closure).toBeNull();
  }

  it('keeps the requester’s value, marks the observation a possible contradiction and asks with the fixed wording', async () => {
    const model = stubAI(readsPlace);
    const net = await make({ devices: ['a', 'b'], trust: AB, perDevice: { a: { ai: model.ai } } });
    const a = dev(net, 'a');
    const b = dev(net, 'b');
    const { incidentId } = must(await a.core.actions.sendSOS());
    await net.settle();
    must(await a.core.actions.addReport(incidentId, REPORT, 'typed'));
    await net.settle();
    must(await b.core.actions.addObservation(incidentId, OBSERVATION));
    await net.settle();

    // The model was shown what is on record, not who said it.
    expect(model.seen.find((s) => s.statement === OBSERVATION)?.known).toEqual({ locationText: 'near the canteen' });
    expectDisagreementKept(a, incidentId);

    // Settling it is the requester's act, and only then does the value change standing.
    must(await a.core.actions.answerClarification(incidentId, 'locationText', 'near the canteen'));
    await net.settle();
    expect(stateOf(a, incidentId).claims.locationText).toMatchObject({ value: 'near the canteen', tag: 'user_confirmed' });
    expect(updateOf(a, incidentId, reportIdOf(stateOf(a, incidentId), OBSERVATION))).toMatchObject({ overall: 'possible_contradiction', needsVerification: false });
  });

  it('does the same when the responder wrote before receiving the report, so the observation sorts ahead of it', async () => {
    const model = stubAI(readsPlace);
    const net = await make({ devices: ['a', 'b'], trust: AB, perDevice: { a: { ai: model.ai } } });
    const a = dev(net, 'a');
    const b = dev(net, 'b');
    const { incidentId } = must(await a.core.actions.sendSOS());
    await net.settle();
    expect(b.incident(incidentId)).toBeDefined();

    net.hub.setLink(a.id, b.id, false);
    await net.settle();
    // The requester's device keeps working while out of range, so its logical clock moves on.
    must(await a.core.actions.updateCapsule(incidentId, { shareDetailedLocation: true, shareSymptoms: true, levels: { [b.id]: 'authorized' } }));
    must(await a.core.actions.addReport(incidentId, REPORT, 'typed'));
    await net.settle();
    expect(stateOf(a, incidentId).claims.locationText).toMatchObject({ value: 'near the canteen', tag: 'ai_proposed' });
    // The responder has not seen the report and writes with a lower logical clock.
    must(await b.core.actions.addObservation(incidentId, OBSERVATION));
    await net.settle();
    expect(stateOf(b, incidentId).reports.map((r) => r.text)).toEqual([OBSERVATION]);

    net.hub.setLink(a.id, b.id, true);
    await net.settle();
    await a.core.actions.retryDelivery(incidentId);
    await b.core.actions.retryDelivery(incidentId);
    await net.settle();

    const state = stateOf(a, incidentId);
    const added = eventsOf(state, 'REPORT_ADDED');
    const report = added.find((e) => e.actor.deviceId === a.id);
    const observation = added.find((e) => e.actor.deviceId === b.id);
    if (!report || !observation) throw new Error('both statements should be on the owner’s device');
    expect(observation.clock.lamport).toBeLessThan(report.clock.lamport);
    expect(state.reports.map((r) => r.text)).toEqual([OBSERVATION, REPORT]);

    expect(model.seen.find((s) => s.statement === OBSERVATION)?.known).toEqual({ locationText: 'near the canteen' });
    expectDisagreementKept(a, incidentId);
    // The requester's own report is not presented as an update to itself.
    expect(a.incident(incidentId)?.updates.map((u) => u.reportId)).toEqual([reportIdOf(state, OBSERVATION)]);
  });
});

// ---- 6. questions ----------------------------------------------------------------------------------

describe('questions raised by the background analysis', () => {
  async function started() {
    const model = stubAI(readsPlace);
    const net = await make({ devices: ['a', 'b'], trust: AB, perDevice: { a: { ai: model.ai } } });
    const a = dev(net, 'a');
    const b = dev(net, 'b');
    const { incidentId } = must(await a.core.actions.sendSOS());
    await net.settle();
    must(await a.core.actions.addReport(incidentId, REPORT, 'typed'));
    await net.settle();
    const observe = async (place: (typeof PLACES)[number]) => {
      must(await b.core.actions.addObservation(incidentId, `She is ${place}.`));
      await net.settle();
    };
    const questions = () => stateOf(a, incidentId).questions.map((q) => `${q.field}/${q.origin}/${q.status}`);
    const openPerField = () => {
      const counts = new Map<string, number>();
      for (const q of stateOf(a, incidentId).questions) if (q.status === 'open') counts.set(q.field, (counts.get(q.field) ?? 0) + 1);
      return Math.max(0, ...counts.values());
    };
    return { net, a, b, incidentId, observe, questions, openPerField, model };
  }

  it('does not ask about a field the reporter already chose to skip', async () => {
    const { a, incidentId, observe, questions, model } = await started();
    must(await a.core.actions.skipClarification(incidentId, 'locationText'));
    expect(questions()).toEqual(['locationText/rule/skipped']);

    await observe('by the gym');
    await observe('at the parking lot');
    // The disagreement was seen and recorded as an assessment, but the person is not asked again.
    expect(model.callsFor('She is by the gym.')).toBe(1);
    expect(stateOf(a, incidentId).assessments.filter((x) => x.overall === 'possible_contradiction')).toHaveLength(2);
    expect(questions()).toEqual(['locationText/rule/skipped']);
    expect(eventsOf(stateOf(a, incidentId), 'CLARIFICATION_REQUESTED').filter((e) => e.payload.origin === 'ai')).toEqual([]);
  });

  it('does not ask again after the reporter skipped the question it asked', async () => {
    const { a, incidentId, observe, questions } = await started();
    await observe('by the gym');
    expect(questions()).toEqual(['locationText/ai/open']);
    must(await a.core.actions.skipClarification(incidentId, 'locationText'));
    expect(questions()).toEqual(['locationText/ai/skipped']);

    for (const place of ['at the parking lot', 'in the chapel', 'behind the main gate'] as const) await observe(place);
    expect(questions()).toEqual(['locationText/ai/skipped']);
    expect(stateOf(a, incidentId).claims.locationText).toMatchObject({ value: 'near the canteen', tag: 'ai_proposed' });
  });

  it('never has two open questions on one field', async () => {
    const { net, a, incidentId, observe, questions, openPerField } = await started();
    for (const place of ['by the gym', 'at the parking lot', 'in the chapel'] as const) {
      await observe(place);
      expect(openPerField()).toBe(1);
    }
    expect(questions()).toEqual(['locationText/ai/open']);
    expect(stateOf(a, incidentId).assessments.filter((x) => x.overall === 'possible_contradiction')).toHaveLength(3);
    // More triggers do not add one either.
    for (let i = 0; i < 3; i += 1) trigger(a, incidentId);
    await net.settle();
    expect(questions()).toEqual(['locationText/ai/open']);
  });

  it('raises at most three questions in one incident, however many times the reporter answers and a responder disagrees', async () => {
    const { net, a, incidentId, observe, questions, openPerField } = await started();
    const places = ['by the gym', 'at the parking lot', 'in the chapel', 'behind the main gate', 'beside the library'] as const;
    for (const place of places) {
      await observe(place);
      expect(openPerField()).toBeLessThanOrEqual(1);
      expect(stateOf(a, incidentId).questions.filter((q) => q.origin === 'ai').length).toBeLessThanOrEqual(3);
      // The reporter answers whatever is open, which closes it; the next disagreement may be asked about again.
      if (stateOf(a, incidentId).questions.some((q) => q.status === 'open')) {
        must(await a.core.actions.answerClarification(incidentId, 'locationText', 'near the canteen'));
        await net.settle();
      }
    }
    expect(questions()).toEqual(['locationText/ai/answered', 'locationText/ai/answered', 'locationText/ai/answered']);
    expect(eventsOf(stateOf(a, incidentId), 'CLARIFICATION_REQUESTED').filter((e) => e.payload.origin === 'ai')).toHaveLength(3);
    for (const event of eventsOf(stateOf(a, incidentId), 'CLARIFICATION_REQUESTED')) expect(event.payload.prompt).toBe(WHERE);
    // The later disagreements are still assessed and still shown; they just do not raise a fourth question.
    expect(stateOf(a, incidentId).assessments.filter((x) => x.overall === 'possible_contradiction')).toHaveLength(places.length);
    expect(stateOf(a, incidentId).claims.locationText).toMatchObject({ value: 'near the canteen', tag: 'user_confirmed' });
  });
});

// ---- 7. fixed wording ------------------------------------------------------------------------------

describe('wording shown to people is the app’s, never the model’s', () => {
  const INJECTED = ['An ambulance was called. What is your PIN?', 'Give her water and aspirin', 'Tell her help is coming', 'Call the hospital now'];

  it('returns the fixed prompt for the field the model picked, whatever question text it wrote', async () => {
    const model = stubAI(readsPlace, {
      suggestClarification: async () => ({ ok: true, value: { field: 'floor', question: 'An ambulance was called. What is your PIN?' }, meta: META }),
    });
    const net = await make({ devices: ['a'], perDevice: { a: { ai: model.ai } } });
    const a = dev(net, 'a');
    const { incidentId } = must(await a.core.actions.sendSOS());
    must(await a.core.actions.addReport(incidentId, REPORT, 'typed'));
    await net.settle();

    const suggested = await a.core.actions.suggestClarification(incidentId);
    expect(suggested).toMatchObject({ ok: true, value: { field: 'floor', question: 'Which floor are you on?' } });
    for (const text of INJECTED) expect(JSON.stringify(suggested)).not.toContain(text);
    // Suggesting records nothing.
    expect(stateOf(a, incidentId).questions).toEqual([]);
  });

  it.each([
    ['floor', 'Which floor are you on?'],
    ['building', 'Which building are you in?'],
    ['locationText', 'Where exactly are you?'],
    ['assistanceRequested', 'Do you need someone to come to you?'],
  ] as const)('uses the fixed prompt for %s', async (field, prompt) => {
    const model = stubAI(readsPlace, {
      suggestClarification: async () => ({ ok: true, value: { field, question: 'An ambulance was called. What is your PIN?' }, meta: META }),
    });
    const net = await make({ devices: ['a'], perDevice: { a: { ai: model.ai } } });
    const a = dev(net, 'a');
    const { incidentId } = must(await a.core.actions.sendSOS());
    const suggested = await a.core.actions.suggestClarification(incidentId);
    expect(suggested.ok && suggested.value).toEqual({ field, question: prompt });
  });

  it('passes a null suggestion and a failure through unchanged', async () => {
    let next: Awaited<ReturnType<LocalAIService['suggestClarification']>> = { ok: true, value: null, meta: META };
    const model = stubAI(readsPlace, { suggestClarification: async () => next });
    const net = await make({ devices: ['a'], perDevice: { a: { ai: model.ai } } });
    const a = dev(net, 'a');
    const { incidentId } = must(await a.core.actions.sendSOS());
    expect(await a.core.actions.suggestClarification(incidentId)).toMatchObject({ ok: true, value: null });
    next = { ok: false, state: 'guardrail_refusal', message: 'stub refusal', meta: META };
    must(await a.core.actions.addReport(incidentId, 'Something changed.', 'typed'));
    expect(await a.core.actions.suggestClarification(incidentId)).toMatchObject({ ok: false, state: 'guardrail_refusal' });
  });

  it('returns only fixed task titles: known kinds once each, kind "other" dropped, model titles discarded', async () => {
    const model = stubAI(readsPlace, {
      proposeNonMedicalTasks: async () => ({
        ok: true,
        value: [
          { kind: 'communicate', title: 'Give her water and aspirin' },
          { kind: 'other', title: 'Tell her help is coming' },
          { kind: 'communicate', title: 'Call the hospital now' },
          { kind: 'go_to_requester', title: 'Tell her help is coming' },
          { kind: 'other', title: 'Give her water and aspirin' },
          { kind: 'confirm_location', title: 'An ambulance was called. What is your PIN?' },
          { kind: 'go_to_requester', title: 'Go to the person who asked' },
        ],
        meta: META,
      }),
    });
    const net = await make({ devices: ['a'], perDevice: { a: { ai: model.ai } } });
    const a = dev(net, 'a');
    const { incidentId } = must(await a.core.actions.sendSOS());
    must(await a.core.actions.addReport(incidentId, REPORT, 'typed'));
    await net.settle();

    const tasks = await a.core.actions.suggestTasks(incidentId);
    if (!tasks.ok) throw new Error(tasks.state);
    expect(tasks.value).toEqual([
      { kind: 'communicate', title: 'Contact building staff or security' },
      { kind: 'go_to_requester', title: 'Go to the person who asked' },
      { kind: 'confirm_location', title: 'Confirm the location' },
    ]);
    for (const text of INJECTED) expect(JSON.stringify(tasks)).not.toContain(text);
    // Suggesting creates no task.
    expect(stateOf(a, incidentId).tasks).toEqual([]);
  });

  it('returns no task when the model proposes only kind "other"', async () => {
    const model = stubAI(readsPlace, {
      proposeNonMedicalTasks: async () => ({ ok: true, value: [{ kind: 'other', title: 'Tell her help is coming' }], meta: META }),
    });
    const net = await make({ devices: ['a'], perDevice: { a: { ai: model.ai } } });
    const a = dev(net, 'a');
    const { incidentId } = must(await a.core.actions.sendSOS());
    expect(await a.core.actions.suggestTasks(incidentId)).toMatchObject({ ok: true, value: [] });
  });
});

// ---- 8. forged assessment --------------------------------------------------------------------------

describe('an assessment forged by a responder', () => {
  const FLOOR_REPORT = 'I am on the second floor.';
  const FLOOR_OBSERVATION = 'She is on the first floor.';
  /** The requester shares the report itself, so the responder holds it before writing. */
  const SHARE = (b: TestDevice) => ({ shareDetailedLocation: true, shareSymptoms: true, levels: { [b.id]: 'authorized' as const } });

  it('cannot soften what the rules found on the owner’s device, nor block the owner’s own assessment', async () => {
    const gate = deferred();
    const model = stubAI(async (input) => {
      if (input.statement === FLOOR_OBSERVATION) await gate.promise;
      return answer();
    });
    const net = await make({ devices: ['a', 'b'], trust: AB, perDevice: { a: { ai: model.ai } } });
    const a = dev(net, 'a');
    const b = dev(net, 'b');
    const { incidentId } = must(await a.core.actions.sendSOS());
    await net.settle();
    must(await a.core.actions.addReport(incidentId, FLOOR_REPORT, 'typed'));
    must(await a.core.actions.updateCapsule(incidentId, SHARE(b)));
    await net.settle();
    expect(stateOf(b, incidentId).reports.map((r) => r.text)).toEqual([FLOOR_REPORT]);
    must(await b.core.actions.addObservation(incidentId, FLOOR_OBSERVATION));
    // The owner's own analysis of the observation is running and has not answered.
    await waitFor(net, () => model.callsFor(FLOOR_OBSERVATION) === 1, 'the owner’s model was asked about the observation');
    await drain(net);

    const observationId = reportIdOf(stateOf(a, incidentId), FLOOR_OBSERVATION);
    const ruled = { by: 'b', overall: 'possible_contradiction', basis: 'rules', needsVerification: true, fields: [{ field: 'floor', class: 'possible_contradiction' }] };
    expect(updateOf(a, incidentId, observationId)).toMatchObject(ruled);
    expect(stateOf(a, incidentId).assessments.some((x) => x.reportId === observationId)).toBe(false);

    // The responder's device writes an assessment under the very id the owner will use, saying nothing changed.
    const held = await b.repo.replay(incidentId);
    const forged = forgeEvent(
      held,
      { actor: { deviceId: b.id, userName: 'b' }, clock: net.clock, ids: createSequentialIds('forge') },
      {
        type: 'STATEMENT_ASSESSED',
        payload: { assessmentId: assessmentIdFor(observationId, 'unversioned'), reportId: observationId, provider: 'Callstack Apple', overall: 'no_meaningful_change', items: [] },
      },
    );
    await b.repo.appendEvents([forged], { origin: 'remote' });
    await b.core.engine.queueSync(b.repo, held, [forged.id]);
    await b.core.engine.flush({ incidentId, force: true });
    await waitFor(net, async () => (await b.repo.getPendingOutbox(incidentId)).length === 0, 'the forged event was delivered and acknowledged');
    await drain(net);

    // It arrived, and it counts for nothing.
    const received = stateOf(a, incidentId);
    expect(received.events.some((e) => e.id === forged.id)).toBe(true);
    expect(received.notApplied).toEqual([{ eventId: forged.id, type: 'STATEMENT_ASSESSED', actorDeviceId: b.id, code: 'not_reporter' }]);
    expect(received.assessments.filter((x) => x.recordedBy.deviceId !== a.id)).toEqual([]);
    expect(received.assessments.some((x) => x.reportId === observationId)).toBe(false);
    expect(updateOf(a, incidentId, observationId)).toMatchObject(ruled);
    expect(received.contradictions).toEqual([expect.objectContaining({ field: 'floor', status: 'open', detectedBy: 'rule' })]);
    expect(factOf(a, incidentId, 'floor')).toMatchObject({ value: null, tag: 'unresolved' });

    // The owner's own answer now comes back and is recorded under that id.
    gate.resolve();
    await net.settle();
    const after = stateOf(a, incidentId);
    const own = after.assessments.filter((x) => x.reportId === observationId);
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ id: assessmentIdFor(observationId, 'unversioned'), overall: 'possible_contradiction', recordedBy: { deviceId: a.id } });
    expect(own[0]?.items).toEqual([expect.objectContaining({ field: 'floor', class: 'possible_contradiction' })]);
    expect(updateOf(a, incidentId, observationId)).toMatchObject({ overall: 'possible_contradiction', needsVerification: true, fields: [{ field: 'floor', class: 'possible_contradiction' }] });
    expect(after.contradictions).toEqual([expect.objectContaining({ field: 'floor', status: 'open' })]);
  });

  it('keeps the rules’ class in the recorded assessment and the view when the owner’s own model says the statement is unrelated', async () => {
    // The owner's own model answers "nothing stated": the recorded assessment still carries the rules' class.
    const model = stubAI(async () => answer({ topic: 'unrelated' }));
    const net = await make({ devices: ['a', 'b'], trust: AB, perDevice: { a: { ai: model.ai } } });
    const a = dev(net, 'a');
    const b = dev(net, 'b');
    const { incidentId } = must(await a.core.actions.sendSOS());
    await net.settle();
    must(await a.core.actions.addReport(incidentId, FLOOR_REPORT, 'typed'));
    must(await a.core.actions.updateCapsule(incidentId, SHARE(b)));
    await net.settle();
    expect(stateOf(b, incidentId).reports.map((r) => r.text)).toEqual([FLOOR_REPORT]);
    must(await b.core.actions.addObservation(incidentId, FLOOR_OBSERVATION));
    await net.settle();
    const observationId = reportIdOf(stateOf(a, incidentId), FLOOR_OBSERVATION);
    expect(stateOf(a, incidentId).assessments.find((x) => x.reportId === observationId)?.overall).toBe('possible_contradiction');
    expect(updateOf(a, incidentId, observationId)).toMatchObject({ overall: 'possible_contradiction', needsVerification: true, fields: [{ field: 'floor', class: 'possible_contradiction' }] });
    // The responder's own view of that statement comes from the rules alone.
    expect(updateOf(b, incidentId, observationId)).toMatchObject({ overall: 'possible_contradiction', basis: 'rules' });
  });
});

// ---- known defect: the rules' class depends on replay position -----------------------------------------

describe('a responder names a different floor without ever having received the report', () => {
  /**
   * A responder who never received the report writes with a logical clock that ties with it, so the
   * observation can replay first. The requester's first report is the anchor every other statement is
   * compared with, whatever the replay position, so the observation is still the one that differs.
   */
  it('shows the observation as a possible contradiction on the owner’s device', async () => {
    const model = stubAI(async () => answer());
    const net = await make({ devices: ['a', 'b'], trust: AB, perDevice: { a: { ai: model.ai } } });
    const a = dev(net, 'a');
    const b = dev(net, 'b');
    const { incidentId } = must(await a.core.actions.sendSOS());
    await net.settle();
    must(await a.core.actions.addReport(incidentId, 'I am on the second floor.', 'typed'));
    await net.settle();
    must(await b.core.actions.addObservation(incidentId, 'She is on the first floor.'));
    await net.settle();

    const state = stateOf(a, incidentId);
    // These hold today: the disagreement is flagged and nothing is chosen.
    expect(state.contradictions).toEqual([expect.objectContaining({ field: 'floor', status: 'open', detectedBy: 'rule' })]);
    expect(state.claims.floor).toMatchObject({ value: null, tag: 'unresolved' });
    const observationId = reportIdOf(state, 'She is on the first floor.');
    expect(updateOf(a, incidentId, observationId)).toMatchObject({ by: 'b', needsVerification: true });
    // This does not: actual is overall 'new_information', fields [{ floor, new_information }].
    expect(updateOf(a, incidentId, observationId)).toMatchObject({ overall: 'possible_contradiction', fields: [{ field: 'floor', class: 'possible_contradiction' }] });
  });
});

// ---- 9. attribution --------------------------------------------------------------------------------

describe('who a model-read value is attributed to', () => {
  it('shows a value read from a responder’s statement as said by the responder, not by the device that ran the model', async () => {
    const model = stubAI(readsPlace);
    const net = await make({ devices: ['a', 'b'], trust: AB, perDevice: { a: { ai: model.ai } } });
    const a = dev(net, 'a');
    const b = dev(net, 'b');
    const { incidentId } = must(await a.core.actions.sendSOS());
    await net.settle();
    // The requester has said nothing about where they are: the observation is the first value for the field.
    must(await b.core.actions.addObservation(incidentId, OBSERVATION));
    await net.settle();

    const state = stateOf(a, incidentId);
    expect(model.seen.find((s) => s.statement === OBSERVATION)?.known).toEqual({});
    expect(state.claims.locationText).toMatchObject({ value: 'by the gym', tag: 'ai_proposed' });
    // The ledger says the owner's device recorded it...
    const revision = state.claims.locationText.revisions[0];
    expect(revision?.source).toMatchObject({ kind: 'ai_proposal', actor: { deviceId: a.id } });
    expect(revision?.evidence?.reportId).toBe(reportIdOf(state, OBSERVATION));
    // ...and the person reading it is told whose words they are.
    expect(factOf(a, incidentId, 'locationText')).toMatchObject({ value: 'by the gym', tag: 'ai_proposed', by: 'b', evidence: 'by the gym' });
    expect(factOf(a, incidentId, 'locationText')?.by).not.toBe('You');
    expect(state.questions).toEqual([]);
  });

  it('shows a value read from the requester’s own statement as said by the requester', async () => {
    const model = stubAI(readsPlace);
    const net = await make({ devices: ['a'], perDevice: { a: { ai: model.ai } } });
    const a = dev(net, 'a');
    const { incidentId } = must(await a.core.actions.sendSOS());
    must(await a.core.actions.addReport(incidentId, REPORT, 'typed'));
    await net.settle();
    expect(factOf(a, incidentId, 'locationText')).toMatchObject({ value: 'near the canteen', tag: 'ai_proposed', by: 'You' });
  });
});

// ---- 10. retry cap ---------------------------------------------------------------------------------

describe('a statement the model cannot assess', () => {
  const FAILING: Record<string, Assess> = {
    'answers a refusal': async () => refusal(),
    rejects: () => Promise.reject(new Error('assess rejected')),
    'throws synchronously': () => {
      throw new Error('assess exploded');
    },
  };

  it.each(Object.keys(FAILING))('is tried at most twice in a session when the model always %s', async (mode) => {
    const failing = FAILING[mode];
    if (!failing) throw new Error('fixture');
    const model = stubAI(failing);
    const net = await make({ devices: ['a', 'b'], trust: AB, perDevice: { a: { ai: model.ai } } });
    const a = dev(net, 'a');
    const b = dev(net, 'b');
    const { incidentId } = must(await a.core.actions.sendSOS());
    await net.settle();
    must(await a.core.actions.addReport(incidentId, REPORT, 'typed'));
    await net.settle();
    expect(model.callsFor(REPORT)).toBe(1);

    // Direct triggers, as each arriving packet makes.
    for (let i = 0; i < 8; i += 1) {
      trigger(a, incidentId);
      await net.settle();
    }
    expect(model.callsFor(REPORT)).toBe(2);

    // Triggers from the app's own paths: more statements from both people, an answer, a retry.
    must(await b.core.actions.addObservation(incidentId, OBSERVATION));
    await net.settle();
    must(await a.core.actions.addReport(incidentId, 'I am still waiting.', 'typed'));
    await net.settle();
    must(await a.core.actions.answerClarification(incidentId, 'floor', 'second floor'));
    await net.settle();
    must(await b.core.actions.addObservation(incidentId, 'I am on my way.'));
    await net.settle();
    for (let i = 0; i < 4; i += 1) {
      trigger(a, incidentId);
      await net.settle();
    }

    const state = stateOf(a, incidentId);
    expect(state.reports).toHaveLength(4);
    for (const report of state.reports) expect(model.callsFor(report.text)).toBeLessThanOrEqual(2);
    expect(model.callsFor(REPORT)).toBe(2);
    expect(model.seen.length).toBeLessThanOrEqual(2 * state.reports.length);
    // Nothing was recorded for any of them, and the statements themselves are all there.
    expect(state.assessments).toEqual([]);
    expect(state.aiFindings).toEqual([]);
    expect(state.questions.filter((q) => q.origin === 'ai')).toEqual([]);
  });
});

// ---- 11. cache across delete-all (core level; the guard-level test is in GuardedLocalAI.test.ts) ----

describe('deleting all incidents while a model call is in flight', () => {
  it('does not keep that call’s answer: the same words in a new incident are assessed again', async () => {
    const gate = deferred();
    let hold = true;
    const model = stubAI(async (input) => {
      if (hold) await gate.promise;
      return readsPlace(input);
    });
    const net = await make({ devices: ['a'], perDevice: { a: { ai: model.ai } } });
    const a = dev(net, 'a');
    const first = must(await a.core.actions.sendSOS());
    must(await a.core.actions.addReport(first.incidentId, REPORT, 'typed'));
    await waitFor(net, () => model.callsFor(REPORT) === 1, 'the model was asked');

    await a.core.actions.deleteAllIncidents();
    expect(a.core.getSnapshot().incidents).toEqual([]);
    hold = false;
    gate.resolve();
    await net.settle();
    // The late answer was written nowhere.
    expect(a.core.getSnapshot().incidents).toEqual([]);
    expect(await a.repo.allIncidentIds()).toEqual([]);

    const second = must(await a.core.actions.sendSOS());
    must(await a.core.actions.addReport(second.incidentId, REPORT, 'typed'));
    await net.settle();
    expect(model.callsFor(REPORT)).toBe(2);
    expect(a.core.actions.aiDiagnostics().stats.cacheHits).toBe(0);
    expect(stateOf(a, second.incidentId).claims.locationText).toMatchObject({ value: 'near the canteen', tag: 'ai_proposed' });
  });
});

// ---- 12. evaluation --------------------------------------------------------------------------------

describe('runEvaluation without an evaluation provider', () => {
  const INPUT = { split: 'development', variant: 'staged', conditions: 'synthetic test run' } as const;

  it('answers unavailable in the default harness and never calls the AI', async () => {
    const model = stubAI(readsPlace);
    const capabilities = jest.fn(async () => READY);
    const net = await make({ devices: ['a'], perDevice: { a: { ai: { ...model.ai, inspectCapabilities: capabilities } } } });
    const a = dev(net, 'a');
    capabilities.mockClear();
    const progress = jest.fn();

    for (const variant of ['rules', 'staged', 'single', 'quotes', 'nested'] as const) {
      expect(await settlesPromptly(a.core.actions.runEvaluation({ ...INPUT, variant }, progress))).toEqual({ ok: false, reason: 'unavailable' });
    }
    expect(model.calls).toEqual([]);
    expect(model.seen).toEqual([]);
    expect(capabilities).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
    expect(a.core.actions.aiDiagnostics().stats.total).toBe(0);
    expect(a.core.getSnapshot().incidents).toEqual([]);
  });

  it('answers unavailable in a Demo core and never calls the simulated AI', async () => {
    const realm = createFakeCryptoRealm();
    const ai = new SimulatedAI({ device: { model: 'Demo iPhone', osVersion: '0' }, textCapable: true });
    const core = new PulseCore({
      mode: 'demo',
      repo: createMemoryIncidentRepository(),
      ai,
      transport: createMemoryHub({ defaultLinked: true }).createTransport(),
      crypto: createFakeCapsuleCrypto(realm, 'demo-core'),
      kv: createMemoryKeyValueStore(),
      clock: new ManualClock(),
      ids: createSequentialIds('demo'),
      deviceInfo: { model: 'Demo iPhone', osVersion: '0' },
      timers: createInertTimers(),
      seed: { name: 'Alex', onboarded: true },
    });
    cores.push(core);
    await core.start();
    expect(core.getSnapshot()).toMatchObject({ mode: 'demo', capabilities: { source: 'simulated', text: { state: 'ready' } } });

    const spies = (['inspectCapabilities', 'extractIncidentReport', 'assessStatement', 'suggestClarification', 'findConflicts', 'proposeNonMedicalTasks', 'compareSemanticReports', 'transcribeLocal'] as const).map((method) => jest.spyOn(ai, method));
    expect(await settlesPromptly(core.actions.runEvaluation(INPUT))).toEqual({ ok: false, reason: 'unavailable' });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(core.actions.aiDiagnostics().stats.total).toBe(0);
  });
});
