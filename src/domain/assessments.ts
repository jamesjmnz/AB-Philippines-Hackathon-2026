/**
 * Identity of a model assessment of one statement.
 *
 * The id is derived from what was assessed and with which prompt, not from the device or the time,
 * so assessing the same statement again with the same prompt gives the same id and the reducer
 * refuses the repeat as `duplicate_entity`. A new prompt version gives a new id, so a later prompt
 * can assess the statement again.
 *
 * Two forms, told apart by the character after "assess":
 * - `assess:<reportId>:<promptVersion>` when that fits in 128 characters and the report id has no
 *   ":" in it, so the two parts cannot be confused.
 * - `assess~<start of reportId>~<16 hex digits>` otherwise. The digits are a hash of both parts
 *   with their lengths, so two prompt versions of a long report id do not collapse into one id.
 */
const MAX_ID = 128;
const HASH_DIGITS = 16;

/** FNV-1a over UTF-16 code units, 32 bits. Integer arithmetic only, so every device agrees. */
function fnv1a(text: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function hex(value: number): string {
  return value.toString(16).padStart(8, '0');
}

export function assessmentIdFor(reportId: string, promptVersion: string): string {
  const plain = `assess:${reportId}:${promptVersion}`;
  if (plain.length <= MAX_ID && !reportId.includes(':')) return plain;
  // Lengths are part of the hashed text so ("ab", "c") and ("a", "bc") differ.
  const keyed = `${reportId.length}:${reportId}:${promptVersion.length}:${promptVersion}`;
  const digest = hex(fnv1a(keyed, 0x811c9dc5)) + hex(fnv1a(keyed, 0x9747b28c));
  const head = 'assess~';
  const room = MAX_ID - head.length - 1 - HASH_DIGITS;
  return `${head}${reportId.slice(0, room)}~${digest}`;
}
