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
