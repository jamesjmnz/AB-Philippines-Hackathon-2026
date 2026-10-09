import { z } from 'zod';

import type { KeyValueStore } from './types';

/**
 * Store-and-forward queue of packets this device is carrying for somebody else. Entries are the
 * encoded packet exactly as received (hop count already incremented): routing metadata plus
 * ciphertext this device has no key for.
 */
const relayedPacketSchema = z.strictObject({
  packetId: z.string().min(1).max(64),
  kind: z.enum(['capsule', 'receipt']),
  to: z.string().min(1).max(128),
  origin: z.string().min(1).max(128),
  receivedFrom: z.string().min(1).max(128),
  expiresAtMs: z.number().int().nonnegative(),
  /** The packet JSON, ready to send. */
  json: z.string().min(1),
});
export type RelayedPacket = z.infer<typeof relayedPacketSchema>;

export const RELAY_KEY = 'relay.queue';

export class RelayStore {
  private items = new Map<string, RelayedPacket>();

  constructor(
    private readonly kv: KeyValueStore,
    private readonly maxPackets: number,
  ) {}

  async load(): Promise<void> {
    try {
      const raw = await this.kv.get(RELAY_KEY);
      if (raw === null) return;
      const parsed = z.array(relayedPacketSchema).safeParse(JSON.parse(raw));
      if (parsed.success) this.items = new Map(parsed.data.map((p) => [p.packetId, p]));
    } catch {
      this.items = new Map();
    }
  }

  private async persist(): Promise<void> {
    try {
      await this.kv.set(RELAY_KEY, JSON.stringify([...this.items.values()]));
    } catch {
      // The queue still works in memory; it just will not survive a restart.
    }
  }

  list(): RelayedPacket[] {
    return [...this.items.values()];
  }

  has(packetId: string): boolean {
    return this.items.has(packetId);
  }

  /** Keyed by packet id: a retried packet replaces the stored copy instead of adding a second one. */
  async put(packet: RelayedPacket): Promise<void> {
    this.items.delete(packet.packetId);
    this.items.set(packet.packetId, packet);
    while (this.items.size > this.maxPackets) {
      const oldest = this.items.keys().next();
      if (oldest.done) break;
      this.items.delete(oldest.value);
    }
    await this.persist();
  }

  async remove(packetId: string): Promise<void> {
    if (this.items.delete(packetId)) await this.persist();
  }

  async purgeExpired(nowMs: number): Promise<void> {
    let changed = false;
    for (const [id, p] of this.items) {
      if (p.expiresAtMs <= nowMs) {
        this.items.delete(id);
        changed = true;
      }
    }
    if (changed) await this.persist();
  }

  async clear(): Promise<void> {
    this.items.clear();
    await this.persist();
  }
}
