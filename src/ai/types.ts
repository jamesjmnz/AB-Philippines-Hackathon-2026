import { z } from 'zod';

import type { StatementAssessmentInput, StatementAssessmentProposal } from './assess';

/** Per-capability state. Capabilities are independent: never collapse them into one "AI available" flag. */
export type AIState =
  | 'ready'
  | 'unavailable'
  | 'unsupported_locale'
  | 'model_assets_missing'
  | 'guardrail_refusal'
  | 'timeout'
  | 'invalid_output'
  | 'native_error'
  /** The caller's AbortSignal fired before a result was delivered. */
  | 'cancelled'
  /** The waiting queue was full and nothing in it had a lower priority. */
  | 'queue_full'
  /** The input, instructions and schema together exceed the model's context window. */
  | 'context_overflow'
  /** The call was waiting in the queue and a higher-priority call took its place. */
  | 'superseded';

export type AIFailureState = Exclude<AIState, 'ready'>;

/**
 * Where a result came from. 'simulated' may only ever be produced by the Demo Lab adapter.
 * 'none' means no provider produced it: the provider is not loaded, or the call was answered before
 * it reached one (cancelled, displaced from the queue, queue full) or after one failed to answer.
 */
export type AISource = 'callstack-apple' | 'simulated' | 'none';

export type AIMeta = {
  source: AISource;
  latencyMs: number;
  /** Time the call waited for the single generation lane before it started. */
  queuedMs?: number;
  /** The value was served from the in-memory result cache; no model ran for this call. */
  cached?: boolean;
  /** The call joined an identical call that was already queued or running. */
  deduped?: boolean;
};

/** Per-call options for the generation methods. An implementation may ignore them. */
export type AICallOptions = {
  /** Aborting resolves the call as `cancelled`. The provider cannot stop a running generation. */
  signal?: AbortSignal;
  /** Default 'interactive'. */
  priority?: 'interactive' | 'background' | 'batch';
  /** Default 'use'. 'bypass' neither reads nor writes the result cache. */
  cache?: 'use' | 'bypass';
};
export type AICallPriority = NonNullable<AICallOptions['priority']>;

export type AIResult<T> =
  | { ok: true; value: T; meta: AIMeta }
  | { ok: false; state: AIFailureState; message: string; meta: AIMeta };

export type CapabilityStatus = { state: AIState; detail?: string };

export type CapabilityMatrix = {
  provider: 'Callstack Apple' | 'Simulation';
  source: AISource;
  packageVersion: string;
  device: { model: string; osVersion: string };
  text: CapabilityStatus;
  embeddings: CapabilityStatus & { language: string; dimension?: number };
  transcription: CapabilityStatus & { locale: string };
  speech: CapabilityStatus;
};

/** Fields the model may propose. There is deliberately no severity, diagnosis, age or coordinate field. */
export const PROPOSAL_FIELDS = ['incidentType', 'building', 'floor', 'locationText', 'symptom', 'assistanceRequested'] as const;
export type ProposalField = (typeof PROPOSAL_FIELDS)[number];

/** One proposed field: the value plus the verbatim span of the original report it was taken from. */
export const proposedFieldSchema = z.strictObject({
  value: z.string().min(1).max(120),
  evidence: z.string().min(1).max(200),
});
export type ProposedField = z.infer<typeof proposedFieldSchema>;

export const incidentProposalSchema = z.strictObject({
  fields: z.partialRecord(z.enum(PROPOSAL_FIELDS), proposedFieldSchema),
  /** Fields the model returned but that failed the evidence check and were discarded. */
  dropped: z.array(z.enum(PROPOSAL_FIELDS)),
  /** Fields with no supported value. They stay unknown. */
  unknown: z.array(z.enum(PROPOSAL_FIELDS)),
});
export type IncidentProposal = z.infer<typeof incidentProposalSchema>;

export const CLARIFIABLE_FIELDS = ['floor', 'building', 'locationText', 'assistanceRequested'] as const;
export type ClarifiableField = (typeof CLARIFIABLE_FIELDS)[number];

export type ClarificationProposal = { field: ClarifiableField; question: string } | null;

export const TASK_KINDS = ['communicate', 'go_to_requester', 'confirm_location', 'other'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];
export type TaskProposal = { kind: TaskKind; title: string };

export type StatementInput = { id: string; author: string; text: string };
export type ConflictProposal = { field: 'floor' | 'building' | 'locationText'; statementIds: [string, string]; note: string };

export type IncidentContext = {
  report: string;
  /** Field values already known (confirmed or reported by a human). */
  known: Partial<Record<ProposalField, string>>;
  /** Fields the person chose to skip; never ask about these again. */
  skipped: readonly ClarifiableField[];
};

export type SimilarityResult =
  | { ok: true; similarity: number; language: string; meta: AIMeta }
  | { ok: false; state: AIFailureState; message: string; meta: AIMeta };

export type LocalAudioInput = { wavBytes: Uint8Array };
export type Transcript = { text: string; locale: string; durationSeconds: number };

export type OriginalReportInput = { text: string };

/** One line of the device probe: an output shape tried on a built-in sentence, never on user text. */
export type OutputProbeLine = { variant: string; ok: boolean; latencyMs: number; detail: string };

/**
 * Everything the app may ask of on-device AI. Every method resolves (never rejects) with a typed result,
 * and none of them is on the path of creating or queueing an SOS.
 */
export interface LocalAIService {
  inspectCapabilities(): Promise<CapabilityMatrix>;
  extractIncidentReport(raw: OriginalReportInput, options?: AICallOptions): Promise<AIResult<IncidentProposal>>;
  suggestClarification(context: IncidentContext, options?: AICallOptions): Promise<AIResult<ClarificationProposal>>;
  findConflicts(statements: readonly StatementInput[], options?: AICallOptions): Promise<AIResult<ConflictProposal[]>>;
  proposeNonMedicalTasks(context: IncidentContext, options?: AICallOptions): Promise<AIResult<TaskProposal[]>>;
  compareSemanticReports(a: string, b: string): Promise<SimilarityResult>;
  transcribeLocal(audio: LocalAudioInput, locale: string): Promise<AIResult<Transcript>>;
  /**
   * What a new statement states and how it relates to what is already known. Optional: a service
   * without it leaves the deterministic delta rules as the only answer.
   */
  assessStatement?(input: StatementAssessmentInput, options?: AICallOptions): Promise<AIResult<StatementAssessmentProposal>>;
  /** Diagnostics only, and only where a real provider is loaded: which output shapes it can produce. */
  probeOutputShapes?(): Promise<OutputProbeLine[]>;
}
