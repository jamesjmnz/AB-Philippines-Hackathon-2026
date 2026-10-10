import { GuardedLocalAI, guardLocalAI } from '../runtime';
import type { AICallRecord } from '../runtime';
import type { AIResult, CapabilityMatrix, IncidentProposal, LocalAIService, OutputProbeLine } from '../types';

/** A clock and timers the test moves by hand. Nothing here waits for real time. */
class FakeClock {
  time = 1_000;
  private nextId = 1;
  private pending = new Map<number, { at: number; fn: () => void }>();

  now = () => this.time;
  timers = {
    setTimeout: (fn: () => void, ms: number): unknown => {
      const id = this.nextId++;
      this.pending.set(id, { at: this.time + ms, fn });
      return id;
    },
    clearTimeout: (handle: unknown): void => {
      this.pending.delete(handle as number);
    },
  };

  get armed(): number {
    return this.pending.size;
  }

  async advance(ms: number): Promise<void> {
    const target = this.time + ms;
    for (;;) {
      const due = [...this.pending.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      this.pending.delete(due[0]);
      this.time = due[1].at;
      due[1].fn();
      await flush();
    }
    this.time = target;
    await flush();
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

type Extract = AIResult<IncidentProposal>;
const PROPOSAL: IncidentProposal = { fields: { building: { value: 'Building B', evidence: 'Building B' } }, dropped: [], unknown: [] };
const success = (latencyMs = 100): Extract => ({ ok: true, value: PROPOSAL, meta: { source: 'callstack-apple', latencyMs } });
const failure = (state: 'timeout' | 'invalid_output' | 'guardrail_refusal', latencyMs = 100): Extract => ({
  ok: false,
  state,
  message: `inner ${state}`,
  meta: { source: 'callstack-apple', latencyMs },
});

const MATRIX: CapabilityMatrix = {
  provider: 'Callstack Apple',
  source: 'callstack-apple',
  packageVersion: '0.12.0',
  device: { model: 'Test iPhone', osVersion: '26.0' },
  text: { state: 'ready' },
  embeddings: { state: 'ready', language: 'en' },
  transcription: { state: 'ready', locale: 'en-US' },
  speech: { state: 'ready' },
};

/** An inner service whose extractions the test settles by hand, in the order they were started. */
function manualInner(overrides: Partial<LocalAIService> = {}) {
  const started: { text: string; resolve: (r: Extract) => void; reject: (e: unknown) => void }[] = [];
  const inner: LocalAIService = {
    inspectCapabilities: async () => MATRIX,
    extractIncidentReport: (raw) =>
      new Promise<Extract>((resolve, reject) => {
        started.push({ text: raw.text, resolve, reject });
      }),
    suggestClarification: async () => ({ ok: true, value: null, meta: { source: 'callstack-apple', latencyMs: 5 } }),
    findConflicts: async () => ({ ok: true, value: [], meta: { source: 'callstack-apple', latencyMs: 5 } }),
    proposeNonMedicalTasks: async () => ({ ok: true, value: [], meta: { source: 'callstack-apple', latencyMs: 5 } }),
    compareSemanticReports: async () => ({ ok: true, similarity: 0.5, language: 'en', meta: { source: 'callstack-apple', latencyMs: 5 } }),
    transcribeLocal: async () => ({ ok: true, value: { text: 'hello', locale: 'en-US', durationSeconds: 1 }, meta: { source: 'callstack-apple', latencyMs: 5 } }),
    ...overrides,
  };
  return { inner, started, texts: () => started.map((s) => s.text) };
}

function setup(options: ConstructorParameters<typeof GuardedLocalAI>[1] = {}, overrides: Partial<LocalAIService> = {}) {
  const clock = new FakeClock();
  const fake = manualInner(overrides);
  const ai = guardLocalAI(fake.inner, { now: clock.now, timers: clock.timers, ...options });
  return { clock, ai, ...fake };
}

/** Tracks a promise without awaiting it. */
function watch<T>(promise: Promise<T>) {
  const box: { settled: boolean; value?: T; rejected?: unknown } = { settled: false };
  promise.then(
    (value) => {
      box.settled = true;
      box.value = value;
    },
    (error: unknown) => {
      box.settled = true;
      box.rejected = error;
    },
  );
  return box;
}

const stateOf = (r: Extract | undefined) => (r === undefined ? 'pending' : r.ok ? 'ready' : r.state);

describe('GuardedLocalAI: one generation at a time', () => {
  it('runs a single call straight away and returns the inner result with queue time', async () => {
    const { ai, started, clock } = setup();
    const a = watch(ai.extractIncidentReport({ text: 'a' }));
    await flush();
    expect(started).toHaveLength(1);
    await clock.advance(300);
    started[0]?.resolve(success(280));
    await flush();
    expect(a.value).toEqual({ ok: true, value: PROPOSAL, meta: { source: 'callstack-apple', latencyMs: 280, queuedMs: 0 } });
    expect(clock.armed).toBe(0);
  });

  it('starts the next call only when the running one settles, and reports how long it queued', async () => {
    const { ai, started, clock } = setup();
    const a = watch(ai.extractIncidentReport({ text: 'a' }));
    const b = watch(ai.extractIncidentReport({ text: 'b' }));
    await flush();
    expect(started.map((s) => s.text)).toEqual(['a']);
    await clock.advance(700);
    started[0]?.resolve(success());
    await flush();
    expect(a.settled).toBe(true);
    expect(started.map((s) => s.text)).toEqual(['a', 'b']);
    started[1]?.resolve(success());
    await flush();
    expect(b.value?.meta.queuedMs).toBe(700);
  });

  it('orders waiting calls interactive, background, batch and first-in first-out within a priority', async () => {
    const { ai, started, texts } = setup();
    void ai.extractIncidentReport({ text: 'running' });
    void ai.extractIncidentReport({ text: 'batch-1' }, { priority: 'batch' });
    void ai.extractIncidentReport({ text: 'background-1' }, { priority: 'background' });
    void ai.extractIncidentReport({ text: 'interactive-1' }, { priority: 'interactive' });
    void ai.extractIncidentReport({ text: 'batch-2' }, { priority: 'batch' });
    void ai.extractIncidentReport({ text: 'interactive-2' }); // default priority is interactive
    void ai.extractIncidentReport({ text: 'background-2' }, { priority: 'background' });
    for (let i = 0; i < 7; i++) {
      await flush();
      started[i]?.resolve(success());
    }
    await flush();
    expect(texts()).toEqual(['running', 'interactive-1', 'interactive-2', 'background-1', 'background-2', 'batch-1', 'batch-2']);
  });
});

describe('GuardedLocalAI: bounded queue', () => {
  it('lets capacity calls wait and answers queue_full when nothing waiting has a lower priority', async () => {
    const { ai, started } = setup({ queueCapacity: 2 });
    const running = watch(ai.extractIncidentReport({ text: 'running' }));
    const q1 = watch(ai.extractIncidentReport({ text: 'q1' }));
    const q2 = watch(ai.extractIncidentReport({ text: 'q2' }));
    const extra = watch(ai.extractIncidentReport({ text: 'extra' }));
    const lower = watch(ai.extractIncidentReport({ text: 'lower' }, { priority: 'batch' }));
    await flush();
    expect(extra.value).toMatchObject({ ok: false, state: 'queue_full', meta: { source: 'none', latencyMs: 0 } });
    expect(lower.value).toMatchObject({ ok: false, state: 'queue_full' });
    expect([running.settled, q1.settled, q2.settled]).toEqual([false, false, false]);
    expect(started).toHaveLength(1);
    expect(ai.stats().queueHighWater).toBe(2);
  });

  it('displaces the oldest lowest-priority waiting call, which resolves superseded', async () => {
    const { ai, started, texts } = setup({ queueCapacity: 3 });
    void ai.extractIncidentReport({ text: 'running' });
    const background = watch(ai.extractIncidentReport({ text: 'background' }, { priority: 'background' }));
    const batchOld = watch(ai.extractIncidentReport({ text: 'batch-old' }, { priority: 'batch' }));
    const batchNew = watch(ai.extractIncidentReport({ text: 'batch-new' }, { priority: 'batch' }));
    const urgent = watch(ai.extractIncidentReport({ text: 'urgent' }));
    await flush();
    expect(batchOld.value).toMatchObject({ ok: false, state: 'superseded', meta: { source: 'none' } });
    expect([background.settled, batchNew.settled, urgent.settled]).toEqual([false, false, false]);

    // A background call can still push out a batch call, but not another background one.
    const second = watch(ai.extractIncidentReport({ text: 'background-2' }, { priority: 'background' }));
    await flush();
    expect(stateOf(batchNew.value)).toBe('superseded');
    const third = watch(ai.extractIncidentReport({ text: 'background-3' }, { priority: 'background' }));
    await flush();
    expect(stateOf(third.value)).toBe('queue_full');
    expect(second.settled).toBe(false);
    expect(ai.stats().displaced).toBe(2);

    for (let i = 0; i < 4; i++) {
      started[i]?.resolve(success());
      await flush();
    }
    expect(texts()).toEqual(['running', 'urgent', 'background', 'background-2']);
  });
});

describe('GuardedLocalAI: cancellation', () => {
  it('answers cancelled at once for a signal that is already aborted, without calling the model', async () => {
    const { ai, started } = setup();
    const controller = new AbortController();
    controller.abort();
    const r = await ai.extractIncidentReport({ text: 'a' }, { signal: controller.signal });
    expect(r).toMatchObject({ ok: false, state: 'cancelled' });
    expect(started).toHaveLength(0);
  });

  it('removes a call cancelled while queued, so it never reaches the model', async () => {
    const { ai, started, texts, clock } = setup();
    void ai.extractIncidentReport({ text: 'running' });
    const controller = new AbortController();
    const queued = watch(ai.extractIncidentReport({ text: 'queued' }, { signal: controller.signal }));
    void ai.extractIncidentReport({ text: 'after' });
    await clock.advance(250);
    controller.abort();
    await flush();
    expect(queued.value).toMatchObject({ ok: false, state: 'cancelled', meta: { source: 'none', latencyMs: 0, queuedMs: 250 } });
    started[0]?.resolve(success());
    await flush();
    expect(texts()).toEqual(['running', 'after']);
  });

  it('answers cancelled at once while running but keeps the lane until the generation settles', async () => {
    const { ai, started, texts, clock } = setup();
    const controller = new AbortController();
    const running = watch(ai.extractIncidentReport({ text: 'running' }, { signal: controller.signal }));
    const next = watch(ai.extractIncidentReport({ text: 'next' }));
    await clock.advance(1_000);
    controller.abort();
    await flush();
    expect(running.value).toMatchObject({ ok: false, state: 'cancelled', meta: { latencyMs: 1_000 } });
    await clock.advance(10_000);
    expect(texts()).toEqual(['running']); // the abandoned generation still occupies the model
    started[0]?.resolve(success());
    await flush();
    expect(texts()).toEqual(['running', 'next']);
    expect(next.settled).toBe(false);
  });

  it('releases a cancelled running call at the ceiling when it never settles', async () => {
    const { ai, texts, clock } = setup();
    const controller = new AbortController();
    void ai.extractIncidentReport({ text: 'running' }, { signal: controller.signal });
    void ai.extractIncidentReport({ text: 'next' });
    await flush();
    controller.abort();
    await clock.advance(44_999);
    expect(texts()).toEqual(['running']);
    await clock.advance(1);
    expect(texts()).toEqual(['running', 'next']);
  });
});

describe('GuardedLocalAI: the lane outlives the answer', () => {
  it('answers timeout from the guard, holds the lane until the inner promise settles, then moves on', async () => {
    const { ai, started, texts, clock } = setup({ callTimeoutMs: 20_000 });
    const hung = watch(ai.extractIncidentReport({ text: 'hung' }));
    const next = watch(ai.extractIncidentReport({ text: 'next' }));
    await clock.advance(19_999);
    expect(hung.settled).toBe(false);
    await clock.advance(1);
    expect(hung.value).toMatchObject({ ok: false, state: 'timeout', meta: { source: 'none', latencyMs: 20_000 } });
    await clock.advance(5_000);
    expect(texts()).toEqual(['hung']);
    started[0]?.resolve(success());
    await flush();
    expect(texts()).toEqual(['hung', 'next']);
    expect(next.settled).toBe(false);
    expect(clock.armed).toBe(2); // only the timers of the call now running
  });

  it('releases the lane at the ceiling when the inner promise never settles', async () => {
    const { ai, started, texts, clock } = setup({ callTimeoutMs: 20_000, laneCeilingMs: 45_000 });
    const hung = watch(ai.extractIncidentReport({ text: 'hung' }));
    void ai.extractIncidentReport({ text: 'next' });
    await clock.advance(44_999);
    expect(stateOf(hung.value)).toBe('timeout');
    expect(texts()).toEqual(['hung']);
    await clock.advance(1);
    expect(texts()).toEqual(['hung', 'next']);
    // The abandoned generation answering late changes nothing.
    started[0]?.resolve(success());
    started[1]?.resolve(success(7));
    await flush();
    expect(ai.diagnostics().map((r) => r.state)).toEqual(['timeout', 'ready']);
  });

  it('keeps the lane until the ceiling after the inner adapter itself answers timeout', async () => {
    const { ai, started, texts, clock } = setup();
    const slow = watch(ai.extractIncidentReport({ text: 'slow' }));
    void ai.extractIncidentReport({ text: 'next' });
    await clock.advance(20_000);
    started[0]?.resolve(failure('timeout', 20_000)); // the adapter gave up; the native call is still running
    await flush();
    expect(slow.value).toMatchObject({ ok: false, state: 'timeout', message: 'inner timeout', meta: { source: 'callstack-apple' } });
    await clock.advance(24_999);
    expect(texts()).toEqual(['slow']);
    await clock.advance(1);
    expect(texts()).toEqual(['slow', 'next']);
  });

  it('releases on an inner timeout result straight away when configured to', async () => {
    const { ai, started, texts } = setup({ holdLaneAfterInnerTimeout: false });
    void ai.extractIncidentReport({ text: 'slow' });
    void ai.extractIncidentReport({ text: 'next' });
    await flush();
    started[0]?.resolve(failure('timeout'));
    await flush();
    expect(texts()).toEqual(['slow', 'next']);
  });

  it('answers the last waiter timeout at the ceiling when no call timeout is shorter', async () => {
    const { ai, clock } = setup({ callTimeoutMs: 60_000, laneCeilingMs: 45_000 });
    const hung = watch(ai.extractIncidentReport({ text: 'hung' }));
    await clock.advance(45_000);
    expect(hung.value).toMatchObject({ ok: false, state: 'timeout' });
    expect(clock.armed).toBe(0);
  });
});

describe('GuardedLocalAI: identical calls in flight', () => {
  it('joins a running identical call and marks the joiner deduped', async () => {
    const { ai, started } = setup();
    const first = watch(ai.extractIncidentReport({ text: 'same' }));
    await flush();
    const second = watch(ai.extractIncidentReport({ text: 'same' }));
    await flush();
    expect(started).toHaveLength(1);
    started[0]?.resolve(success(90));
    await flush();
    expect(first.value?.meta.deduped).toBeUndefined();
    expect(second.value).toMatchObject({ ok: true, value: PROPOSAL, meta: { source: 'callstack-apple', latencyMs: 90, deduped: true } });
    expect(ai.stats().dedupHits).toBe(1);
  });

  it('joins a queued identical call without using a queue slot, and takes the higher priority', async () => {
    const { ai, started, texts } = setup({ queueCapacity: 2 });
    void ai.extractIncidentReport({ text: 'running' });
    void ai.extractIncidentReport({ text: 'background' }, { priority: 'background' });
    const slow = watch(ai.extractIncidentReport({ text: 'same' }, { priority: 'batch' }));
    const joined = watch(ai.extractIncidentReport({ text: 'same' }, { priority: 'interactive' }));
    await flush();
    expect(joined.settled).toBe(false);
    started[0]?.resolve(success());
    await flush();
    expect(texts()).toEqual(['running', 'same']);
    started[1]?.resolve(failure('invalid_output'));
    await flush();
    expect(stateOf(slow.value)).toBe('invalid_output');
    expect(joined.value).toMatchObject({ ok: false, state: 'invalid_output', meta: { deduped: true } });
  });

  it('treats the same context with keys in another order as the same call, and other operations as different', async () => {
    const suggestClarification = jest.fn(
      () => new Promise<AIResult<null>>(() => undefined), // never settles
    );
    const { ai, started } = setup({}, { suggestClarification });
    void ai.suggestClarification({ report: 'r', known: { floor: 'Second floor', building: 'Building B' }, skipped: [] });
    void ai.suggestClarification({ skipped: [], known: { building: 'Building B', floor: 'Second floor' }, report: 'r' });
    void ai.extractIncidentReport({ text: 'r' });
    await flush();
    expect(suggestClarification).toHaveBeenCalledTimes(1);
    expect(ai.stats().dedupHits).toBe(1);
    expect(started).toHaveLength(0); // a different operation waits for the lane instead of joining
  });

  it('keeps the generation for the remaining caller when one of two cancels', async () => {
    const { ai, started } = setup();
    void ai.extractIncidentReport({ text: 'running' });
    const controller = new AbortController();
    const quitter = watch(ai.extractIncidentReport({ text: 'same' }, { signal: controller.signal }));
    const stayer = watch(ai.extractIncidentReport({ text: 'same' }));
    await flush();
    controller.abort();
    await flush();
    expect(stateOf(quitter.value)).toBe('cancelled');
    started[0]?.resolve(success());
    await flush();
    started[1]?.resolve(success());
    await flush();
    expect(stateOf(stayer.value)).toBe('ready');
  });
});

describe('GuardedLocalAI: result cache', () => {
  async function run(ai: GuardedLocalAI, started: { resolve: (r: Extract) => void }[], text: string, result: Extract, options?: Parameters<GuardedLocalAI['extractIncidentReport']>[1]) {
    const before = started.length;
    const pending = ai.extractIncidentReport({ text }, options);
    await flush();
    if (started.length > before) started[before]?.resolve(result);
    return pending;
  }

  it('serves a repeated successful call from memory with cached true and zero latency', async () => {
    const { ai, started } = setup();
    await run(ai, started, 'a', success(321));
    const again = await ai.extractIncidentReport({ text: 'a' });
    expect(again).toEqual({ ok: true, value: PROPOSAL, meta: { source: 'callstack-apple', latencyMs: 0, queuedMs: 0, cached: true } });
    expect(started).toHaveLength(1);
    expect(ai.stats().cacheHits).toBe(1);
  });

  it('hands out a copy, so a caller changing its result does not change the cache', async () => {
    const { ai, started } = setup();
    await run(ai, started, 'a', success());
    const first = await ai.extractIncidentReport({ text: 'a' });
    if (first.ok) first.value.dropped.push('floor');
    const second = await ai.extractIncidentReport({ text: 'a' });
    expect(second.ok && second.value.dropped).toEqual([]);
  });

  it('answers from the cache even while the lane is busy', async () => {
    const { ai, started } = setup();
    await run(ai, started, 'a', success());
    void ai.extractIncidentReport({ text: 'hangs' });
    const hit = await ai.extractIncidentReport({ text: 'a' });
    expect(hit.meta.cached).toBe(true);
  });

  it('neither reads nor writes the cache with cache bypass', async () => {
    const { ai, started } = setup();
    await run(ai, started, 'a', success(), { cache: 'bypass' });
    await run(ai, started, 'a', success());
    expect(started).toHaveLength(2); // the bypassed result was not stored
    const bypassed = await run(ai, started, 'a', success(), { cache: 'bypass' });
    expect(started).toHaveLength(3); // and a stored one is not read
    expect(bypassed.meta.cached).toBeUndefined();
  });

  it('forgets everything on clearCache', async () => {
    const { ai, started } = setup();
    await run(ai, started, 'a', success());
    ai.clearCache();
    await run(ai, started, 'a', success());
    expect(started).toHaveLength(2);
  });

  it('does not store a result that was in flight when clearCache was called, so a later identical call runs again', async () => {
    const { ai, started } = setup();
    const first = watch(ai.extractIncidentReport({ text: 'a' }));
    await flush();
    expect(started).toHaveLength(1);
    ai.clearCache();
    started[0]?.resolve(success(210));
    await flush();
    // The caller that was waiting is still answered, from the model.
    expect(first.value).toEqual({ ok: true, value: PROPOSAL, meta: { source: 'callstack-apple', latencyMs: 210, queuedMs: 0 } });

    const again = watch(ai.extractIncidentReport({ text: 'a' }));
    await flush();
    expect(again.settled).toBe(false);
    expect(started).toHaveLength(2);
    started[1]?.resolve(success());
    await flush();
    expect(again.value?.meta.cached).toBeUndefined();
    expect(ai.stats().cacheHits).toBe(0);

    // The call made after the clear is stored as usual.
    expect((await ai.extractIncidentReport({ text: 'a' })).meta.cached).toBe(true);
    expect(started).toHaveLength(2);
  });

  it('does not store a result whose call was still queued when clearCache was called', async () => {
    const { ai, started, texts } = setup();
    void ai.extractIncidentReport({ text: 'running' });
    const queued = watch(ai.extractIncidentReport({ text: 'a' }));
    await flush();
    expect(texts()).toEqual(['running']);
    ai.clearCache();
    started[0]?.resolve(success());
    await flush();
    started[1]?.resolve(success());
    await flush();
    expect(stateOf(queued.value)).toBe('ready');

    // Neither the call that was running nor the one that was waiting left anything behind.
    for (const text of ['running', 'a']) {
      const before = started.length;
      const repeat = watch(ai.extractIncidentReport({ text }));
      await flush();
      expect(started).toHaveLength(before + 1);
      started[before]?.resolve(success());
      await flush();
      expect(repeat.value?.meta.cached).toBeUndefined();
    }
    expect(ai.stats().cacheHits).toBe(0);
  });

  it('keeps a result from before the clear out of the cache for every caller that had joined it', async () => {
    const { ai, started } = setup();
    const one = watch(ai.extractIncidentReport({ text: 'a' }));
    const two = watch(ai.extractIncidentReport({ text: 'a' }));
    await flush();
    ai.clearCache();
    // A caller joining after the clear shares the generation that is already running, and still nothing is stored.
    const three = watch(ai.extractIncidentReport({ text: 'a' }));
    await flush();
    expect(started).toHaveLength(1);
    started[0]?.resolve(success());
    await flush();
    expect([one, two, three].map((w) => stateOf(w.value))).toEqual(['ready', 'ready', 'ready']);
    void ai.extractIncidentReport({ text: 'a' });
    await flush();
    expect(started).toHaveLength(2);
  });

  it('never caches a failure', async () => {
    const { ai, started } = setup();
    for (const state of ['invalid_output', 'guardrail_refusal'] as const) {
      const r = await run(ai, started, 'a', failure(state));
      expect(stateOf(r)).toBe(state);
    }
    expect(started).toHaveLength(2);
    expect(ai.stats().cacheHits).toBe(0);
  });

  it('drops the least recently used entry beyond its size', async () => {
    const { ai, started } = setup({ cacheSize: 2 });
    await run(ai, started, 'a', success());
    await run(ai, started, 'b', success());
    await ai.extractIncidentReport({ text: 'a' }); // 'a' is now the most recent
    await run(ai, started, 'c', success()); // pushes out 'b'
    expect(started).toHaveLength(3);
    expect((await ai.extractIncidentReport({ text: 'a' })).meta.cached).toBe(true);
    await run(ai, started, 'b', success());
    expect(started).toHaveLength(4);
  });
});

describe('GuardedLocalAI: pass-through and the output probe', () => {
  it('does not queue capabilities, embeddings or transcription behind a hanging generation', async () => {
    const { ai } = setup();
    const hung = watch(ai.extractIncidentReport({ text: 'hangs forever' }));
    await expect(ai.inspectCapabilities()).resolves.toBe(MATRIX);
    await expect(ai.compareSemanticReports('a', 'b')).resolves.toMatchObject({ ok: true, similarity: 0.5 });
    await expect(ai.transcribeLocal({ wavBytes: new Uint8Array(4) }, 'en-US')).resolves.toMatchObject({ ok: true });
    expect(hung.settled).toBe(false);
    expect(ai.diagnostics()).toHaveLength(0); // pass-through calls are not recorded
  });

  it('exposes probeOutputShapes only when the inner service has it', () => {
    expect(setup().ai.probeOutputShapes).toBeUndefined();
    expect(typeof setup({}, { probeOutputShapes: async () => [] }).ai.probeOutputShapes).toBe('function');
  });

  it('exposes assessStatement only when the inner service has it, and runs it through the lane and the cache', async () => {
    expect(setup().ai.assessStatement).toBeUndefined();
    const assessed = { ok: true as const, value: { marker: 1 }, meta: { source: 'callstack-apple' as const, latencyMs: 40 } };
    const assessStatement = jest.fn(async () => assessed) as unknown as NonNullable<LocalAIService['assessStatement']>;
    const { ai, started } = setup({}, { assessStatement });
    void ai.extractIncidentReport({ text: 'running' });
    const input = { statement: 'nasa second floor na ako', known: { floor: 'First floor' } };
    const waiting = watch(ai.assessStatement?.(input) ?? Promise.resolve(null));
    await flush();
    expect(assessStatement).not.toHaveBeenCalled();
    started[0]?.resolve(success());
    await flush();
    expect(waiting.value).toMatchObject({ ok: true, value: { marker: 1 }, meta: { latencyMs: 40, queuedMs: 0 } });
    expect(await ai.assessStatement?.(input)).toMatchObject({ ok: true, meta: { cached: true, latencyMs: 0 } });
    expect(assessStatement).toHaveBeenCalledTimes(1);
    expect(ai.diagnostics().at(-1)).toMatchObject({ operation: 'assess', inputChars: input.statement.length, cached: true });
  });

  it('runs the probe through the lane at batch priority and returns its lines untouched', async () => {
    const lines: OutputProbeLine[] = [{ variant: 'flat', ok: true, latencyMs: 900, detail: 'ok' }];
    const probeOutputShapes = jest.fn(async () => lines);
    const { ai, started } = setup({}, { probeOutputShapes });
    void ai.extractIncidentReport({ text: 'running' });
    const probe = watch(ai.probeOutputShapes?.() ?? Promise.resolve([]));
    void ai.extractIncidentReport({ text: 'interactive' });
    await flush();
    expect(probeOutputShapes).not.toHaveBeenCalled();
    started[0]?.resolve(success());
    await flush();
    expect(probeOutputShapes).not.toHaveBeenCalled(); // the interactive call went first
    started[1]?.resolve(success());
    await flush();
    expect(probe.value).toBe(lines);
    expect(ai.diagnostics().at(-1)).toMatchObject({ operation: 'probe', priority: 'batch', state: 'ready', inputChars: 0 });
  });
});

describe('GuardedLocalAI: never rejects', () => {
  const boom = () => {
    throw Object.assign(new Error('Guardrail violation: unsafe'), { code: 'AppleLLM' });
  };

  it('turns a synchronous throw from the inner service into a typed failure and frees the lane', async () => {
    const { ai, started } = setup({}, { suggestClarification: boom });
    const r = await ai.suggestClarification({ report: 'r', known: {}, skipped: [] });
    expect(r).toMatchObject({ ok: false, state: 'guardrail_refusal', meta: { source: 'none' } });
    void ai.extractIncidentReport({ text: 'next' });
    await flush();
    expect(started).toHaveLength(1);
  });

  it('turns a rejection from the inner service into a typed failure', async () => {
    const { ai, started } = setup();
    const call = watch(ai.extractIncidentReport({ text: 'a' }));
    await flush();
    started[0]?.reject(new Error('Something nobody has seen before'));
    await flush();
    expect(call.rejected).toBeUndefined();
    expect(call.value).toMatchObject({ ok: false, state: 'native_error' });
  });

  it('answers native_error when the inner service returns something that is not a result', async () => {
    const { ai } = setup({}, { findConflicts: (async () => undefined) as unknown as LocalAIService['findConflicts'] });
    await expect(ai.findConflicts([{ id: 's1', author: 'a', text: 't' }])).resolves.toMatchObject({ ok: false, state: 'native_error' });
  });

  it('keeps every pass-through method from rejecting', async () => {
    const reject = async () => {
      throw new Error('Unsupported language or locale');
    };
    const { ai } = setup({}, { inspectCapabilities: reject, compareSemanticReports: boom, transcribeLocal: reject, probeOutputShapes: reject });
    await expect(ai.inspectCapabilities()).resolves.toMatchObject({ source: 'none', text: { state: 'native_error' } });
    await expect(ai.compareSemanticReports('a', 'b')).resolves.toMatchObject({ ok: false, state: 'guardrail_refusal' });
    await expect(ai.transcribeLocal({ wavBytes: new Uint8Array(1) }, 'fil-PH')).resolves.toMatchObject({ ok: false, state: 'unsupported_locale' });
    await expect(ai.probeOutputShapes?.()).resolves.toEqual([{ variant: 'guard', ok: false, latencyMs: 0, detail: 'unsupported_locale' }]);
  });

  it('survives a clock that throws', async () => {
    const fake = manualInner();
    const ai = guardLocalAI(fake.inner, {
      now: () => {
        throw new Error('no clock');
      },
      timers: new FakeClock().timers,
    });
    const call = watch(ai.extractIncidentReport({ text: 'a' }));
    await flush();
    fake.started[0]?.resolve(success());
    await flush();
    expect(stateOf(call.value)).toBe('ready');
  });
});

describe('GuardedLocalAI: diagnostics', () => {
  const ALLOWED_KEYS = ['seq', 'operation', 'source', 'state', 'queuedMs', 'latencyMs', 'inputChars', 'cached', 'deduped', 'priority', 'timestamp'];
  const SECRET_REPORT = 'Nadulas ako sa hagdan sa Building B, ikalawang palapag. Masakit ang paa ko at kailangan ko ng tulong. ZX-MARKER-91';
  const SECRET_OUTPUT = 'MODEL-OUTPUT-MARKER-77 this is what the model wrote about the person';
  const SECRET_ERROR = 'NATIVE-ERROR-MARKER-55 a localized description that may quote the prompt back';

  /** Drives every kind of outcome the guard can record. */
  async function exercise() {
    const lines: OutputProbeLine[] = [{ variant: 'flat', ok: false, latencyMs: 4_400, detail: SECRET_ERROR }];
    const ctx = setup({ queueCapacity: 1, callTimeoutMs: 20_000 }, { probeOutputShapes: async () => lines });
    const { ai, started, clock } = ctx;
    const secretResult: Extract = {
      ok: true,
      value: { fields: { incidentType: { value: SECRET_OUTPUT, evidence: SECRET_REPORT } }, dropped: [], unknown: [] },
      meta: { source: 'callstack-apple', latencyMs: 1_200 },
    };
    const step = async (index: number, result: Extract | Error) => {
      await flush();
      if (result instanceof Error) started[index]?.reject(result);
      else started[index]?.resolve(result);
      await flush();
    };

    void ai.extractIncidentReport({ text: SECRET_REPORT });
    void ai.extractIncidentReport({ text: SECRET_REPORT }); // deduped
    await step(0, secretResult);
    await ai.extractIncidentReport({ text: SECRET_REPORT }); // cached

    void ai.extractIncidentReport({ text: `${SECRET_REPORT} 2` });
    await step(1, { ok: false, state: 'invalid_output', message: SECRET_ERROR, meta: { source: 'callstack-apple', latencyMs: 4_400 } });
    void ai.extractIncidentReport({ text: `${SECRET_REPORT} 3` });
    await step(2, new Error(SECRET_ERROR));

    const controller = new AbortController();
    void ai.extractIncidentReport({ text: `${SECRET_REPORT} 4` }); // will time out at the guard
    void ai.extractIncidentReport({ text: `${SECRET_REPORT} 5` }, { priority: 'batch' }); // superseded
    void ai.extractIncidentReport({ text: `${SECRET_REPORT} 6` }, { priority: 'background', signal: controller.signal }); // cancelled
    void ai.extractIncidentReport({ text: `${SECRET_REPORT} 7` }, { priority: 'batch' }); // queue_full
    await flush();
    controller.abort();
    await clock.advance(45_000);
    void ai.suggestClarification({ report: SECRET_REPORT, known: { building: SECRET_OUTPUT }, skipped: [] });
    void ai.findConflicts([{ id: 's1', author: 'Ana', text: SECRET_REPORT }, { id: 's2', author: 'Ben', text: SECRET_REPORT }]);
    void ai.proposeNonMedicalTasks({ report: SECRET_REPORT, known: {}, skipped: [] });
    await clock.advance(1);
    await ai.probeOutputShapes?.();
    await flush();
    return ctx;
  }

  it('records every kind of outcome', async () => {
    const { ai } = await exercise();
    const records = ai.diagnostics();
    expect(new Set(records.map((r) => r.state))).toEqual(new Set(['ready', 'invalid_output', 'native_error', 'timeout', 'superseded', 'cancelled', 'queue_full']));
    expect(new Set(records.map((r) => r.operation))).toEqual(new Set(['extract', 'clarify', 'conflicts', 'tasks', 'probe']));
    expect(records.some((r) => r.cached)).toBe(true);
    expect(records.some((r) => r.deduped)).toBe(true);
    expect(records.map((r) => r.seq)).toEqual(records.map((_, i) => i + 1));
    expect(records.find((r) => r.operation === 'conflicts')?.inputChars).toBe(SECRET_REPORT.length * 2);
  });

  it('keeps only the allowed keys and no string longer than 40 characters', async () => {
    const { ai } = await exercise();
    const records = ai.diagnostics();
    expect(records.length).toBeGreaterThan(10);
    for (const record of records as readonly (AICallRecord & Record<string, unknown>)[]) {
      expect(Object.keys(record).filter((key) => !ALLOWED_KEYS.includes(key))).toEqual([]);
      for (const [key, value] of Object.entries(record)) {
        expect(['string', 'number', 'boolean']).toContain(typeof value);
        if (typeof value === 'string' && value.length > 40) throw new Error(`diagnostic field ${key} holds a long string`);
      }
    }
  });

  it('holds no report text, model output or error message anywhere in diagnostics or stats', async () => {
    const { ai } = await exercise();
    const dump = JSON.stringify([ai.diagnostics(), ai.stats()]);
    for (const marker of ['MARKER', 'Nadulas', 'Building B', 'tulong', 'Ana', 'localized']) expect(dump).not.toContain(marker);
  });

  it('gives callers copies, so the buffer cannot be altered from outside', async () => {
    const { ai } = await exercise();
    const first = ai.diagnostics()[0] as AICallRecord;
    first.state = 'native_error';
    expect(ai.diagnostics()[0]?.state).toBe('ready');
  });

  it('keeps only the newest records up to the buffer size', async () => {
    const { ai, started } = setup({ diagnosticsSize: 3, cacheSize: 0 });
    for (let i = 0; i < 5; i++) {
      void ai.extractIncidentReport({ text: `call ${i}` });
      await flush();
      started[i]?.resolve(success(i));
      await flush();
    }
    expect(ai.diagnostics().map((r) => r.seq)).toEqual([3, 4, 5]);
    expect(ai.stats().total).toBe(5);
  });

  it('reports counts and latency percentiles over calls a real provider answered', async () => {
    const { ai, started } = setup();
    const latencies = [100, 200, 300, 400, 500, 600, 700, 800, 900, 4_400];
    for (let i = 0; i < latencies.length; i++) {
      void ai.extractIncidentReport({ text: `call ${i}` });
      await flush();
      started[i]?.resolve(i === 9 ? failure('invalid_output', latencies[i]) : success(latencies[i]));
      await flush();
    }
    await ai.extractIncidentReport({ text: 'call 0' }); // cache hit: not a latency sample
    const controller = new AbortController();
    controller.abort();
    await ai.extractIncidentReport({ text: 'never ran' }, { signal: controller.signal });
    expect(ai.stats()).toEqual({
      total: 12,
      byState: { ready: 10, invalid_output: 1, cancelled: 1 },
      cacheHits: 1,
      dedupHits: 0,
      displaced: 0,
      queueHighWater: 0,
      latencyMs: { samples: 10, p50: 500, p90: 900, max: 4_400 },
    });
  });

  it('never reports latency from simulated calls', async () => {
    const { ai, started } = setup();
    void ai.extractIncidentReport({ text: 'demo' });
    await flush();
    started[0]?.resolve({ ok: true, value: PROPOSAL, meta: { source: 'simulated', latencyMs: 0 } });
    await flush();
    expect(ai.diagnostics()[0]?.source).toBe('simulated');
    expect(ai.stats().latencyMs).toEqual({ samples: 0, p50: null, p90: null, max: null });
  });
});
