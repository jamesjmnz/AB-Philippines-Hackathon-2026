import { classifyAIError } from '../classifyError';
import type {
  AICallOptions,
  AICallPriority,
  AIFailureState,
  AIMeta,
  AIResult,
  AISource,
  AIState,
  CapabilityMatrix,
  ClarificationProposal,
  ConflictProposal,
  IncidentContext,
  IncidentProposal,
  LocalAIService,
  LocalAudioInput,
  OriginalReportInput,
  OutputProbeLine,
  SimilarityResult,
  StatementInput,
  TaskProposal,
  Transcript,
} from '../types';

/** The subset of timers the guard needs. `systemTimers` from `@/sync/types` satisfies it. */
export interface AIGuardTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface AIGuardOptions {
  /** Calls allowed to wait behind the running one. Default 6. */
  queueCapacity?: number;
  /**
   * How long the caller of a running generation waits before it is answered `timeout`. The lane stays
   * held afterwards. Default 25 000 ms, above the adapter's own 20 s so the adapter normally answers first.
   */
  callTimeoutMs?: number;
  /** Longest one generation may hold the lane, measured from when it started. Default 45 000 ms. */
  laneCeilingMs?: number;
  /**
   * The provider ignores abort, so an inner `timeout` result means the native generation is still running.
   * When true (default) the lane stays held until the ceiling after such a result; when false it is released
   * as soon as the inner promise settles, whatever it settled with.
   */
  holdLaneAfterInnerTimeout?: boolean;
  /** Successful results remembered, least recently used dropped first. Default 16. 0 disables the cache. */
  cacheSize?: number;
  /** Diagnostic records kept. Default 200. */
  diagnosticsSize?: number;
  now?: () => number;
  timers?: AIGuardTimers;
}

export type AIOperation = 'extract' | 'clarify' | 'conflicts' | 'tasks' | 'assess' | 'probe';

/**
 * One finished call, as kept for diagnostics. Numbers and short enumerated strings only: no report text,
 * no model output, no error message and no hash of any of them.
 */
export type AICallRecord = {
  seq: number;
  operation: AIOperation;
  source: AISource;
  state: AIState;
  queuedMs: number;
  latencyMs: number;
  inputChars: number;
  cached: boolean;
  deduped: boolean;
  priority: AICallPriority;
  timestamp: number;
};

export type AIGuardStats = {
  /** Calls answered since the guard was created (not limited to the diagnostics buffer). */
  total: number;
  byState: Partial<Record<AIState, number>>;
  cacheHits: number;
  dedupHits: number;
  /** Queued calls pushed out by a higher-priority call. */
  displaced: number;
  queueHighWater: number;
  /**
   * Over the calls still in the diagnostics buffer that a real provider answered itself: never cached,
   * deduplicated, simulated or guard-answered calls. Null when there are none.
   */
  latencyMs: { samples: number; p50: number | null; p90: number | null; max: number | null };
};

const PRIORITY_RANK: Record<AICallPriority, number> = { interactive: 0, background: 1, batch: 2 };

const systemGuardTimers: AIGuardTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** What the lane needs to know about a result type so it can answer and record without reading its content. */
type Shape<T> = {
  /** The answer when the guard itself ends the call. */
  fail(state: AIFailureState, meta: AIMeta): T;
  describe(result: T): { state: AIState; source: AISource; latencyMs: number; cacheable: boolean };
  /** A copy of `result` carrying the guard's bookkeeping. */
  annotate(result: T, extra: { queuedMs: number; cached?: boolean; deduped?: boolean; latencyMs?: number }): T;
};

type Waiter<T> = {
  resolve(result: T): void;
  done: boolean;
  deduped: boolean;
  priority: AICallPriority;
  enqueuedAt: number;
  detach(): void;
};

type Job<T> = {
  order: number;
  operation: AIOperation;
  key: string | null;
  inputChars: number;
  priority: AICallPriority;
  shape: Shape<T>;
  run(): Promise<T>;
  waiters: Waiter<T>[];
  writeCache: boolean;
  /** Cache generation the job started under; a result from before a clear is never stored. */
  generation: number;
  status: 'queued' | 'running' | 'released';
  startedAt: number;
  ceilingTimer?: unknown;
  callTimer?: unknown;
};

type AnyJob = Job<any>;

const GUARD_MESSAGES: Record<'cancelled' | 'queue_full' | 'superseded' | 'timeout', string> = {
  cancelled: 'The request was cancelled.',
  queue_full: 'Too many on-device AI requests are waiting.',
  superseded: 'A more urgent request took this one’s place in the queue.',
  timeout: 'The on-device model did not answer in time.',
};

function resultShape<V>(): Shape<AIResult<V>> {
  return {
    fail: (state, meta) => ({ ok: false, state, message: GUARD_MESSAGES[state as keyof typeof GUARD_MESSAGES] ?? state, meta }),
    describe: (r) => ({ state: r.ok ? 'ready' : r.state, source: r.meta.source, latencyMs: r.meta.latencyMs, cacheable: r.ok }),
    annotate: (r, extra) => ({ ...r, meta: { ...r.meta, ...extra } }),
  };
}

const PROBE_SHAPE: Shape<OutputProbeLine[]> = {
  fail: (state) => [{ variant: 'guard', ok: false, latencyMs: 0, detail: state }],
  describe: (lines) => ({ state: 'ready', source: 'none', latencyMs: lines.reduce((sum, l) => sum + l.latencyMs, 0), cacheable: false }),
  annotate: (lines) => lines,
};

/** Key order must not change the key: `known` may be built in any order by callers. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(',')}}`;
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1] ?? null;
}

/**
 * Puts any `LocalAIService` behind one generation lane.
 *
 * The on-device model runs one generation at a time and cannot be interrupted, so generation calls
 * (extract, clarify, conflicts, tasks, and where the inner service has them statement assessment and the
 * output probe) run strictly one after another. Callers wait
 * in a bounded priority queue, identical calls share one generation, successful results are remembered in
 * memory, and a caller is always answered: no method ever throws or rejects. Capabilities, embeddings and
 * transcription go straight to the inner service.
 *
 * The call key (operation plus arguments) lives only in the in-flight and cache maps, in memory. The
 * diagnostics hold sizes, timings and states, never text.
 */
export class GuardedLocalAI implements LocalAIService {
  /** Present only when the inner service has it. Runs through the lane like the other generation methods. */
  assessStatement?: NonNullable<LocalAIService['assessStatement']>;
  /** Present only when the inner service has it. Runs through the lane at batch priority; its lines are returned untouched. */
  probeOutputShapes?: () => Promise<OutputProbeLine[]>;

  private readonly queueCapacity: number;
  private readonly callTimeoutMs: number;
  private readonly laneCeilingMs: number;
  private readonly holdLaneAfterInnerTimeout: boolean;
  private readonly cacheSize: number;
  private readonly diagnosticsSize: number;
  private readonly now: () => number;
  private readonly timers: AIGuardTimers;

  private running: AnyJob | null = null;
  private readonly queue: AnyJob[] = [];
  private readonly inFlight = new Map<string, AnyJob>();
  /** Insertion order is recency: a hit is re-inserted, the first key is the least recently used. */
  private readonly cache = new Map<string, unknown>();
  private readonly records: AICallRecord[] = [];
  private seq = 0;
  private order = 0;
  private readonly counts: Partial<Record<AIState, number>> = {};
  private total = 0;
  private cacheHits = 0;
  private dedupHits = 0;
  private displaced = 0;
  private queueHighWater = 0;
  private lastProvider: CapabilityMatrix['provider'] = 'Callstack Apple';

  constructor(
    private readonly inner: LocalAIService,
    options: AIGuardOptions = {},
  ) {
    this.queueCapacity = Math.max(0, options.queueCapacity ?? 6);
    this.laneCeilingMs = Math.max(1, options.laneCeilingMs ?? 45_000);
    this.callTimeoutMs = Math.max(1, options.callTimeoutMs ?? 25_000);
    this.holdLaneAfterInnerTimeout = options.holdLaneAfterInnerTimeout ?? true;
    this.cacheSize = Math.max(0, options.cacheSize ?? 16);
    this.diagnosticsSize = Math.max(1, options.diagnosticsSize ?? 200);
    this.now = options.now ?? Date.now;
    this.timers = options.timers ?? systemGuardTimers;
    if (typeof inner.assessStatement === 'function') {
      this.assessStatement = (input, options) =>
        this.generate('assess', [input], input?.statement?.length ?? 0, options, async () => {
          const assess = this.inner.assessStatement;
          if (!assess) throw new Error('assessStatement is not available');
          return assess.call(this.inner, input);
        });
    }
    if (typeof inner.probeOutputShapes === 'function') {
      this.probeOutputShapes = () =>
        this.submit<OutputProbeLine[]>('probe', null, 0, PROBE_SHAPE, { priority: 'batch', cache: 'bypass' }, async () => {
          const probe = this.inner.probeOutputShapes;
          return probe ? probe.call(this.inner) : [];
        });
    }
  }

  // ---- Pass-through: unqueued, uncached, never blocked by the lane -----------------------------

  async inspectCapabilities(): Promise<CapabilityMatrix> {
    try {
      const matrix = await this.inner.inspectCapabilities();
      this.lastProvider = matrix.provider;
      return matrix;
    } catch {
      const status = { state: 'native_error' as const, detail: 'capabilities_unreadable' };
      return {
        provider: this.lastProvider,
        source: 'none',
        packageVersion: 'unknown',
        device: { model: 'unknown', osVersion: 'unknown' },
        text: status,
        embeddings: { ...status, language: 'en' },
        transcription: { ...status, locale: 'en-US' },
        speech: status,
      };
    }
  }

  async compareSemanticReports(a: string, b: string): Promise<SimilarityResult> {
    try {
      return await this.inner.compareSemanticReports(a, b);
    } catch (error) {
      return { ok: false, ...classifyAIError(error), meta: { source: 'none', latencyMs: 0 } };
    }
  }

  async transcribeLocal(audio: LocalAudioInput, locale: string): Promise<AIResult<Transcript>> {
    try {
      return await this.inner.transcribeLocal(audio, locale);
    } catch (error) {
      return { ok: false, ...classifyAIError(error), meta: { source: 'none', latencyMs: 0 } };
    }
  }

  // ---- Generation: one at a time ----------------------------------------------------------------

  extractIncidentReport(raw: OriginalReportInput, options?: AICallOptions): Promise<AIResult<IncidentProposal>> {
    return this.generate('extract', [raw], raw?.text?.length ?? 0, options, () => this.inner.extractIncidentReport(raw));
  }

  suggestClarification(context: IncidentContext, options?: AICallOptions): Promise<AIResult<ClarificationProposal>> {
    return this.generate('clarify', [context], context?.report?.length ?? 0, options, () => this.inner.suggestClarification(context));
  }

  findConflicts(statements: readonly StatementInput[], options?: AICallOptions): Promise<AIResult<ConflictProposal[]>> {
    let chars = 0;
    if (Array.isArray(statements)) for (const s of statements) chars += s?.text?.length ?? 0;
    return this.generate('conflicts', [statements], chars, options, () => this.inner.findConflicts(statements));
  }

  proposeNonMedicalTasks(context: IncidentContext, options?: AICallOptions): Promise<AIResult<TaskProposal[]>> {
    return this.generate('tasks', [context], context?.report?.length ?? 0, options, () => this.inner.proposeNonMedicalTasks(context));
  }

  // ---- Cache and diagnostics --------------------------------------------------------------------

  /** Forgets every stored answer, and makes sure a generation already in flight does not store one afterwards. */
  clearCache(): void {
    this.cache.clear();
    this.cacheGeneration += 1;
  }

  private cacheGeneration = 0;

  /** Oldest first. Copies, so a caller cannot alter the buffer. */
  diagnostics(): readonly AICallRecord[] {
    return this.records.map((r) => ({ ...r }));
  }

  stats(): AIGuardStats {
    const real = this.records
      .filter((r) => r.source === 'callstack-apple' && !r.cached && !r.deduped)
      .map((r) => r.latencyMs)
      .sort((a, b) => a - b);
    return {
      total: this.total,
      byState: { ...this.counts },
      cacheHits: this.cacheHits,
      dedupHits: this.dedupHits,
      displaced: this.displaced,
      queueHighWater: this.queueHighWater,
      latencyMs: { samples: real.length, p50: percentile(real, 50), p90: percentile(real, 90), max: real[real.length - 1] ?? null },
    };
  }

  // ---- Internals --------------------------------------------------------------------------------

  private generate<V>(
    operation: AIOperation,
    args: readonly unknown[],
    inputChars: number,
    options: AICallOptions | undefined,
    call: () => Promise<AIResult<V>>,
  ): Promise<AIResult<V>> {
    const shape = resultShape<V>();
    let key: string | null = null;
    try {
      key = `${operation}\u0000${stableStringify(args)}`;
    } catch {
      key = null; // not serialisable: run it, but it can be neither shared nor cached
    }
    return this.submit(operation, key, inputChars, shape, options, call);
  }

  private submit<T>(
    operation: AIOperation,
    key: string | null,
    inputChars: number,
    shape: Shape<T>,
    options: AICallOptions | undefined,
    call: () => Promise<T>,
  ): Promise<T> {
    return new Promise<T>((resolve) => {
      const priority: AICallPriority = options?.priority && options.priority in PRIORITY_RANK ? options.priority : 'interactive';
      const useCache = options?.cache !== 'bypass' && key !== null && this.cacheSize > 0;
      const enqueuedAt = this.safeNow();
      const signal = options?.signal;
      const base = { operation, inputChars, priority };
      try {
        if (signal?.aborted) {
          resolve(this.answer(shape, 'cancelled', { ...base, queuedMs: 0, latencyMs: 0, deduped: false }));
          return;
        }
        if (useCache && key !== null && this.cache.has(key)) {
          const stored = this.cache.get(key) as T;
          this.cache.delete(key);
          this.cache.set(key, stored);
          const hit = shape.annotate(clone(stored), { queuedMs: 0, cached: true, latencyMs: 0 });
          this.cacheHits += 1;
          this.record({ ...base, source: shape.describe(hit).source, state: 'ready', queuedMs: 0, latencyMs: 0, cached: true, deduped: false });
          resolve(hit);
          return;
        }

        const waiter: Waiter<T> = { resolve, done: false, deduped: false, priority, enqueuedAt, detach: () => undefined };
        let job = key !== null ? (this.inFlight.get(key) as Job<T> | undefined) : undefined;
        if (job) {
          waiter.deduped = true;
          this.dedupHits += 1;
          job.waiters.push(waiter);
          job.writeCache = job.writeCache || useCache;
          if (job.status === 'queued' && PRIORITY_RANK[priority] < PRIORITY_RANK[job.priority]) job.priority = priority;
        } else {
          job = {
            order: (this.order += 1),
            operation,
            key,
            inputChars,
            priority,
            shape,
            run: call,
            waiters: [waiter],
            writeCache: useCache,
            generation: this.cacheGeneration,
            status: 'queued',
            startedAt: 0,
          };
          if (this.running !== null && this.queue.length >= this.queueCapacity) {
            const victim = this.pickVictim(priority);
            if (!victim) {
              resolve(this.answer(shape, 'queue_full', { ...base, queuedMs: 0, latencyMs: 0, deduped: false }));
              return;
            }
            this.displace(victim);
          }
          this.queue.push(job);
          if (key !== null) this.inFlight.set(key, job);
        }

        if (signal) {
          const owner = job;
          const onAbort = () => this.cancel(owner, waiter);
          signal.addEventListener('abort', onAbort, { once: true });
          waiter.detach = () => signal.removeEventListener('abort', onAbort);
        }
        this.pump();
        this.queueHighWater = Math.max(this.queueHighWater, this.queue.length);
      } catch {
        // Bookkeeping must never be the reason a caller is left without an answer.
        resolve(shape.fail('native_error', { source: 'none', latencyMs: 0 }));
      }
    });
  }

  /** The queued call to push out for an incoming one: lowest priority class first, oldest within it. */
  private pickVictim(incoming: AICallPriority): AnyJob | null {
    let victim: AnyJob | null = null;
    for (const job of this.queue) {
      if (PRIORITY_RANK[job.priority] <= PRIORITY_RANK[incoming]) continue;
      if (!victim || PRIORITY_RANK[job.priority] > PRIORITY_RANK[victim.priority] || (job.priority === victim.priority && job.order < victim.order)) {
        victim = job;
      }
    }
    return victim;
  }

  private displace(job: AnyJob): void {
    this.dequeue(job);
    this.displaced += 1;
    const at = this.safeNow();
    for (const waiter of job.waiters) this.settleByGuard(job, waiter, 'superseded', at);
  }

  private dequeue(job: AnyJob): void {
    const at = this.queue.indexOf(job);
    if (at >= 0) this.queue.splice(at, 1);
    this.forget(job);
    job.status = 'released';
  }

  private forget(job: AnyJob): void {
    if (job.key !== null && this.inFlight.get(job.key) === job) this.inFlight.delete(job.key);
  }

  private cancel(job: AnyJob, waiter: Waiter<unknown>): void {
    if (waiter.done) return;
    this.settleByGuard(job, waiter, 'cancelled', this.safeNow());
    // A queued call nobody is waiting for is dropped. A running one cannot be stopped: the lane stays held.
    if (job.status === 'queued' && job.waiters.every((w) => w.done)) {
      this.dequeue(job);
      this.pump();
    }
  }

  private settleByGuard(job: AnyJob, waiter: Waiter<unknown>, state: 'cancelled' | 'superseded' | 'timeout' | 'native_error', at: number): void {
    if (waiter.done) return;
    waiter.done = true;
    waiter.detach();
    const started = job.startedAt > 0;
    const queuedMs = Math.max(0, (started ? job.startedAt : at) - waiter.enqueuedAt);
    const latencyMs = started ? Math.max(0, at - job.startedAt) : 0;
    waiter.resolve(
      this.answer(job.shape, state, { operation: job.operation, inputChars: job.inputChars, priority: waiter.priority, queuedMs, latencyMs, deduped: waiter.deduped }),
    );
  }

  /** Builds and records an answer the guard gives itself, without any provider result. */
  private answer<T>(
    shape: Shape<T>,
    state: AIFailureState,
    info: { operation: AIOperation; inputChars: number; priority: AICallPriority; queuedMs: number; latencyMs: number; deduped: boolean },
  ): T {
    const meta: AIMeta = { source: 'none', latencyMs: info.latencyMs, queuedMs: info.queuedMs };
    if (info.deduped) meta.deduped = true;
    this.record({ ...info, source: 'none', state, cached: false });
    return shape.fail(state, meta);
  }

  private pump(): void {
    if (this.running !== null) return;
    let next: AnyJob | null = null;
    for (const job of this.queue) {
      if (!next || PRIORITY_RANK[job.priority] < PRIORITY_RANK[next.priority] || (job.priority === next.priority && job.order < next.order)) next = job;
    }
    if (!next) return;
    this.queue.splice(this.queue.indexOf(next), 1);
    this.start(next);
  }

  private start(job: AnyJob): void {
    this.running = job;
    job.status = 'running';
    job.startedAt = this.safeNow();
    job.ceilingTimer = this.timers.setTimeout(() => this.onCeiling(job), this.laneCeilingMs);
    if (this.callTimeoutMs < this.laneCeilingMs) {
      job.callTimer = this.timers.setTimeout(() => this.onCallTimeout(job), this.callTimeoutMs);
    }
    let pending: Promise<unknown>;
    try {
      pending = Promise.resolve(job.run());
    } catch (error) {
      pending = Promise.reject(error);
    }
    pending.then(
      (result) => this.onInnerSettled(job, { ok: true, result }),
      (error: unknown) => this.onInnerSettled(job, { ok: false, error }),
    );
  }

  private onInnerSettled(job: AnyJob, outcome: { ok: true; result: unknown } | { ok: false; error: unknown }): void {
    if (job.status !== 'running') return; // the ceiling already gave the lane away; a late answer is ignored
    try {
      this.clearTimer(job, 'callTimer');
      const at = this.safeNow();
      let holdLane = false;
      if (outcome.ok) {
        const info = this.safeDescribe(job, outcome.result);
        if (info) {
          holdLane = this.holdLaneAfterInnerTimeout && info.state === 'timeout';
          if (info.cacheable && job.writeCache && job.key !== null && job.generation === this.cacheGeneration) this.remember(job.key, outcome.result);
          for (const waiter of job.waiters) {
            if (waiter.done) continue;
            waiter.done = true;
            waiter.detach();
            const queuedMs = Math.max(0, job.startedAt - waiter.enqueuedAt);
            if (waiter.deduped) {
              this.record({ operation: job.operation, inputChars: job.inputChars, priority: waiter.priority, source: info.source, state: info.state, queuedMs, latencyMs: info.latencyMs, cached: false, deduped: true });
              waiter.resolve(job.shape.annotate(outcome.result, { queuedMs, deduped: true }));
            } else {
              this.record({ operation: job.operation, inputChars: job.inputChars, priority: waiter.priority, source: info.source, state: info.state, queuedMs, latencyMs: info.latencyMs, cached: false, deduped: false });
              waiter.resolve(job.shape.annotate(outcome.result, { queuedMs }));
            }
          }
        } else {
          for (const waiter of job.waiters) this.settleByGuard(job, waiter, 'native_error', at);
        }
      } else {
        // The inner service broke its contract by throwing. The caller still gets a typed failure.
        const classified = classifyAIError(outcome.error);
        holdLane = this.holdLaneAfterInnerTimeout && classified.state === 'timeout';
        for (const waiter of job.waiters) {
          if (waiter.done) continue;
          waiter.done = true;
          waiter.detach();
          const queuedMs = Math.max(0, job.startedAt - waiter.enqueuedAt);
          const latencyMs = Math.max(0, at - job.startedAt);
          this.record({ operation: job.operation, inputChars: job.inputChars, priority: waiter.priority, source: 'none', state: classified.state, queuedMs, latencyMs, cached: false, deduped: waiter.deduped });
          const meta: AIMeta = { source: 'none', latencyMs, queuedMs };
          if (waiter.deduped) meta.deduped = true;
          const failure = job.shape.fail(classified.state, meta);
          // For AIResult shapes carry the classified message to the caller (never to the diagnostics).
          waiter.resolve(isFailureResult(failure) ? { ...failure, message: classified.message } : failure);
        }
      }
      this.forget(job);
      if (!holdLane) this.release(job);
    } catch {
      this.release(job);
    }
  }

  /** The caller stops waiting; the generation, which cannot be stopped, keeps the lane. */
  private onCallTimeout(job: AnyJob): void {
    if (job.status !== 'running') return;
    job.callTimer = undefined;
    const at = this.safeNow();
    for (const waiter of job.waiters) this.settleByGuard(job, waiter, 'timeout', at);
    this.forget(job); // an identical new call must not join a generation everyone has given up on
  }

  private onCeiling(job: AnyJob): void {
    if (job.status !== 'running') return;
    job.ceilingTimer = undefined;
    const at = this.safeNow();
    for (const waiter of job.waiters) this.settleByGuard(job, waiter, 'timeout', at);
    this.release(job);
  }

  private release(job: AnyJob): void {
    this.clearTimer(job, 'callTimer');
    this.clearTimer(job, 'ceilingTimer');
    this.forget(job);
    job.status = 'released';
    if (this.running === job) this.running = null;
    this.pump();
  }

  private clearTimer(job: AnyJob, which: 'callTimer' | 'ceilingTimer'): void {
    const handle = job[which];
    if (handle === undefined) return;
    job[which] = undefined;
    try {
      this.timers.clearTimeout(handle);
    } catch {
      // a timer that cannot be cleared fires into a job that is no longer running, which is ignored
    }
  }

  private safeDescribe(job: AnyJob, result: unknown): ReturnType<Shape<unknown>['describe']> | null {
    try {
      const info = job.shape.describe(result);
      return typeof info.state === 'string' && typeof info.source === 'string' ? { ...info, latencyMs: Number.isFinite(info.latencyMs) ? info.latencyMs : 0 } : null;
    } catch {
      return null; // not a result at all
    }
  }

  private remember(key: string, result: unknown): void {
    if (this.cacheSize <= 0) return;
    this.cache.delete(key);
    this.cache.set(key, clone(result));
    while (this.cache.size > this.cacheSize) {
      const oldest = this.cache.keys().next();
      if (oldest.done) break;
      this.cache.delete(oldest.value);
    }
  }

  private record(entry: Omit<AICallRecord, 'seq' | 'timestamp'>): void {
    this.total += 1;
    this.counts[entry.state] = (this.counts[entry.state] ?? 0) + 1;
    // Built field by field so nothing but the allowed keys can ride along.
    this.records.push({
      seq: (this.seq += 1),
      operation: entry.operation,
      source: entry.source,
      state: entry.state,
      queuedMs: entry.queuedMs,
      latencyMs: entry.latencyMs,
      inputChars: entry.inputChars,
      cached: entry.cached,
      deduped: entry.deduped,
      priority: entry.priority,
      timestamp: this.safeNow(),
    });
    while (this.records.length > this.diagnosticsSize) this.records.shift();
  }

  private safeNow(): number {
    try {
      const value = this.now();
      return Number.isFinite(value) ? value : 0;
    } catch {
      return 0;
    }
  }
}

function isFailureResult(value: unknown): value is { ok: false; message: string } {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && (value as { ok?: unknown }).ok === false;
}

export function guardLocalAI(inner: LocalAIService, options?: AIGuardOptions): GuardedLocalAI {
  return new GuardedLocalAI(inner, options);
}
