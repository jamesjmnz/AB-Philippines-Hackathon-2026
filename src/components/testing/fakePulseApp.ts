import type { AIResult, CapabilityMatrix } from '@/ai';
import { CLAIM_FIELDS, type Actor, type IncidentState } from '@/domain';
import type { AppSettings, FactView, IncidentView, PeerView, PulseActions, PulseApp, PulseSnapshot } from '@/services/api';

/** Test-only in-memory PulseApp: the snapshot is set by the test and every action is a jest.fn(). */

export const ME: Actor = { deviceId: 'dev-alex', userName: 'Alex Rivera' };

export const DEFAULT_SETTINGS: AppSettings = {
  discoveryEnabled: true,
  relayEnabled: true,
  showTechnicalDetails: false,
  sosCountdownSeconds: 5,
  reportLocale: 'en-US',
};

export function capabilities(text: CapabilityMatrix['text']['state'] = 'ready', source: CapabilityMatrix['source'] = 'callstack-apple'): CapabilityMatrix {
  return {
    provider: source === 'simulated' ? 'Simulation' : 'Callstack Apple',
    source,
    packageVersion: '0.12.0',
    device: { model: 'iPhone 16 Pro', osVersion: '26.0' },
    text: { state: text },
    embeddings: { state: 'ready', language: 'en' },
    transcription: { state: 'unsupported_locale', locale: 'fil-PH' },
    speech: { state: 'ready' },
  };
}

export function peer(actor: Actor, patch: Partial<PeerView> = {}): PeerView {
  return { deviceId: actor.deviceId, name: actor.userName, trusted: true, reach: 'connected', lastSeenMs: 1_760_000_000_000, ...patch };
}

export function makeSnapshot(patch: Partial<PulseSnapshot> = {}): PulseSnapshot {
  return {
    mode: 'live',
    ready: true,
    me: { deviceId: ME.deviceId, name: ME.userName, onboarded: true, hardwareBackedKeys: true },
    capabilities: capabilities(),
    network: { discovery: 'on', error: null },
    peers: [],
    incidents: [],
    pairing: null,
    settings: DEFAULT_SETTINGS,
    demo: null,
    ...patch,
  };
}

/** Builds the view a device would hold for a replayed ledger state. Facts come from the real claims. */
export function viewOf(state: IncidentState, me: Actor = ME, patch: Partial<IncidentView> = {}): IncidentView {
  const reporter = state.incident?.reporter.deviceId === me.deviceId;
  const nameOf = (actor: Actor) => (actor.deviceId === me.deviceId ? 'You' : actor.userName);
  const facts: FactView[] = CLAIM_FIELDS.map((field) => {
    const claim = state.claims[field];
    const shown = claim.revisions.find((r) => r.id === claim.displayedRevisionId) ?? null;
    return {
      field,
      value: claim.value,
      tag: claim.tag,
      by: shown ? nameOf(shown.source.actor) : null,
      evidence: shown?.evidence?.text ?? null,
      protected: false,
      candidates: claim.candidates.map((value) => {
        const rev = [...claim.revisions].reverse().find((r) => r.value === value && r.source.kind !== 'ai_proposal');
        return { value, by: rev ? nameOf(rev.source.actor) : 'Unknown' };
      }),
    };
  });
  const report = state.reports.find((r) => r.kind === 'report') ?? null;
  return {
    id: state.incidentId,
    shortId: 'PULSE-7F3A',
    state,
    role: reporter ? 'reporter' : 'responder',
    access: reporter ? 'owner' : 'authorized',
    facts,
    originalReport: report?.text ?? null,
    receivedViaName: null,
    pendingOutbox: 0,
    ...patch,
  };
}

const okResult = { ok: true as const, value: undefined };

function aiUnavailable<T>(): AIResult<T> {
  return { ok: false, state: 'unavailable', message: 'not configured in this test', meta: { source: 'callstack-apple', latencyMs: 0 } };
}

export type FakeActions = { [K in keyof Omit<PulseActions, 'demo'>]: jest.MockedFunction<PulseActions[K]> } & {
  demo: { [K in keyof PulseActions['demo']]: jest.MockedFunction<PulseActions['demo'][K]> };
};

export type FakePulseApp = PulseApp & { actions: FakeActions; setSnapshot(patch: Partial<PulseSnapshot>): void };

export function createFakePulseApp(initial: Partial<PulseSnapshot> = {}): FakePulseApp {
  let snapshot = makeSnapshot(initial);
  const listeners = new Set<() => void>();
  const impl: Omit<PulseActions, 'demo'> = {
    completeOnboarding: async () => undefined,
    sendSOS: async () => ({ ok: true as const, value: { incidentId: 'inc-test-0001' } }),
    addReport: async () => ({ ok: true as const, value: { reportId: 'rpt-test-0001' } }),
    analyzeReport: async () => aiUnavailable(),
    diagnoseExtraction: async () => aiUnavailable(),
    probeLocalAI: async () => [],
    runEvaluation: async () => ({ ok: false as const, reason: 'unavailable' as const }),
    attachProposal: async () => okResult,
    confirmFact: async () => okResult,
    suggestClarification: async () => aiUnavailable(),
    answerClarification: async () => okResult,
    skipClarification: async () => okResult,
    addObservation: async () => okResult,
    resolveConflict: async () => okResult,
    requestConflictClarification: async () => okResult,
    suggestTasks: async () => aiUnavailable(),
    offerTask: async () => okResult,
    acknowledge: async () => okResult,
    declineRequest: async () => okResult,
    acceptTask: async () => okResult,
    declineTask: async () => okResult,
    startTask: async () => okResult,
    reportTaskComplete: async () => okResult,
    confirmTaskComplete: async () => okResult,
    updateCapsule: async () => okResult,
    previewDisclosure: () => [],
    resolveIncident: async () => okResult,
    cancelIncident: async () => okResult,
    retryDelivery: async () => undefined,
    setDiscovery: async () => undefined,
    startPairing: async () => okResult,
    confirmPairing: async () => okResult,
    cancelPairing: async () => undefined,
    removePeer: async () => undefined,
    renamePeer: async () => undefined,
    setPeerLevel: async () => okResult,
    transcribe: async () => aiUnavailable(),
    updateSettings: async () => undefined,
    refreshCapabilities: async () => undefined,
    deleteAllIncidents: async () => undefined,
  };
  const wrapped = Object.fromEntries(Object.entries(impl).map(([key, fn]) => [key, jest.fn(fn as (...args: unknown[]) => unknown)]));
  const actions = {
    ...wrapped,
    demo: { viewAs: jest.fn(), setLink: jest.fn(), setAIReady: jest.fn(), runScenario: jest.fn(), reset: jest.fn() },
  } as unknown as FakeActions;
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    actions,
    dispose: async () => undefined,
    setSnapshot(patch) {
      snapshot = { ...snapshot, ...patch };
      listeners.forEach((l) => l());
    },
  };
}

/** Names of every action that reaches on-device AI. The SOS path must call none of them. */
export const AI_ACTIONS = ['analyzeReport', 'diagnoseExtraction', 'suggestClarification', 'suggestTasks', 'transcribe', 'refreshCapabilities'] as const;
