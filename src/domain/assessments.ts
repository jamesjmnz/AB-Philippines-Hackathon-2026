/**
 * Identity of a model assessment of one statement.
 *
 * The id is derived from what was assessed and with which prompt, not from the device or the time,
 * so two devices that assess the same statement with the same prompt record the same assessment:
 * the reducer keeps the first in replay order and lists the other as `duplicate_entity`. A new
 * prompt version gives a new id, so a later prompt can assess the statement again.
 */
export function assessmentIdFor(reportId: string, promptVersion: string): string {
  return `assess:${reportId}:${promptVersion}`.slice(0, 128);
}
