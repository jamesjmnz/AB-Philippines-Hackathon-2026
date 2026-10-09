import { z } from 'zod';

/** Public keys and derived id of one device. Safe to show and to send; contains nothing private. */
export const pairingMaterialSchema = z.strictObject({
  v: z.literal(1),
  deviceId: z.string().regex(/^dev-[0-9a-f]{20}$/),
  signKey: z.string().min(40).max(200),
  agreeKey: z.string().min(40).max(200),
});
export type PairingMaterial = z.infer<typeof pairingMaterialSchema>;

/** Routing metadata a relay can read. No names, symptoms or report text may ever be placed here. */
export const capsuleHeaderSchema = z.strictObject({
  capsuleId: z.string().min(8).max(64),
  incidentRef: z.string().min(8).max(64),
  senderId: z.string().regex(/^dev-[0-9a-f]{20}$/),
  createdAtMs: z.number().int().nonnegative(),
  expiresAtMs: z.number().int().nonnegative(),
  hopLimit: z.number().int().min(0).max(4),
});

export const capsuleEnvelopeSchema = z.strictObject({
  v: z.literal(1),
  header: capsuleHeaderSchema,
  ephemeralKey: z.string().min(40).max(200),
  sections: z.array(z.strictObject({ name: z.string().min(1).max(32), ct: z.string().min(1) })).min(1).max(4),
  wraps: z.array(z.strictObject({ recipientId: z.string(), section: z.string(), wrappedKey: z.string() })).max(64),
  signature: z.string().min(40).max(200),
});
export type CapsuleEnvelope = z.infer<typeof capsuleEnvelopeSchema>;

export const CAPSULE_SECTIONS = ['summary', 'detail'] as const;
export type CapsuleSectionName = (typeof CAPSULE_SECTIONS)[number];

export type CapsuleRecipientInput = {
  material: PairingMaterial;
  /** Sections this recipient may read. Empty means relay-only: it receives ciphertext it cannot open. */
  sections: readonly CapsuleSectionName[];
};

export type CapsuleSealInput = {
  capsuleId: string;
  incidentRef: string;
  createdAtMs: number;
  expiresAtMs: number;
  hopLimit: number;
  sections: Partial<Record<CapsuleSectionName, string>>;
  recipients: readonly CapsuleRecipientInput[];
};

export type CryptoFailure = 'expired' | 'bad_signature' | 'untrusted_sender' | 'not_a_recipient' | 'decryption_failed' | 'malformed' | 'unsupported_version' | 'native_error';

export type CryptoResult<T> = { ok: true; value: T } | { ok: false; reason: CryptoFailure; message: string };

/** Identity, pairing and capsule crypto. Private keys stay inside the implementation. */
export interface CapsuleCrypto {
  createOrLoadIdentity(): Promise<{ deviceId: string; hardwareBacked: boolean }>;
  exportPublicPairingMaterial(): Promise<PairingMaterial>;
  /** Validates a peer's material and returns the six-digit code both people compare before trusting. */
  verifyPeerPairing(peer: PairingMaterial): Promise<CryptoResult<{ deviceId: string; code: string }>>;
  encryptForRecipients(input: CapsuleSealInput): Promise<CryptoResult<CapsuleEnvelope>>;
  /** Signature, sender, version and expiry. This is everything a relay-only device can check. */
  verifyEnvelope(envelope: CapsuleEnvelope, sender: PairingMaterial, nowMs: number): Promise<CryptoResult<true>>;
  decryptAuthorized(envelope: CapsuleEnvelope, sender: PairingMaterial, nowMs: number): Promise<CryptoResult<Partial<Record<CapsuleSectionName, string>>>>;
  signEvent(canonicalText: string): Promise<string>;
  verifyEventSignature(canonicalText: string, signature: string, signer: PairingMaterial): Promise<boolean>;
}
