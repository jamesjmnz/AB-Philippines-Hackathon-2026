import type { PeerConnectionState, PeerTransport, TransportError, Unsubscribe } from '@/transport/types';

/**
 * SIMULATED radio: an in-memory hub joining any number of virtual devices. Used by the Demo Lab and
 * by Jest. Links are symmetric and can be cut and restored; faults (drop, duplicate, hold) are per
 * direction. Everything is delivered on microtasks, so it runs under fake timers.
 */

export interface LinkFault {
  /** Bytes are accepted by `send` and then lost. */
  drop?: boolean;
  /** Every packet arrives twice. */
  duplicate?: boolean;
  /** Packets are held until `release` is called (used to reorder). */
  hold?: boolean;
}

export type HubTap = (from: string, to: string, bytes: Uint8Array) => void;

export interface MemoryHub {
  /** A transport for one virtual device. Its id is whatever it passes to `startDiscovery`. */
  createTransport(): PeerTransport;
  setLink(a: string, b: string, up: boolean): void;
  isLinked(a: string, b: string): boolean;
  /** Fault for packets travelling from `from` to `to`. Pass `{}` to clear. */
  setFault(from: string, to: string, fault: LinkFault): void;
  /** Delivers packets held on `from -> to`, in the order sent or reversed. */
  release(from: string, to: string, order?: 'fifo' | 'reverse'): void;
  /** Delivers bytes to `to` as if `from` had sent them, bypassing faults. `from` need not exist. */
  inject(from: string, to: string, bytes: Uint8Array): void;
  /** Observes every packet handed to the hub by a device (before faults are applied). */
  tap(listener: HubTap): Unsubscribe;
  /** Resolves when nothing is in flight. */
  idle(): Promise<void>;
  readonly pending: number;
}

interface Endpoint {
  id: string | null;
  discovering: boolean;
  found: Set<(peerId: string) => void>;
  lost: Set<(peerId: string) => void>;
  state: Set<(peerId: string, state: PeerConnectionState, reason: string | null) => void>;
  packet: Set<(peerId: string, bytes: Uint8Array) => void>;
  error: Set<(error: TransportError) => void>;
  connected: Set<string>;
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const dirKey = (from: string, to: string) => `${from}>${to}`;

export function createMemoryHub(options: { defaultLinked?: boolean } = {}): MemoryHub {
  const defaultLinked = options.defaultLinked ?? true;
  const endpoints = new Set<Endpoint>();
  const links = new Map<string, boolean>();
  const faults = new Map<string, LinkFault>();
  const held = new Map<string, Uint8Array[]>();
  const taps = new Set<HubTap>();
  let pending = 0;
  let idleWaiters: (() => void)[] = [];

  const byId = (id: string): Endpoint | undefined => {
    for (const e of endpoints) if (e.id === id && e.discovering) return e;
    return undefined;
  };

  const linked = (a: string, b: string) => links.get(pairKey(a, b)) ?? defaultLinked;

  /** Runs `fn` on a later microtask and counts it as in flight until it has run. */
  const later = (fn: () => void) => {
    pending += 1;
    void Promise.resolve().then(() => {
      try {
        fn();
      } catch {
        // A listener that throws must not take the simulated radio down.
      } finally {
        pending -= 1;
        if (pending === 0) {
          const waiters = idleWaiters;
          idleWaiters = [];
          for (const w of waiters) w();
        }
      }
    });
  };

  const emit = <T extends unknown[]>(listeners: Set<(...args: T) => void>, ...args: T) => {
    for (const listener of [...listeners]) later(() => listener(...args));
  };

  const announce = (a: Endpoint, b: Endpoint) => {
    if (!a.id || !b.id) return;
    emit(a.found, b.id);
    emit(b.found, a.id);
  };

  const sever = (a: Endpoint, b: Endpoint, reason: string) => {
    if (!a.id || !b.id) return;
    if (a.connected.delete(b.id)) emit(a.state, b.id, 'disconnected', reason);
    if (b.connected.delete(a.id)) emit(b.state, a.id, 'disconnected', reason);
  };

  const deliver = (from: string, to: string, bytes: Uint8Array) => {
    const target = byId(to);
    if (!target) return;
    emit(target.packet, from, bytes.slice());
  };

  const hub: MemoryHub = {
    createTransport() {
      const self: Endpoint = {
        id: null,
        discovering: false,
        found: new Set(),
        lost: new Set(),
        state: new Set(),
        packet: new Set(),
        error: new Set(),
        connected: new Set(),
      };
      endpoints.add(self);

      const on = <L>(set: Set<L>, listener: L): Unsubscribe => {
        set.add(listener);
        return () => {
          set.delete(listener);
        };
      };

      const shutdown = () => {
        if (!self.discovering) return;
        for (const other of endpoints) {
          if (other === self || !other.id || !other.discovering) continue;
          sever(self, other, 'peer_stopped');
          if (self.id) emit(other.lost, self.id);
        }
        self.discovering = false;
      };

      const transport: PeerTransport = {
        async startDiscovery(localDeviceId) {
          if (self.discovering && self.id === localDeviceId) return;
          self.id = localDeviceId;
          self.discovering = true;
          for (const other of endpoints) {
            if (other === self || !other.id || !other.discovering) continue;
            if (linked(localDeviceId, other.id)) announce(self, other);
          }
        },
        async stopDiscovery() {
          shutdown();
        },
        async connect(peerId) {
          const other = byId(peerId);
          if (!self.id || !self.discovering || !other || !linked(self.id, peerId)) throw new Error('peer_unreachable');
          if (!self.connected.has(peerId)) {
            self.connected.add(peerId);
            emit(self.state, peerId, 'connected', null);
          }
          if (!other.connected.has(self.id)) {
            other.connected.add(self.id);
            emit(other.state, self.id, 'connected', null);
          }
        },
        async disconnect(peerId) {
          const other = byId(peerId);
          if (other) sever(self, other, 'closed');
        },
        async sendOpaquePacket(peerId, bytes) {
          if (!self.id || !self.connected.has(peerId)) throw new Error('not_connected');
          const from = self.id;
          const copy = bytes.slice();
          for (const tap of [...taps]) tap(from, peerId, copy.slice());
          const fault = faults.get(dirKey(from, peerId)) ?? {};
          if (fault.drop) return;
          if (fault.hold) {
            const queue = held.get(dirKey(from, peerId)) ?? [];
            queue.push(copy);
            held.set(dirKey(from, peerId), queue);
            return;
          }
          deliver(from, peerId, copy);
          if (fault.duplicate) deliver(from, peerId, copy);
        },
        onPeerFound: (listener) => on(self.found, listener),
        onPeerLost: (listener) => on(self.lost, listener),
        onConnectionState: (listener) => on(self.state, listener),
        onOpaquePacket: (listener) => on(self.packet, listener),
        onError: (listener) => on(self.error, listener),
        async stop() {
          shutdown();
        },
      };
      return transport;
    },

    setLink(a, b, up) {
      const was = linked(a, b);
      links.set(pairKey(a, b), up);
      if (was === up) return;
      const ea = byId(a);
      const eb = byId(b);
      if (!ea || !eb) return;
      if (up) {
        announce(ea, eb);
      } else {
        sever(ea, eb, 'link_lost');
        emit(ea.lost, b);
        emit(eb.lost, a);
      }
    },

    isLinked: (a, b) => linked(a, b),

    setFault(from, to, fault) {
      faults.set(dirKey(from, to), { ...fault });
    },

    release(from, to, order = 'fifo') {
      const queue = held.get(dirKey(from, to)) ?? [];
      held.delete(dirKey(from, to));
      const ordered = order === 'reverse' ? [...queue].reverse() : queue;
      for (const bytes of ordered) deliver(from, to, bytes);
    },

    inject(from, to, bytes) {
      deliver(from, to, bytes);
    },

    tap(listener) {
      taps.add(listener);
      return () => {
        taps.delete(listener);
      };
    },

    idle() {
      if (pending === 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        idleWaiters.push(resolve);
      });
    },

    get pending() {
      return pending;
    },
  };
  return hub;
}
