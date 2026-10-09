/** Collapses whitespace and case so a span quoted by the model can be matched against the original report. */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A located quote: `report.slice(start, end) === text`, offsets in UTF-16 code units of the original report. */
export type EvidenceSpan = { start: number; end: number; text: string };

/** Shortest quote, after normalisation and edge stripping, that counts as evidence. */
const MIN_EVIDENCE_CHARS = 2;

/** Code points that attach to the one before them: combining marks, and the Hangul jamo NFKC composes across. */
const EXTENDS_PREVIOUS = /^[\p{M}ᅠ-ᇿힰ-퟿]$/u;
const WHITESPACE = /\s/;
const EDGE_PUNCTUATION = /^["'.,;:!?\s]+|["'.,;:!?\s]+$/g;

function foldCluster(cluster: string): string {
  return cluster
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/ς/g, 'σ');
}

type Mapped = {
  /** Normalised text: same folding as `normalizeForMatch`, whitespace runs collapsed, edges trimmed. */
  text: string;
  /** For each code unit of `text`, where the original characters it came from start and end. */
  starts: number[];
  ends: number[];
};

/**
 * Normalises `source` one grapheme-like cluster at a time (a base code point plus what attaches to it),
 * so every normalised code unit knows the original range it came from even when NFKC changes the
 * length ("ﬁ" -> "fi", "２" -> "2", "e" + U+0301 -> "é").
 */
function normalizeWithMap(source: string): Mapped {
  const out: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let pendingSpace: { start: number; end: number } | null = null;

  const emit = (folded: string, start: number, end: number) => {
    for (let i = 0; i < folded.length; i++) {
      const unit = folded.charAt(i);
      if (WHITESPACE.test(unit)) {
        if (out.length === 0) continue; // leading whitespace is trimmed
        if (pendingSpace) pendingSpace.end = end;
        else pendingSpace = { start, end };
        continue;
      }
      if (pendingSpace) {
        out.push(' ');
        starts.push(pendingSpace.start);
        ends.push(pendingSpace.end);
        pendingSpace = null;
      }
      out.push(unit);
      starts.push(start);
      ends.push(end);
    }
  };

  let clusterStart = 0;
  let index = 0;
  while (index < source.length) {
    const codePoint = source.codePointAt(index) ?? 0;
    const width = codePoint > 0xffff ? 2 : 1;
    const char = source.slice(index, index + width);
    if (index > clusterStart && !EXTENDS_PREVIOUS.test(char)) {
      emit(foldCluster(source.slice(clusterStart, index)), clusterStart, index);
      clusterStart = index;
    }
    index += width;
  }
  if (clusterStart < source.length) emit(foldCluster(source.slice(clusterStart)), clusterStart, source.length);
  // A trailing whitespace run is dropped: `pendingSpace` is never flushed.
  return { text: out.join(''), starts, ends };
}

/**
 * Finds `quote` in `report` under the evidence normalisation (NFKC, case, curly quotes, whitespace runs,
 * punctuation and whitespace stripped from the quote's edges) and returns where it sits in the ORIGINAL report.
 *
 * `report.slice(start, end) === text` always holds. The first occurrence wins. When a match begins or ends
 * inside a character that normalisation expands (a ligature, a base letter with combining marks), the span
 * widens to the whole original character. Returns null when the quote is absent or shorter than two characters.
 */
export function locateEvidence(report: string, quote: string): EvidenceSpan | null {
  const needle = normalizeWithMap(quote).text.replace(EDGE_PUNCTUATION, '');
  if (needle.length < MIN_EVIDENCE_CHARS) return null;
  const haystack = normalizeWithMap(report);
  const at = haystack.text.indexOf(needle);
  if (at < 0) return null;
  const start = haystack.starts[at];
  const end = haystack.ends[at + needle.length - 1];
  if (start === undefined || end === undefined || end <= start) return null;
  return { start, end, text: report.slice(start, end) };
}

/** True only when `evidence` appears verbatim (modulo case, whitespace and edge punctuation) in the original report. */
export function isEvidenceInReport(evidence: string, report: string): boolean {
  return locateEvidence(report, evidence) !== null;
}

const UNKNOWN_VALUES = new Set(['', 'unknown', 'n/a', 'na', 'none', 'not stated', 'not specified', 'not mentioned', 'unspecified', 'null', 'undefined', '-']);

export function isUnknownValue(value: string): boolean {
  return UNKNOWN_VALUES.has(normalizeForMatch(value).replace(/[.]+$/, ''));
}

/**
 * Words that would turn a proposal into a medical or severity judgement, English and Tagalog.
 * Proposals containing them are discarded.
 */
const MEDICAL_JUDGEMENT =
  /\b(severe(ly)?|severity|critical(ly)?|life[- ]threatening|emergency[- ]level|malubha\w*|kritikal|fracture[ds]?|broken|sprain(ed)?|concussion|diagnos\w*|triage|priority|urgent care|stable|unstable|mild|moderate)\b/i;

export function containsMedicalJudgement(text: string): boolean {
  return MEDICAL_JUDGEMENT.test(text.normalize('NFKC'));
}
