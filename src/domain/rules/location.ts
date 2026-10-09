import type { TextSpan } from '../primitives';

/**
 * Deterministic floor and building extraction from free text, English and Tagalog. No model.
 * Every match returns the exact span it came from so the UI can show the evidence.
 *
 * Values are canonical labels ("Ground floor", "Second floor", "11th floor"). "Ground" and
 * "first" are kept distinct: the rule never decides that one means the other.
 */

export interface LocationMatch {
  value: string;
  span: TextSpan;
}

export interface FloorMatch extends LocationMatch {
  /** 0 = ground, 1 = first ... */
  level: number;
}

const ORDINAL_LABELS = [
  'Ground',
  'First',
  'Second',
  'Third',
  'Fourth',
  'Fifth',
  'Sixth',
  'Seventh',
  'Eighth',
  'Ninth',
  'Tenth',
] as const;

const ENGLISH_WORDS: Record<string, number> = {
  ground: 0,
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
};

/** Tagalog ordinals, written with or without the hyphen after "ika". */
const TAGALOG_WORDS: Record<string, number> = {
  una: 1,
  ikalawa: 2,
  pangalawa: 2,
  ikatlo: 3,
  pangatlo: 3,
  ikaapat: 4,
  pangapat: 4,
  ikalima: 5,
  panglima: 5,
  ikaanim: 6,
  ikapito: 7,
  ikawalo: 8,
  ikasiyam: 9,
  ikasampu: 10,
};

const MAX_FLOOR = 150;

export function floorLabel(level: number): string {
  const word = ORDINAL_LABELS[level];
  if (word) return `${word} floor`;
  const tens = level % 100;
  const suffix =
    tens >= 11 && tens <= 13 ? 'th' : level % 10 === 1 ? 'st' : level % 10 === 2 ? 'nd' : level % 10 === 3 ? 'rd' : 'th';
  return `${level}${suffix} floor`;
}

function tagalogLevel(raw: string): number | undefined {
  // "ikalawang" / "ika-lawang" / "unang" -> strip hyphen and the "-ng" / "-g" linker.
  const word = raw.toLowerCase().replace(/-/g, '');
  const candidates = [word, word.replace(/ng$/, ''), word.replace(/g$/, '')];
  for (const c of candidates) {
    const level = TAGALOG_WORDS[c];
    if (level !== undefined) return level;
  }
  return undefined;
}

interface FloorPattern {
  regex: RegExp;
  level: (m: RegExpExecArray) => number | undefined;
}

const EN_WORD = Object.keys(ENGLISH_WORDS).join('|');
const TL_WORD =
  'unang|ika-?lawang|pangalawang|ika-?tlong|pangatlong|ika-?apat|pang-?apat|ika-?limang|panglimang|ika-?anim|ika-?pitong|ika-?walong|ika-?siyam|ika-?sampung';

const FLOOR_PATTERNS: readonly FloorPattern[] = [
  // "second floor", "ground floor", Taglish "second palapag"
  {
    regex: new RegExp(`\\b(${EN_WORD})\\s+(?:floor|flr|palapag)\\b`, 'gi'),
    level: (m) => ENGLISH_WORDS[(m[1] ?? '').toLowerCase()],
  },
  // "2nd floor", "3rd flr", "2nd palapag"
  {
    regex: /\b(\d{1,3})\s?(?:st|nd|rd|th)\s+(?:floor|flr|palapag)\b/gi,
    level: (m) => Number(m[1]),
  },
  // "floor 2", "palapag 3"
  {
    regex: /\b(?:floor|flr|palapag)\s+(?:no\.?\s*)?(\d{1,3})\b/gi,
    level: (m) => Number(m[1]),
  },
  // "2/F", "2F"
  {
    regex: /\b(\d{1,3})\s?\/\s?F\b/g,
    level: (m) => Number(m[1]),
  },
  // "unang palapag", "ikalawang palapag", "ikaapat na palapag"
  {
    regex: new RegExp(`\\b(${TL_WORD})(?:\\s+na)?\\s+(?:palapag|floor)\\b`, 'gi'),
    level: (m) => tagalogLevel(m[1] ?? ''),
  },
  // "ika-2 palapag", "ika-2 na palapag"
  {
    regex: /\bika-?\s?(\d{1,3})(?:\s+na)?\s+(?:palapag|floor)\b/gi,
    level: (m) => Number(m[1]),
  },
];

/** A match directly preceded by a negation is not a statement that the person is there. */
const NEGATION_BEFORE = /(?:\bnot|\bn't|\bhindi|\bwala)\s+(?:(?:on|in|at|sa|the|ako|siya|nasa)\s+){0,3}$/i;

/** All floor mentions, in text order, without overlaps. */
export function extractFloors(text: string): FloorMatch[] {
  const found: FloorMatch[] = [];
  for (const pattern of FLOOR_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.regex.exec(text)) !== null) {
      const level = pattern.level(m);
      if (level === undefined || !Number.isInteger(level) || level < 0 || level > MAX_FLOOR) continue;
      const start = m.index;
      const end = start + m[0].length;
      if (NEGATION_BEFORE.test(text.slice(0, start))) continue;
      found.push({ value: floorLabel(level), level, span: { start, end, text: text.slice(start, end) } });
    }
  }
  found.sort((a, b) => a.span.start - b.span.start || b.span.end - a.span.end);
  const out: FloorMatch[] = [];
  for (const match of found) {
    const previous = out[out.length - 1];
    if (previous && match.span.start < previous.span.end) continue;
    out.push(match);
  }
  return out;
}

/**
 * The floor a text states, or null. If the text names more than one different floor the rule does
 * not choose: the floor stays unknown.
 */
export function extractFloor(text: string): FloorMatch | null {
  const matches = extractFloors(text);
  const first = matches[0];
  if (!first) return null;
  return matches.every((m) => m.level === first.level) ? first : null;
}

const BUILDING_PATTERN = /\b(?:building|bldg\.?|gusali)\s+([A-Za-z]\d{0,3}|\d{1,3}[A-Za-z]?)(?![A-Za-z0-9])/gi;

export function extractBuildings(text: string): LocationMatch[] {
  const out: LocationMatch[] = [];
  BUILDING_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BUILDING_PATTERN.exec(text)) !== null) {
    const token = m[1] ?? '';
    const start = m.index;
    const end = start + m[0].length;
    // "building a fire", "building I saw": a lone lowercase article or pronoun is not a name
    // unless the clause ends right after it.
    if (/^[ai]$/.test(token) || token === 'I') {
      const rest = text.slice(end);
      if (!/^\s*(?:[.,;:!?)]|$)/.test(rest)) continue;
    }
    out.push({ value: `Building ${token.toUpperCase()}`, span: { start, end, text: text.slice(start, end) } });
  }
  return out;
}

/** The building a text names, or null when it names none or more than one. */
export function extractBuilding(text: string): LocationMatch | null {
  const matches = extractBuildings(text);
  const first = matches[0];
  if (!first) return null;
  return matches.every((m) => m.value === first.value) ? first : null;
}

/**
 * A text that says the person moved from one floor to another.
 *
 * `to` is where the text says the person is now; `from` is where they were. Either side may be an
 * elided ordinal ("moved up to the 3rd floor from the 2nd"), in which case its span covers only
 * the ordinal.
 */
export interface FloorTransition {
  from: FloorMatch;
  to: FloorMatch;
}

const ELIDED_WORD = Object.keys(ENGLISH_WORDS)
  .filter((w) => w !== 'ground')
  .join('|');

/**
 * An English ordinal with the word "floor" left out. Only read directly after "from/to/on the" and
 * only when the clause ends there (or "to" follows), so "wait a second" is never a floor.
 */
const ELIDED_FLOOR = new RegExp(
  `\\b(?:from|to|onto|on|at)\\s+the\\s+(?:(${ELIDED_WORD})|(\\d{1,3})(?:st|nd|rd|th))\\b(?=\\s*(?:[.,;!]|$)|\\s+to\\b)`,
  'gi',
);

function elidedFloors(text: string): FloorMatch[] {
  const out: FloorMatch[] = [];
  ELIDED_FLOOR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ELIDED_FLOOR.exec(text)) !== null) {
    const token = m[1] ?? m[2] ?? '';
    const level = m[1] !== undefined ? ENGLISH_WORDS[m[1].toLowerCase()] : Number(m[2]);
    if (level === undefined || !Number.isInteger(level) || level < 0 || level > MAX_FLOOR) continue;
    // The ordinal is the last thing in the match apart from an optional "st/nd/rd/th".
    const start = m.index + m[0].lastIndexOf(token);
    const end = m.index + m[0].length;
    out.push({ value: floorLabel(level), level, span: { start, end, text: text.slice(start, end) } });
  }
  return out;
}

/** Where the person was. Tested against the text that ends right before a mention. */
const ORIGIN_BEFORE =
  /(?:\bfrom|\bleft|\b(?:was|were)\s+(?:still\s+)?(?:on|at|in)|\bmula(?:\s+sa)?|\bgaling(?:\s+(?:ako|kami|po|na))*(?:\s+(?:sa|ng))?|\b(?:kanina|dati)(?:\s+(?:ako|kami|po|ay))*\s+(?:nasa|sa))\s+(?:the\s+)?$/i;

/** "now I'm on the ...", "ngayon nasa ...", "nandito na ako sa ...": states the present location outright. */
const DESTINATION_STATED_BEFORE =
  /(?:\b(?:now|ngayon)(?:\s+(?:i['’]?m|i\s+am|we['’]?re|we\s+are|ako|kami|ay|po))*(?:\s+(?:on|at|in|nasa|sa))?|\b(?:nandito|andito|narito)\s+na\s+(?:po\s+)?(?:ako|kami)\s+sa)\s+(?:the\s+)?$/i;

/** "nasa <floor> na ako": the Tagalog "already here" marker that follows the mention. */
const NASA_BEFORE = /\bnasa\s+$/i;
const NA_AFTER = /^\s+na(?:\s+(?:po\s+)?(?:ako|kami|siya|sila)\b|\s*(?:[.,;!]|$))/i;
/** "... on the second floor now" */
const AT_BEFORE = /\b(?:on|at|in)\s+(?:the\s+)?$/i;
const NOW_AFTER = /^\s+(?:right\s+)?now\b/i;

const MOVED_VERB_TL = 'lumipat|umakyat|bumaba|pumunta|nagpunta|nakaakyat|nakababa|nakalipat';

/** "to the ...", "papunta sa ...", "umakyat ako sa ...": a destination only if a completed movement is stated. */
const DESTINATION_DIRECTION_BEFORE = new RegExp(
  `(?:\\b(?:to|onto)|\\bpapunta(?:ng)?(?:\\s+sa)?|\\bpatungo(?:ng)?(?:\\s+sa)?|\\b(?:${MOVED_VERB_TL})(?:\\s+(?:na|ako|kami|po|siya))*\\s+sa)\\s+(?:the\\s+)?$`,
  'i',
);

/**
 * Words that say the movement happened. Future and in-progress Tagalog forms ("pupunta",
 * "umaakyat") and bare English infinitives ("move", "go") are deliberately absent.
 */
const MOVEMENT_CUE = new RegExp(
  `\\b(?:moved|went|gone|came|going|climbed|transferred|relocated|now|${MOVED_VERB_TL})\\b`,
  'gi',
);

/** Negated, interrupted ("was going"), hypothetical or future movement is not a movement. */
const CUE_BLOCKED_BEFORE =
  /(?:\bnot|n['’]t|\bnever|\bhindi|\bdi|\bwala(?:ng)?|\bwas|\bwere|\bwill|\bwould|\bif|\bkung)\s+(?:\S+\s+){0,2}$/i;

const NEGATION_NEAR = /(?:\bnot|n['’]t|\bnever|\bhindi|\bwala(?:ng)?)\s+(?:\S+\s+){0,3}$/i;

type TransitionRole = 'origin' | 'stated' | 'direction' | 'none' | 'ambiguous';

function transitionRole(text: string, match: FloorMatch): TransitionRole {
  const before = text.slice(0, match.span.start);
  const after = text.slice(match.span.end);
  const origin = ORIGIN_BEFORE.test(before);
  const stated =
    DESTINATION_STATED_BEFORE.test(before) ||
    (NASA_BEFORE.test(before) && NA_AFTER.test(after)) ||
    (AT_BEFORE.test(before) && NOW_AFTER.test(after));
  const direction = DESTINATION_DIRECTION_BEFORE.test(before);
  if (origin && (stated || direction)) return 'ambiguous';
  if (origin) return 'origin';
  if (stated) return 'stated';
  if (direction) return 'direction';
  return 'none';
}

/** True when the last movement word before `index` is there and is not negated or hypothetical. */
function movementStatedBefore(text: string, index: number): boolean {
  const head = text.slice(0, index);
  MOVEMENT_CUE.lastIndex = 0;
  let lastCue = -1;
  let m: RegExpExecArray | null;
  while ((m = MOVEMENT_CUE.exec(head)) !== null) lastCue = m.index;
  if (lastCue < 0) return false;
  return !CUE_BLOCKED_BEFORE.test(head.slice(0, lastCue));
}

/**
 * The floor the text says the person moved from and the floor it says they are on now, or null.
 *
 * Conservative by construction. It answers only when the text has exactly two floor mentions (one
 * may be an elided English ordinal), on different levels, one marked as the origin (from ...,
 * was on ..., mula ..., galing ... sa ...) and the other as the destination. A destination marked only
 * by direction ("to", "papunta sa") also needs a completed-movement word ("moved", "went",
 * "lumipat", "umakyat" ...) that is not negated, interrupted or hypothetical. Anything else,
 * including "between the second floor and the third floor", "I was going from ... to ..." and a
 * question, returns null and the caller keeps treating the floor as unstated.
 */
export function extractFloorTransition(text: string): FloorTransition | null {
  const full = extractFloors(text);
  const mentions = full.length === 1 ? [...full, ...elidedFloors(text)] : full;
  if (mentions.length !== 2) return null;
  mentions.sort((a, b) => a.span.start - b.span.start);
  const [first, second] = mentions;
  if (!first || !second || first.level === second.level) return null;
  if (first.span.end > second.span.start) return null;
  if (mentions.some((m) => NEGATION_NEAR.test(text.slice(0, m.span.start)))) return null;
  // A question about moving is not a statement that someone moved.
  if (/^[^.!\n]*\?/.test(text.slice(second.span.end))) return null;

  const roles = [transitionRole(text, first), transitionRole(text, second)];
  const originIndex = roles.indexOf('origin');
  if (originIndex < 0 || roles.lastIndexOf('origin') !== originIndex) return null;
  const from = originIndex === 0 ? first : second;
  const to = originIndex === 0 ? second : first;
  const toRole = roles[1 - originIndex];
  if (toRole === 'stated') return { from, to };
  if (toRole === 'direction' && movementStatedBefore(text, to.span.start)) return { from, to };
  return null;
}
