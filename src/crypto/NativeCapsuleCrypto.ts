import PulseCrypto from '../../modules/pulse-crypto';
import {
  CAPSULE_SECTIONS,
  capsuleEnvelopeSchema,
  pairingMaterialSchema,
  type CapsuleCrypto,
  type CapsuleSectionName,
  type CryptoFailure,
  type CryptoResult,
} from './types';

/** Maps Swift `CryptoCoreError` cases (surfaced in the rejection message) to typed reasons. */
export function classifyCryptoError(error: unknown): { reason: CryptoFailure; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (/expired/i.test(message)) return { reason: 'expired', message };
  if (/badSignature/i.test(message)) return { reason: 'bad_signature', message };
  if (/senderMismatch/i.test(message)) return { reason: 'untrusted_sender', message };
  if (/notARecipient/i.test(message)) return { reason: 'not_a_recipient', message };
  if (/decryptionFailed/i.test(message)) return { reason: 'decryption_failed', message };
  if (/unsupportedVersion/i.test(message)) return { reason: 'unsupported_version', message };
  if (/invalidEnvelope|invalidKey|invalidPairingMaterial|malformed/i.test(message)) return { reason: 'malformed', message };
  return { reason: 'native_error', message };
}

async function guarded<T>(run: () => Promise<T>): Promise<CryptoResult<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, ...classifyCryptoError(error) };
  }
}

/** CapsuleCrypto backed by CryptoKit and the Keychain through the Swift module. */
export function createNativeCapsuleCrypto(): CapsuleCrypto {
  return {
    createOrLoadIdentity: () => PulseCrypto.createOrLoadIdentity(),

    exportPublicPairingMaterial: async () => pairingMaterialSchema.parse(JSON.parse(await PulseCrypto.exportPublicPairingMaterial())),

    verifyPeerPairing: (peer) => guarded(() => PulseCrypto.verifyPeerPairing(JSON.stringify(pairingMaterialSchema.parse(peer)))),

    encryptForRecipients: (input) =>
      guarded(async () => {
        const sections = CAPSULE_SECTIONS.flatMap((name) => {
          const text = input.sections[name];
          return text === undefined ? [] : [{ name, text }];
        });
        const json = await PulseCrypto.encryptForRecipients(
          { capsuleId: input.capsuleId, incidentRef: input.incidentRef, createdAtMs: input.createdAtMs, expiresAtMs: input.expiresAtMs, hopLimit: input.hopLimit },
          sections,
          input.recipients.map((r) => ({
            deviceId: r.material.deviceId,
            agreeKey: r.material.agreeKey,
            // Never wrap a key for a section that is not being sent.
            sections: r.sections.filter((s) => input.sections[s] !== undefined),
          })),
        );
        return capsuleEnvelopeSchema.parse(JSON.parse(json));
      }),

    verifyEnvelope: (envelope, sender, nowMs) =>
      guarded(async () => {
        await PulseCrypto.verifyEnvelope(JSON.stringify(envelope), JSON.stringify(sender), nowMs);
        return true as const;
      }),

    decryptAuthorized: (envelope, sender, nowMs) =>
      guarded(async () => {
        const opened = await PulseCrypto.decryptAuthorized(JSON.stringify(envelope), JSON.stringify(sender), nowMs);
        const out: Partial<Record<CapsuleSectionName, string>> = {};
        for (const name of CAPSULE_SECTIONS) {
          const text = opened[name];
          if (typeof text === 'string') out[name] = text;
        }
        return out;
      }),

    signEvent: (canonicalText) => PulseCrypto.signEvent(canonicalText),

    verifyEventSignature: async (canonicalText, signature, signer) => {
      try {
        return await PulseCrypto.verifyEventSignature(canonicalText, signature, JSON.stringify(signer));
      } catch {
        return false;
      }
    },
  };
}
