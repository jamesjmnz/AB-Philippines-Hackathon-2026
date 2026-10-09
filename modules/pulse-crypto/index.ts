import { requireNativeModule } from 'expo-modules-core';

export type NativeCapsuleHeader = { capsuleId: string; incidentRef: string; createdAtMs: number; expiresAtMs: number; hopLimit: number };
export type NativeCapsuleSection = { name: string; text: string };
export type NativeCapsuleRecipient = { deviceId: string; agreeKey: string; sections: string[] };

export type PulseCryptoNativeModule = {
  createOrLoadIdentity(): Promise<{ deviceId: string; hardwareBacked: boolean }>;
  /** JSON PairingMaterial: public keys and derived device id only. */
  exportPublicPairingMaterial(): Promise<string>;
  verifyPeerPairing(peerMaterialJson: string): Promise<{ deviceId: string; code: string }>;
  /** Returns the JSON envelope. Recipients with no sections get no key and can only relay. */
  encryptForRecipients(header: NativeCapsuleHeader, sections: NativeCapsuleSection[], recipients: NativeCapsuleRecipient[]): Promise<string>;
  verifyEnvelope(envelopeJson: string, senderMaterialJson: string, nowMs: number): Promise<boolean>;
  decryptAuthorized(envelopeJson: string, senderMaterialJson: string, nowMs: number): Promise<Record<string, string>>;
  signEvent(canonicalText: string): Promise<string>;
  verifyEventSignature(canonicalText: string, signatureBase64: string, signerMaterialJson: string): Promise<boolean>;
  resetIdentity(): Promise<void>;
};

export default requireNativeModule<PulseCryptoNativeModule>('PulseCrypto');
