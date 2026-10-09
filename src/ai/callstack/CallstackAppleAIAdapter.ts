import { z } from 'zod';

import { AITimeoutError, classifyAIError } from '../classifyError';
import { RELATED_FIELDS, type AssessmentVariant, type FieldRelation, type RelatedField, type StatementAssessmentInput, type StatementAssessmentProposal } from '../assess';
import { containsMedicalJudgement, isUnknownValue, locateEvidence } from '../evidence';
import { extractFloors } from '@/domain/rules';

import { groundValue } from '../grounding';
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
  type OutputProbeLine,
  type ProposalField,
  type ProposedField,
  type SimilarityResult,
  type StatementInput,
  type TaskProposal,
  type Transcript,
} from '../types';
import {
  CLARIFICATION_SYSTEM,
  COMBINED_SYSTEM,
  CONFLICT_SYSTEM,
  EXTRACTION_SYSTEM,
  QUOTE_KEYS,
  QUOTE_SYSTEM,
  RELATION_SYSTEM,
  TASK_SYSTEM,
  clarificationModelSchema,
  combinedModelSchema,
  conflictModelSchema,
  extractionModelSchema,
  fenceReport,
  quoteModelSchema,
  relationModelSchema,
  taskModelSchema,
  type ExtractionVariant,
  type Relation,
} from './prompts';
import type { AppleRuntime } from './runtime.types';

export type AdapterOptions = {
  /** Upper bound for one text generation. The UI never waits on this to send an SOS. */
  timeoutMs?: number;
  /** Language passed to NLContextualEmbedding. Filipino is not supported by the provider; see docs/LOCAL_AI.md. */
  embeddingLanguage?: string;
  transcriptionLocale?: string;
  now?: () => number;
  /** Output shape asked of the model for extraction. 'quotes' unless an experiment says otherwise. */
  extraction?: ExtractionVariant;
  /** How a new statement is assessed: phrases then a comparison call, or one combined call. */
  assessment?: AssessmentVariant;
  /** Device probe for the diagnostics screen. Injected so the adapter itself never imports the provider. */
  probe?: () => Promise<OutputProbeLine[]>;
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
  private readonly extraction: ExtractionVariant;
  private readonly assessment: AssessmentVariant;

  constructor(
    private readonly runtime: AppleRuntime,
    options: AdapterOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.embeddingLanguage = options.embeddingLanguage ?? 'en';
    this.transcriptionLocale = options.transcriptionLocale ?? 'en-US';
    this.now = options.now ?? Date.now;
    this.extraction = options.extraction ?? 'quotes';
    this.assessment = options.assessment ?? 'staged';
    if (options.probe) this.probeOutputShapes = options.probe;
  }

  probeOutputShapes?: () => Promise<OutputProbeLine[]>;

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
    if (this.extraction === 'nested') {
      return this.generate(EXTRACTION_SYSTEM, fenceReport(clip(report)), extractionModelSchema, (output) =>
        collectFields(report, (name) => ({ value: output[name].value, quote: output[name].evidence })),
      );
    }
    return this.generate(QUOTE_SYSTEM, fenceReport(clip(report)), quoteModelSchema, (output) => fieldsFromQuotes(report, output));
  }

  /**
   * What a new statement states and how it relates to what is known. Never throws. A failed comparison
   * call does not discard the phrases already extracted: it is reported in `relationCall`.
   */
  async assessStatement(input: StatementAssessmentInput): Promise<AIResult<StatementAssessmentProposal>> {
    const statement = input.statement.trim();
    const known = describeKnownDetails(input.known);
    const prompt = `Known details:\n${known}\n${fenceReport(clip(statement)).replace(/report>/g, 'statement>')}`;

    if (this.assessment === 'single') {
      return this.generate(COMBINED_SYSTEM, prompt, combinedModelSchema, (output) => {
        const extracted = fieldsFromQuotes(statement, output);
        const stated = Object.keys(extracted.fields).length > 0;
        return {
          ...extracted,
          relations: keepRelations(extracted.fields, input.known, { locationText: output.placeRelation, incidentType: output.incidentRelation, symptom: output.feelingRelation }),
          topic: !stated && output.topic === 'unrelated' ? ('unrelated' as const) : ('about_request' as const),
          relationCall: 'ready' as const,
          latenciesMs: [],
        };
      }).then(withLatency);
    }

    const first = await this.generate(QUOTE_SYSTEM.replace('<report> and </report>', '<statement> and </statement>'), prompt.slice(prompt.indexOf('<statement>')), quoteModelSchema, (output) =>
      fieldsFromQuotes(statement, output),
    );
    if (!first.ok) return first;
    const extracted = first.value;
    const stated = Object.keys(extracted.fields).length > 0;
    const comparable = RELATED_FIELDS.filter((f) => extracted.fields[f] !== undefined && !!input.known[f]);
    // Code settles everything else: a comparison is asked only for free-text details that exist on
    // both sides, or to tell an unrelated message from one that merely adds nothing.
    if (stated && comparable.length === 0) {
      return { ok: true, value: { ...extracted, relations: {}, topic: 'about_request', relationCall: 'skipped', latenciesMs: [first.meta.latencyMs] }, meta: first.meta };
    }
    const second = await this.generate(RELATION_SYSTEM, prompt, relationModelSchema, (output) => output);
    const meta: AIMeta = { ...first.meta, latencyMs: first.meta.latencyMs + second.meta.latencyMs };
    const latenciesMs = [first.meta.latencyMs, second.meta.latencyMs];
    if (!second.ok) {
      return { ok: true, value: { ...extracted, relations: {}, topic: 'about_request', relationCall: second.state, latenciesMs }, meta };
    }
    const out = second.value;
    return {
      ok: true,
      value: {
        ...extracted,
        relations: keepRelations(extracted.fields, input.known, { locationText: out.place, incidentType: out.incident, symptom: out.feeling }),
        topic: !stated && out.topic === 'unrelated' ? 'unrelated' : 'about_request',
        relationCall: 'ready',
        latenciesMs,
      },
      meta,
    };
  }

  async suggestClarification(context: IncidentContext): Promise<AIResult<ClarificationProposal>> {
    const missing = CLARIFIABLE_FIELDS.filter((f) => !context.known[f] && !context.skipped.includes(f));
    if (missing.length === 0) return { ok: true, value: null, meta: this.meta(this.now()) };
    const prompt = `${fenceReport(clip(context.report))}\nAlready known: ${describeKnown(context.known)}\nMissing: ${missing.join(', ')}`;
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
    const prompt = `${fenceReport(clip(context.report))}\nKnown: ${describeKnown(context.known)}`;
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
      // Guided generation cannot add keys, but nothing else may either: an unexpected key fails the call.
      const strict: z.ZodType = schema instanceof z.ZodObject ? schema.strict() : schema;
      const parsed = strict.safeParse(raw);
      if (!parsed.success) return this.fail('invalid_output', 'The model returned output that did not match the expected structure.', started);
      return { ok: true, value: accept(parsed.data as z.infer<S>), meta: this.meta(started) };
    } catch (error) {
      const c = classifyAIError(error);
      return this.fail(c.state, c.message, started);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

type Extracted = Pick<IncidentProposal, 'fields' | 'dropped' | 'unknown'>;

/** A single-call assessment has exactly one generation: its own. */
function withLatency(result: AIResult<StatementAssessmentProposal>): AIResult<StatementAssessmentProposal> {
  return result.ok ? { ...result, value: { ...result.value, latenciesMs: [result.meta.latencyMs] } } : result;
}

/** A negation in the few words before a place name ("hindi ako sa Building A"), within the same clause. */
const NEGATED_BEFORE = /(?:\bnot|n['’]t|\bnever|\bno longer|\bhindi|\bhinde|\bdi|\bwala(?:ng)?)\s+(?:[^\s.,;:!?]+\s+){0,3}$/i;

/**
 * Turns what the model returned for each field into a proposal. A field survives only if its quote is
 * found in the original text, the value follows from the quote, the text does not negate it, and it is
 * not a medical or severity judgement. The stored evidence is the original's exact substring.
 */
function collectFields(report: string, read: (name: ProposalField) => { value: string; quote: string }): Extracted {
  const fields: Partial<Record<ProposalField, ProposedField>> = {};
  const dropped: ProposalField[] = [];
  const unknown: ProposalField[] = [];
  for (const name of PROPOSAL_FIELDS) {
    const candidate = read(name);
    const value = candidate.value.trim();
    const quote = candidate.quote.trim();
    if (isUnknownValue(value) || isUnknownValue(quote)) {
      unknown.push(name);
      continue;
    }
    const span = locateEvidence(report, quote);
    // When the model only copied a phrase, the value is the report's own words, not the model's re-typing of them.
    const grounded = span ? groundValue(name, value === quote ? span.text : value, span.text) : null;
    // A floor is the detail most dangerous to get wrong: it must be something the rules read as a floor.
    const unreadableFloor = name === 'floor' && span !== null && extractFloors(span.text).length === 0;
    const negated = span !== null && (name === 'floor' || name === 'building') && NEGATED_BEFORE.test(report.slice(0, span.start));
    if (!span || !grounded?.ok || negated || unreadableFloor || span.text.length > 200) {
      dropped.push(name);
      unknown.push(name);
      continue;
    }
    fields[name] = { value: grounded.value, evidence: span.text };
  }
  // A "place detail" that only repeats the building or floor, or the incident phrase, adds nothing.
  const place = fields.locationText;
  if (place && [fields.building, fields.floor, fields.incidentType].some((other) => other && other.evidence.toLowerCase() === place.evidence.toLowerCase())) {
    delete fields.locationText;
    unknown.push('locationText');
  }
  return { fields, dropped, unknown };
}

/** Quote-only output: the value is the person's own phrase, canonicalised by the rules for floor and building. */
function fieldsFromQuotes(report: string, output: Record<(typeof QUOTE_KEYS)[ProposalField], string>): Extracted {
  return collectFields(report, (name) => {
    const quote = output[QUOTE_KEYS[name]];
    return { value: quote, quote };
  });
}

function describeKnownDetails(known: StatementAssessmentInput['known']): string {
  const line = (label: string, value: string | undefined) => `${label}: ${value ? `"${clip(value, 120)}"` : '(not known)'}`;
  return [line('place', known.locationText), line('what happened', known.incidentType), line('feeling', known.symptom)].join('\n');
}

/** A relation counts only where the statement states the detail and something is already known about it. */
function keepRelations(
  fields: Extracted['fields'],
  known: StatementAssessmentInput['known'],
  relations: Record<RelatedField, Relation>,
): Partial<Record<RelatedField, FieldRelation>> {
  const kept: Partial<Record<RelatedField, FieldRelation>> = {};
  for (const name of RELATED_FIELDS) {
    const relation = relations[name];
    if (fields[name] && known[name] && relation !== 'not_mentioned') kept[name] = relation;
  }
  return kept;
}

function clip(text: string, max = MAX_REPORT_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function describeKnown(known: IncidentContext['known']): string {
  const parts = Object.entries(known).filter(([, v]) => !!v).map(([k, v]) => `${k}=${v}`);
  return parts.length > 0 ? parts.join('; ') : 'nothing';
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
