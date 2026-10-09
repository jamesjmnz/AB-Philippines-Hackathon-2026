import { buildCapsuleSections, parseCapsuleSections, sectionsForLevel, type SentProjection } from '@/crypto/capsule';
import type { CapsuleCrypto, CapsuleEnvelope, CapsuleSectionName, CryptoResult } from '@/crypto/types';
import {
  PacketReceiptSchema,
  flagDetectedConflicts,
  levelForDevice,
  newOutboxMessage,
  recordPeerReceipt,
  recordSendAttempt,
  type Actor,
  type Clock,
  type CommandContext,
  type IdGenerator,
  type IncidentState,
  type OutboxMessage,
} from '@/domain';
import type { IncidentRepository } from '@/storage';
import { utf8ToBytes } from '@/transport/base64';
import type { PeerConnectionState, PeerTransport, Unsubscribe } from '@/transport/types';
import { z } from 'zod';

import { capsuleIdFor, decodePacket, encodePacket, incidentRefFor, type PairingPacket, type SealedPacket } from './packet';
import { PairingManager, type PairingResult, type PairingView } from './pairing';
import { RelayStore } from './relay';
import type { KeyValueStore, PeerRecord, SendBlockCode, Timers } from './types';

/**
 * Moves incident data between devices: seals outbox rows into capsule packets, routes them directly
 * or through a relay, ingests what arrives, and proves delivery with signed receipts.
 *
 * Rules that hold here:
 * - A transport `send` resolving is a send attempt. Only a verified receipt marks a packet delivered.
 * - Nothing from an untrusted device is processed, except the pairing handshake.
 * - A packet is acknowledged only after it was verified and stored in one transaction.
 * - A relay stores and forwards ciphertext it holds no key for.
 * - No incident content is logged; failures are dropped silently and the sender retries.
 */

export interface SyncHost {
  /** This device as an event author, or null while the identity is unavailable. */
  self(): Actor | null;
  /** True for this device's id and any earlier id it authored events under. */
  isLocalDevice(deviceId: string): boolean;
  /** The actor this device uses for an incident (handles events authored under an earlier id). */
  actorFor(state: IncidentState): Actor | null;
  peer(deviceId: string): PeerRecord | undefined;
  peers(): readonly PeerRecord[];
  trust(record: PeerRecord): Promise<void>;
  relayEnabled(): boolean;
  /** Serializes read-then-commit sections on the ledger. Must not be re-entered. */
  exclusive<T>(fn: () => Promise<T>): Promise<T>;
  /** Stores the reporter's latest projection for an incident this device does not own. */
  storeProjection(incidentId: string, projection: SentProjection): Promise<void>;
  /** Remembers that an incident first reached this device through a relay. */
  noteVia(incidentId: string, viaDeviceId: string): Promise<void>;
  /** Something visible changed; rebuild the snapshot. */
  changed(): void;
  /** Tracks background work so tests and Demo scripts can wait for the device to go quiet. */
  track<T>(work: Promise<T>): Promise<T>;
}

export interface SyncConfig {
  /** Signed into every envelope header; a packet may be forwarded by at most this many relays. */
  hopLimit: number;
  capsuleTtlMs: number;
  maxRelayPackets: number;
  pairingHelloTimeoutMs: number;
  /** How long a requested connection may take to come up before the peer counts as unreachable. */
  connectTimeoutMs: number;
  /** A send still unresolved after this long may be attempted again. */
  inFlightTimeoutMs: number;
  /** Most events one capsule section may carry. Receivers refuse a section with more (see `@/crypto/capsule`). */
  maxSectionEvents: number;
}

export const DEFAULT_SYNC_CONFIG: SyncConfig = {
  hopLimit: 2,
  capsuleTtlMs: 6 * 60 * 60 * 1000,
  maxRelayPackets: 200,
  pairingHelloTimeoutMs: 8_000,
  connectTimeoutMs: 6_000,
  inFlightTimeoutMs: 15_000,
  maxSectionEvents: 1000,
};

export interface SyncEngineDeps {
  repo: IncidentRepository;
  transport: PeerTransport;
  crypto: CapsuleCrypto;
  kv: KeyValueStore;
  clock: Clock;
  ids: IdGenerator;
  timers: Timers;
  host: SyncHost;
  config?: Partial<SyncConfig>;
}

export type PeerReachability = 'connected' | 'discovered' | 'unreachable';

const ReceiptBodySchema = z.strictObject({
  receipt: z.strictObject({
    receiptId: z.string().min(1).max(128),
    packetId: z.string().min(1).max(128),
    recipientDeviceId: z.string().min(1).max(128),
    receivedAtMs: z.number().int().nonnegative(),
  }),
  signature: z.string().min(8).max(1024),
});

export function receiptCanonicalText(receipt: { receiptId: string; packetId: string; recipientDeviceId: string; receivedAtMs: number }): string {
  return `pulse-receipt-v1|${receipt.receiptId}|${receipt.packetId}|${receipt.recipientDeviceId}|${receipt.receivedAtMs}`;
}

function rawActorId(event: unknown): string | null {
  if (typeof event !== 'object' || event === null || !('actor' in event)) return null;
  const actor: unknown = event.actor;
  if (typeof actor !== 'object' || actor === null || !('deviceId' in actor)) return null;
  return typeof actor.deviceId === 'string' ? actor.deviceId : null;
}

function rawType(event: unknown): string | null {
  if (typeof event !== 'object' || event === null || !('type' in event)) return null;
  return typeof event.type === 'string' ? event.type : null;
}

/** True when any section holds more events than `max`. Sections are the JSON this device just built. */
function exceedsEventCap(sections: Partial<Record<CapsuleSectionName, string>>, max: number): boolean {
  for (const json of Object.values(sections)) {
    if (json === undefined) continue;
    try {
      const body: unknown = JSON.parse(json);
      if (typeof body === 'object' && body !== null && 'events' in body && Array.isArray(body.events) && body.events.length > max) return true;
    } catch {
      return true;
    }
  }
  return false;
}

async function settle<T>(work: Promise<CryptoResult<T>>): Promise<CryptoResult<T>> {
  try {
    return await work;
  } catch {
    return { ok: false, reason: 'native_error', message: 'native_error' };
  }
}

export class SyncEngine {
  readonly pairing: PairingManager;
  readonly relay: RelayStore;
  private readonly config: SyncConfig;
  private readonly connected = new Set<string>();
  private readonly connectWaiters = new Map<string, Set<(up: boolean) => void>>();
  private readonly discovered = new Map<string, number>();
  private readonly lastSeen = new Map<string, number>();
  private readonly inFlight = new Map<string, number>();
  /** Packet ids whose content was already built at least once; a new event needs a new row after that. */
  private readonly sealedOnce = new Set<string>();
  /** Pending packet ids that cannot be sent as they are, with the reason. Rebuilt by the next send after a restart. */
  private readonly blocked = new Map<string, SendBlockCode>();
  private unsubscribers: Unsubscribe[] = [];
  private lastTransportError: string | null = null;

  constructor(private readonly deps: SyncEngineDeps) {
    this.config = { ...DEFAULT_SYNC_CONFIG, ...(deps.config ?? {}) };
    this.relay = new RelayStore(deps.kv, this.config.maxRelayPackets);
    this.pairing = new PairingManager({
      crypto: deps.crypto,
      timers: deps.timers,
      self: () => {
        const me = deps.host.self();
        return me ? { deviceId: me.deviceId, name: me.userName } : null;
      },
      connect: (peerId) => this.ensureConnected(peerId),
      send: (peerId, packet) => deps.transport.sendOpaquePacket(peerId, encodePacket(packet)),
      nextPacketId: () => deps.ids.next('pair').slice(0, 64),
      trust: async (record) => {
        await deps.host.trust(record);
        void deps.host.track(this.onPeerUsable(record.deviceId));
      },
      trusted: (peerId) => deps.host.peer(peerId),
      nowMs: () => deps.clock.nowMs(),
      changed: () => deps.host.changed(),
      helloTimeoutMs: this.config.pairingHelloTimeoutMs,
    });
  }

  // ---- lifecycle -------------------------------------------------------------------------------

  /** Subscribes to the transport. A transport whose subscriptions throw leaves the engine inert, not broken. */
  attach(): void {
    const { transport, host } = this.deps;
    const safe = (subscribe: () => Unsubscribe) => {
      try {
        this.unsubscribers.push(subscribe());
      } catch {
        this.lastTransportError = 'transport_unavailable';
      }
    };
    safe(() => transport.onPeerFound((peerId) => this.onPeerFound(peerId)));
    safe(() => transport.onPeerLost((peerId) => this.onPeerLost(peerId)));
    safe(() => transport.onConnectionState((peerId, state) => this.onConnectionState(peerId, state)));
    safe(() => transport.onOpaquePacket((peerId, bytes) => void host.track(this.onPacket(peerId, bytes))));
    safe(() =>
      transport.onError((error) => {
        this.lastTransportError = typeof error.code === 'string' ? error.code.slice(0, 64) : 'transport_error';
        host.changed();
      }),
    );
  }

  detach(): void {
    for (const unsubscribe of this.unsubscribers) {
      try {
        unsubscribe();
      } catch {
        // Nothing useful to do while shutting down.
      }
    }
    this.unsubscribers = [];
    this.connected.clear();
    this.discovered.clear();
  }

  /** Forgets who is in range. Called when discovery is switched off. */
  resetReachability(): void {
    this.connected.clear();
    this.discovered.clear();
  }

  transportError(): string | null {
    return this.lastTransportError;
  }

  clearTransportError(): void {
    this.lastTransportError = null;
  }

  // ---- peers -----------------------------------------------------------------------------------

  reachOf(deviceId: string): PeerReachability {
    if (this.connected.has(deviceId)) return 'connected';
    if (this.discovered.has(deviceId)) return 'discovered';
    return 'unreachable';
  }

  lastSeenMs(deviceId: string): number | null {
    return this.lastSeen.get(deviceId) ?? null;
  }

  discoveredIds(): string[] {
    return [...new Set([...this.discovered.keys(), ...this.connected])];
  }

  pairingView(): PairingView | null {
    return this.pairing.view();
  }

  private seen(peerId: string): void {
    this.lastSeen.set(peerId, this.deps.clock.nowMs());
  }

  private onPeerFound(peerId: string): void {
    this.discovered.set(peerId, this.deps.clock.nowMs());
    this.seen(peerId);
    this.deps.host.changed();
    if (this.deps.host.peer(peerId) && !this.connected.has(peerId)) {
      void this.deps.host.track(this.deps.transport.connect(peerId).catch(() => undefined));
    }
  }

  private onPeerLost(peerId: string): void {
    this.discovered.delete(peerId);
    this.deps.host.changed();
  }

  private onConnectionState(peerId: string, state: PeerConnectionState): void {
    if (state === 'connected') {
      this.connected.add(peerId);
      this.seen(peerId);
      this.settleConnect(peerId, true);
      // A pairing still waiting on this peer's confirmation asks again now that the link is back.
      void this.deps.host.track(this.pairing.resendConfirm(peerId));
      void this.deps.host.track(this.onPeerUsable(peerId));
    } else if (state === 'disconnected') {
      this.connected.delete(peerId);
      this.settleConnect(peerId, false);
    }
    this.deps.host.changed();
  }

  private settleConnect(peerId: string, up: boolean): void {
    const waiters = this.connectWaiters.get(peerId);
    if (!waiters) return;
    this.connectWaiters.delete(peerId);
    for (const waiter of waiters) waiter(up);
  }

  /**
   * Resolves once the link to `peerId` is up. The transport's `connect` only requests a dial, so the
   * link is not usable when it returns; this waits for the `connected` state, bounded by a timeout.
   */
  private async ensureConnected(peerId: string): Promise<void> {
    if (this.connected.has(peerId)) return;
    const { timers } = this.deps;
    const up = new Promise<boolean>((resolve) => {
      const waiters = this.connectWaiters.get(peerId) ?? new Set<(up: boolean) => void>();
      this.connectWaiters.set(peerId, waiters);
      const timer = timers.setTimeout(() => {
        waiters.delete(done);
        resolve(false);
      }, this.config.connectTimeoutMs);
      const done = (ok: boolean) => {
        timers.clearTimeout(timer);
        resolve(ok);
      };
      waiters.add(done);
    });
    try {
      await this.deps.transport.connect(peerId);
    } catch (error) {
      this.settleConnect(peerId, false);
      throw error;
    }
    if (!this.connected.has(peerId) && !(await up)) throw new Error('peer_unreachable');
  }

  /** Connects to every trusted peer that is in range. Called after pairing and when discovery starts. */
  async connectTrusted(): Promise<void> {
    for (const peerId of this.discovered.keys()) {
      if (this.deps.host.peer(peerId) && !this.connected.has(peerId)) {
        await this.deps.transport.connect(peerId).catch(() => undefined);
      }
    }
  }

  /** A link to a trusted peer came up (or a peer just became trusted): flush what was waiting. */
  private async onPeerUsable(peerId: string): Promise<void> {
    if (!this.deps.host.peer(peerId)) return;
    if (!this.connected.has(peerId)) {
      if (!this.discovered.has(peerId)) return;
      try {
        await this.deps.transport.connect(peerId);
      } catch {
        return;
      }
      return;
    }
    await this.forwardRelayed();
    await this.flush({ reconnectedPeer: peerId });
  }

  /** Why a pending packet cannot be sent at all, or null when it is merely waiting. */
  sendBlockOf(packetId: string): SendBlockCode | null {
    return this.blocked.get(packetId) ?? null;
  }

  /** The row stays pending and is never recorded as attempted; the incident's view says why. */
  private block(packetId: string, code: SendBlockCode): void {
    if (this.blocked.get(packetId) === code) return;
    this.blocked.set(packetId, code);
    this.deps.host.changed();
  }

  /** Where to hand a packet for `target`: the target itself, or every connected trusted peer as a relay. */
  private routesTo(target: string): string[] {
    if (this.connected.has(target)) return [target];
    return [...this.connected].filter((id) => id !== target && this.deps.host.peer(id) !== undefined);
  }

  // ---- outbound --------------------------------------------------------------------------------

  private ctxFor(state: IncidentState): CommandContext | null {
    const actor = this.deps.host.actorFor(state);
    return actor ? { actor, clock: this.deps.clock, ids: this.deps.ids } : null;
  }

  /**
   * Queues an `event_sync` packet to every other participant this device can seal for. Call it
   * inside the exclusive section that committed `eventIds`. A row that has not been sealed yet
   * already covers new events (content is read from the ledger at send time), so it is reused.
   */
  async queueSync(repo: IncidentRepository, state: IncidentState, eventIds: readonly string[], exclude: ReadonlySet<string> = new Set()): Promise<void> {
    if (!state.incident || eventIds.length === 0) return;
    const host = this.deps.host;
    const targets = new Set<string>();
    const reporterId = state.incident.reporter.deviceId;
    if (!host.isLocalDevice(reporterId)) targets.add(reporterId);
    for (const r of state.recipients) {
      if (r.level !== 'relay' && !host.isLocalDevice(r.deviceId)) targets.add(r.deviceId);
    }
    const pending = await repo.getPendingOutbox(state.incidentId);
    const rows: OutboxMessage[] = [];
    const createdAtMs = this.deps.clock.nowMs();
    for (const target of targets) {
      if (exclude.has(target) || !host.peer(target)) continue;
      const reusable = pending.some(
        (row) => row.recipientDeviceId === target && row.attempts === 0 && !this.sealedOnce.has(row.packetId) && !this.inFlight.has(row.packetId),
      );
      if (reusable) continue;
      rows.push(
        newOutboxMessage({
          packetId: this.deps.ids.next('pkt').slice(0, 64),
          incidentId: state.incidentId,
          recipientDeviceId: target,
          kind: 'event_sync',
          eventIds: eventIds.slice(0, 500),
          createdAtMs,
        }),
      );
    }
    if (rows.length > 0) await repo.enqueue(rows);
  }

  /**
   * Sends what is due. `force` ignores backoff (manual retry); `reconnectedPeer` ignores it for rows
   * that this peer can now receive or relay.
   */
  async flush(options: { force?: boolean; incidentId?: string; reconnectedPeer?: string } = {}): Promise<void> {
    const { repo, clock } = this.deps;
    let rows: OutboxMessage[];
    try {
      if (options.force) {
        rows = await repo.getPendingOutbox(options.incidentId);
      } else if (options.reconnectedPeer !== undefined) {
        const peer = options.reconnectedPeer;
        const due = new Set((await repo.retryDue(clock.nowMs())).map((r) => r.packetId));
        rows = (await repo.getPendingOutbox()).filter(
          (r) => due.has(r.packetId) || r.recipientDeviceId === peer || !this.connected.has(r.recipientDeviceId),
        );
      } else {
        rows = (await repo.retryDue(clock.nowMs())).filter((r) => options.incidentId === undefined || r.incidentId === options.incidentId);
      }
    } catch {
      return;
    }
    await Promise.all(rows.map((row) => this.sendRow(row)));
  }

  private async sendRow(row: OutboxMessage): Promise<void> {
    const { repo, crypto, transport, clock, host } = this.deps;
    const startedAt = this.inFlight.get(row.packetId);
    const now = clock.nowMs();
    if (startedAt !== undefined && now - startedAt < this.config.inFlightTimeoutMs) return;
    const me = host.self();
    const peer = host.peer(row.recipientDeviceId);
    if (!me || !peer) return;
    const routes = this.routesTo(peer.deviceId);
    // No path at all: the row stays queued and nothing is recorded as attempted.
    if (routes.length === 0) return;

    this.inFlight.set(row.packetId, now);
    try {
      const built = await host.exclusive(async () => {
        const state = await repo.replay(row.incidentId);
        if (!state.incident) return null;
        const level = levelForDevice(state, peer.deviceId);
        this.sealedOnce.add(row.packetId);
        return {
          level,
          eventCount: state.events.length,
          sections: buildCapsuleSections({ state, senderDeviceId: me.deviceId, recipientLevel: level }),
        };
      });
      if (!built) return;
      // Only a ledger longer than the cap can overfill a section, so the count is skipped otherwise.
      if (built.eventCount > this.config.maxSectionEvents && exceedsEventCap(built.sections, this.config.maxSectionEvents)) {
        this.block(row.packetId, 'packet_too_large');
        return;
      }
      const readable = sectionsForLevel(built.level).filter((name) => built.sections[name] !== undefined);
      const sealed = await settle(
        crypto.encryptForRecipients({
          capsuleId: capsuleIdFor(row.packetId),
          incidentRef: incidentRefFor(row.incidentId),
          createdAtMs: now,
          expiresAtMs: now + this.config.capsuleTtlMs,
          hopLimit: this.config.hopLimit,
          sections: built.sections,
          recipients: [{ material: peer.material, sections: readable }],
        }),
      );
      if (!sealed.ok) return;
      let bytes: Uint8Array;
      try {
        bytes = encodePacket({ v: 1, packetId: row.packetId, kind: 'capsule', hops: 0, to: peer.deviceId, envelope: sealed.value });
      } catch {
        this.block(row.packetId, 'packet_too_large');
        return;
      }
      // It fits now (it may not have before, under another disclosure level).
      this.blocked.delete(row.packetId);

      let via: string | null = null;
      let sent = false;
      for (const route of routes) {
        try {
          await transport.sendOpaquePacket(route, bytes);
          sent = true;
          if (route !== peer.deviceId && via === null) via = route;
        } catch {
          // Try the next route; the row stays pending either way.
        }
      }
      if (!sent) return;

      // The radio accepted the bytes. That is an attempt, never a delivery.
      await host.exclusive(async () => {
        const state = await repo.replay(row.incidentId);
        const packet = state.packets.find((p) => p.packetId === row.packetId);
        const ctx = this.ctxFor(state);
        if (packet && packet.delivery !== 'delivered' && ctx) {
          try {
            await repo.commit(recordSendAttempt(state, ctx, { packetId: row.packetId, ...(via ? { viaDeviceId: via } : {}) }));
          } catch {
            // A refused bookkeeping event must not stop the outbox from retrying.
          }
        }
        await repo.markSendAttempt(row.packetId, clock.nowMs());
      });
      host.changed();
    } catch {
      // Stays pending; the next flush tries again.
    } finally {
      this.inFlight.delete(row.packetId);
    }
  }

  // ---- inbound ---------------------------------------------------------------------------------

  private async onPacket(fromPeer: string, bytes: Uint8Array): Promise<void> {
    try {
      const decoded = decodePacket(bytes);
      if (!decoded.ok) return;
      const packet = decoded.packet;
      const me = this.deps.host.self();
      if (!me) return;

      if (packet.kind === 'pair_hello' || packet.kind === 'pair_confirm' || packet.kind === 'pair_cancel') {
        // The only packets accepted from a device that is not trusted yet.
        if (packet.to === me.deviceId) await this.pairing.handle(fromPeer, packet satisfies PairingPacket);
        return;
      }

      // Everything else must arrive over a link to a trusted device.
      if (!this.deps.host.peer(fromPeer)) return;
      if (packet.to !== me.deviceId) {
        await this.relayPacket(fromPeer, packet);
        return;
      }
      if (packet.kind === 'capsule') await this.receiveCapsule(fromPeer, packet);
      else await this.receiveReceipt(fromPeer, packet);
    } catch {
      // Dropped. The sender keeps the packet queued until it gets a receipt.
    }
  }

  /** Checks shared by recipients and relays: binding to the packet id, hop limit, trusted sender, signature, expiry. */
  private async verifySealed(packet: SealedPacket): Promise<PeerRecord | null> {
    const envelope: CapsuleEnvelope = packet.envelope;
    if (envelope.header.capsuleId !== capsuleIdFor(packet.packetId)) return null;
    if (packet.hops > envelope.header.hopLimit) return null;
    const origin = this.deps.host.peer(envelope.header.senderId);
    if (!origin) return null;
    const verified = await settle(this.deps.crypto.verifyEnvelope(envelope, origin.material, this.deps.clock.nowMs()));
    return verified.ok ? origin : null;
  }

  private async relayPacket(fromPeer: string, packet: SealedPacket): Promise<void> {
    const host = this.deps.host;
    if (!host.relayEnabled()) return;
    if (packet.to === fromPeer || packet.envelope.header.senderId === packet.to) return;
    // Forward only between devices this one has paired with.
    if (!host.peer(packet.to)) return;
    const hops = packet.hops + 1;
    if (hops > packet.envelope.header.hopLimit) return;
    const origin = await this.verifySealed(packet);
    if (!origin) return;
    await this.relay.put({
      packetId: packet.packetId,
      kind: packet.kind,
      to: packet.to,
      origin: origin.deviceId,
      receivedFrom: fromPeer,
      expiresAtMs: packet.envelope.header.expiresAtMs,
      json: JSON.stringify({ ...packet, hops }),
    });
    await this.forwardRelayed();
  }

  /** Forwards stored packets whose recipient is directly connected. A stored packet is dropped once handed over or expired. */
  async forwardRelayed(): Promise<void> {
    await this.relay.purgeExpired(this.deps.clock.nowMs());
    for (const item of this.relay.list()) {
      if (!this.connected.has(item.to) || item.to === item.receivedFrom) continue;
      const decoded = decodePacket(utf8ToBytes(item.json));
      if (!decoded.ok) {
        await this.relay.remove(item.packetId);
        continue;
      }
      try {
        await this.deps.transport.sendOpaquePacket(item.to, encodePacket(decoded.packet));
        await this.relay.remove(item.packetId);
      } catch {
        // Kept for the next connection.
      }
    }
  }

  private async receiveCapsule(fromPeer: string, packet: SealedPacket): Promise<void> {
    const { repo, crypto, clock, host } = this.deps;
    const origin = await this.verifySealed(packet);
    if (!origin) return;
    const now = clock.nowMs();
    const opened = await settle(crypto.decryptAuthorized(packet.envelope, origin.material, now));
    let content: ReturnType<typeof parseCapsuleSections> = null;
    if (opened.ok) {
      content = parseCapsuleSections(opened.value);
      if (!content) return;
    } else if (opened.reason !== 'not_a_recipient') {
      return;
    }
    const via = fromPeer !== origin.deviceId ? fromPeer : null;
    const accepted = content;

    await host.exclusive(async () => {
      const merged = await repo.transaction(async (tx) => {
        const seen = await tx.recordInbound(packet.packetId, {
          ...(accepted ? { incidentId: accepted.incidentId } : {}),
          fromDeviceId: origin.deviceId,
          receivedAtMs: now,
        });
        // A replayed packet changes nothing, but it is still acknowledged below: the first receipt may have been lost.
        if (seen === 'duplicate' || !accepted) return null;
        const local = await tx.replay(accepted.incidentId);
        const created = accepted.events.find((e) => rawType(e) === 'INCIDENT_CREATED');
        const reporterId = local.incident?.reporter.deviceId ?? (created ? rawActorId(created) : null);
        const fromReporter = reporterId !== null && reporterId === origin.deviceId;
        // The envelope proves who sealed it. Only the reporter may pass on other people's events,
        // and nobody may hand this device events claiming to be its own.
        const events = accepted.events.filter((e) => {
          const author = rawActorId(e);
          if (author === null) return true;
          if (host.isLocalDevice(author)) return false;
          return fromReporter || author === origin.deviceId;
        });
        const result = await tx.ingestRemote({ version: 1, incidentId: accepted.incidentId, fromDeviceId: origin.deviceId, events }, now);
        const state = result.state;
        if (state?.incident && result.applied.length > 0 && host.isLocalDevice(state.incident.reporter.deviceId)) {
          // This device owns the incident: flag disagreements the rules can see, then pass the new
          // events (and a fresh projection) on to everyone else.
          let current = state;
          const eventIds = result.applied.map((e) => e.id);
          const ctx = this.ctxFor(state);
          if (ctx) {
            try {
              const flagged = flagDetectedConflicts(state, ctx);
              if (flagged.events.length > 0) {
                await tx.commit(flagged);
                current = flagged.state;
                eventIds.push(...flagged.events.map((e) => e.id));
              }
            } catch {
              // Conflict flagging is best effort; the statements themselves are already stored.
            }
          }
          await this.queueSync(tx, current, eventIds);
        }
        return { state, fromReporter };
      });
      if (merged && accepted) {
        if (merged.fromReporter && accepted.projection) await host.storeProjection(accepted.incidentId, accepted.projection);
        if (via) await host.noteVia(accepted.incidentId, via);
      }
    });
    host.changed();
    await this.sendReceipt(fromPeer, packet, origin);
    await this.flush();
  }

  private async sendReceipt(fromPeer: string, packet: SealedPacket, origin: PeerRecord): Promise<void> {
    const { crypto, transport, clock, ids, host } = this.deps;
    const me = host.self();
    if (!me) return;
    const now = clock.nowMs();
    const receipt = { receiptId: ids.next('rcpt').slice(0, 64), packetId: packet.packetId, recipientDeviceId: me.deviceId, receivedAtMs: now };
    let signature: string;
    try {
      signature = await crypto.signEvent(receiptCanonicalText(receipt));
    } catch {
      return;
    }
    const sections: Partial<Record<CapsuleSectionName, string>> = { summary: JSON.stringify({ receipt, signature }) };
    const sealed = await settle(
      crypto.encryptForRecipients({
        capsuleId: capsuleIdFor(receipt.receiptId),
        incidentRef: packet.envelope.header.incidentRef,
        createdAtMs: now,
        expiresAtMs: now + this.config.capsuleTtlMs,
        hopLimit: this.config.hopLimit,
        sections,
        recipients: [{ material: origin.material, sections: ['summary'] }],
      }),
    );
    if (!sealed.ok) return;
    let bytes: Uint8Array;
    try {
      bytes = encodePacket({ v: 1, packetId: receipt.receiptId, kind: 'receipt', hops: 0, to: origin.deviceId, envelope: sealed.value });
    } catch {
      return;
    }
    // Straight back if possible, otherwise through the hop it came from.
    const routes = this.connected.has(origin.deviceId)
      ? [origin.deviceId]
      : this.connected.has(fromPeer)
        ? [fromPeer]
        : this.routesTo(origin.deviceId);
    for (const route of routes) {
      try {
        await transport.sendOpaquePacket(route, bytes);
        return;
      } catch {
        // Try the next route. If none works the sender retries and gets a fresh receipt.
      }
    }
  }

  private async receiveReceipt(fromPeer: string, packet: SealedPacket): Promise<void> {
    const { repo, crypto, clock, host } = this.deps;
    const recipient = await this.verifySealed(packet);
    if (!recipient) return;
    const now = clock.nowMs();
    const opened = await settle(crypto.decryptAuthorized(packet.envelope, recipient.material, now));
    if (!opened.ok || opened.value.summary === undefined) return;
    let raw: unknown;
    try {
      raw = JSON.parse(opened.value.summary);
    } catch {
      return;
    }
    const body = ReceiptBodySchema.safeParse(raw);
    if (!body.success) return;
    const { receipt, signature } = body.data;
    // The receipt must be signed by the device the packet was addressed to.
    if (receipt.recipientDeviceId !== recipient.deviceId) return;
    let valid = false;
    try {
      valid = await crypto.verifyEventSignature(receiptCanonicalText(receipt), signature, recipient.material);
    } catch {
      valid = false;
    }
    if (!valid) return;
    const via = fromPeer !== recipient.deviceId ? fromPeer : null;

    await host.exclusive(async () => {
      const row = (await repo.getPendingOutbox()).find((r) => r.packetId === receipt.packetId);
      if (!row || row.recipientDeviceId !== recipient.deviceId) return;
      await repo.transaction(async (tx) => {
        const state = await tx.replay(row.incidentId);
        const ledgerPacket = state.packets.find((p) => p.packetId === row.packetId);
        const ctx = this.ctxFor(state);
        if (ledgerPacket && ledgerPacket.delivery !== 'delivered' && ctx) {
          const parsed = PacketReceiptSchema.safeParse({
            ...receipt,
            signature: { alg: 'pulse-receipt-v1', keyId: recipient.deviceId, value: signature },
          });
          if (parsed.success) {
            try {
              const result = recordPeerReceipt(state, ctx, { receipt: parsed.data, ...(via ? { viaDeviceId: via } : {}) });
              await tx.commit(result);
              await this.queueSync(tx, result.state, result.events.map((e) => e.id));
            } catch {
              // The outbox row is still cleared below; the ledger keeps its last proven state.
            }
          }
        }
        await tx.acknowledgeReceipt(row.packetId, receipt.receiptId, now);
      });
    });
    host.changed();
    await this.flush();
  }

  // ---- pairing ---------------------------------------------------------------------------------

  startPairing(peerId: string): Promise<PairingResult> {
    return this.pairing.start(peerId);
  }

  confirmPairing(): Promise<PairingResult> {
    return this.pairing.confirm();
  }

  cancelPairing(): Promise<void> {
    return this.pairing.cancel();
  }

  /** Called on the retry tick: a pairing whose last confirmation was lost converges instead of staying one-sided. */
  retryPairing(): Promise<void> {
    return this.pairing.resendConfirm();
  }

  async forgetPeer(peerId: string): Promise<void> {
    this.connected.delete(peerId);
    try {
      await this.deps.transport.disconnect(peerId);
    } catch {
      // Already gone.
    }
  }
}
