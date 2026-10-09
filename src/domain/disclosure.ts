import { z } from 'zod';

import type { ClaimField } from './claims';
import { IdSchema, NameSchema } from './primitives';

/**
 * Disclosure levels a reporter can grant a recipient.
 * - relay: routes ciphertext, reads nothing.
 * - trusted: reads the approved summary.
 * - authorized: additionally reads restricted detail the reporter opted to share.
 * `owner` is the reporter and is never granted to anyone else.
 */
export const DISCLOSURE_LEVELS = ['relay', 'trusted', 'authorized'] as const;
export const DisclosureLevelSchema = z.enum(DISCLOSURE_LEVELS);
export type DisclosureLevel = z.infer<typeof DisclosureLevelSchema>;
export type AccessLevel = DisclosureLevel | 'owner';

export const DisclosureRecipientSchema = z.strictObject({
  deviceId: IdSchema,
  level: DisclosureLevelSchema,
  userName: NameSchema.optional(),
});
export type DisclosureRecipient = z.infer<typeof DisclosureRecipientSchema>;

export const DisclosurePolicySchema = z.strictObject({
  /** When false, trusted and authorized recipients get the building only (no floor, no location text). */
  shareDetailedLocation: z.boolean(),
  /** When false, nobody but the reporter reads the symptom or the original report text. */
  shareSymptoms: z.boolean(),
  recipients: z.array(DisclosureRecipientSchema).max(32),
});
export type DisclosurePolicy = z.infer<typeof DisclosurePolicySchema>;

/** Readable items: the claim fields plus the verbatim report text. */
export type DisclosableItem = ClaimField | 'originalReport';

/**
 * Deterministic access matrix. This is the single source of truth for what a level may read;
 * the capsule encryptor uses it to decide which ciphertext a field goes into.
 */
export function canReadItem(
  level: AccessLevel,
  item: DisclosableItem,
  policy: Pick<DisclosurePolicy, 'shareDetailedLocation' | 'shareSymptoms'>,
): boolean {
  if (level === 'owner') return true;
  if (level === 'relay') return false;
  switch (item) {
    case 'incidentType':
    case 'building':
    case 'assistanceRequested':
      return true;
    case 'floor':
    case 'locationText':
      return policy.shareDetailedLocation;
    case 'symptom':
    case 'originalReport':
      return level === 'authorized' && policy.shareSymptoms;
  }
}

/** The level a device holds under a policy. Unlisted devices read nothing. */
export function levelInPolicy(policy: DisclosurePolicy, deviceId: string): DisclosureLevel {
  return policy.recipients.find((r) => r.deviceId === deviceId)?.level ?? 'relay';
}
