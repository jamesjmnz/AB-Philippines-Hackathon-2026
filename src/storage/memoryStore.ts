import {
  sortEvents,
  type DomainEvent,
  type InboxMessage,
  type OutboxMessage,
  type SyncCursor,
} from '@/domain';

import type { LedgerStore, QuarantinedEvent } from './ledgerStore';

interface MemoryData {
  events: Map<string, DomainEvent>;
  outbox: Map<string, OutboxMessage>;
  inbox: Map<string, InboxMessage>;
  cursors: Map<string, SyncCursor>;
  quarantine: QuarantinedEvent[];
}

function emptyData(): MemoryData {
  return { events: new Map(), outbox: new Map(), inbox: new Map(), cursors: new Map(), quarantine: [] };
}

function copyData(data: MemoryData): MemoryData {
  return {
    events: new Map(data.events),
    outbox: new Map(data.outbox),
    inbox: new Map(data.inbox),
    cursors: new Map(data.cursors),
    quarantine: [...data.quarantine],
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const cursorKey = (peerDeviceId: string, incidentId: string) => `${peerDeviceId}\u0000${incidentId}`;

/** In-memory store for the Demo bundle and for tests. Same contract as the SQLite store; nothing survives a restart. */
export function createMemoryStore(): LedgerStore {
  let data = emptyData();
  let inTransaction = false;
  let queue: Promise<unknown> = Promise.resolve();

  const store: LedgerStore = {
    transaction<T>(fn: (tx: LedgerStore) => Promise<T>): Promise<T> {
      if (inTransaction) return fn(store);
      const run = async (): Promise<T> => {
        const snapshot = copyData(data);
        inTransaction = true;
        try {
          return await fn(store);
        } catch (error) {
          data = snapshot;
          throw error;
        } finally {
          inTransaction = false;
        }
      };
      const next = queue.then(run, run);
      queue = next.catch(() => undefined);
      return next;
    },

    async insertEvent(event) {
      if (data.events.has(event.id)) return false;
      data.events.set(event.id, clone(event));
      return true;
    },

    async eventsFor(incidentId) {
      return sortEvents([...data.events.values()].filter((e) => e.incidentId === incidentId)).map(clone);
    },

    async incidentIds() {
      return [...new Set([...data.events.values()].map((e) => e.incidentId))];
    },

    async insertOutbox(message) {
      if (data.outbox.has(message.packetId)) return false;
      data.outbox.set(message.packetId, clone(message));
      return true;
    },

    async getOutbox(packetId) {
      const found = data.outbox.get(packetId);
      return found ? clone(found) : null;
    },

    async updateOutbox(message) {
      if (data.outbox.has(message.packetId)) data.outbox.set(message.packetId, clone(message));
    },

    async listOutbox(filter) {
      return [...data.outbox.values()]
        .filter((m) => filter.status === undefined || m.status === filter.status)
        .filter((m) => filter.incidentId === undefined || m.incidentId === filter.incidentId)
        .sort((a, b) => a.createdAtMs - b.createdAtMs || (a.packetId < b.packetId ? -1 : 1))
        .map(clone);
    },

    async insertInbox(message) {
      if (data.inbox.has(message.packetId)) return false;
      data.inbox.set(message.packetId, clone(message));
      return true;
    },

    async getCursor(peerDeviceId, incidentId) {
      const found = data.cursors.get(cursorKey(peerDeviceId, incidentId));
      return found ? clone(found) : null;
    },

    async putCursor(cursor) {
      data.cursors.set(cursorKey(cursor.peerDeviceId, cursor.incidentId), clone(cursor));
    },

    async insertQuarantine(entry) {
      data.quarantine.push(clone(entry));
    },

    async listQuarantine() {
      return data.quarantine.map(clone);
    },

    async reset() {
      data = emptyData();
    },
  };
  return store;
}
