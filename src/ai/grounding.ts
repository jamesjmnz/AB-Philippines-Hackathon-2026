import { extractBuildings, extractFloors } from '@/domain/rules';

import { containsMedicalJudgement, normalizeForMatch } from './evidence';
import type { ProposalField } from './types';

/**
 * Whether a proposed value follows from the words quoted as its evidence. Deterministic, no model.
 * This is the second check after `locateEvidence`: that one proves the quote is in the report, this one
 * proves the value says what the quote says.
 */
export type Grounding =
  | { ok: true; value: string }
  | { ok: false; reason: 'value_not_in_quote' | 'negated' | 'medical_or_severity' | 'too_long' };

export const MAX_GROUNDED_VALUE_CHARS = 120;

const NEGATION_WORD = /\bnot\b|n['’]t\b|\bnever\b|\bhindi\b|\bhinde\b|\bdi\b|\bwala(?:ng)?\b/gi;
/** A negation up to three words before a mention, without crossing a clause boundary. */
const NEGATED_BEFORE = /(?:\bnot|n['’]t|\bnever|\bhindi|\bhinde|\bdi|\bwala(?:ng)?)\s+(?:[^\s.,;:!?]+\s+){0,3}$/i;

/** Same-length masking, so the domain extractor (which skips negated floors) reports every mention at its real offset. */
function maskNegations(text: string): string {
  return text.replace(NEGATION_WORD, (word) => 'x'.repeat(word.length));
}

type Mention = { key: string; label: string; negated: boolean };

function floorMentions(text: string): Mention[] {
  return extractFloors(maskNegations(text)).map((m) => ({
    key: String(m.level),
    label: m.value,
    negated: NEGATED_BEFORE.test(text.slice(0, m.span.start)),
  }));
}

function buildingMentions(text: string): Mention[] {
  return extractBuildings(text).map((m) => ({
    key: m.value,
    label: m.value,
    negated: NEGATED_BEFORE.test(text.slice(0, m.span.start)),
  }));
}

/** What the value itself names. A bare "2nd", "second" or "B" is read as a floor or building name. */
function valueMentions(field: 'floor' | 'building', value: string): Mention[] {
  if (field === 'floor') {
    const direct = floorMentions(value);
    if (direct.length > 0) return direct;
    if (/^\d{1,3}$/.test(value)) return floorMentions(`floor ${value}`);
    if (/^[\p{L}\p{N}-]+$/u.test(value)) return floorMentions(`${value} floor`);
    return [];
  }
  const direct = buildingMentions(value);
  if (direct.length > 0) return direct;
  return /^[A-Za-z0-9]{1,4}$/.test(value) ? buildingMentions(`Building ${value}`) : [];
}

function groundLocation(field: 'floor' | 'building', value: string, quote: string): Grounding {
  const named = valueMentions(field, value);
  const first = named[0];
  if (!first || named.some((m) => m.key !== first.key)) {
    // A floor is the detail most dangerous to get wrong: it must be something the rules read as one floor.
    if (field === 'floor') return { ok: false, reason: 'value_not_in_quote' };
    // A building may go by a name the rules do not read ("Science Hall"). It is accepted only when
    // the quote says those same words, un-negated.
    return groundVerbatim(value, quote);
  }
  const inQuote = (field === 'floor' ? floorMentions(quote) : buildingMentions(quote)).filter((m) => m.key === first.key);
  if (inQuote.length === 0) return { ok: false, reason: 'value_not_in_quote' };
  if (inQuote.every((m) => m.negated)) return { ok: false, reason: 'negated' };
  return { ok: true, value: first.label };
}

function groundVerbatim(value: string, quote: string): Grounding {
  const haystack = normalizeForMatch(quote);
  const at = haystack.indexOf(normalizeForMatch(value));
  if (at < 0) return { ok: false, reason: 'value_not_in_quote' };
  if (NEGATED_BEFORE.test(haystack.slice(0, at))) return { ok: false, reason: 'negated' };
  return { ok: true, value };
}

const HELP_REQUEST =
  /\b(?:help(?:s|ed|ing)?|assist(?:ance|s|ed|ing)?|rescue(?:d|rs?)?|sos|need(?:s|ed)?\s+(?:some(?:one|body)|a\s+hand|anyone)|send\s+(?:some(?:one|body)|anyone)|\w*tulong\w*|\w*tulung\w*|saklolo\w*|sagipin\w*)\b/i;

/** Ways of saying help is not wanted. Deliberately specific: "I can't move, help" is a request, not a refusal. */
const HELP_DECLINED: readonly RegExp[] = [
  /(?:\b(?:do|does|did)\s*n['’]?t|\b(?:do|does|did)\s+not|\bnot|\bnever|\bno\s+longer)\s+(?:\w+\s+)?(?:need|needs|want|wants|require|requires|asking|ask|looking)\b/i,
  /\bno\s+(?:need|help|assistance)\b/i,
  /\b(?:help|assistance)\s+(?:is\s+|was\s+)?not\s+(?:needed|required|necessary|wanted)\b/i,
  /\b(?:i|we)(?:['’]?m|['’]?re|\s+am|\s+are)\s+(?:ok|okay|fine|alright|all\s+right|safe)\b/i,
  /\b(?:hindi|hinde|di)\s+(?:(?:ko|na|po|namin|natin|niya|nila|naman|ako|kami)\s+){0,3}(?:kailangan|kelangan|need)\b/i,
  /\bwala(?:ng)?\s+(?:(?:akong|kaming|ako|kami|po|na)\s+){0,2}(?:kailangan|kelangan)\b/i,
  /\b(?:ok|okay|okey|ayos|maayos)\s+(?:lang|na|naman)\s+(?:po\s+)?(?:ako|kami)\b/i,
  /\b(?:huwag|wag)\s+na\b/i,
  /\bayaw\s+(?:ko|namin)\b/i,
];

const CLAUSE_BREAK = /[.,;:!?\n]+|\s+(?:but|however|pero|kaso|ngunit|subalit)\s+/i;
const NEGATIVE_ANSWER = /^(?:no|none|false|not\s+\w+|hindi|hinde|wala|di)\b/i;

function declines(text: string): boolean {
  return HELP_DECLINED.some((pattern) => pattern.test(text));
}

function groundAssistance(value: string, quote: string): Grounding {
  const clauses = normalizeForMatch(quote).split(CLAUSE_BREAK);
  const asked = clauses.some((clause) => HELP_REQUEST.test(clause) && !declines(clause));
  if (!asked) return { ok: false, reason: clauses.some(declines) ? 'negated' : 'value_not_in_quote' };
  // A "no" backed by words that do ask for help contradicts its own evidence.
  if (NEGATIVE_ANSWER.test(normalizeForMatch(value))) return { ok: false, reason: 'value_not_in_quote' };
  return { ok: true, value };
}

const STOPWORDS = new Set([
  ...'a an the of on in at to for from with by and or is are was were be been am i im my me we our you your he she it its they them this that there here very some has have had do does did not no'.split(' '),
  ...'ang ng sa na at ay mga si ni kay ko mo ako ka siya kami tayo sila po ho lang din rin may nasa yung ito iyan iyon dito diyan doon pa ba kasi para'.split(' '),
]);

function contentTokens(text: string): string[] {
  return normalizeForMatch(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

/** Exact word, or one word starting with the other ("slip" / "slipped", "dulas" / "dulasan"). */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  return a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a));
}

function groundFreeText(value: string, quote: string): Grounding {
  const wanted = contentTokens(value);
  const said = contentTokens(quote);
  const found = wanted.filter((token) => said.some((word) => sameWord(token, word))).length;
  if (wanted.length > 0 && found * 2 >= wanted.length) return { ok: true, value };
  // The value is the model's paraphrase, not the person's words: keep the person's words instead.
  const own = quote.replace(/\s+/g, ' ').trim();
  if (own.length === 0) return { ok: false, reason: 'value_not_in_quote' };
  if (own.length > MAX_GROUNDED_VALUE_CHARS) return { ok: false, reason: 'too_long' };
  return { ok: true, value: own };
}

/**
 * Checks one proposed field against its evidence quote. The caller has already located the quote in the
 * original report (`locateEvidence`); this never looks at the report itself.
 *
 * - every field: a value over 120 characters, or one that words a medical or severity judgement, is rejected;
 * - `floor`, `building`: the value must name the floor or building the quote names (the domain rules read both),
 *   the quote must not negate it, and the accepted value is the rules' canonical label ("Second floor", "Building B").
 *   A floor the rules cannot read is rejected; a building with a proper name is accepted when the quote says that name;
 * - `assistanceRequested`: the quote must ask for help, in English or Tagalog, and not decline it;
 * - `incidentType`, `locationText`, `symptom`: accepted when at least half of the value's content words are in
 *   the quote; otherwise the value is replaced by the quote itself, the person's own words.
 */
export function groundValue(field: ProposalField, value: string, quote: string): Grounding {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length === 0) return { ok: false, reason: 'value_not_in_quote' };
  if (trimmed.length > MAX_GROUNDED_VALUE_CHARS) return { ok: false, reason: 'too_long' };
  if (containsMedicalJudgement(trimmed)) return { ok: false, reason: 'medical_or_severity' };
  switch (field) {
    case 'floor':
    case 'building':
      return groundLocation(field, trimmed, quote);
    case 'assistanceRequested':
      return groundAssistance(trimmed, quote);
    case 'incidentType':
    case 'locationText':
    case 'symptom':
      return groundFreeText(trimmed, quote);
  }
}
