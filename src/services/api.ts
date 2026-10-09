import type { AIResult, CapabilityMatrix, ClarifiableField, ClarificationProposal, IncidentProposal, ProposalField, TaskKind, TaskProposal } from '@/ai';
import type { ClaimField, DisclosureLevel, IncidentState, ProvenanceTag } from '@/domain';

/**
 * The single contract between screens and everything underneath them.
 * Two implementations exist: LIVE (SQLite, Callstack Apple AI, native transport and crypto) and DEMO
 * (in-memory, scripted, clearly simulated). Screens must not import storage, AI, transport or crypto directly.
 */
export type AppMode = 'live' | 'demo';

export type PeerReach =
  /** A transport link is open right now. */
  | 'connected'
  /** Seen on the local network but no link is open. */
  | 'discovered'
  | 'unreachable';

export type PeerView = {
  deviceId: string;
  name: string;
  /** True only after both people compared and confirmed the pairing code. */
  trusted: boolean;
  reach: PeerReach;
  lastSeenMs: number | null;
};

/** One displayed incident fact. `value: null` means unknown; `protected` means this device may not read it. */
export type FactView = {
  field: ClaimField;
  value: string | null;
  tag: ProvenanceTag;
  /** Who said it, for display ("You", "Mika"). */
  by: string | null;
  /** Verbatim words from the original report backing an AI proposal. */
  evidence: string | null;
  protected: boolean;
  /** Competing values while a contradiction is open. */
  candidates: { value: string; by: string }[];
};

export type IncidentView = {
  id: string;
  /** Short human reference, e.g. "PULSE-7F3A". Never contains personal data. */
  shortId: string;
  /** Replayed ledger state as this device knows it. Status, tasks, recipients and timeline come from here. */
  state: IncidentState;
  role: 'reporter' | 'responder';
  /** What this device may read. 'relay' incidents are never listed. */
  access: 'owner' | DisclosureLevel;
  facts: FactView[];
  /** The requester's own words, or null if this device may not read them. */
  originalReport: string | null;
  /** How this incident reached this device: null when created here or received directly. */
  receivedViaName: string | null;
  pendingOutbox: number;
};

export type DiscoveryState = 'off' | 'starting' | 'on' | 'permission_denied' | 'error';

export type PairingSession = {
  peerDeviceId: string;
  peerName: string;
  /** Six digits both people must see on both phones before confirming. */
  code: string;
  /** 'awaiting_peer' = we confirmed, the other person has not yet. */
  stage: 'compare' | 'awaiting_peer' | 'failed';
  error: string | null;
};

export type AppSettings = {
  discoveryEnabled: boolean;
  relayEnabled: boolean;
  showTechnicalDetails: boolean;
  sosCountdownSeconds: number;
  reportLocale: string;
};

export type PulseSnapshot = {
  mode: AppMode;
  /** False until storage and identity are loaded. Screens show a neutral loading state, never fake data. */
  ready: boolean;
  me: { deviceId: string; name: string; onboarded: boolean; hardwareBackedKeys: boolean | null };
  /** Per-capability on-device AI status. In demo mode `source` is 'simulated'. */
  capabilities: CapabilityMatrix | null;
  network: { discovery: DiscoveryState; error: string | null };
  peers: PeerView[];
  incidents: IncidentView[];
  pairing: PairingSession | null;
  settings: AppSettings;
  /** Demo-only state. Null in live mode. */
  demo: DemoState | null;
};

export type DemoDevice = 'alex' | 'mika' | 'noah';

export type DemoState = {
  viewingAs: DemoDevice;
  aiReady: boolean;
  links: Record<Exclude<DemoDevice, 'alex'>, boolean>;
  runningScenario: string | null;
  scenarios: { key: string; title: string; description: string }[];
};

export type ActionResult<T = void> = { ok: true; value: T } | { ok: false; code: string; message: string };

export type RecipientPolicyInput = {
  shareDetailedLocation: boolean;
  shareSymptoms: boolean;
  levels: Record<string, DisclosureLevel | 'off'>;
};

export interface PulseActions {
  completeOnboarding(input: { name: string }): Promise<void>;

  /**
   * Persists the incident and queues it for every trusted peer, then returns.
   * Must never wait for AI, microphone, permissions or the radio.
   */
  sendSOS(input?: { incidentType?: string }): Promise<ActionResult<{ incidentId: string }>>;

  addReport(incidentId: string, text: string, inputMode: 'typed' | 'transcribed'): Promise<ActionResult<{ reportId: string }>>;
  /** Runs on-device extraction for a stored report. The result is a proposal; nothing is recorded as fact. */
  analyzeReport(incidentId: string, reportId: string): Promise<AIResult<IncidentProposal>>;
  /** Records the proposal in the ledger as AI-proposed claims. */
  attachProposal(incidentId: string, reportId: string, proposal: IncidentProposal): Promise<ActionResult>;
  /** A human confirms (optionally editing) one proposed or reported field. */
  confirmFact(incidentId: string, field: ProposalField, value: string): Promise<ActionResult>;

  suggestClarification(incidentId: string): Promise<AIResult<ClarificationProposal>>;
  answerClarification(incidentId: string, field: ClarifiableField, answer: string): Promise<ActionResult>;
  skipClarification(incidentId: string, field: ClarifiableField): Promise<ActionResult>;

  addObservation(incidentId: string, text: string): Promise<ActionResult>;
  /** Reporter only. Keeps both statements in history. */
  resolveConflict(incidentId: string, conflictId: string, value: string): Promise<ActionResult>;
  requestConflictClarification(incidentId: string, conflictId: string): Promise<ActionResult>;

  suggestTasks(incidentId: string): Promise<AIResult<TaskProposal[]>>;
  offerTask(incidentId: string, input: { kind: TaskKind; title: string; toDeviceId?: string; aiSuggested?: boolean }): Promise<ActionResult>;

  /** Responder: "I have seen this". Distinct from taking a task. */
  acknowledge(incidentId: string): Promise<ActionResult>;
  declineRequest(incidentId: string): Promise<ActionResult>;
  acceptTask(incidentId: string, taskId: string): Promise<ActionResult>;
  declineTask(incidentId: string, taskId: string): Promise<ActionResult>;
  startTask(incidentId: string, taskId: string, note?: string): Promise<ActionResult>;
  reportTaskComplete(incidentId: string, taskId: string, note?: string): Promise<ActionResult>;
  /** Reporter only. */
  confirmTaskComplete(incidentId: string, taskId: string): Promise<ActionResult>;

  /** Reviews recipients and disclosure, encrypts and queues a capsule update. */
  updateCapsule(incidentId: string, policy: RecipientPolicyInput): Promise<ActionResult>;
  /** What a given level would be able to read, computed by the same deterministic projection used for encryption. */
  previewDisclosure(incidentId: string, level: DisclosureLevel, policy: RecipientPolicyInput): FactView[];

  resolveIncident(incidentId: string, note?: string): Promise<ActionResult>;
  cancelIncident(incidentId: string): Promise<ActionResult>;
  retryDelivery(incidentId?: string): Promise<void>;

  setDiscovery(enabled: boolean): Promise<void>;
  startPairing(peerDeviceId: string): Promise<ActionResult>;
  confirmPairing(): Promise<ActionResult>;
  cancelPairing(): Promise<void>;
  removePeer(peerDeviceId: string): Promise<void>;
  renamePeer(peerDeviceId: string, name: string): Promise<void>;

  /** On-device transcription of a recorded WAV file. Returns unsupported_locale etc. rather than throwing. */
  transcribe(wavFileUri: string, locale: string): Promise<AIResult<{ text: string }>>;

  updateSettings(patch: Partial<AppSettings>): Promise<void>;
  refreshCapabilities(): Promise<void>;
  /** Deletes all incidents on this device. Does not touch identity or pairings. */
  deleteAllIncidents(): Promise<void>;

  /** Demo Lab only; no-ops in live mode. */
  demo: {
    viewAs(device: DemoDevice): void;
    setLink(device: Exclude<DemoDevice, 'alex'>, connected: boolean): void;
    setAIReady(ready: boolean): void;
    runScenario(key: string): void;
    reset(): void;
  };
}

export interface PulseApp {
  getSnapshot(): PulseSnapshot;
  subscribe(listener: () => void): () => void;
  actions: PulseActions;
  dispose(): Promise<void>;
}
