import { z } from 'zod';

import { AITimeoutError, classifyAIError } from '../classifyError';
import { containsMedicalJudgement, isEvidenceInReport, isUnknownValue } from '../evidence';
import {
  CLARIFIABLE_FIELDS,
  PROPOSAL_FIELDS,
  TASK_KINDS,
  type AIFailureState,
  type AIMeta,
  type AIResult,
  type CapabilityMatrix,
  type CapabilityStatus,
  type ClarifiableField,
  type ClarificationProposal,
  type ConflictProposal,
  type IncidentContext,
  type IncidentProposal,
  type LocalAIService,
  type LocalAudioInput,
  type OriginalReportInput,
  type ProposalField,
  type ProposedField,
  type SimilarityResult,
  type StatementInput,
  type TaskProposal,
  type Transcript,
} from '../types';
import {
  CLARIFICATION_SYSTEM,
  CONFLICT_SYSTEM,
  EXTRACTION_SYSTEM,
  TASK_SYSTEM,
  clarificationModelSchema,
  conflictModelSchema,
  extractionModelSchema,
  taskModelSchema,
} from './prompts';
import type { AppleRuntime } from './runtime.types';

export type AdapterOptions = {
  /** Upper bound for one text generation. The UI never waits on this to send an SOS. */
  timeoutMs?: number;
  /** Language passed to NLContextualEmbedding. Filipino is not supported by the provider; see docs/LOCAL_AI.md. */
  embeddingLanguage?: string;
  transcriptionLocale?: string;
  now?: () => number;
};

/** Reports longer than this are truncated before prompting; the model has a 4096-token window. */
const MAX_REPORT_CHARS = 1200;

const MEDICAL_TASK = /\b(first aid|cpr|treat|treatment|medic\w*|bandage|splint|tourniquet|move (him|her|them|the person)|lift|carry|diagnos\w*|pain ?killer|ice pack)\b/i;

/**
 * LocalAIService backed by Apple's on-device models through @react-native-ai/apple.
 * This class owns prompting, validation and failure typing; it never reaches the network and never throws.
 */
export class CallstackAppleAIAdapter implements LocalAIService {
  private readonly timeoutMs: number;
  private readonly embeddingLanguage: string;
  private readonly transcriptionLocale: string;
  private readonly now: () => number;

  constructor(
    private readonly runtime: AppleRuntime,
    options: AdapterOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.embeddingLanguage = options.embeddingLanguage ?? 'en';
    this.transcriptionLocale = options.transcriptionLocale ?? 'en-US';
    this.now = options.now ?? Date.now;
  }

  async inspectCapabilities(): Promise<CapabilityMatrix> {
    const text: CapabilityStatus = this.safeTextAvailable()
      ? { state: 'ready' }
      : { state: 'unavailable', detail: 'Apple Foundation Models is not available on this device or is turned off.' };

    let embeddings: CapabilityMatrix['embeddings'] = { state: 'unavailable', language: this.embeddingLanguage };
    try {
      const info = await this.runtime.embeddingInfo(this.embeddingLanguage);
      embeddings = info.hasAvailableAssets
        ? { state: 'ready', language: this.embeddingLanguage, dimension: info.dimension }
        : { state: 'model_assets_missing', language: this.embeddingLanguage, dimension: info.dimension, detail: 'Embedding assets are not downloaded yet.' };
    } catch (error) {
      const c = classifyAIError(error);
      embeddings = { state: c.state, language: this.embeddingLanguage, detail: c.message };
    }

    let transcription: CapabilityMatrix['transcription'];
    try {
      transcription = this.runtime.isTranscriptionAvailable(this.transcriptionLocale)
        ? { state: 'ready', locale: this.transcriptionLocale, detail: 'Locale assets are checked when a recording is transcribed.' }
        : { state: 'unavailable', locale: this.transcriptionLocale, detail: 'On-device transcription is not available on this device.' };
    } catch (error) {
      const c = classifyAIError(error);
      transcription = { state: c.state, locale: this.transcriptionLocale, detail: c.message };
    }

    return {
      provider: 'Callstack Apple',
      source: 'callstack-apple',
      packageVersion: this.runtime.packageVersion,
      device: this.runtime.device(),
      text,
      embeddings,
      transcription,
      speech: { state: 'ready', detail: 'System speech synthesis.' },
    };
  }

  async extractIncidentReport(raw: OriginalReportInput): Promise<AIResult<IncidentProposal>> {
    const report = raw.text.trim();
    return this.generate(EXTRACTION_SYSTEM, `Report:\n"""${clip(report)}"""`, extractionModelSchema, (output) => {
      const fields: Partial<Record<ProposalField, ProposedField>> = {};
      const dropped: ProposalField[] = [];
      const unknown: ProposalField[] = [];
      for (const name of PROPOSAL_FIELDS) {
        const candidate = output[name];
        const value = candidate.value.trim();
        const evidence = candidate.evidence.trim();
        if (isUnknownValue(value) || evidence.length === 0) {
          unknown.push(name);
          continue;
        }
        // A value survives only if the model can point at the words in the report that say it,
        // and only if it is not a medical judgement. Everything else is discarded, not shown.
        if (!isEvidenceInReport(evidence, report) || containsMedicalJudgement(value) || value.length > 120) {
          dropped.push(name);
          unknown.push(name);
          continue;
        }
        fields[name] = { value: name === 'assistanceRequested' ? normalizeYes(value) : value, evidence };
      }
      return { fields, dropped, unknown };
    });
  }

  async suggestClarification(context: IncidentContext): Promise<AIResult<ClarificationProposal>> {
    const missing = CLARIFIABLE_FIELDS.filter((f) => !context.known[f] && !context.skipped.includes(f));
    if (missing.length === 0) return { ok: true, value: null, meta: this.meta(this.now()) };
    const prompt = `Report:\n"""${clip(context.report)}"""\nAlready known: ${describeKnown(context.known)}\nMissing: ${missing.join(', ')}`;
    return this.generate(CLARIFICATION_SYSTEM, prompt, clarificationModelSchema, (output) => {
      const question = output.question.trim();
      if (output.field === 'none' || question.length === 0) return null;
      const field = output.field as ClarifiableField;
      // The model may only ask about something that is actually missing, and never a medical question.
      if (!missing.includes(field) || containsMedicalJudgement(question) || question.length > 140) return null;
      return { field, question: question.endsWith('?') ? question : `${question}?` };
    });
  }

  async findConflicts(statements: readonly StatementInput[]): Promise<AIResult<ConflictProposal[]>> {
    if (statements.length < 2) return { ok: true, value: [], meta: this.meta(this.now()) };
    const byId = new Map(statements.map((s) => [s.id, s]));
    const prompt = statements.map((s) => `[${s.id}] ${s.author}: "${clip(s.text, 300)}"`).join('\n');
    return this.generate(CONFLICT_SYSTEM, `Statements:\n${prompt}`, conflictModelSchema, (output) => {
      const seen = new Set<string>();
      const conflicts: ConflictProposal[] = [];
      for (const c of output.conflicts) {
        const a = byId.get(c.first.replace(/[[\]]/g, '').trim());
        const b = byId.get(c.second.replace(/[[\]]/g, '').trim());
        if (!a || !b || a.id === b.id) continue;
        const key = [c.field, ...[a.id, b.id].sort()].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        conflicts.push({ field: c.field, statementIds: [a.id, b.id], note: c.note.trim().slice(0, 160) });
      }
      return conflicts;
    });
  }

  async proposeNonMedicalTasks(context: IncidentContext): Promise<AIResult<TaskProposal[]>> {
    const prompt = `Report:\n"""${clip(context.report)}"""\nKnown: ${describeKnown(context.known)}`;
    return this.generate(TASK_SYSTEM, prompt, taskModelSchema, (output) => {
      const tasks: TaskProposal[] = [];
      for (const t of output.tasks) {
        const title = t.title.trim();
        if (title.length === 0 || title.length > 80) continue;
        if (!TASK_KINDS.includes(t.kind)) continue;
        if (MEDICAL_TASK.test(title) || containsMedicalJudgement(title)) continue;
        if (tasks.some((x) => x.title.toLowerCase() === title.toLowerCase())) continue;
        tasks.push({ kind: t.kind, title });
        if (tasks.length === 3) break;
      }
      return tasks;
    });
  }

  async compareSemanticReports(a: string, b: string): Promise<SimilarityResult> {
    const started = this.now();
    try {
      const [va, vb] = await this.runtime.embed([a, b], this.embeddingLanguage);
      if (!va || !vb || va.length === 0 || va.length !== vb.length) {
        return { ok: false, state: 'invalid_output', message: 'Embedding vectors were missing or mismatched.', meta: this.meta(started) };
      }
      return { ok: true, similarity: cosine(va, vb), language: this.embeddingLanguage, meta: this.meta(started) };
    } catch (error) {
      return { ok: false, ...classifyAIError(error), meta: this.meta(started) };
    }
  }

  async transcribeLocal(audio: LocalAudioInput, locale: string): Promise<AIResult<Transcript>> {
    const started = this.now();
    try {
      if (!this.runtime.isTranscriptionAvailable(locale)) {
        return this.fail('unavailable', 'On-device transcription is not available on this device.', started);
      }
      const result = await this.runtime.transcribe(audio.wavBytes, locale);
      const text = result.text.trim();
      if (text.length === 0) return this.fail('invalid_output', 'No speech was recognised in the recording.', started);
      return { ok: true, value: { text, locale, durationSeconds: result.durationSeconds }, meta: this.meta(started) };
    } catch (error) {
      const c = classifyAIError(error);
      return this.fail(c.state, c.message, started);
    }
  }

  private safeTextAvailable(): boolean {
    try {
      return this.runtime.isTextAvailable();
    } catch {
      return false;
    }
  }

  private meta(started: number): AIMeta {
    return { source: 'callstack-apple', latencyMs: Math.max(0, this.now() - started) };
  }

  private fail<T>(state: AIFailureState, message: string, started: number): AIResult<T> {
    return { ok: false, state, message, meta: this.meta(started) };
  }

  /** One guarded generation: availability check, timeout, strict re-validation, then the caller's own checks. */
  private async generate<S extends z.ZodType, T>(system: string, prompt: string, schema: S, accept: (output: z.infer<S>) => T): Promise<AIResult<T>> {
    const started = this.now();
    if (!this.safeTextAvailable()) {
      return this.fail('unavailable', 'The on-device language model is not available on this device.', started);
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const raw = await Promise.race([
        this.runtime.generateObject({ system, prompt, schema, signal: controller.signal }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new AITimeoutError(this.timeoutMs));
          }, this.timeoutMs);
        }),
      ]);
      const parsed = schema.safeParse(raw);
      if (!parsed.success) return this.fail('invalid_output', 'The model returned output that did not match the expected structure.', started);
      return { ok: true, value: accept(parsed.data), meta: this.meta(started) };
    } catch (error) {
      const c = classifyAIError(error);
      return this.fail(c.state, c.message, started);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

function clip(text: string, max = MAX_REPORT_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function describeKnown(known: IncidentContext['known']): string {
  const parts = Object.entries(known).filter(([, v]) => !!v).map(([k, v]) => `${k}=${v}`);
  return parts.length > 0 ? parts.join('; ') : 'nothing';
}

function normalizeYes(value: string): string {
  return /^(yes|oo|opo|true)\b/i.test(value.trim()) ? 'Yes' : value;
}

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}
