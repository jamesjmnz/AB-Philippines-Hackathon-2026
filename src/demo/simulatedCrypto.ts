import {
  capsuleEnvelopeSchema,
  pairingMaterialSchema,
  type CapsuleCrypto,
  type CapsuleEnvelope,
  type CapsuleSectionName,
  type CryptoFailure,
  type CryptoResult,
  type PairingMaterial,
} from '@/crypto/types';

/**
 * SIMULATED CapsuleCrypto for the Demo Lab and for Jest. It is not cryptography and protects
 * nothing outside this process. What it does do is enforce the same access rules as the native
 * module, so tests about who can read what are meaningful:
 *
 * - Plaintext never appears in an envelope. A section's `ct` is an opaque handle; the plaintext sits
 *   in a private vault inside the realm, readable only by the device ids the sender listed.
 * - Signatures are keyed digests over the whole envelope using a per-device secret that never
 *   leaves the realm, so any change to the header, sections or wraps is detected.
 * - A device with no wrap gets `not_a_recipient`, exactly like a relay-only peer.
 */

type VaultEntry = { plaintext: string; readers: ReadonlySet<string> };

interface RealmState {
  /** signKey -> signing secret. */
  secrets: Map<string, string>;
  vault: Map<string, VaultEntry>;
  counter: number;
}

const realms = new WeakMap<SimulatedCryptoRealm, RealmState>();

/** One simulated "world" of devices. Devices in different realms cannot verify or open each other's envelopes. */
export class SimulatedCryptoRealm {
  constructor() {
    realms.set(this, { secrets: new Map(), vault: new Map(), counter: 0 });
  }
}

export function createSimulatedCryptoRealm(): SimulatedCryptoRealm {
  return new SimulatedCryptoRealm();
}

function stateOf(realm: SimulatedCryptoRealm): RealmState {
  const state = realms.get(realm);
  if (!state) throw new Error('unknown simulated crypto realm');
  return state;
}

/** Deterministic non-cryptographic digest (FNV-1a rounds), hex encoded. */
export function simulatedDigest(text: string, hexLength: number): string {
  let out = '';
  for (let round = 0; out.length < hexLength; round += 1) {
    let h = 0x811c9dc5 ^ (round * 0x9e3779b1);
    const salted = `${round}|${text}`;
    for (let i = 0; i < salted.length; i += 1) {
      h ^= salted.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    out += (h >>> 0).toString(16).padStart(8, '0');
  }
  return out.slice(0, hexLength);
}

function fail<T>(reason: CryptoFailure): CryptoResult<T> {
  return { ok: false, reason, message: reason };
}

function signedText(envelope: CapsuleEnvelope): string {
  const h = envelope.header;
  return JSON.stringify([
    envelope.v,
    [h.capsuleId, h.incidentRef, h.senderId, h.createdAtMs, h.expiresAtMs, h.hopLimit],
    envelope.ephemeralKey,
    envelope.sections.map((s) => [s.name, s.ct]),
    envelope.wraps.map((w) => [w.recipientId, w.section, w.wrappedKey]),
  ]);
}

export function simulatedDeviceId(signKey: string, agreeKey: string): string {
  return `dev-${simulatedDigest(`id|${signKey}|${agreeKey}`, 20)}`;
}

export interface SimulatedCryptoOptions {
  /** Reported by `createOrLoadIdentity`. The simulation has no hardware keys. */
  hardwareBacked?: boolean;
}

/** A device identity inside a realm. The same `seed` always yields the same device id and keys. */
export function createSimulatedCrypto(realm: SimulatedCryptoRealm, seed: string, options: SimulatedCryptoOptions = {}): CapsuleCrypto {
  const state = stateOf(realm);
  const signKey = `sim-sign-${simulatedDigest(`sign|${seed}`, 40)}`;
  const agreeKey = `sim-agree-${simulatedDigest(`agree|${seed}`, 40)}`;
  const deviceId = simulatedDeviceId(signKey, agreeKey);
  const material: PairingMaterial = { v: 1, deviceId, signKey, agreeKey };
  state.secrets.set(signKey, simulatedDigest(`secret|${seed}`, 40));

  const sign = (key: string, text: string): string | null => {
    const secret = state.secrets.get(key);
    return secret === undefined ? null : `sim-sig-${simulatedDigest(`${secret}|${text}`, 48)}`;
  };

  const verify = (raw: CapsuleEnvelope, sender: PairingMaterial, nowMs: number): CryptoResult<CapsuleEnvelope> => {
    if ((raw as { v?: unknown }).v !== 1) return fail('unsupported_version');
    const parsed = capsuleEnvelopeSchema.safeParse(raw);
    if (!parsed.success) return fail('malformed');
    const envelope = parsed.data;
    const senderMaterial = pairingMaterialSchema.safeParse(sender);
    if (!senderMaterial.success) return fail('malformed');
    if (envelope.header.senderId !== senderMaterial.data.deviceId) return fail('untrusted_sender');
    if (simulatedDeviceId(senderMaterial.data.signKey, senderMaterial.data.agreeKey) !== senderMaterial.data.deviceId) {
      return fail('untrusted_sender');
    }
    const expected = sign(senderMaterial.data.signKey, signedText(envelope));
    if (expected === null || expected !== envelope.signature) return fail('bad_signature');
    if (envelope.header.expiresAtMs <= nowMs) return fail('expired');
    return { ok: true, value: envelope };
  };

  return {
    async createOrLoadIdentity() {
      return { deviceId, hardwareBacked: options.hardwareBacked ?? false };
    },

    async exportPublicPairingMaterial() {
      return { ...material };
    },

    async verifyPeerPairing(peer) {
      const parsed = pairingMaterialSchema.safeParse(peer);
      if (!parsed.success) return fail('malformed');
      const p = parsed.data;
      if (simulatedDeviceId(p.signKey, p.agreeKey) !== p.deviceId) return fail('malformed');
      if (p.deviceId === deviceId) return fail('malformed');
      const pair = [`${deviceId}:${signKey}:${agreeKey}`, `${p.deviceId}:${p.signKey}:${p.agreeKey}`].sort().join('|');
      const code = (parseInt(simulatedDigest(`code|${pair}`, 8), 16) % 1_000_000).toString().padStart(6, '0');
      return { ok: true, value: { deviceId: p.deviceId, code } };
    },

    async encryptForRecipients(input) {
      const names = (['summary', 'detail'] as const).filter((name) => input.sections[name] !== undefined);
      if (names.length === 0) return fail('malformed');
      const sections = names.map((name) => {
        state.counter += 1;
        const handle = `sim-ct-${simulatedDigest(`${deviceId}|${input.capsuleId}|${name}|${state.counter}`, 32)}`;
        const readers = new Set(input.recipients.filter((r) => r.sections.includes(name)).map((r) => r.material.deviceId));
        state.vault.set(handle, { plaintext: input.sections[name] ?? '', readers });
        return { name, ct: handle };
      });
      const wraps = input.recipients.flatMap((r) =>
        r.sections
          .filter((name) => input.sections[name] !== undefined)
          .map((name) => ({
            recipientId: r.material.deviceId,
            section: name as string,
            wrappedKey: `sim-wrap-${simulatedDigest(`${input.capsuleId}|${name}|${r.material.deviceId}`, 24)}`,
          })),
      );
      state.counter += 1;
      const unsigned = {
        v: 1 as const,
        header: {
          capsuleId: input.capsuleId,
          incidentRef: input.incidentRef,
          senderId: deviceId,
          createdAtMs: input.createdAtMs,
          expiresAtMs: input.expiresAtMs,
          hopLimit: input.hopLimit,
        },
        ephemeralKey: `sim-eph-${simulatedDigest(`${deviceId}|${state.counter}`, 40)}`,
        sections,
        wraps,
        signature: 'x'.repeat(40),
      };
      const signature = sign(signKey, signedText(unsigned));
      if (signature === null) return fail('native_error');
      const parsed = capsuleEnvelopeSchema.safeParse({ ...unsigned, signature });
      return parsed.success ? { ok: true, value: parsed.data } : fail('malformed');
    },

    async verifyEnvelope(envelope, sender, nowMs) {
      const result = verify(envelope, sender, nowMs);
      return result.ok ? { ok: true, value: true } : result;
    },

    async decryptAuthorized(envelope, sender, nowMs) {
      const verified = verify(envelope, sender, nowMs);
      if (!verified.ok) return verified;
      const mine = verified.value.wraps.filter((w) => w.recipientId === deviceId);
      if (mine.length === 0) return fail('not_a_recipient');
      const out: Partial<Record<CapsuleSectionName, string>> = {};
      for (const wrap of mine) {
        if (wrap.section !== 'summary' && wrap.section !== 'detail') continue;
        const section = verified.value.sections.find((s) => s.name === wrap.section);
        if (!section) return fail('decryption_failed');
        const entry = state.vault.get(section.ct);
        // The vault, not the wrap list, is what grants access: a forged wrap opens nothing.
        if (!entry || !entry.readers.has(deviceId)) return fail('decryption_failed');
        out[wrap.section] = entry.plaintext;
      }
      return { ok: true, value: out };
    },

    async signEvent(canonicalText) {
      const signature = sign(signKey, `event|${canonicalText}`);
      if (signature === null) throw new Error('simulated identity missing');
      return signature;
    },

    async verifyEventSignature(canonicalText, signature, signer) {
      const parsed = pairingMaterialSchema.safeParse(signer);
      if (!parsed.success) return false;
      const expected = sign(parsed.data.signKey, `event|${canonicalText}`);
      return expected !== null && expected === signature;
    },
  };
}
