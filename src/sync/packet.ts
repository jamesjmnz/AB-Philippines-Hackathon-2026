import { z } from 'zod';

import { capsuleEnvelopeSchema, pairingMaterialSchema } from '@/crypto/types';
import { NameSchema } from '@/domain';
import { bytesToUtf8, utf8ToBytes } from '@/transport/base64';

/**
 * Wire format. Every packet is one JSON object, UTF-8 encoded, inside one transport frame.
 *
 * `capsule` and `receipt` packets carry a signed, encrypted `CapsuleEnvelope` and nothing readable
 * besides routing metadata (`packetId`, `to`, `hops`, and the envelope header). The pairing packets
 * are the only unsealed ones: they exist before any shared key does, and carry public key material,
 * a self-declared display name and a signature — never incident content.
 */

export const PACKET_VERSION = 1;
/** Upper bound on one encoded packet. Larger packets are refused before sending and on receipt. */
export const MAX_PACKET_BYTES = 512 * 1024;
export const MAX_HOPS = 4;

const DeviceId = z.string().regex(/^dev-[0-9a-f]{20}$/);
const PacketId = z.string().min(1).max(64);

const routing = {
  v: z.literal(PACKET_VERSION),
  packetId: PacketId,
  /** How many relays have forwarded this packet. Checked against the signed `header.hopLimit`. */
  hops: z.number().int().min(0).max(MAX_HOPS + 1),
  /** Final recipient: a pseudonymous device id, readable by relays. */
  to: DeviceId,
};

const sealedPacket = <K extends 'capsule' | 'receipt'>(kind: K) =>
  z.strictObject({ ...routing, kind: z.literal(kind), envelope: capsuleEnvelopeSchema });

export const packetSchema = z.discriminatedUnion('kind', [
  sealedPacket('capsule'),
  sealedPacket('receipt'),
  z.strictObject({
    ...routing,
    kind: z.literal('pair_hello'),
    pairing: z.strictObject({ material: pairingMaterialSchema, name: NameSchema }),
  }),
  z.strictObject({
    ...routing,
    kind: z.literal('pair_confirm'),
    pairing: z.strictObject({ signature: z.string().min(8).max(1024) }),
  }),
  z.strictObject({ ...routing, kind: z.literal('pair_cancel') }),
]);

export type Packet = z.infer<typeof packetSchema>;
export type SealedPacket = Extract<Packet, { kind: 'capsule' | 'receipt' }>;
export type PairingPacket = Exclude<Packet, SealedPacket>;

export type PacketDecodeFailure = 'too_large' | 'not_json' | 'invalid_shape';
export type PacketDecodeResult = { ok: true; packet: Packet } | { ok: false; reason: PacketDecodeFailure };

export class PacketTooLargeError extends Error {
  readonly code = 'packet_too_large';
  constructor() {
    super('packet_too_large');
    this.name = 'PacketTooLargeError';
  }
}

export function encodePacket(packet: Packet): Uint8Array {
  const bytes = utf8ToBytes(JSON.stringify(packet));
  if (bytes.byteLength > MAX_PACKET_BYTES) throw new PacketTooLargeError();
  return bytes;
}

export function decodePacket(bytes: Uint8Array): PacketDecodeResult {
  if (bytes.byteLength > MAX_PACKET_BYTES) return { ok: false, reason: 'too_large' };
  let raw: unknown;
  try {
    raw = JSON.parse(bytesToUtf8(bytes));
  } catch {
    return { ok: false, reason: 'not_json' };
  }
  const parsed = packetSchema.safeParse(raw);
  return parsed.success ? { ok: true, packet: parsed.data } : { ok: false, reason: 'invalid_shape' };
}

/** The envelope's `capsuleId` is derived from the packet id, so a packet id cannot be swapped onto another envelope. */
export function capsuleIdFor(packetId: string): string {
  return packetId.length >= 8 ? packetId : packetId.padEnd(8, '_');
}

/** Pseudonymous incident reference placed in the readable header. Incident ids are random and carry no content. */
export function incidentRefFor(incidentId: string): string {
  const ref = incidentId.length > 64 ? incidentId.slice(0, 64) : incidentId;
  return ref.length >= 8 ? ref : ref.padEnd(8, '_');
}
