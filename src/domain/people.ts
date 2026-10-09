import { z } from 'zod';

import { DisclosureLevelSchema } from './disclosure';
import { IdSchema, NameSchema } from './primitives';

export const UserSchema = z.strictObject({
  userName: NameSchema,
});
export type User = z.infer<typeof UserSchema>;

/** This device. Key identifiers are filled in by the crypto layer in a later phase. */
export const DeviceIdentitySchema = z.strictObject({
  deviceId: IdSchema,
  userName: NameSchema,
  signingKeyId: IdSchema.optional(),
  agreementKeyId: IdSchema.optional(),
});
export type DeviceIdentity = z.infer<typeof DeviceIdentitySchema>;

/** A paired peer and the disclosure level the user grants it by default. */
export const TrustedPeerSchema = z.strictObject({
  deviceId: IdSchema,
  userName: NameSchema,
  level: DisclosureLevelSchema,
  signingKeyId: IdSchema.optional(),
  pairedAtMs: z.number().int().nonnegative().optional(),
});
export type TrustedPeer = z.infer<typeof TrustedPeerSchema>;
