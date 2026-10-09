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

/** True only when `evidence` appears verbatim (modulo case and whitespace) in the original report. */
export function isEvidenceInReport(evidence: string, report: string): boolean {
  const needle = normalizeForMatch(evidence).replace(/^["'.,;:!?\s]+|["'.,;:!?\s]+$/g, '');
  if (needle.length < 2) return false;
  return normalizeForMatch(report).includes(needle);
}

const UNKNOWN_VALUES = new Set(['', 'unknown', 'n/a', 'na', 'none', 'not stated', 'not specified', 'not mentioned', 'unspecified', 'null', 'undefined', '-']);

export function isUnknownValue(value: string): boolean {
  return UNKNOWN_VALUES.has(normalizeForMatch(value).replace(/[.]+$/, ''));
}

/** Words that would turn a proposal into a medical judgement. Proposals containing them are discarded. */
const MEDICAL_JUDGEMENT = /\b(severe|severity|critical|life[- ]threatening|fracture[ds]?|broken|sprain(ed)?|concussion|diagnos\w*|triage|priority|urgent care|stable|unstable|mild|moderate)\b/i;

export function containsMedicalJudgement(text: string): boolean {
  return MEDICAL_JUDGEMENT.test(text);
}
