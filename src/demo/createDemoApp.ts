import type { DemoDevice, DemoState, PulseActions, PulseApp, PulseSnapshot } from '@/services/api';
import { DEFAULT_SETTINGS, type CoreConfig } from '@/services/PulseCore';
import { systemTimers, type Timers } from '@/sync/types';

import { DEMO_DEVICES } from './personas';
import { DEMO_SCENARIOS, seedDemoWorld, type ScenarioContext } from './scenarios';
import { createDemoWorld, type DemoWorld } from './world';

/**
 * DEMO PulseApp. Three simulated devices run the real domain, storage and sync code against a
 * simulated radio, simulated crypto and simulated AI; `demo.viewAs` chooses whose phone the screens
 * show. Its snapshot always says `mode: 'demo'` and its capabilities always say `simulated`.
 */

export interface DemoAppOptions {
  timers?: Timers;
  now?: () => number;
  /** Artificial thinking time of the simulated AI once the seed is in place. 0 in tests. */
  aiDelayMs?: number;
  /** Multiplies the pauses between scenario steps. */
  stepScale?: number;
  config?: Partial<CoreConfig>;
}

export interface DemoApp extends PulseApp {
  /** For tests and the Demo Lab's own diagnostics. Screens use `actions.demo` only. */
  internals: {
    world(): DemoWorld | null;
    /** Resolves when the seeded world is in place. */
    whenReady(): Promise<void>;
    /** Resolves when the running scenario (if any) has finished or was cancelled. */
    scenarioFinished(): Promise<void>;
    /** Steps the last seed or scenario had refused, as `label:code`. Empty when everything applied. */
    failures(): readonly string[];
    seedIncidentId(): string | null;
    lastIncidentId(): string | null;
  };
}

const SCENARIO_LIST = DEMO_SCENARIOS.map(({ key, title, description }) => ({ key, title, description }));

const INITIAL_DEMO: DemoState = {
  viewingAs: 'alex',
  aiReady: true,
  links: { mika: true, noah: true },
  runningScenario: null,
  scenarios: SCENARIO_LIST,
};

const PLACEHOLDER: PulseSnapshot = Object.freeze<PulseSnapshot>({
  mode: 'demo',
  ready: false,
  me: { deviceId: '', name: '', onboarded: false, hardwareBackedKeys: null },
  capabilities: null,
  network: { discovery: 'off', error: null },
  peers: [],
  incidents: [],
  pairing: null,
  settings: DEFAULT_SETTINGS,
  demo: INITIAL_DEMO,
});

export function createDemoApp(options: DemoAppOptions = {}): DemoApp {
  const timers = options.timers ?? systemTimers;
  const now = options.now ?? (() => Date.now());
  const aiDelayMs = options.aiDelayMs ?? 900;
  const stepScale = options.stepScale ?? 1;

  const listeners = new Set<() => void>();
  let world: DemoWorld | null = null;
  let unsubscribe: (() => void)[] = [];
  let demo: DemoState = INITIAL_DEMO;
  let seedIncidentId: string | null = null;
  let lastIncidentId: string | null = null;
  let failures: string[] = [];
  let generation = 0;
  let disposed = false;
  let building: Promise<void> = Promise.resolve();
  let scenario: Promise<void> = Promise.resolve();
  let sleepTimer: unknown = null;
  let wakeSleeper: (() => void) | null = null;

  let snapshot: PulseSnapshot = PLACEHOLDER;
  let lastBase: PulseSnapshot | null = null;
  let lastDemo: DemoState = demo;

  const emit = () => {
    const base = world ? world.cores[demo.viewingAs].getSnapshot() : null;
    if (base === lastBase && demo === lastDemo) return;
    lastBase = base;
    lastDemo = demo;
    snapshot = Object.freeze(base ? { ...base, mode: 'demo' as const, demo } : { ...PLACEHOLDER, demo });
    for (const listener of [...listeners]) listener();
  };

  const setDemo = (patch: Partial<DemoState>) => {
    const next = { ...demo, ...patch };
    if (JSON.stringify(next) === JSON.stringify(demo)) return;
    demo = next;
    emit();
  };

  const cancelSleep = () => {
    if (sleepTimer !== null) timers.clearTimeout(sleepTimer);
    sleepTimer = null;
    const wake = wakeSleeper;
    wakeSleeper = null;
    if (wake) wake();
  };

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      if (ms <= 0) {
        resolve();
        return;
      }
      wakeSleeper = resolve;
      sleepTimer = timers.setTimeout(() => {
        sleepTimer = null;
        wakeSleeper = null;
        resolve();
      }, ms);
    });

  /** Builds a fresh seeded world and swaps it in. The previous world stays visible until then. */
  const rebuild = (gen: number): Promise<void> => {
    building = building
      .then(async () => {
        if (disposed || gen !== generation) return;
        const next = await createDemoWorld({ timers, now, ...(options.config ? { config: options.config } : {}) });
        const seeded = await seedDemoWorld(next, now());
        if (disposed || gen !== generation) {
          await next.dispose();
          return;
        }
        for (const key of DEMO_DEVICES) next.ais[key].setDelay(aiDelayMs);
        const previous = world;
        for (const off of unsubscribe) off();
        world = next;
        seedIncidentId = seeded.seedIncidentId;
        lastIncidentId = null;
        failures = [...seeded.failures];
        unsubscribe = DEMO_DEVICES.map((key) => next.cores[key].subscribe(emit));
        demo = { ...demo, viewingAs: 'alex', aiReady: true, links: { mika: true, noah: true } };
        emit();
        if (previous) await previous.dispose();
      })
      .catch(() => {
        failures = [...failures, 'world:build_failed'];
      });
    return building;
  };

  const runScenario = (key: string) => {
    const definition = DEMO_SCENARIOS.find((s) => s.key === key);
    if (!definition || disposed) return;
    generation += 1;
    const gen = generation;
    cancelSleep();
    setDemo({ runningScenario: key });
    scenario = (async () => {
      await rebuild(gen);
      const current = world;
      if (!current || gen !== generation || !seedIncidentId) return;
      const ctx: ScenarioContext = {
        world: current,
        seedIncidentId,
        incidentId: null,
        reportId: null,
        proposal: null,
        failures,
        setLink: (device, connected) => {
          current.setLink(device, connected);
          setDemo({ links: { ...demo.links, [device]: connected } });
        },
      };
      for (const step of definition.steps) {
        await sleep(step.afterMs * stepScale);
        if (disposed || gen !== generation) return;
        try {
          await step.run(ctx);
        } catch {
          failures.push(`${step.label}:threw`);
        }
        lastIncidentId = ctx.incidentId;
        await current.settle();
        if (disposed || gen !== generation) return;
      }
    })()
      .catch(() => undefined)
      .then(() => {
        if (gen === generation && !disposed) setDemo({ runningScenario: null });
      });
  };

  const demoActions: PulseActions['demo'] = {
    viewAs(device: DemoDevice) {
      if (!DEMO_DEVICES.includes(device)) return;
      setDemo({ viewingAs: device });
    },
    setLink(device, connected) {
      world?.setLink(device, connected);
      setDemo({ links: { ...demo.links, [device]: connected } });
    },
    setAIReady(ready) {
      setDemo({ aiReady: ready });
      const current = world;
      if (!current) return;
      for (const key of DEMO_DEVICES) {
        current.ais[key].setReady(ready);
        void current.cores[key].actions.refreshCapabilities();
      }
    },
    runScenario,
    reset() {
      generation += 1;
      cancelSleep();
      setDemo({ runningScenario: null });
      void rebuild(generation);
    },
  };

  // Every other action goes to whichever device is being viewed when it is called.
  const forwarders = new Map<string, unknown>();
  const actions = new Proxy({} as PulseActions, {
    get(_target, property) {
      if (property === 'demo') return demoActions;
      if (typeof property !== 'string') return undefined;
      const cached = forwarders.get(property);
      if (cached) return cached;
      const forward =
        property === 'previewDisclosure'
          ? (...args: unknown[]) => {
              const target = world?.cores[demo.viewingAs].actions;
              return target ? Reflect.apply(Reflect.get(target, property) as (...a: unknown[]) => unknown, target, args) : [];
            }
          : async (...args: unknown[]) => {
              await building;
              const target = world?.cores[demo.viewingAs].actions;
              if (!target) throw new Error('demo_unavailable');
              const method: unknown = Reflect.get(target, property);
              if (typeof method !== 'function') throw new Error('unknown_action');
              return Reflect.apply(method, target, args) as unknown;
            };
      forwarders.set(property, forward);
      return forward;
    },
  });

  void rebuild(generation);

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    actions,
    async dispose() {
      disposed = true;
      generation += 1;
      cancelSleep();
      listeners.clear();
      for (const off of unsubscribe) off();
      unsubscribe = [];
      await building.catch(() => undefined);
      if (world) await world.dispose();
    },
    internals: {
      world: () => world,
      whenReady: () => building,
      scenarioFinished: () => scenario,
      failures: () => failures,
      seedIncidentId: () => seedIncidentId,
      lastIncidentId: () => lastIncidentId,
    },
  };
}
