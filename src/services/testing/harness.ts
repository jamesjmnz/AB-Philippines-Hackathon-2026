import type { LocalAIService } from '@/ai';
import { createFakeCapsuleCrypto, createFakeCryptoRealm, type FakeCryptoRealm } from '@/crypto/testing';
import type { CapsuleCrypto, PairingMaterial } from '@/crypto/types';
import { createSequentialIds, type DisclosureLevel } from '@/domain';
import { SimulatedAI } from '@/demo/SimulatedAI';
import { createMemoryIncidentRepository, type IncidentRepository } from '@/storage';
import { decodePacket, type Packet } from '@/sync/packet';
import type { PeerRecord, Timers } from '@/sync/types';
import { createMemoryHub, type MemoryHub } from '@/transport/testing';
import type { PeerTransport } from '@/transport/types';

import type { IncidentView } from '../api';
import { createMemoryKeyValueStore } from '../kv';
import { PulseCore, type CoreConfig, type PulseCoreDeps } from '../PulseCore';

/** Jest harness: N device cores on the in-memory hub with the fake crypto. No timers fire unless a test fires them. */

export class ManualClock {
  now = 1_760_000_000_000;
  nowMs = (): number => this.now;
  advance(ms: number): void {
    this.now += ms;
  }
}

/** Timers that never fire on their own. `fireIntervals` runs every registered interval callback once. */
export function createInertTimers(): Timers & { fireIntervals(): void; fireTimeouts(): void } {
  const intervals = new Map<number, () => void>();
  const timeouts = new Map<number, () => void>();
  let next = 1;
  return {
    setTimeout(fn) {
      timeouts.set(next, fn);
      return next++;
    },
    clearTimeout(handle) {
      timeouts.delete(handle as number);
    },
    setInterval(fn) {
      intervals.set(next, fn);
      return next++;
    },
    clearInterval(handle) {
      intervals.delete(handle as number);
    },
    fireIntervals() {
      for (const fn of [...intervals.values()]) fn();
    },
    fireTimeouts() {
      const pending = [...timeouts.values()];
      timeouts.clear();
      for (const fn of pending) fn();
    },
  };
}

export interface TestDevice {
  name: string;
  id: string;
  core: PulseCore;
  crypto: CapsuleCrypto;
  material: PairingMaterial;
  repo: IncidentRepository;
  kv: ReturnType<typeof createMemoryKeyValueStore>;
  transport: PeerTransport;
  timers: ReturnType<typeof createInertTimers>;
  incident(id: string): IncidentView | undefined;
}

export interface SeenPacket {
  from: string;
  to: string;
  bytes: Uint8Array;
  packet: Packet | null;
}

export interface TestNet {
  hub: MemoryHub;
  realm: FakeCryptoRealm;
  clock: ManualClock;
  devices: Record<string, TestDevice>;
  /** Every packet any device handed to the simulated radio, in order. */
  wire: SeenPacket[];
  settle(): Promise<void>;
  dispose(): Promise<void>;
}

export interface TestNetOptions {
  devices: readonly string[];
  /** `[x, y, level x grants y, level y grants x]`. Omit a level to leave that direction untrusted. */
  trust?: readonly (readonly [string, string, DisclosureLevel | null, DisclosureLevel | null])[];
  /** Pairs with a radio link. Default: every pair is linked. */
  links?: readonly (readonly [string, string])[];
  config?: Partial<CoreConfig>;
  perDevice?: Record<string, { config?: Partial<CoreConfig>; ai?: LocalAIService; start?: boolean; onboarded?: boolean }>;
}

async function microtasks(count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) await Promise.resolve();
}

export async function createTestNet(options: TestNetOptions): Promise<TestNet> {
  const realm = createFakeCryptoRealm();
  const hub = createMemoryHub({ defaultLinked: options.links === undefined });
  const clock = new ManualClock();
  const cryptos = new Map<string, CapsuleCrypto>();
  const materials = new Map<string, PairingMaterial>();
  for (const name of options.devices) {
    const crypto = createFakeCapsuleCrypto(realm, `test-${name}`);
    cryptos.set(name, crypto);
    materials.set(name, await crypto.exportPublicPairingMaterial());
  }
  const material = (name: string): PairingMaterial => {
    const m = materials.get(name);
    if (!m) throw new Error(`unknown test device ${name}`);
    return m;
  };
  for (const [a, b] of options.links ?? []) hub.setLink(material(a).deviceId, material(b).deviceId, true);

  const wire: SeenPacket[] = [];
  hub.tap((from, to, bytes) => {
    const decoded = decodePacket(bytes);
    wire.push({ from, to, bytes, packet: decoded.ok ? decoded.packet : null });
  });

  const devices: Record<string, TestDevice> = {};
  for (const name of options.devices) {
    const peers: PeerRecord[] = [];
    for (const [x, y, xGrantsY, yGrantsX] of options.trust ?? []) {
      if (x === name && xGrantsY) peers.push({ deviceId: material(y).deviceId, name: y, level: xGrantsY, material: material(y), pairedAtMs: 0 });
      if (y === name && yGrantsX) peers.push({ deviceId: material(x).deviceId, name: x, level: yGrantsX, material: material(x), pairedAtMs: 0 });
    }
    const extra = options.perDevice?.[name] ?? {};
    const crypto = cryptos.get(name);
    if (!crypto) throw new Error('missing crypto');
    const repo = createMemoryIncidentRepository();
    const kv = createMemoryKeyValueStore();
    const transport = hub.createTransport();
    const timers = createInertTimers();
    const deps: PulseCoreDeps = {
      mode: 'live',
      repo,
      ai: extra.ai ?? new SimulatedAI({ device: { model: 'Test iPhone', osVersion: '0' }, textCapable: true }),
      transport,
      crypto,
      kv,
      clock,
      ids: createSequentialIds(name),
      deviceInfo: { model: 'Test iPhone', osVersion: '0' },
      timers,
      readFile: async () => new Uint8Array([1, 2, 3]),
      config: { ...(options.config ?? {}), ...(extra.config ?? {}) },
      seed: { name, onboarded: extra.onboarded ?? true, peers },
    };
    const core = new PulseCore(deps);
    devices[name] = {
      name,
      id: material(name).deviceId,
      core,
      crypto,
      material: material(name),
      repo,
      kv,
      transport,
      timers,
      incident: (id) => core.getSnapshot().incidents.find((i) => i.id === id),
    };
  }

  const all = Object.values(devices);
  const net: TestNet = {
    hub,
    realm,
    clock,
    devices,
    wire,
    async settle() {
      let quiet = 0;
      for (let round = 0; round < 500 && quiet < 2; round += 1) {
        await hub.idle();
        await Promise.all(all.map((d) => d.core.whenIdle()));
        await microtasks(4);
        quiet = hub.pending === 0 && all.every((d) => d.core.busy === 0) ? quiet + 1 : 0;
      }
    },
    async dispose() {
      await Promise.all(all.map((d) => d.core.dispose()));
    },
  };

  await Promise.all(all.filter((d) => options.perDevice?.[d.name]?.start !== false).map((d) => d.core.start()));
  await net.settle();
  return net;
}

/** The device with the given test name; throws instead of returning undefined so tests stay terse. */
export function dev(net: TestNet, name: string): TestDevice {
  const device = net.devices[name];
  if (!device) throw new Error(`unknown test device ${name}`);
  return device;
}

export function must<T>(result: { ok: true; value: T } | { ok: false; code: string }): T {
  if (!result.ok) throw new Error(`action refused: ${result.code}`);
  return result.value;
}
