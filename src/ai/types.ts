import { z } from 'zod';

/** Per-capability state. Capabilities are independent: never collapse them into one "AI available" flag. */
export type AIState =
  | 'ready'
  | 'unavailable'
  | 'unsupported_locale'
  | 'model_assets_missing'
  | 'guardrail_refusal'
  | 'timeout'
  | 'invalid_output'
  | 'native_error';

export type AIFailureState = Exclude<AIState, 'ready'>;

/** Where a result came from. 'simulated' may only ever be produced by the Demo Lab adapter. */
export type AISource = 'callstack-apple' | 'simulated';

export type AIMeta = { source: AISource; latencyMs: number };

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

/**
 * Everything the app may ask of on-device AI. Every method resolves (never rejects) with a typed result,
 * and none of them is on the path of creating or queueing an SOS.
 */
export interface LocalAIService {
  inspectCapabilities(): Promise<CapabilityMatrix>;
  extractIncidentReport(raw: OriginalReportInput): Promise<AIResult<IncidentProposal>>;
  suggestClarification(context: IncidentContext): Promise<AIResult<ClarificationProposal>>;
  findConflicts(statements: readonly StatementInput[]): Promise<AIResult<ConflictProposal[]>>;
  proposeNonMedicalTasks(context: IncidentContext): Promise<AIResult<TaskProposal[]>>;
  compareSemanticReports(a: string, b: string): Promise<SimilarityResult>;
  transcribeLocal(audio: LocalAudioInput, locale: string): Promise<AIResult<Transcript>>;
}
