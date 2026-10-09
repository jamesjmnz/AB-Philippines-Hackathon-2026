import { z } from 'zod';

import { pairingMaterialSchema } from '@/crypto/types';
import { DisclosureLevelSchema, NameSchema } from '@/domain';

/** Small async string store for profile, peers, settings, projections and relayed ciphertext. */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Injected timers so retries, pairing timeouts and Demo scripts can run under fake timers. */
export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export const systemTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

/**
 * A paired device. Trust comes from `material` (the keys both people confirmed with the pairing
 * code); `name` is a local label and proves nothing.
 */
export const peerRecordSchema = z.strictObject({
  deviceId: z.string().regex(/^dev-[0-9a-f]{20}$/),
  name: NameSchema,
  /** Default disclosure level for new incidents. `relay` peers only ever carry ciphertext. */
  level: DisclosureLevelSchema,
  material: pairingMaterialSchema,
  pairedAtMs: z.number().int().nonnegative(),
});
export type PeerRecord = z.infer<typeof peerRecordSchema>;

export type SyncFailureCode =
  | 'identity_unavailable'
  | 'peer_not_trusted'
  | 'peer_unreachable'
  | 'pairing_busy'
  | 'pairing_no_response'
  | 'pairing_no_session'
  | 'pairing_material_mismatch'
  | 'pairing_material_changed'
  | 'pairing_bad_confirmation'
  | 'pairing_cancelled'
  | 'pairing_send_failed';
