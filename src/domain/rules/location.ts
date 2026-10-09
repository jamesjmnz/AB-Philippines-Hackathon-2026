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
 * A text in which the author says that they themselves moved from one floor to another.
 *
 * `to` is where the text says the author is now; `from` is where they were. One side may be an
 * elided English ordinal ("I moved up to the 3rd floor from the 2nd"), in which case its span
 * covers only the ordinal.
 */
export interface FloorTransition {
  from: FloorMatch;
  to: FloorMatch;
}

const ELIDED_WORD = Object.keys(ENGLISH_WORDS)
  .filter((w) => w !== 'ground')
  .join('|');

/**
 * An English ordinal with the word "floor" left out. Only read directly after a preposition and
 * "the", and only when the clause ends there (or "to" follows), so "wait a second" is never a floor.
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

/**
 * The transition rule is a whitelist. The two floor mentions are replaced by placeholders and the
 * text must then contain one of a few complete first-person constructions, with nothing between
 * the subject, the movement word and the two floors except what the construction allows. Anything
 * else is not a transition: another subject (the fire, the water, he, they, my son), an object
 * ("I moved the boxes from ..."), an attempt or intention ("tried", "almost", "going", "gusto"),
 * reported speech, a question, or a reversal afterwards ("and came back").
 */
const SLOT = '\u0001';
/** A floor placeholder with its optional article; the capture is the mention's position, 0 or 1. */
const F = `(?:the\\s+)?${SLOT}([01])`;

/** "I", "we", "I've", "we have", with only these adverbs allowed before the verb. */
const EN_SUBJECT = "(?:i|we)(?:'ve|\\s+have)?(?:\\s+(?:just|already|then|also|now))*";
/** Completed movement only. No "going", no "moving", no bare infinitive, and no transitive "transferred". */
const EN_MOVED = '(?:moved|went|gone|came|climbed|walked|ran|relocated)(?:\\s+(?:up|down|over|upstairs|downstairs))?';
const EN_AM = "(?:i'?m|i\\s+am|we'?re|we\\s+are)";

const TL_PRONOUN = '(?:ako|kami|tayo)';
const TL_ENCLITIC = '(?:\\s+(?:na|po|nga|rin|din|lang))*';
/** Completed-aspect forms only: "pupunta" (will go) and "umaakyat" (is climbing) are absent. */
const TL_MOVED = '(?:lumipat|umakyat|bumaba|pumunta|nagpunta|nakaakyat|nakababa|nakalipat)';
const TL_JOIN = '\\s*[,.;]?\\s*(?:(?:at|pero|tapos)\\s+)?';

interface TransitionPattern {
  regex: RegExp;
  /** Which capture is the origin; the other is the destination. */
  originCapture: 1 | 2;
  /** An elided ordinal is allowed on these sides. */
  elided: 'either' | 'destination' | 'none';
}

const TRANSITION_PATTERNS: readonly TransitionPattern[] = [
  // "I moved from the first floor to the second floor"
  {
    regex: new RegExp(`\\b${EN_SUBJECT}\\s+${EN_MOVED}\\s+from\\s+${F}\\s+(?:(?:up|down)\\s+)?to\\s+${F}`),
    originCapture: 1,
    elided: 'either',
  },
  // "I moved up to the 3rd floor from the 2nd floor"
  {
    regex: new RegExp(`\\b${EN_SUBJECT}\\s+${EN_MOVED}\\s+to\\s+${F}\\s+from\\s+${F}`),
    originCapture: 2,
    elided: 'either',
  },
  // "I was on the first floor, now I'm on the second floor": both clauses are first person.
  {
    regex: new RegExp(
      `\\b(?:i|we)\\s+(?:was|were)\\s+(?:still\\s+)?(?:on|at|in)\\s+${F}\\s*[,.;]?\\s*(?:(?:and|but|then)\\s+)?(?:(?:right\\s+)?now\\s*,?\\s+)?${EN_AM}\\s+(?:now\\s+)?(?:on|at|in)\\s+${F}`,
    ),
    originCapture: 1,
    elided: 'destination',
  },
  // "I was on the first floor then went to the second floor"
  {
    regex: new RegExp(
      `\\b(?:i|we)\\s+(?:was|were)\\s+(?:still\\s+)?(?:on|at|in)\\s+${F}\\s*,?\\s*(?:and\\s+|but\\s+)?(?:then\\s+)?(?:(?:i|we)\\s+)?(?:then\\s+)?${EN_MOVED}\\s+to\\s+${F}`,
    ),
    originCapture: 1,
    elided: 'destination',
  },
  // "lumipat ako mula first floor papunta sa second floor"
  {
    regex: new RegExp(
      `(?<![\\p{L}\\p{N}])${TL_MOVED}${TL_ENCLITIC}\\s+${TL_PRONOUN}${TL_ENCLITIC}\\s+(?:mula|galing)\\s+(?:sa\\s+)?${F}\\s+(?:papunta|patungo)(?:ng)?\\s+(?:sa\\s+)?${F}`,
      'u',
    ),
    originCapture: 1,
    elided: 'none',
  },
  // "umakyat ako sa 3rd floor galing 2nd floor"
  {
    regex: new RegExp(
      `(?<![\\p{L}\\p{N}])${TL_MOVED}${TL_ENCLITIC}\\s+${TL_PRONOUN}${TL_ENCLITIC}\\s+sa\\s+${F}\\s+(?:mula|galing)\\s+(?:sa\\s+)?${F}`,
      'u',
    ),
    originCapture: 2,
    elided: 'none',
  },
  // "galing ako sa 1st floor, nasa 2nd floor na ako": the destination clause carries the pronoun.
  {
    regex: new RegExp(
      `(?<![\\p{L}\\p{N}])galing(?:${TL_ENCLITIC}\\s+${TL_PRONOUN})?${TL_ENCLITIC}\\s+(?:sa|ng)\\s+${F}${TL_JOIN}(?:ngayon\\s+(?:ay\\s+)?)?nasa\\s+${F}\\s+na${TL_ENCLITIC}\\s+${TL_PRONOUN}(?![\\p{L}\\p{N}])`,
      'u',
    ),
    originCapture: 1,
    elided: 'none',
  },
  // "kanina nasa first floor ako, ngayon nasa second floor na ako"
  {
    regex: new RegExp(
      `(?<![\\p{L}\\p{N}])kanina(?:ng)?(?:${TL_ENCLITIC}\\s+${TL_PRONOUN})?\\s+nasa\\s+${F}(?:\\s+${TL_PRONOUN})?${TL_JOIN}ngayon\\s+(?:ay\\s+)?nasa\\s+${F}\\s+na${TL_ENCLITIC}\\s+${TL_PRONOUN}(?![\\p{L}\\p{N}])`,
      'u',
    ),
    originCapture: 1,
    elided: 'none',
  },
];

/**
 * Words earlier in the same sentence that make the construction something other than a plain
 * statement: reported speech, a question, a condition, a wish, an attempt, a negation.
 */
const BLOCKED_BEFORE =
  /(?:^|[^\p{L}\p{N}])(?:said|say|says|saying|told|tell|heard|hear|true|if|whether|when|while|unless|until|before|think|thinks|thought|maybe|perhaps|should|would|could|can|cannot|may|might|must|tried|try|trying|almost|nearly|want|wants|wanted|need|needs|needed|will|shall|not|never|wish|hope|plan|planned|supposed|asked|ask|gusto|gustong|dapat|pwede|pwedeng|puwede|puwedeng|sana|kung|kapag|pag|bago|sabi|daw|raw|hindi|di|wala|walang|baka|siguro|balak|sinubukan|muntik|muntikan|ba|bang)(?![\p{L}\p{N}])|n't/u;
/** A sentence that opens with an auxiliary is a question whether or not it ends with "?". */
const QUESTION_OPENING = /^\s*(?:is|are|was|were|did|do|does|have|has|had|am)(?![\p{L}\p{N}])/u;
/** After the destination, in the same sentence: a question, hearsay or a wish. */
const BLOCKED_AFTER_IN_SENTENCE = /\?|(?:^|[^\p{L}\p{N}])(?:daw|raw|sana|ba)(?![\p{L}\p{N}])/u;
/** Anywhere after the destination: the person went back, so the destination is not where they are. */
const REVERSAL_AFTER = /(?:^|[^\p{L}\p{N}])(?:back|return|returned|returning|bumalik|balik|bumabalik|nakabalik)(?![\p{L}\p{N}])/u;

const SENTENCE_END = /[.!?;\n]/;

/** The floor mentions a transition may be read from: the full ones, plus one elided ordinal beside a single full one. */
function transitionMentions(text: string): { mentions: FloorMatch[]; elided: Set<FloorMatch> } {
  const full = extractFloors(text);
  const extra = full.length === 1 ? elidedFloors(text) : [];
  const mentions = [...full, ...extra].sort((a, b) => a.span.start - b.span.start);
  return { mentions, elided: new Set(extra) };
}

/**
 * The floor the author says they moved from and the floor they say they are on now, or null.
 *
 * A wrong floor is worse than no floor, so this answers only when all of the following hold:
 *
 * - the text has exactly two floor mentions on different levels (one may be an elided English
 *   ordinal, and then both must be in the same sentence);
 * - they sit in one of the first-person constructions above: English "I / we" governing a
 *   completed movement verb or both location clauses; Tagalog "ako / kami / tayo" directly after
 *   the verb, or closing the destination clause ("nasa 2nd floor na ako");
 * - nothing earlier in the sentence makes it reported, asked, conditional, wished, attempted or
 *   negated, and nothing afterwards says the person went back.
 *
 * Everything else returns null: other subjects, objects, "I'm going from ... to ...", "between the
 * second floor and the third floor", three or more mentions. The caller then treats the floor as
 * unstated.
 */
export function extractFloorTransition(text: string): FloorTransition | null {
  const { mentions, elided } = transitionMentions(text);
  if (mentions.length !== 2) return null;
  const [first, second] = mentions;
  if (!first || !second || first.level === second.level) return null;
  if (first.span.end > second.span.start) return null;
  const between = text.slice(first.span.end, second.span.start);
  if (elided.size > 0 && SENTENCE_END.test(between)) return null;

  const skeleton = (
    text.slice(0, first.span.start) +
    `${SLOT}0` +
    between +
    `${SLOT}1` +
    text.slice(second.span.end)
  )
    .replace(/[‘’]/g, "'")
    .toLowerCase();

  for (const pattern of TRANSITION_PATTERNS) {
    const m = pattern.regex.exec(skeleton);
    if (!m) continue;
    const origin = m[pattern.originCapture] === '0' ? first : second;
    const destination = origin === first ? second : first;
    if (elided.has(origin) && pattern.elided !== 'either') continue;
    if (elided.has(destination) && pattern.elided === 'none') continue;

    const before = skeleton.slice(0, m.index);
    const sentenceStart = Math.max(...['.', '!', '?', ';', '\n'].map((c) => before.lastIndexOf(c))) + 1;
    const lead = before.slice(sentenceStart);
    if (BLOCKED_BEFORE.test(lead) || QUESTION_OPENING.test(lead)) return null;

    const after = skeleton.slice(m.index + m[0].length);
    // Up to the end of the sentence, keeping a question mark so it can be seen.
    const sentenceRest = after.split(/[.!;\n]/)[0] ?? '';
    if (BLOCKED_AFTER_IN_SENTENCE.test(sentenceRest) || REVERSAL_AFTER.test(after)) return null;
    return { from: origin, to: destination };
  }
  return null;
}

/**
 * The floor a report puts its writer on, for use as a claim: the destination of a transition,
 * otherwise the single floor the text names once mentions that are not about where the writer is
 * have been left out (`isNotWriterLocation`). Null when nothing is left, when two different
 * floors are left, or when one floor is left next to a bare ordinal on another level ("I was at
 * the 3rd. Now I am on the 2nd floor"), where the full mention may be the place the person left.
 */
export function extractStatedFloor(text: string): FloorMatch | null {
  const transition = extractFloorTransition(text);
  if (transition) return transition.to;
  const about = (m: FloorMatch): boolean => !isNotWriterLocation(text, m.span);
  const mentions = extractFloors(text).filter(about);
  const first = mentions[0];
  if (!first || !mentions.every((m) => m.level === first.level)) return null;
  return elidedFloors(text).filter(about).some((e) => e.level !== first.level) ? null : first;
}

/** The building a report puts its writer in, or null. See `extractStatedFloor`. */
export function extractStatedBuilding(text: string): LocationMatch | null {
  const mentions = extractBuildings(text).filter((m) => !isNotWriterLocation(text, m.span));
  const first = mentions[0];
  if (!first) return null;
  return mentions.every((m) => m.value === first.value) ? first : null;
}

/**
 * First-person location, for observations. A responder who writes "I'm on the first floor, coming
 * up to you" is saying where they are, not where the person who asked for assistance is. These
 * tests look only at the clause the mention is in (clauses end at . ! ? ; , or a line break).
 */
const FP_ENCLITIC = '(?:(?:na|pa|po|lang|nga|rin|din)\\s+)*';
const FP_BE = "(?:i'?m|i\\s+am|i\\s+was|i'?ll\\s+be|i\\s+will\\s+be|we'?re|we\\s+are|we\\s+were|we'?ll\\s+be|we\\s+will\\s+be)";
const FP_ADVERB = '(?:\\s+(?:now|still|here|currently|already|just|right|back|also|not))*';
const FP_PLACE = '(?:on|at|in|near|by|inside|outside|around|close\\s+to|next\\s+to|beside|behind|below|above|under)';
const FP_GOING = "(?:coming|heading|going|walking|running|climbing|moving|on\\s+my\\s+way|on\\s+our\\s+way|omw)";
const FP_ROUTE = '(?:from|to|towards|toward|via|through|past|into)';
const TO_MENTION = '(?:the\\s+)?$';

/** "I'm (here) on / at / near ...": the rest of the clause up to the mention. */
const FP_LOCATED = new RegExp(`\\b${FP_BE}${FP_ADVERB}\\s+${FP_PLACE}\\b(.*)$`);
/** Another subject between the first-person phrase and the mention takes the mention over. */
const OTHER_SUBJECT = /\b(?:is|are|was|were|who|they|he|she|them|sila|siya|nila|niya)\b/;
/** "I'm coming up to you from the ...", "I am heading to the ..." */
const FP_MOVING = new RegExp(`\\b${FP_BE}${FP_ADVERB}\\s+${FP_GOING}\\b.*\\b${FP_ROUTE}\\s+${TO_MENTION}`);
/** "Coming up from the ...", "On my way to the ...": no subject, but only the writer can be meant. */
const FP_MOVING_BARE = new RegExp(
  `^\\s*(?:(?:ok|okay|yes|copy|sige|opo|oo)\\W+)?(?:(?:still|now|just)\\s+)?${FP_GOING}\\b.*\\b${FP_ROUTE}\\s+${TO_MENTION}`,
);
/** "I went to the ...", "we'll go up to the ...", "I checked the ..." */
const FP_WENT = new RegExp(
  `\\b(?:i|we)(?:'ll|'ve|\\s+will|\\s+have)?(?:\\s+(?:just|already|now))*\\s+(?:went|go|came|come|moved|climbed|ran|walked|got|reached|arrived|checked|searched|left)(?:\\s+(?:up|down|over|back|here))*(?:\\s+(?:to|from|at|on|in|into))?\\s+${TO_MENTION}`,
);
/** "I can see the smoke from the ..." */
const FP_SEEING_FROM = new RegExp(`\\b(?:i|we)\\s+(?:can\\s+|could\\s+)?(?:see|saw|hear|heard|watch|watched)\\b.*\\bfrom\\s+${TO_MENTION}`);

/** "andito ako sa ...", "galing ako sa ...", "papunta na ako sa ...", "paakyat na kami ... from ..." */
const FP_TAGALOG_BEFORE = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:andito|nandito|narito|nandirito|dito|galing|papunta(?:ng)?|paakyat|pababa|pupunta|aakyat|bababa|umaakyat|bumababa|parating|paparating)\\s+${FP_ENCLITIC}(?:ako|kami)(?![\\p{L}\\p{N}])`,
  'u',
);
/** "ako ay nasa ...", "kami nasa ..." */
const FP_TAGALOG_AKO_NASA = new RegExp(`(?<![\\p{L}\\p{N}])(?:ako|kami)\\s+(?:ay\\s+)?${FP_ENCLITIC}(?:nasa|sa)\\s+${TO_MENTION}`, 'u');
/** "nasa <mention> (na) ako" */
const FP_TAGALOG_NASA_BEFORE = /(?<![\p{L}\p{N}])nasa\s+(?:the\s+)?$/u;
const FP_TAGALOG_AKO_AFTER = new RegExp(`^\\s+${FP_ENCLITIC}(?:ako|kami)(?![\\p{L}\\p{N}])`, 'u');

const CLAUSE_END = /[.!?;,\n]/;

/**
 * True when the mention at `span` is governed by a first-person subject in its own clause, so it
 * says where the writer is, was or is going: "I'm on the first floor", "I'm coming up from the
 * first floor", "I can see it from the 3rd floor", "nasa 1st floor na ako", "andito ako sa
 * Building A", "galing ako sa 2nd floor", "papunta na ako sa 3rd floor".
 *
 * False when the clause is about somebody else even if the writer appears in it: "I think Alex is
 * on the first floor", "I found them on the third floor", "Nakita ko sila sa 3rd floor", "They
 * told me second floor", and for a bare mention with no subject ("Second floor, Science Hall").
 */
export function isFirstPersonLocation(text: string, span: Pick<TextSpan, 'start' | 'end'>): boolean {
  const normalized = text.replace(/[‘’]/g, "'").toLowerCase();
  let clauseStart = span.start;
  while (clauseStart > 0 && !CLAUSE_END.test(normalized.charAt(clauseStart - 1))) clauseStart -= 1;
  let clauseEnd = span.end;
  while (clauseEnd < normalized.length && !CLAUSE_END.test(normalized.charAt(clauseEnd))) clauseEnd += 1;
  const before = normalized.slice(clauseStart, span.start);
  const after = normalized.slice(span.end, clauseEnd);

  const located = FP_LOCATED.exec(before);
  if (located && !OTHER_SUBJECT.test(located[1] ?? '')) return true;
  if (FP_MOVING.test(before) || FP_MOVING_BARE.test(before) || FP_WENT.test(before) || FP_SEEING_FROM.test(before)) {
    return true;
  }
  const tagalog = FP_TAGALOG_BEFORE.exec(before);
  if (tagalog && !OTHER_SUBJECT.test(before.slice(tagalog.index + tagalog[0].length))) return true;
  if (FP_TAGALOG_AKO_NASA.test(before)) return true;
  return FP_TAGALOG_NASA_BEFORE.test(before) && FP_TAGALOG_AKO_AFTER.test(after);
}

/**
 * The floor an observation puts the person who asked for assistance on, or null. An observation is
 * written by a responder, so a mention governed by the writer's own first person is left out, and
 * a first-person move ("I went from the first floor to the second floor") states no floor at all:
 * it is the responder who moved. What remains must name one floor.
 */
export function extractObservedFloor(text: string): FloorMatch | null {
  if (extractFloorTransition(text)) return null;
  const about = (m: FloorMatch): boolean => !isFirstPersonLocation(text, m.span) && !isNotRequesterLocation(text, m.span);
  const mentions = extractFloors(text).filter(about);
  const first = mentions[0];
  if (!first || !mentions.every((m) => m.level === first.level)) return null;
  return elidedFloors(text).filter(about).some((e) => e.level !== first.level) ? null : first;
}

/** The building an observation puts the person who asked for assistance in, or null. See `extractObservedFloor`. */
export function extractObservedBuilding(text: string): LocationMatch | null {
  const mentions = extractBuildings(text).filter(
    (m) => !isFirstPersonLocation(text, m.span) && !isNotRequesterLocation(text, m.span),
  );
  const first = mentions[0];
  if (!first) return null;
  return mentions.every((m) => m.value === first.value) ? first : null;
}

/**
 * Mentions that are not where the person is. A report says many things besides the writer's own
 * location: where the fire is, where somebody else is, where the writer was, where nobody should
 * go. A wrong floor is worse than no floor, so those mentions yield no claim.
 */
interface Clause {
  /** `before` in its original letter case. */
  rawBefore: string;
  before: string;
  after: string;
  /** The character that ended the clause, or '' at the end of the text. */
  terminator: string;
}

function clauseAround(text: string, span: Pick<TextSpan, 'start' | 'end'>): Clause {
  const normalized = text.replace(/[‘’]/g, "'").toLowerCase();
  let start = span.start;
  while (start > 0 && !CLAUSE_END.test(normalized.charAt(start - 1))) start -= 1;
  let end = span.end;
  while (end < normalized.length && !CLAUSE_END.test(normalized.charAt(end))) end += 1;
  return {
    rawBefore: text.slice(start, span.start),
    before: normalized.slice(start, span.start),
    after: normalized.slice(span.end, end),
    terminator: normalized.charAt(end),
  };
}

const WORD_END = '(?![\\p{L}\\p{N}])';
const WORD_START = '(?<![\\p{L}\\p{N}])';

/** A clause that ends with "?", opens with an auxiliary or a question word, or carries the Tagalog "ba". */
const ASKS_OPENING = new RegExp(
  `^\\s*(?:is|are|was|were|am|do|does|did|can|could|should|would|will|where|what|which|who|nasaan|nasan|saan|ano|alin|sino)${WORD_END}`,
  'u',
);
const ASKS_PARTICLE = new RegExp(`${WORD_START}(?:ba|bang)${WORD_END}`, 'u');

function isQuestion(clause: Clause): boolean {
  return (
    clause.terminator === '?' ||
    ASKS_OPENING.test(clause.before) ||
    ASKS_PARTICLE.test(clause.before) ||
    ASKS_PARTICLE.test(clause.after)
  );
}

/** "I left the ...", "came from the ...", "umalis na ako sa ...", "galing ako sa ...": where the person was. */
const LEFT_BEFORE = new RegExp(
  `(?:${WORD_START}(?:left|leaving|leave|exited|evacuated|escaped|fled)(?:\\s+from)?|${WORD_START}(?:came|come|coming|got|get|getting|ran|went)\\s+(?:out\\s+)?(?:from|of)|${WORD_START}out\\s+of|${WORD_START}(?:galing|umalis|lumabas|nakaalis|nakalabas)(?:\\s+(?:na|po|ako|kami|tayo))*(?:\\s+(?:sa|ng))?)\\s+${TO_MENTION}`,
  'u',
);

/** "go to the ...", "I am going up to the ...", "pumunta kayo sa ...": somewhere to go, not where anyone is. */
const GO_TO_BEFORE = new RegExp(
  `(?:${WORD_START}(?:go|going|get|head|heading)(?:\\s+(?:up|down|back|over))*\\s+to` +
    // Future and "on the way" forms: not there yet.
    `|${WORD_START}(?:pupunta|papunta|aakyat|paakyat|bababa|pababa)(?:\\s+(?:na|po|ako|kami|tayo|kayo|ka))*\\s+sa` +
    // An imperative addressed to others. "Umakyat na ako sa ..." (I went up) is not one.
    `|${WORD_START}(?:pumunta|punta|umakyat|akyat|bumaba|baba)(?:\\s+(?:na|po))*\\s+(?:kayo|ka)(?:\\s+(?:na|po))*\\s+sa)\\s+${TO_MENTION}`,
  'u',
);

/** "do not come to ...", "huwag kayong pumunta sa ...": an instruction to others. */
const TOLD_NOT_TO = new RegExp(
  `${WORD_START}(?:do\\s+not|don'?t|never|huwag|wag)${WORD_END}.*${WORD_START}(?:come|go|enter|use|send|bring|take|climb|pumunta|punta|pasok|pumasok|akyat|umakyat|baba|bumaba|dumaan|daan)${WORD_END}`,
  'u',
);

/** "fire exit", "water station", "smoke detector" name a place or a thing, not a hazard that is somewhere. */
const NOT_A_FIXTURE =
  '(?!\\s+(?:exit|escape|alarm|station|extinguisher|hose|hydrant|detector|door|truck|drill|tank|fountain|dispenser|cooler|bottle|pipe|meter))';
const HAZARD = `(?:fire|flames?|smoke|water|flood|flooding|gas|explosion|blast|noise|sound|alarm|sunog|apoy|usok|tubig|baha|ingay)${NOT_A_FIXTURE}`;
const SOMEBODY_ELSE =
  '(?:he|she|they|them|someone|somebody|people|everyone|everybody|nobody|others?|son|daughter|mother|father|mom|mum|mama|dad|papa|wife|husband|child|children|kids?|baby|friends?|brother|sister|neighbou?rs?|classmates?|teacher|guard|rescuers?|patient|siya|sila|nila|niya|anak|nanay|tatay|asawa|kapatid|kapitbahay|lola|lolo|kaibigan|kasama)';
const HAZARD_BEFORE = new RegExp(`${WORD_START}${HAZARD}${WORD_END}`, 'u');
const OTHER_ENTITY_BEFORE = new RegExp(`${WORD_START}(?:${HAZARD}|${SOMEBODY_ELSE})${WORD_END}`, 'u');
/** "nasa 3rd floor ang apoy", "nasa 2nd floor si Mika", "nasa 3rd floor sila" */
const TAGALOG_OTHER_AFTER = new RegExp(`^\\s+(?:(?:na|pa|po|daw|raw)\\s+)*(?:ang|yung|'yung|si|sina|sila|siya)${WORD_END}`, 'u');
const TAGALOG_HAZARD_AFTER = new RegExp(`^\\s+(?:(?:na|pa|po|daw|raw)\\s+)*(?:ang|yung|'yung)\\s+(?:mga\\s+)?${HAZARD}${WORD_END}`, 'u');

/** "... is on the", "... are at the": the last one before the mention, with what precedes it. */
const BE_VERB = new RegExp(`${WORD_START}(?:is|are|was|were|isn't|aren't|wasn't|weren't)${WORD_END}|${WORD_START}(?:he|she|there|who)'s${WORD_END}`, 'gu');
/** "Alex is on ...", "Mika and Noah are on ...": a name with no article or possessive before it. */
const NAMED_SUBJECT = /(?:^|\s)(?!(?:The|My|Our|This|That|These|Those|A|An|It|Here|I|We)\s*$)\p{Lu}[\p{L}'-]*\s*$/u;
const DETERMINED_SUBJECT = /(?:^|\s)(?:the|my|our|this|that|these|those|a|an)\s+(?:[\p{L}\p{N}'-]+\s+){0,3}[\p{L}\p{N}'-]+\s*$/iu;
const FP_BE_ANYWHERE = new RegExp(`\\b${FP_BE}\\b`, 'g');

/** "I am ... <mention>" with nobody else named in between, or the Tagalog first-person forms. */
function writerGoverns(clause: Clause): boolean {
  FP_BE_ANYWHERE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FP_BE_ANYWHERE.exec(clause.before)) !== null) {
    if (!OTHER_SUBJECT.test(clause.before.slice(m.index + m[0].length))) return true;
  }
  const tagalog = FP_TAGALOG_BEFORE.exec(clause.before);
  if (tagalog && !OTHER_SUBJECT.test(clause.before.slice(tagalog.index + tagalog[0].length))) return true;
  if (FP_TAGALOG_AKO_NASA.test(clause.before)) return true;
  return FP_TAGALOG_AKO_AFTER.test(clause.after);
}

/**
 * True when, in a report, the mention at `span` is not a statement of where the writer is:
 *
 * - its clause is a question ("Is this the 3rd floor?", "Ito ba ang 3rd floor?");
 * - it is a place the writer left with no destination given ("I left the 3rd floor already",
 *   "umalis na ako sa 3rd floor", "galing ako sa 3rd floor"), or a place to go or not to go
 *   ("go to the 3rd floor", "do not come to the 3rd floor", "huwag kayong pumunta sa 3rd floor");
 * - its clause has an explicit subject other than the writer: a hazard, another person or a name
 *   ("The fire is on the 3rd floor", "My son is on the 3rd floor", "Alex is on the 3rd floor",
 *   "nasa 3rd floor ang apoy", "nasa 2nd floor si Mika"). A place as the subject ("the shower
 *   area is on the second floor") is not excluded.
 *
 * False for a first-person mention ("I am on the second floor", "nasa 2nd floor ako", "I'm stuck
 * on the 4th floor", "My son and I are on the 3rd floor") and for a bare mention with no subject
 * ("Building B, second floor", "2nd floor near the canteen", "sa 3rd floor ng Building A").
 */
export function isNotWriterLocation(text: string, span: Pick<TextSpan, 'start' | 'end'>): boolean {
  const clause = clauseAround(text, span);
  if (isQuestion(clause)) return true;
  if (LEFT_BEFORE.test(clause.before) || GO_TO_BEFORE.test(clause.before) || TOLD_NOT_TO.test(clause.before)) return true;
  if (writerGoverns(clause)) return false;
  if (TAGALOG_OTHER_AFTER.test(clause.after)) return true;

  BE_VERB.lastIndex = 0;
  let lastBe: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = BE_VERB.exec(clause.before)) !== null) lastBe = m;
  if (lastBe) {
    if (lastBe[0].endsWith("'s")) return true;
    // Who or what "is" there. A hazard, another person or a name is not the writer. A place
    // ("the shower area is on the second floor", "my room is on the 2nd floor") is left alone:
    // it is most often the place the writer is describing because they are in it.
    const subject = clause.before.slice(0, lastBe.index);
    // "My son and I are on ...": the writer is part of the subject.
    if (/(?:^|\s)(?:i|we)\s*$/.test(subject)) return false;
    if (OTHER_ENTITY_BEFORE.test(subject)) return true;
    const rawSubject = clause.rawBefore.slice(0, lastBe.index);
    return NAMED_SUBJECT.test(rawSubject) && !DETERMINED_SUBJECT.test(rawSubject);
  }
  return OTHER_ENTITY_BEFORE.test(clause.before);
}

/**
 * The same test for an observation, narrower: there a third person is usually the requester, so
 * only a question and a hazard as the subject ("the fire is on the 3rd floor") are left out.
 */
function isNotRequesterLocation(text: string, span: Pick<TextSpan, 'start' | 'end'>): boolean {
  const clause = clauseAround(text, span);
  if (isQuestion(clause)) return true;
  return HAZARD_BEFORE.test(clause.before) || TAGALOG_HAZARD_AFTER.test(clause.after);
}
