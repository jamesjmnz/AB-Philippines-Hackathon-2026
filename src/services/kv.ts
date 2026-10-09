import type { KeyValueStore } from '@/sync/types';

export type { KeyValueStore } from '@/sync/types';

/** In-memory key-value store: the Demo Lab's storage and the Jest double. Nothing survives a restart. */
export function createMemoryKeyValueStore(initial: Record<string, string> = {}): KeyValueStore & { dump(): Record<string, string> } {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    async get(key) {
      return data.get(key) ?? null;
    },
    async set(key, value) {
      data.set(key, value);
    },
    async remove(key) {
      data.delete(key);
    },
    dump() {
      return Object.fromEntries(data);
    },
  };
}

/** Namespaces every key, so LIVE data cannot collide with anything else in the same backing store. */
export function prefixedKeyValueStore(inner: KeyValueStore, prefix: string): KeyValueStore {
  return {
    get: (key) => inner.get(prefix + key),
    set: (key, value) => inner.set(prefix + key, value),
    remove: (key) => inner.remove(prefix + key),
  };
}

/** Reads and parses JSON; anything unreadable is treated as absent. */
export async function readJson(kv: KeyValueStore, key: string): Promise<unknown> {
  try {
    const raw = await kv.get(key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export async function writeJson(kv: KeyValueStore, key: string, value: unknown): Promise<void> {
  try {
    await kv.set(key, JSON.stringify(value));
  } catch {
    // Persistence is best effort for settings and labels; the in-memory value stays authoritative.
  }
}
