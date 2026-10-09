import type { Clock } from '@/domain';
import { createSequentialIds } from '@/domain';
import type { DemoDevice } from '@/services/api';
import { createMemoryKeyValueStore } from '@/services/kv';
import { PulseCore, type CoreConfig } from '@/services/PulseCore';
import { createMemoryIncidentRepository } from '@/storage';
import type { PeerRecord, Timers } from '@/sync/types';

import { createMemoryHub, type MemoryHub } from './memoryHub';
import { DEMO_DEVICES, DEMO_LEVELS, DEMO_LINKS, DEMO_PERSONAS } from './personas';
import { SimulatedAI } from './SimulatedAI';
import { createSimulatedCrypto, createSimulatedCryptoRealm } from './simulatedCrypto';

/** Clock for the simulated world. It can be pinned to a past moment while history is being seeded. */
export class DemoClock implements Clock {
  private pinned: number | null = null;
  private last = 0;

  constructor(private readonly now: () => number) {}

  /** Pins the clock to a moment in the past, or releases it back to the live source with `null`. */
  set(ms: number | null): void {
    this.pinned = ms;
  }

  advance(ms: number): void {
    if (this.pinned !== null) this.pinned += ms;
  }

  nowMs(): number {
    // Pinned time is fully scripted (and always in the past); live time never runs backwards.
    if (this.pinned !== null) return this.pinned;
    this.last = Math.max(this.now(), this.last);
    return this.last;
  }
}

/**
 * Three complete device cores (Alex, Mika, Noah) wired together by the simulated radio, with
 * simulated crypto, in-memory ledgers and simulated AI. Nothing here touches live storage, the
 * keychain, the network or a model.
 */
export interface DemoWorld {
  hub: MemoryHub;
  clock: DemoClock;
  cores: Record<DemoDevice, PulseCore>;
  ais: Record<DemoDevice, SimulatedAI>;
  deviceIds: Record<DemoDevice, string>;
  setLink(device: Exclude<DemoDevice, 'alex'>, connected: boolean): void;
  /** Resolves once every device and the simulated radio have gone quiet. */
  settle(): Promise<void>;
  dispose(): Promise<void>;
}

export interface DemoWorldOptions {
  timers: Timers;
  now: () => number;
  config?: Partial<CoreConfig>;
}

async function microtasks(count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) await Promise.resolve();
}

export async function createDemoWorld(options: DemoWorldOptions): Promise<DemoWorld> {
  const realm = createSimulatedCryptoRealm();
  const hub = createMemoryHub({ defaultLinked: false });
  const clock = new DemoClock(options.now);

  const cryptos = Object.fromEntries(DEMO_DEVICES.map((key) => [key, createSimulatedCrypto(realm, `demo-${key}`)])) as Record<
    DemoDevice,
    ReturnType<typeof createSimulatedCrypto>
  >;
  const materials = Object.fromEntries(
    await Promise.all(DEMO_DEVICES.map(async (key) => [key, await cryptos[key].exportPublicPairingMaterial()] as const)),
  ) as Record<DemoDevice, Awaited<ReturnType<(typeof cryptos)['alex']['exportPublicPairingMaterial']>>>;
  const deviceIds = Object.fromEntries(DEMO_DEVICES.map((key) => [key, materials[key].deviceId])) as Record<DemoDevice, string>;

  const ais = Object.fromEntries(
    DEMO_DEVICES.map((key) => {
      const persona = DEMO_PERSONAS[key];
      return [
        key,
        new SimulatedAI({
          device: { model: persona.deviceModel, osVersion: persona.osVersion },
          textCapable: persona.textModel,
          delayMs: 0,
          timers: options.timers,
        }),
      ];
    }),
  ) as Record<DemoDevice, SimulatedAI>;

  const cores = Object.fromEntries(
    DEMO_DEVICES.map((key) => {
      const persona = DEMO_PERSONAS[key];
      const peers: PeerRecord[] = DEMO_DEVICES.filter((other) => other !== key).map((other) => ({
        deviceId: deviceIds[other],
        name: DEMO_PERSONAS[other].name,
        level: DEMO_LEVELS[key][other] ?? 'trusted',
        material: materials[other],
        pairedAtMs: 0,
      }));
      return [
        key,
        new PulseCore({
          mode: 'demo',
          repo: createMemoryIncidentRepository(),
          ai: ais[key],
          transport: hub.createTransport(),
          crypto: cryptos[key],
          kv: createMemoryKeyValueStore(),
          clock,
          ids: createSequentialIds(key),
          deviceInfo: { model: persona.deviceModel, osVersion: persona.osVersion },
          timers: options.timers,
          readFile: async () => new Uint8Array(0),
          ...(options.config ? { config: options.config } : {}),
          seed: { name: persona.name, onboarded: true, peers },
        }),
      ];
    }),
  ) as Record<DemoDevice, PulseCore>;

  const all = DEMO_DEVICES.map((key) => cores[key]);

  const world: DemoWorld = {
    hub,
    clock,
    cores,
    ais,
    deviceIds,
    setLink(device, connected) {
      const [a, b] = DEMO_LINKS[device];
      hub.setLink(deviceIds[a], deviceIds[b], connected);
    },
    async settle() {
      let quiet = 0;
      for (let round = 0; round < 500 && quiet < 2; round += 1) {
        await hub.idle();
        await Promise.all(all.map((core) => core.whenIdle()));
        await microtasks(4);
        quiet = hub.pending === 0 && all.every((core) => core.busy === 0) ? quiet + 1 : 0;
      }
    },
    async dispose() {
      await Promise.all(all.map((core) => core.dispose()));
    },
  };

  world.setLink('mika', true);
  world.setLink('noah', true);
  await Promise.all(all.map((core) => core.start()));
  await world.settle();
  return world;
}
