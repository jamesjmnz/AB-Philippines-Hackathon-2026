import type {
  AIMeta,
  AIResult,
  CapabilityMatrix,
  ClarificationProposal,
  ConflictProposal,
  IncidentContext,
  IncidentProposal,
  LocalAIService,
  LocalAudioInput,
  OriginalReportInput,
  ProposalField,
  ProposedField,
  FieldRelation,
  RelatedField,
  SimilarityResult,
  StatementAssessmentInput,
  StatementAssessmentProposal,
  StatementInput,
  TaskProposal,
  Transcript,
} from '@/ai';
import { PROPOSAL_FIELDS, RELATED_FIELDS } from '@/ai';
import type { Timers } from '@/sync/types';

import { SAMPLE_REPORT } from './personas';

/**
 * SIMULATED on-device AI for the Demo Lab. No model runs: extraction is the keyword matching from
 * the design prototype. Every result carries `source: 'simulated'` and a latency of 0, because a
 * simulated call has no measured latency to report.
 *
 * `assessStatement` follows the same approach: keyword extraction on the new statement, and word overlap
 * for how a free-text detail relates to what is already known.
 *
 * It keeps the product rules the real adapter keeps: a value is proposed only with the verbatim
 * words that back it, a floor is never invented, and there is no severity or diagnosis.
 */

export interface SimulatedAIOptions {
  device: { model: string; osVersion: string };
  /** Whether this simulated phone can run the text model at all. */
  textCapable: boolean;
  /** Artificial thinking time per call. 0 in tests. */
  delayMs?: number;
  timers?: Timers;
}

const META: AIMeta = { source: 'simulated', latencyMs: 0 };

type Hit = { value: string; evidence: string };

function match(text: string, re: RegExp): string | null {
  const m = re.exec(text);
  return m && m[0].trim().length > 0 ? m[0].trim().slice(0, 200) : null;
}

/** Port of the design's `floorOf`: a floor is reported only when the text names one. */
export function simulatedFloor(text: string): Hit | null {
  const table: [RegExp, string][] = [
    [/\bground\s+floor\b/i, 'Ground floor'],
    [/\b(?:first|1st)\s+floor\b|\bunang\s+palapag\b/i, 'First floor'],
    [/\b(?:second|2nd)\s+floor\b|\bikalawa\w*(?:\s+na)?\s+palapag\b/i, 'Second floor'],
    [/\b(?:third|3rd)\s+floor\b|\bikatlo\w*(?:\s+na)?\s+palapag\b/i, 'Third floor'],
  ];
  for (const [re, value] of table) {
    const evidence = match(text, re);
    if (evidence) return { value, evidence };
  }
  const generic = /\b([a-z0-9]+)\s+floor\b/i.exec(text);
  if (generic && generic[1] && !/^(the|a|this|that|which|what|same|my|your|on|one)$/i.test(generic[1])) {
    const word = generic[1];
    return { value: `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()} floor`, evidence: generic[0] };
  }
  return null;
}

/** Port of the design's `extract()`, minus its severity field. */
export function simulatedExtract(text: string): IncidentProposal {
  const fields: Partial<Record<ProposalField, ProposedField>> = {};
  const put = (field: ProposalField, value: string, evidence: string | null) => {
    if (evidence) fields[field] = { value, evidence };
  };

  put('incidentType', 'Possible slip or fall', match(text, /nadulas[^.]*?hagdan|nadulas|natumba|slipped|slip|fell|fall/i));
  const building = /\bbuilding\s+([a-z0-9]+)\b/i.exec(text);
  if (building && building[1]) put('building', `Building ${building[1].toUpperCase()}`, building[0]);
  const floor = simulatedFloor(text);
  if (floor) put('floor', floor.value, floor.evidence);
  const symptom = match(text, /masakit[^.]*|(?:leg|foot)[^.]*(?:pain|hurts?)|pain[^.]*|hurts?[^.]*|sakit[^.]*/i);
  if (symptom) put('symptom', /paa|leg|foot/i.test(text) ? 'Leg pain' : 'Pain', symptom);
  put('assistanceRequested', 'Yes', match(text, /kailangan ko ng tulong|need help|tulong|help|assist\w*/i));

  return { fields, dropped: [], unknown: PROPOSAL_FIELDS.filter((f) => fields[f] === undefined) };
}

function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1));
}

/** Lower case, letters and digits only, single spaces: the form two phrases are compared in. */
function normalisePhrase(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const FILLER_WORDS = new Set([
  ...'a an the of on in at to for from with by and or is are was were be am i im my me we our you your he she it its they them this that there here very some has have had do does did not no possible'.split(' '),
  ...'ang ng sa na at ay mga si ni kay ko mo ako ka siya kami tayo sila po ho lang din rin may nasa yung ito iyan iyon dito diyan doon pa ba kasi para'.split(' '),
]);

function contentWords(phrase: string): string[] {
  return normalisePhrase(phrase)
    .split(' ')
    .filter((word) => word.length > 1 && !FILLER_WORDS.has(word));
}

const RELATION_RANK: Record<FieldRelation, number> = { different: 0, adds_detail: 1, same: 2 };

/**
 * How two free-text phrases relate, by words alone: 'same' when they are equal or one holds the other
 * as whole words, 'adds_detail' when they share a content word, otherwise 'different'.
 */
export function simulatedRelation(known: string, stated: string): FieldRelation {
  const a = normalisePhrase(known);
  const b = normalisePhrase(stated);
  if (a.length === 0 || b.length === 0) return 'different';
  if (a === b || ` ${a} `.includes(` ${b} `) || ` ${b} `.includes(` ${a} `)) return 'same';
  const words = new Set(contentWords(a));
  return contentWords(b).some((word) => words.has(word)) ? 'adds_detail' : 'different';
}

/** Words that make a message about the request even when nothing structured can be read from it. */
const REQUEST_WORDS =
  /\b(?:help\w*|tulong|tulungan|saklolo|sos|floor|palapag|building|stairs|hagdan|here|dito|there|doon|hurry|bilis\w*|where|saan|nasaan|coming|papunta|parating|wait|sandali|okay|ok|safe|ligtas)\b/i;

/**
 * Keyword stand-in for the model stage of the delta pipeline: what the statement states (the same
 * matching as `simulatedExtract`) and how its free-text details relate to what is already known.
 * Floor and building are never related here; the deterministic rules own those.
 */
export function simulatedAssess(input: StatementAssessmentInput): StatementAssessmentProposal {
  const statement = typeof input?.statement === 'string' ? input.statement : '';
  const known = input?.known ?? {};
  const extracted = simulatedExtract(statement);

  const relations: Partial<Record<RelatedField, FieldRelation>> = {};
  for (const field of RELATED_FIELDS) {
    const stated = extracted.fields[field];
    const prior = known[field];
    if (!stated || typeof prior !== 'string' || prior.trim().length === 0) continue;
    // The proposed value is a fixed label and the evidence is the person's own words: the closer of the two counts.
    const byValue = simulatedRelation(prior, stated.value);
    const byEvidence = simulatedRelation(prior, stated.evidence);
    relations[field] = RELATION_RANK[byValue] >= RELATION_RANK[byEvidence] ? byValue : byEvidence;
  }

  const nothingStated = Object.keys(extracted.fields).length === 0;
  return {
    ...extracted,
    relations,
    topic: nothingStated && !REQUEST_WORDS.test(statement) ? 'unrelated' : 'about_request',
    relationCall: Object.keys(relations).length > 0 ? 'ready' : 'skipped',
    // One simulated call, and a simulated call has no measured latency.
    latenciesMs: [0],
  };
}

export class SimulatedAI implements LocalAIService {
  private ready: boolean;
  private delayMs: number;

  constructor(private readonly options: SimulatedAIOptions) {
    this.ready = options.textCapable;
    this.delayMs = options.delayMs ?? 0;
  }

  /** Demo Lab switch. A phone that cannot run the text model stays unavailable whatever is asked. */
  setReady(ready: boolean): void {
    this.ready = ready && this.options.textCapable;
  }

  setDelay(delayMs: number): void {
    this.delayMs = Math.max(0, delayMs);
  }

  private async think(): Promise<void> {
    const timers = this.options.timers;
    if (this.delayMs <= 0 || !timers) return;
    await new Promise<void>((resolve) => {
      timers.setTimeout(resolve, this.delayMs);
    });
  }

  private async text<T>(produce: () => T): Promise<AIResult<T>> {
    await this.think();
    if (!this.ready) {
      return { ok: false, state: 'unavailable', message: 'Simulated: the text model is not available on this device.', meta: META };
    }
    try {
      return { ok: true, value: produce(), meta: META };
    } catch {
      return { ok: false, state: 'native_error', message: 'Simulated: the call could not be completed.', meta: META };
    }
  }

  async inspectCapabilities(): Promise<CapabilityMatrix> {
    return {
      provider: 'Simulation',
      source: 'simulated',
      packageVersion: 'simulated',
      device: { ...this.options.device },
      text: this.ready ? { state: 'ready', detail: 'Simulated.' } : { state: 'unavailable', detail: 'Simulated: no text model on this device.' },
      embeddings: { state: 'ready', language: 'en', detail: 'Simulated.' },
      transcription: { state: 'ready', locale: 'en-US', detail: 'Simulated.' },
      speech: { state: 'ready', detail: 'Simulated.' },
    };
  }

  extractIncidentReport(raw: OriginalReportInput): Promise<AIResult<IncidentProposal>> {
    return this.text(() => simulatedExtract(raw.text));
  }

  assessStatement(input: StatementAssessmentInput): Promise<AIResult<StatementAssessmentProposal>> {
    return this.text(() => simulatedAssess(input));
  }

  suggestClarification(context: IncidentContext): Promise<AIResult<ClarificationProposal>> {
    return this.text<ClarificationProposal>(() => {
      const missing = (field: 'floor' | 'building') => context.known[field] === undefined && !context.skipped.includes(field);
      if (missing('floor')) return { field: 'floor', question: 'Which floor are you on?' };
      if (missing('building')) return { field: 'building', question: 'Which building are you in?' };
      return null;
    });
  }

  findConflicts(statements: readonly StatementInput[]): Promise<AIResult<ConflictProposal[]>> {
    return this.text(() => {
      const floors = statements.flatMap((s) => {
        const hit = simulatedFloor(s.text);
        return hit ? [{ id: s.id, value: hit.value }] : [];
      });
      const out: ConflictProposal[] = [];
      for (let i = 0; i < floors.length; i += 1) {
        for (let j = i + 1; j < floors.length; j += 1) {
          const a = floors[i];
          const b = floors[j];
          if (a && b && a.value !== b.value) {
            out.push({ field: 'floor', statementIds: [a.id, b.id], note: 'These statements name different floors.' });
            return out;
          }
        }
      }
      return out;
    });
  }

  proposeNonMedicalTasks(_context: IncidentContext): Promise<AIResult<TaskProposal[]>> {
    return this.text<TaskProposal[]>(() => [
      { kind: 'communicate', title: 'Communicate with staff' },
      { kind: 'go_to_requester', title: 'Go to the requester' },
      { kind: 'confirm_location', title: 'Confirm location' },
    ]);
  }

  async compareSemanticReports(a: string, b: string): Promise<SimilarityResult> {
    await this.think();
    const ta = tokens(a);
    const tb = tokens(b);
    const shared = [...ta].filter((t) => tb.has(t)).length;
    const union = new Set([...ta, ...tb]).size;
    return { ok: true, similarity: union === 0 ? 0 : shared / union, language: 'en', meta: META };
  }

  async transcribeLocal(_audio: LocalAudioInput, locale: string): Promise<AIResult<Transcript>> {
    await this.think();
    // There is no audio in the Demo Lab; the scripted sample stands in for the recording.
    return { ok: true, value: { text: SAMPLE_REPORT, locale, durationSeconds: 0 }, meta: META };
  }
}
