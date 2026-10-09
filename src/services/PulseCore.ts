import { z } from 'zod';

import type {
  AIFailureState,
  AIResult,
  AISource,
  CapabilityMatrix,
  ClarifiableField,
  ClarificationProposal,
  IncidentContext,
  IncidentProposal,
  LocalAIService,
  ProposalField,
  TaskProposal,
} from '@/ai';
import { SentProjectionSchema, type SentProjection } from '@/crypto/capsule';
import type { CapsuleCrypto } from '@/crypto/types';
import {
  acceptTask,
  acknowledge,
  addObservation,
  addReport,
  cancelIncident,
  confirmClaim,
  confirmCompletion,
  conflictIdFor,
  createManualSOS,
  declineRequest,
  declineTask,
  extractBuilding,
  extractFloor,
  flagConflict,
  flagDetectedConflicts,
  isDomainError,
  isHumanRevision,
  normalizeValue,
  offerTask,
  prepareCapsule,
  projectForLevel,
  queueCapsule,
  recordAIProposal,
  replay,
  reportCompletion,
  reportProgress,
  requestClarification,
  resolveConflict,
  resolveIncident,
  skipClarification,
  DisclosureLevelSchema,
  DomainError,
  type Actor,
  type ClaimField,
  type Clock,
  type CommandContext,
  type CommandResult,
  type DisclosureLevel,
  type DomainEvent,
  type IdGenerator,
  type IncidentState,
  type TextSpan,
} from '@/domain';
import type { IncidentRepository } from '@/storage';
import { DEFAULT_SYNC_CONFIG, SyncEngine, type SyncConfig } from '@/sync/SyncEngine';
import { peerRecordSchema, systemTimers, type KeyValueStore, type PeerRecord, type Timers } from '@/sync/types';
import type { PeerTransport } from '@/transport/types';

import type {
  ActionResult,
  AppMode,
  AppSettings,
  DiscoveryState,
  FactView,
  IncidentView,
  PairingSession,
  PeerView,
  PulseActions,
  PulseApp,
  PulseSnapshot,
  RecipientPolicyInput,
  SendFailureCode,
} from './api';
import { readJson, writeJson } from './kv';
import { buildIncidentView, policyFromInput, projectionFacts } from './views';

/**
 * One device's whole application core: every PulseAction and the snapshot, on top of the domain
 * commands, the incident repository and the sync engine. LIVE runs one core on real adapters; DEMO
 * runs three on simulated ones. The logic in between is the same code.
 */

export interface CoreConfig extends SyncConfig {
  retryIntervalMs: number;
  /** How long startup waits for the keychain identity and the capability probe before going on without them. */
  startupTimeoutMs: number;
  defaultName: string;
}

export const DEFAULT_CORE_CONFIG: CoreConfig = {
  ...DEFAULT_SYNC_CONFIG,
  retryIntervalMs: 5_000,
  startupTimeoutMs: 2_500,
  defaultName: 'PULSE user',
};

export const DEFAULT_SETTINGS: AppSettings = {
  discoveryEnabled: true,
  relayEnabled: true,
  showTechnicalDetails: false,
  sosCountdownSeconds: 5,
  reportLocale: 'en-US',
};

export interface PulseCoreDeps {
  mode: AppMode;
  repo: IncidentRepository;
  ai: LocalAIService;
  transport: PeerTransport;
  crypto: CapsuleCrypto;
  kv: KeyValueStore;
  /** False when `kv` does not survive a restart. Defaults to true in LIVE and false in DEMO. */
  kvPersistent?: boolean;
  clock: Clock;
  ids: IdGenerator;
  deviceInfo: { model: string; osVersion: string };
  timers?: Timers;
  /** Reads a recorded WAV file. Injected so Jest never loads expo-file-system. */
  readFile?: (uri: string) => Promise<Uint8Array>;
  config?: Partial<CoreConfig>;
  /** Preset profile and pairings. Used by the Demo Lab and tests; LIVE pairs over the transport. */
  seed?: { name?: string; onboarded?: boolean; peers?: readonly PeerRecord[]; settings?: Partial<AppSettings> };
}

const profileSchema = z.strictObject({
  deviceId: z.string().nullable(),
  /** Earlier ids this device authored events under (for example a provisional id used before the keychain answered). */
  aliases: z.array(z.string()).max(8),
  provisional: z.boolean(),
  name: z.string().max(80),
  onboarded: z.boolean(),
  hardwareBacked: z.boolean().nullable(),
});
type Profile = z.infer<typeof profileSchema>;

const settingsSchema = z.strictObject({
  discoveryEnabled: z.boolean(),
  relayEnabled: z.boolean(),
  showTechnicalDetails: z.boolean(),
  sosCountdownSeconds: z.number().int().min(0).max(60),
  reportLocale: z.string().min(2).max(16),
});

const storedProjectionsSchema = z.record(
  z.string(),
  z.strictObject({ projection: SentProjectionSchema.nullable(), via: z.string().nullable(), version: z.number().int() }),
);
type StoredProjection = { projection: SentProjection | null; via: string | null; version: number };

const KEY_PROFILE = 'profile';
const KEY_SETTINGS = 'settings';
const KEY_PEERS = 'peers';
const KEY_PROJECTIONS = 'projections';

const MESSAGES: Record<string, string> = {
  incident_not_found: 'This request is not on this device.',
  incident_closed: 'This request is already closed.',
  not_reporter: 'Only the person who asked for help can do this.',
  not_participant: 'This device is not part of this request.',
  not_recipient: 'Only a responder can do this.',
  not_assignee: 'Only the person who took this role can do this.',
  not_authorized_to_resolve: 'Only the requester or a responder who took a role can resolve this.',
  task_not_open: 'This role has already been taken.',
  peer_not_trusted: 'That device is not a trusted peer.',
  identity_unavailable: 'This device has no identity keys yet.',
  invalid_input: 'That input is not valid.',
};

function fail<T>(error: unknown): ActionResult<T> {
  const code = isDomainError(error) ? error.code : error instanceof CoreError ? error.code : 'internal_error';
  return { ok: false, code, message: MESSAGES[code] ?? 'That could not be done on this device.' };
}

function ok(): ActionResult;
function ok<T>(value: T): ActionResult<T>;
function ok<T>(value?: T): ActionResult<T | undefined> {
  return { ok: true, value };
}

class CoreError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'CoreError';
  }
}

function stable<T>(previous: T, next: T): T {
  return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
}

function randomHex(length: number): string {
  let out = '';
  while (out.length < length) out += Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0');
  return out.slice(0, length);
}

function spanIn(text: string, evidence: string): TextSpan | null {
  const needle = evidence.trim();
  if (needle.length === 0) return null;
  let start = text.indexOf(needle);
  if (start < 0) start = text.toLowerCase().indexOf(needle.toLowerCase());
  if (start < 0) return null;
  const end = start + needle.length;
  const exact = text.slice(start, end);
  return exact.length <= 500 ? { start, end, text: exact } : null;
}

/** Same bound as a stored report's text. */
const MAX_DIAGNOSTIC_TEXT = 4_000;

const CLARIFICATION_PROMPTS: Record<ClaimField, string> = {
  floor: 'Which floor are you on?',
  building: 'Which building are you in?',
  locationText: 'Where exactly are you?',
  assistanceRequested: 'Do you need someone to come to you?',
  incidentType: 'What happened?',
  symptom: 'How are you feeling?',
};

export class PulseCore implements PulseApp {
  readonly actions: PulseActions;
  readonly engine: SyncEngine;

  private readonly config: CoreConfig;
  private readonly timers: Timers;
  private readonly storage: { settingsPersistent: boolean };
  private profile: Profile;
  private settings: AppSettings;
  private readonly peers = new Map<string, PeerRecord>();
  private readonly projections = new Map<string, StoredProjection>();
  private capabilities: CapabilityMatrix | null = null;
  private discovery: DiscoveryState = 'off';
  private discoveryError: string | null = null;
  private ready = false;
  private disposed = false;
  /** False while the app is in the background. The radio is paused then, whatever the setting says. */
  private appActive = true;
  private lifecycleTail: Promise<void> = Promise.resolve();

  private snapshot: PulseSnapshot;
  private readonly listeners = new Set<() => void>();
  private incidentViews: IncidentView[] = [];
  private readonly viewCache = new Map<string, { key: string; view: IncidentView | null }>();
  private namesVersion = 0;

  private lock: Promise<unknown> = Promise.resolve();
  private refreshTail: Promise<void> = Promise.resolve();
  private localLoad: Promise<void> | null = null;
  private startup: Promise<void> | null = null;
  private retryTimer: unknown = null;
  private pendingWork = 0;
  private idleWaiters: (() => void)[] = [];

  constructor(private readonly deps: PulseCoreDeps) {
    this.config = { ...DEFAULT_CORE_CONFIG, ...(deps.config ?? {}) };
    this.timers = deps.timers ?? systemTimers;
    this.storage = Object.freeze({ settingsPersistent: deps.kvPersistent ?? deps.mode === 'live' });
    this.profile = {
      deviceId: null,
      aliases: [],
      provisional: false,
      name: deps.seed?.name ?? '',
      onboarded: deps.seed?.onboarded ?? false,
      hardwareBacked: null,
    };
    this.settings = { ...DEFAULT_SETTINGS, ...(deps.seed?.settings ?? {}) };
    for (const peer of deps.seed?.peers ?? []) this.peers.set(peer.deviceId, peer);

    this.engine = new SyncEngine({
      repo: deps.repo,
      transport: deps.transport,
      crypto: deps.crypto,
      kv: deps.kv,
      clock: deps.clock,
      ids: deps.ids,
      timers: this.timers,
      config: this.config,
      host: {
        self: () => this.self(),
        isLocalDevice: (id) => this.isLocal(id),
        actorFor: (state) => this.actorFor(state),
        peer: (id) => this.peers.get(id),
        peers: () => [...this.peers.values()],
        trust: (record) => this.trust(record),
        relayEnabled: () => this.settings.relayEnabled,
        exclusive: (fn) => this.exclusive(fn),
        storeProjection: (incidentId, projection) => this.storeProjection(incidentId, projection),
        noteVia: (incidentId, via) => this.noteVia(incidentId, via),
        changed: () => this.changed(),
        track: (work) => this.track(work),
      },
    });

    this.snapshot = Object.freeze(this.compose());
    this.actions = this.buildActions();
  }

  // ---- PulseApp --------------------------------------------------------------------------------

  getSnapshot = (): PulseSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.retryTimer !== null) this.timers.clearInterval(this.retryTimer);
    this.retryTimer = null;
    this.engine.detach();
    this.listeners.clear();
    try {
      await this.deps.transport.stop();
    } catch {
      // Nothing to release.
    }
  }

  // ---- startup ---------------------------------------------------------------------------------

  /** Loads local state, then identity and capabilities (bounded), then starts syncing. Idempotent. */
  start(): Promise<void> {
    if (!this.startup) this.startup = this.runStartup();
    return this.startup;
  }

  /** Local storage only. This is all an SOS ever waits for. */
  private local(): Promise<void> {
    if (!this.localLoad) this.localLoad = this.loadLocal();
    return this.localLoad;
  }

  private async loadLocal(): Promise<void> {
    const kv = this.deps.kv;
    const profile = profileSchema.safeParse(await readJson(kv, KEY_PROFILE));
    if (profile.success) this.profile = profile.data;
    const settings = settingsSchema.safeParse(await readJson(kv, KEY_SETTINGS));
    if (settings.success) this.settings = settings.data;
    const peers = z.array(peerRecordSchema).safeParse(await readJson(kv, KEY_PEERS));
    if (peers.success) {
      this.peers.clear();
      for (const peer of peers.data) this.peers.set(peer.deviceId, peer);
    } else if (this.peers.size > 0) {
      // Preset pairings (Demo Lab, tests) are stored like any others.
      await writeJson(kv, KEY_PEERS, [...this.peers.values()]);
    }
    const projections = storedProjectionsSchema.safeParse(await readJson(kv, KEY_PROJECTIONS));
    if (projections.success) {
      for (const [id, entry] of Object.entries(projections.data)) this.projections.set(id, entry);
    }
    await this.engine.relay.load();
  }

  private bounded(work: Promise<unknown>): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = this.timers.setTimeout(() => resolve(), this.config.startupTimeoutMs);
      const done = () => {
        this.timers.clearTimeout(timer);
        resolve();
      };
      work.then(done, done);
    });
  }

  private async runStartup(): Promise<void> {
    await this.local();
    this.engine.attach();
    // The keychain may be slow or broken. A cached id is used at once and verified in the background.
    const identity = this.loadIdentity();
    const needsIdentity = this.profile.deviceId === null || this.profile.provisional;
    await this.bounded(Promise.all([needsIdentity ? identity : Promise.resolve(), this.refreshCapabilitiesInner()]));
    if (this.disposed) return;
    if (this.appActive && this.settings.discoveryEnabled && this.profile.onboarded) void this.track(this.applyDiscovery(true));
    this.retryTimer = this.timers.setInterval(() => {
      void this.track(this.engine.retryPairing());
      void this.track(this.engine.forwardRelayed().then(() => this.engine.flush()));
    }, this.config.retryIntervalMs);
    this.ready = true;
    await this.refresh();
  }

  private async loadIdentity(): Promise<void> {
    try {
      const identity = await this.deps.crypto.createOrLoadIdentity();
      if (this.disposed) return;
      const previous = this.profile.deviceId;
      const aliases = previous !== null && previous !== identity.deviceId ? [...this.profile.aliases, previous].slice(-8) : this.profile.aliases;
      const changed = previous !== identity.deviceId || this.profile.hardwareBacked !== identity.hardwareBacked || this.profile.provisional;
      this.profile = { ...this.profile, deviceId: identity.deviceId, aliases, provisional: false, hardwareBacked: identity.hardwareBacked };
      if (changed) {
        await writeJson(this.deps.kv, KEY_PROFILE, this.profile);
        this.namesVersion += 1;
        // Discovery that already failed for lack of an identity is retried now that there is one.
        if (this.appActive && this.settings.discoveryEnabled && this.profile.onboarded && this.discovery === 'error') {
          void this.track(this.applyDiscovery(true));
        }
        this.changed();
      }
    } catch {
      // No identity keys: SOS still works locally, nothing can be sealed or paired until this succeeds.
    }
  }

  // ---- identity and helpers --------------------------------------------------------------------

  private displayName(): string {
    return this.profile.name.trim().length > 0 ? this.profile.name.trim() : this.config.defaultName;
  }

  private self(): Actor | null {
    return this.profile.deviceId === null ? null : { deviceId: this.profile.deviceId, userName: this.displayName() };
  }

  /** The author for a new incident. Mints a provisional device id rather than ever waiting for the keychain. */
  private ensureSelf(): Actor {
    if (this.profile.deviceId === null) {
      this.profile = { ...this.profile, deviceId: `dev-${randomHex(20)}`, provisional: true };
      void writeJson(this.deps.kv, KEY_PROFILE, this.profile);
    }
    return { deviceId: this.profile.deviceId ?? '', userName: this.displayName() };
  }

  private isLocal(deviceId: string): boolean {
    return deviceId === this.profile.deviceId || this.profile.aliases.includes(deviceId);
  }

  private actorFor(state: IncidentState): Actor | null {
    const me = this.self();
    if (!me) return null;
    const reporter = state.incident?.reporter.deviceId;
    if (reporter !== undefined && reporter !== me.deviceId && this.isLocal(reporter)) return { deviceId: reporter, userName: me.userName };
    return me;
  }

  private ctxFor(state: IncidentState): CommandContext {
    const actor = this.actorFor(state);
    if (!actor) throw new CoreError('identity_unavailable');
    return { actor, clock: this.deps.clock, ids: this.deps.ids };
  }

  private nameOf = (actor: Actor): string => {
    if (this.isLocal(actor.deviceId)) return 'You';
    return this.peers.get(actor.deviceId)?.name ?? actor.userName;
  };

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  track<T>(work: Promise<T>): Promise<T> {
    this.pendingWork += 1;
    const done = () => {
      this.pendingWork -= 1;
      if (this.pendingWork === 0) {
        const waiters = this.idleWaiters;
        this.idleWaiters = [];
        for (const w of waiters) w();
      }
    };
    work.then(done, done);
    return work;
  }

  /** Background work (sends, receipts, relays, snapshot rebuilds) currently running. */
  get busy(): number {
    return this.pendingWork;
  }

  whenIdle(): Promise<void> {
    if (this.pendingWork === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  private async trust(record: PeerRecord): Promise<void> {
    this.peers.set(record.deviceId, record);
    this.namesVersion += 1;
    await writeJson(this.deps.kv, KEY_PEERS, [...this.peers.values()]);
    this.changed();
  }

  private async persistProjections(): Promise<void> {
    await writeJson(this.deps.kv, KEY_PROJECTIONS, Object.fromEntries(this.projections));
  }

  private async storeProjection(incidentId: string, projection: SentProjection): Promise<void> {
    const previous = this.projections.get(incidentId);
    this.projections.set(incidentId, { projection, via: previous?.via ?? null, version: (previous?.version ?? 0) + 1 });
    await this.persistProjections();
  }

  private async noteVia(incidentId: string, via: string): Promise<void> {
    const previous = this.projections.get(incidentId);
    if (previous?.via) return;
    // Only the first arrival counts: an incident that already came directly is not relabelled.
    if (previous && previous.version > 1) return;
    this.projections.set(incidentId, { projection: previous?.projection ?? null, via, version: (previous?.version ?? 0) + 1 });
    await this.persistProjections();
  }

  // ---- snapshot --------------------------------------------------------------------------------

  private peerViews(): PeerView[] {
    const views: PeerView[] = [...this.peers.values()].map((p) => ({
      deviceId: p.deviceId,
      name: p.name,
      trusted: true,
      reach: this.engine.reachOf(p.deviceId),
      lastSeenMs: this.engine.lastSeenMs(p.deviceId),
      level: p.level,
    }));
    for (const id of this.engine.discoveredIds()) {
      if (this.peers.has(id) || this.isLocal(id)) continue;
      // An unpaired device has no verified name. Whatever it advertises is not shown as identity.
      views.push({ deviceId: id, name: 'Nearby iPhone', trusted: false, reach: this.engine.reachOf(id), lastSeenMs: this.engine.lastSeenMs(id) });
    }
    return views;
  }

  private compose(): PulseSnapshot {
    const previous: PulseSnapshot | undefined = this.snapshot;
    const pairing: PairingSession | null = this.engine.pairingView();
    const next: PulseSnapshot = {
      mode: this.deps.mode,
      ready: this.ready,
      me: {
        deviceId: this.profile.deviceId ?? '',
        name: this.profile.name,
        onboarded: this.profile.onboarded,
        hardwareBackedKeys: this.profile.hardwareBacked,
      },
      capabilities: this.capabilities,
      network: { discovery: this.discovery, error: this.discoveryError ?? this.engine.transportError() },
      peers: this.peerViews(),
      incidents: this.incidentViews,
      pairing,
      settings: this.settings,
      storage: this.storage,
      demo: null,
    };
    if (!previous) return next;
    return {
      ...next,
      me: stable(previous.me, next.me),
      capabilities: stable(previous.capabilities, next.capabilities),
      network: stable(previous.network, next.network),
      peers: stable(previous.peers, next.peers),
      pairing: stable(previous.pairing, next.pairing),
      settings: stable(previous.settings, next.settings),
    };
  }

  /** Replaces the snapshot only if something in it changed, then notifies. */
  private publish(): void {
    const next = this.compose();
    const previous = this.snapshot;
    const same = (Object.keys(next) as (keyof PulseSnapshot)[]).every((key) => previous[key] === next[key]);
    if (same) return;
    this.snapshot = Object.freeze(next);
    for (const listener of [...this.listeners]) listener();
  }

  private async rebuildIncidents(): Promise<void> {
    const repo = this.deps.repo;
    const ids = await repo.allIncidentIds();
    const pendingBy = new Map<string, number>();
    const blockedBy = new Map<string, SendFailureCode>();
    for (const row of await repo.getPendingOutbox()) {
      pendingBy.set(row.incidentId, (pendingBy.get(row.incidentId) ?? 0) + 1);
      const block = this.engine.sendBlockOf(row.packetId);
      if (block) blockedBy.set(row.incidentId, block);
    }
    const views: IncidentView[] = [];
    const live = new Set(ids);
    for (const id of this.viewCache.keys()) if (!live.has(id)) this.viewCache.delete(id);
    for (const id of ids) {
      const events = await repo.eventsForIncident(id);
      const stored = this.projections.get(id) ?? null;
      const pending = pendingBy.get(id) ?? 0;
      const sendFailure = blockedBy.get(id) ?? null;
      const key = `${events.length}|${pending}|${stored?.version ?? 0}|${this.namesVersion}|${sendFailure ?? ''}`;
      let cached = this.viewCache.get(id);
      if (!cached || cached.key !== key) {
        const via = stored?.via ?? null;
        cached = {
          key,
          view: buildIncidentView({
            state: replay(id, events),
            selfId: this.profile.deviceId,
            isLocal: (deviceId) => this.isLocal(deviceId),
            nameOf: this.nameOf,
            stored: stored?.projection ?? null,
            viaName: via === null ? null : (this.peers.get(via)?.name ?? null),
            pendingOutbox: pending,
            sendFailure,
          }),
        };
        this.viewCache.set(id, cached);
      }
      if (cached.view) views.push(cached.view);
    }
    views.sort((a, b) => (b.state.incident?.createdAtMs ?? 0) - (a.state.incident?.createdAtMs ?? 0) || (a.id < b.id ? 1 : -1));
    const unchanged = views.length === this.incidentViews.length && views.every((v, i) => v === this.incidentViews[i]);
    if (!unchanged) this.incidentViews = views;
  }

  /** Rebuilds the snapshot from storage. Resolves after subscribers were notified. */
  refresh(): Promise<void> {
    const run = this.refreshTail.then(async () => {
      if (this.disposed) return;
      try {
        await this.rebuildIncidents();
      } catch {
        // Keep the last good incident list; the next change rebuilds it.
      }
      this.publish();
    });
    this.refreshTail = run.catch(() => undefined);
    return this.refreshTail;
  }

  private changed(): void {
    if (this.disposed) return;
    void this.track(this.refresh());
  }

  // ---- commands --------------------------------------------------------------------------------

  /**
   * Replays, builds, commits and queues the result for the other participants, all under the
   * ledger lock; then kicks delivery off without waiting for it.
   */
  private async command(
    incidentId: string,
    build: (state: IncidentState, ctx: CommandContext) => CommandResult,
  ): Promise<ActionResult<CommandResult>> {
    try {
      await this.local();
      const result = await this.exclusive(async () => {
        const state = await this.deps.repo.replay(incidentId);
        if (!state.incident) throw new DomainError('incident_not_found');
        const built = build(state, this.ctxFor(state));
        if (built.events.length === 0 && built.outbox.length === 0) return built;
        await this.deps.repo.commit(built);
        const direct = new Set(built.outbox.map((row) => row.recipientDeviceId));
        await this.engine.queueSync(this.deps.repo, built.state, built.events.map((e) => e.id), direct);
        return built;
      });
      this.kickDelivery(incidentId);
      await this.refresh();
      return ok(result);
    } catch (error) {
      return fail(error);
    }
  }

  private async simple(incidentId: string, build: (state: IncidentState, ctx: CommandContext) => CommandResult): Promise<ActionResult> {
    const result = await this.command(incidentId, build);
    return result.ok ? ok() : result;
  }

  private kickDelivery(incidentId?: string): void {
    void this.track(this.engine.flush(incidentId === undefined ? {} : { incidentId }).catch(() => undefined));
  }

  private withConflicts(result: CommandResult, ctx: CommandContext): CommandResult {
    const flagged = flagDetectedConflicts(result.state, ctx);
    return { events: [...result.events, ...flagged.events], outbox: result.outbox, state: flagged.state };
  }

  private async sendSOS(input?: { incidentType?: string }): Promise<ActionResult<{ incidentId: string }>> {
    try {
      // Local storage only. No AI, radio, keychain or permission is awaited on this path.
      await this.local();
      const actor = this.ensureSelf();
      const recipients = [...this.peers.values()]
        .filter((p) => p.level !== 'relay')
        .map((p) => ({ deviceId: p.deviceId, userName: p.name, level: p.level }));
      const incidentType = input?.incidentType?.trim().slice(0, 80);
      const result = await this.exclusive(async () => {
        const built = createManualSOS(
          { actor, clock: this.deps.clock, ids: this.deps.ids },
          { recipients, ...(incidentType ? { incidentType } : {}) },
        );
        await this.deps.repo.commit(built);
        return built;
      });
      this.kickDelivery(result.incidentId);
      await this.refresh();
      return ok({ incidentId: result.incidentId });
    } catch (error) {
      return fail(error);
    }
  }

  private async updateCapsule(incidentId: string, input: RecipientPolicyInput): Promise<ActionResult> {
    for (const [deviceId, level] of Object.entries(input.levels)) {
      if (level !== 'off' && !this.isLocal(deviceId) && !this.peers.has(deviceId)) return fail(new CoreError('peer_not_trusted'));
    }
    return this.simple(incidentId, (state, ctx) => {
      const policy = policyFromInput(
        input,
        (id) => this.peers.get(id)?.name ?? state.recipients.find((r) => r.deviceId === id)?.userName ?? null,
        (id) => this.isLocal(id),
      );
      const prepared = prepareCapsule(state, ctx, { policy });
      const targets = policy.recipients.filter((r) => r.level !== 'relay').map((r) => r.deviceId);
      if (targets.length === 0) return prepared;
      const queued = queueCapsule(prepared.state, ctx, { capsuleId: prepared.capsuleId, recipientDeviceIds: targets });
      return { events: [...prepared.events, ...queued.events], outbox: queued.outbox, state: queued.state };
    });
  }

  private previewDisclosure(incidentId: string, level: DisclosureLevel, input: RecipientPolicyInput): FactView[] {
    const view = this.snapshot.incidents.find((i) => i.id === incidentId);
    if (!view) return [];
    const policy = policyFromInput(input, () => null, (id) => this.isLocal(id));
    // The same projection the encryptor uses, applied to what this device holds.
    return projectionFacts(projectForLevel(view.state, level, policy), view.state, this.nameOf);
  }

  // ---- AI --------------------------------------------------------------------------------------

  private aiSource(): AISource {
    return this.capabilities?.source ?? (this.deps.mode === 'demo' ? 'simulated' : 'callstack-apple');
  }

  private aiFailure<T>(state: AIFailureState, message: string): AIResult<T> {
    return { ok: false, state, message, meta: { source: this.aiSource(), latencyMs: 0 } };
  }

  private async guardAI<T>(run: () => Promise<AIResult<T>>): Promise<AIResult<T>> {
    try {
      return await run();
    } catch {
      return this.aiFailure('native_error', 'ai_call_failed');
    }
  }

  private async contextFor(incidentId: string): Promise<IncidentContext | null> {
    await this.local();
    const state = await this.deps.repo.replay(incidentId);
    if (!state.incident) return null;
    const known: Partial<Record<ProposalField, string>> = {};
    for (const field of Object.keys(state.claims) as ClaimField[]) {
      const claim = state.claims[field];
      if (claim.value !== null && claim.tag !== 'ai_proposed' && claim.tag !== 'unknown' && claim.tag !== 'unresolved') known[field] = claim.value;
    }
    const skipped = state.questions
      .filter((q) => q.status === 'skipped')
      .map((q) => q.field)
      .filter((f): f is ClarifiableField => f === 'floor' || f === 'building' || f === 'locationText' || f === 'assistanceRequested');
    return { report: state.reports.filter((r) => r.kind === 'report').map((r) => r.text).join('\n'), known, skipped: [...new Set(skipped)] };
  }

  private async analyzeReport(incidentId: string, reportId: string): Promise<AIResult<IncidentProposal>> {
    await this.local();
    const state = await this.deps.repo.replay(incidentId);
    const report = state.reports.find((r) => r.id === reportId);
    if (!report) return this.aiFailure('invalid_output', 'report_not_found');
    return this.guardAI(() => this.deps.ai.extractIncidentReport({ text: report.text }));
  }

  /** Extraction on text that belongs to no incident. Touches neither the ledger, the outbox nor the radio. */
  private async diagnoseExtraction(text: string): Promise<AIResult<IncidentProposal>> {
    const bounded = typeof text === 'string' ? text.trim().slice(0, MAX_DIAGNOSTIC_TEXT) : '';
    if (bounded.length === 0) return this.aiFailure('invalid_output', 'empty_input');
    return this.guardAI(() => this.deps.ai.extractIncidentReport({ text: bounded }));
  }

  private attachProposal(incidentId: string, reportId: string, proposal: IncidentProposal): Promise<ActionResult> {
    return this.simple(incidentId, (state, ctx) => {
      const report = state.reports.find((r) => r.id === reportId);
      if (!report) throw new DomainError('invalid_input');
      const findings = (Object.keys(proposal.fields) as ProposalField[]).flatMap((field) => {
        const proposed = proposal.fields[field];
        if (!proposed) return [];
        const evidence = spanIn(report.text, proposed.evidence);
        return [{ field, value: proposed.value.slice(0, 500), ...(evidence ? { evidence } : {}) }];
      });
      if (findings.length === 0) return { events: [], outbox: [], state };
      return recordAIProposal(state, ctx, { provider: this.capabilities?.provider ?? 'unknown', reportId, findings });
    });
  }

  /** AI may point at a contradiction the rules missed. It only ever flags; a human resolves. */
  private async flagAIConflicts(incidentId: string): Promise<void> {
    if (this.capabilities?.text.state !== 'ready') return;
    const before = await this.deps.repo.replay(incidentId);
    const statements = before.reports.map((r) => ({ id: r.id, author: r.author.userName, text: r.text }));
    if (!before.incident || before.closure || statements.length < 2) return;
    const result = await this.guardAI(() => this.deps.ai.findConflicts(statements));
    if (!result.ok || result.value.length === 0) return;
    const flagged = await this.exclusive(async () => {
      let state = await this.deps.repo.replay(incidentId);
      const actor = this.actorFor(state);
      if (!actor || state.closure) return false;
      const ctx: CommandContext = { actor, clock: this.deps.clock, ids: this.deps.ids };
      const eventIds: string[] = [];
      for (const proposal of result.value) {
        const revisions = state.claims[proposal.field].revisions.filter(isHumanRevision);
        const a = revisions.find((r) => r.evidence?.reportId === proposal.statementIds[0]);
        const b = revisions.find((r) => r.evidence?.reportId === proposal.statementIds[1]);
        if (!a || !b || normalizeValue(a.value) === normalizeValue(b.value)) continue;
        const covered = state.contradictions.some(
          (c) => c.field === proposal.field && (c.status === 'open' || (c.revisionIds.includes(a.id) && c.revisionIds.includes(b.id))),
        );
        if (covered) continue;
        try {
          const built = flagConflict(state, ctx, {
            field: proposal.field,
            revisionIds: [a.id, b.id],
            detectedBy: 'ai',
            conflictId: conflictIdFor(proposal.field, [a.id, b.id]),
          });
          await this.deps.repo.commit(built);
          state = built.state;
          eventIds.push(...built.events.map((e) => e.id));
        } catch {
          // Not flaggable; the statements stay as they are.
        }
      }
      if (eventIds.length > 0) await this.engine.queueSync(this.deps.repo, state, eventIds);
      return eventIds.length > 0;
    });
    if (flagged) {
      await this.engine.flush({ incidentId });
      await this.refresh();
    }
  }

  private async refreshCapabilitiesInner(): Promise<void> {
    try {
      this.capabilities = await this.deps.ai.inspectCapabilities();
    } catch {
      const down = { state: 'native_error' as const, detail: 'capability_probe_failed' };
      this.capabilities = {
        provider: this.deps.mode === 'demo' ? 'Simulation' : 'Callstack Apple',
        source: this.deps.mode === 'demo' ? 'simulated' : 'callstack-apple',
        packageVersion: 'unknown',
        device: { ...this.deps.deviceInfo },
        text: down,
        embeddings: { ...down, language: 'en' },
        transcription: { ...down, locale: this.settings.reportLocale },
        speech: down,
      };
    }
    this.publish();
  }

  private async transcribe(wavFileUri: string, locale: string): Promise<AIResult<{ text: string }>> {
    const read = this.deps.readFile;
    if (!read) return this.aiFailure('native_error', 'file_reader_unavailable');
    let wavBytes: Uint8Array;
    try {
      wavBytes = await read(wavFileUri);
    } catch {
      return this.aiFailure('native_error', 'audio_file_unreadable');
    }
    const result = await this.guardAI(() => this.deps.ai.transcribeLocal({ wavBytes }, locale));
    return result.ok ? { ok: true, value: { text: result.value.text }, meta: result.meta } : result;
  }

  // ---- network ---------------------------------------------------------------------------------

  private async applyDiscovery(enabled: boolean): Promise<void> {
    const transport = this.deps.transport;
    if (!enabled) {
      try {
        await transport.stopDiscovery();
      } catch {
        // Already stopped.
      }
      // With the radio off nobody is in range, whatever the transport last reported.
      this.engine.resetReachability();
      this.discovery = 'off';
      this.discoveryError = null;
      this.publish();
      return;
    }
    const deviceId = this.profile.deviceId;
    if (deviceId === null || this.profile.provisional) {
      this.discovery = 'error';
      this.discoveryError = 'identity_unavailable';
      this.publish();
      return;
    }
    this.discovery = 'starting';
    this.discoveryError = null;
    this.engine.clearTransportError();
    this.publish();
    try {
      await transport.startDiscovery(deviceId);
      this.discovery = 'on';
      await this.engine.connectTrusted();
    } catch (error) {
      const text = error instanceof Error ? error.message : '';
      const denied = /denied|permission|not authorized|policy/i.test(text);
      this.discovery = denied ? 'permission_denied' : 'error';
      this.discoveryError = denied ? 'local_network_permission_denied' : 'discovery_failed';
    }
    this.publish();
  }

  /**
   * App moved to the background (`false`) or back to the foreground (`true`). iOS tears the listener,
   * browser and links down in the background and restarts none of them, so the radio is stopped on the
   * way out and, if the person has discovery on, started again on the way back, followed by a delivery
   * pass. Repeated calls with the same value do nothing. Nothing on the SOS path waits for this.
   */
  setAppActive(active: boolean): Promise<void> {
    if (this.disposed || active === this.appActive) return this.lifecycleTail;
    this.appActive = active;
    const run = this.lifecycleTail.then(async () => {
      await (this.startup ?? this.local());
      // A later change already replaced this one.
      if (this.disposed || this.appActive !== active) return;
      if (!active) {
        if (this.discovery !== 'off') await this.applyDiscovery(false);
        return;
      }
      // Also retried after an error: the person may be returning from granting the permission.
      const running = this.discovery === 'on' || this.discovery === 'starting';
      if (!running && this.settings.discoveryEnabled && this.profile.onboarded) await this.applyDiscovery(true);
      await this.engine.forwardRelayed().catch(() => undefined);
      this.kickDelivery();
    });
    this.lifecycleTail = run.catch(() => undefined);
    return this.track(this.lifecycleTail);
  }

  private async saveSettings(patch: Partial<AppSettings>): Promise<void> {
    const merged = settingsSchema.safeParse({ ...this.settings, ...patch });
    if (!merged.success) return;
    this.settings = stable(this.settings, merged.data);
    await writeJson(this.deps.kv, KEY_SETTINGS, this.settings);
    this.publish();
  }

  // ---- action table ----------------------------------------------------------------------------

  private buildActions(): PulseActions {
    const noop = () => undefined;
    return {
      completeOnboarding: async ({ name }) => {
        await this.local();
        this.profile = { ...this.profile, name: name.trim().slice(0, 80), onboarded: true };
        this.namesVersion += 1;
        await writeJson(this.deps.kv, KEY_PROFILE, this.profile);
        if (this.appActive && this.settings.discoveryEnabled && this.discovery === 'off') void this.track(this.applyDiscovery(true));
        await this.refresh();
      },

      sendSOS: (input) => this.sendSOS(input),

      addReport: async (incidentId, text, inputMode) => {
        const result = await this.command(incidentId, (state, ctx) => addReport(state, ctx, { text, inputMode }));
        if (!result.ok) return result;
        const added = result.value.events.find((e): e is Extract<DomainEvent, { type: 'REPORT_ADDED' }> => e.type === 'REPORT_ADDED');
        if (!added) return fail(new CoreError('internal_error'));
        void this.track(this.flagAIConflicts(incidentId).catch(() => undefined));
        return ok({ reportId: added.payload.reportId });
      },
      analyzeReport: (incidentId, reportId) => this.analyzeReport(incidentId, reportId),
      diagnoseExtraction: (text) => this.diagnoseExtraction(text),
      attachProposal: (incidentId, reportId, proposal) => this.attachProposal(incidentId, reportId, proposal),
      confirmFact: (incidentId, field, value) =>
        this.simple(incidentId, (state, ctx) => {
          const key = normalizeValue(value);
          const target = [...state.claims[field].revisions]
            .reverse()
            .find((r) => r.authority !== 'confirmation' && normalizeValue(r.value) === key);
          return confirmClaim(state, ctx, { field, value: value.trim().slice(0, 500), ...(target ? { confirmsRevisionId: target.id } : {}) });
        }),

      suggestClarification: async (incidentId): Promise<AIResult<ClarificationProposal>> => {
        const context = await this.contextFor(incidentId);
        if (!context) return this.aiFailure('invalid_output', 'incident_not_found');
        return this.guardAI(() => this.deps.ai.suggestClarification(context));
      },
      answerClarification: async (incidentId, field, answer) => {
        const result = await this.simple(incidentId, (state, ctx) => {
          const text = answer.trim();
          const derived = field === 'floor' ? extractFloor(text)?.value : field === 'building' ? extractBuilding(text)?.value : undefined;
          const question = [...state.questions].reverse().find((q) => q.field === field && q.status === 'open');
          const confirmed = confirmClaim(state, ctx, {
            field,
            value: (derived ?? text).slice(0, 500),
            ...(question ? { questionId: question.id } : {}),
          });
          return this.withConflicts(confirmed, ctx);
        });
        if (result.ok) void this.track(this.flagAIConflicts(incidentId).catch(() => undefined));
        return result;
      },
      skipClarification: (incidentId, field) =>
        this.simple(incidentId, (state, ctx) => {
          const open = [...state.questions].reverse().find((q) => q.field === field && q.status === 'open');
          if (open) return skipClarification(state, ctx, { questionId: open.id });
          // Nothing was recorded as asked yet: record the question and the refusal together, so it is not asked again.
          const asked = requestClarification(state, ctx, { field, prompt: CLARIFICATION_PROMPTS[field], origin: 'rule' });
          const question = asked.state.questions[asked.state.questions.length - 1];
          if (!question) throw new DomainError('unknown_question');
          const skipped = skipClarification(asked.state, ctx, { questionId: question.id });
          return { events: [...asked.events, ...skipped.events], outbox: [], state: skipped.state };
        }),

      addObservation: async (incidentId, text) => {
        const result = await this.simple(incidentId, (state, ctx) => addObservation(state, ctx, { text }));
        if (result.ok) void this.track(this.flagAIConflicts(incidentId).catch(() => undefined));
        return result;
      },
      resolveConflict: (incidentId, conflictId, value) =>
        this.simple(incidentId, (state, ctx) => {
          const conflict = state.contradictions.find((c) => c.id === conflictId);
          if (!conflict) throw new DomainError('unknown_conflict');
          const key = normalizeValue(value);
          const chosen = state.claims[conflict.field].revisions.find((r) => conflict.revisionIds.includes(r.id) && normalizeValue(r.value) === key);
          return resolveConflict(state, ctx, { conflictId, value: value.trim().slice(0, 500), ...(chosen ? { chosenRevisionId: chosen.id } : {}) });
        }),
      requestConflictClarification: (incidentId, conflictId) =>
        this.simple(incidentId, (state, ctx) => {
          const conflict = state.contradictions.find((c) => c.id === conflictId);
          if (conflict) {
            return requestClarification(state, ctx, { field: conflict.field, prompt: CLARIFICATION_PROMPTS[conflict.field], origin: 'human', conflictId });
          }
          // A device that cannot read the conflicting statements still knows which field is disputed.
          const field = (Object.keys(CLARIFICATION_PROMPTS) as ClaimField[]).find((f) => conflictId.startsWith(`conflict:${f}:`));
          if (!field) throw new DomainError('unknown_conflict');
          return requestClarification(state, ctx, { field, prompt: CLARIFICATION_PROMPTS[field], origin: 'human' });
        }),

      suggestTasks: async (incidentId): Promise<AIResult<TaskProposal[]>> => {
        const context = await this.contextFor(incidentId);
        if (!context) return this.aiFailure('invalid_output', 'incident_not_found');
        return this.guardAI(() => this.deps.ai.proposeNonMedicalTasks(context));
      },
      offerTask: (incidentId, input) =>
        this.simple(incidentId, (state, ctx) =>
          offerTask(state, ctx, {
            kind: input.kind,
            title: input.title.trim().slice(0, 120),
            origin: input.aiSuggested ? 'ai_suggested' : 'human',
            ...(input.toDeviceId ? { offeredToDeviceId: input.toDeviceId } : {}),
          }),
        ),

      acknowledge: (incidentId) => this.simple(incidentId, (state, ctx) => acknowledge(state, ctx)),
      declineRequest: (incidentId) => this.simple(incidentId, (state, ctx) => declineRequest(state, ctx)),
      acceptTask: (incidentId, taskId) => this.simple(incidentId, (state, ctx) => acceptTask(state, ctx, { taskId })),
      declineTask: (incidentId, taskId) => this.simple(incidentId, (state, ctx) => declineTask(state, ctx, { taskId })),
      startTask: (incidentId, taskId, note) =>
        this.simple(incidentId, (state, ctx) => reportProgress(state, ctx, { taskId, ...(note ? { note: note.slice(0, 500) } : {}) })),
      reportTaskComplete: (incidentId, taskId, note) =>
        this.simple(incidentId, (state, ctx) => reportCompletion(state, ctx, { taskId, ...(note ? { note: note.slice(0, 500) } : {}) })),
      confirmTaskComplete: (incidentId, taskId) => this.simple(incidentId, (state, ctx) => confirmCompletion(state, ctx, { taskId })),

      updateCapsule: (incidentId, policy) => this.updateCapsule(incidentId, policy),
      previewDisclosure: (incidentId, level, policy) => this.previewDisclosure(incidentId, level, policy),

      resolveIncident: (incidentId, note) =>
        this.simple(incidentId, (state, ctx) => resolveIncident(state, ctx, note ? { note: note.slice(0, 500) } : {})),
      cancelIncident: (incidentId) => this.simple(incidentId, (state, ctx) => cancelIncident(state, ctx)),
      retryDelivery: async (incidentId) => {
        await this.local();
        await this.engine.forwardRelayed().catch(() => undefined);
        await this.engine.flush({ force: true, ...(incidentId === undefined ? {} : { incidentId }) }).catch(() => undefined);
        await this.refresh();
      },

      setDiscovery: async (enabled) => {
        await this.local();
        await this.saveSettings({ discoveryEnabled: enabled });
        // In the background only the choice is stored; the radio follows it on the next foreground.
        if (this.appActive || !enabled) await this.applyDiscovery(enabled);
      },
      startPairing: async (peerDeviceId) => {
        await this.local();
        if (this.isLocal(peerDeviceId)) return fail(new CoreError('invalid_input'));
        const result = await this.engine.startPairing(peerDeviceId);
        this.publish();
        return result.ok ? ok() : fail(new CoreError(result.code));
      },
      confirmPairing: async () => {
        const result = await this.engine.confirmPairing();
        this.publish();
        return result.ok ? ok() : fail(new CoreError(result.code));
      },
      cancelPairing: async () => {
        await this.engine.cancelPairing();
        this.publish();
      },
      removePeer: async (peerDeviceId) => {
        await this.local();
        if (!this.peers.delete(peerDeviceId)) return;
        this.namesVersion += 1;
        await writeJson(this.deps.kv, KEY_PEERS, [...this.peers.values()]);
        await this.engine.forgetPeer(peerDeviceId);
        await this.refresh();
      },
      renamePeer: async (peerDeviceId, name) => {
        await this.local();
        const peer = this.peers.get(peerDeviceId);
        const trimmed = name.trim().slice(0, 80);
        if (!peer || trimmed.length === 0) return;
        this.peers.set(peerDeviceId, { ...peer, name: trimmed });
        this.namesVersion += 1;
        await writeJson(this.deps.kv, KEY_PEERS, [...this.peers.values()]);
        await this.refresh();
      },
      setPeerLevel: (peerDeviceId, level) => this.setPeerLevel(peerDeviceId, level),

      transcribe: (wavFileUri, locale) => this.transcribe(wavFileUri, locale),

      updateSettings: async (patch) => {
        await this.local();
        const discoveryChanged = patch.discoveryEnabled !== undefined && patch.discoveryEnabled !== this.settings.discoveryEnabled;
        await this.saveSettings(patch);
        if (discoveryChanged && (this.appActive || !this.settings.discoveryEnabled)) await this.applyDiscovery(this.settings.discoveryEnabled);
      },
      refreshCapabilities: () => this.refreshCapabilitiesInner(),
      deleteAllIncidents: async () => {
        await this.local();
        await this.exclusive(() => this.deps.repo.reset());
        this.projections.clear();
        this.viewCache.clear();
        await this.persistProjections();
        await this.refresh();
      },

      demo: { viewAs: noop, setLink: noop, setAIReady: noop, runScenario: noop, reset: noop },
    };
  }

  /** Changes the default disclosure level this device grants a paired peer on new incidents. */
  async setPeerLevel(peerDeviceId: string, level: DisclosureLevel): Promise<ActionResult> {
    await this.local();
    const peer = this.peers.get(peerDeviceId);
    if (!peer) return fail(new CoreError('peer_not_trusted'));
    const parsed = DisclosureLevelSchema.safeParse(level);
    if (!parsed.success) return fail(new CoreError('invalid_input'));
    this.peers.set(peerDeviceId, { ...peer, level: parsed.data });
    await writeJson(this.deps.kv, KEY_PEERS, [...this.peers.values()]);
    await this.refresh();
    return ok();
  }
}
