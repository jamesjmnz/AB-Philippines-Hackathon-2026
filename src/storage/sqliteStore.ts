import {
  DomainEventSchema,
  OutboxMessageSchema,
  SyncCursorSchema,
  sortEvents,
  type DomainEvent,
  type EventOrigin,
  type InboxMessage,
  type OutboxMessage,
  type OutboxStatus,
  type SyncCursor,
} from '@/domain';

import type { LedgerStore, QuarantinedEvent } from './ledgerStore';
import { DATA_TABLES, migrate } from './migrations';
import type { SqlDriver, SqlValue } from './sqlDriver';

interface OutboxRow {
  packet_id: string;
  incident_id: string;
  recipient_device_id: string;
  kind: string;
  event_ids: string;
  capsule_id: string | null;
  status: string;
  attempts: number;
  created_at_ms: number;
  last_attempt_at_ms: number | null;
  next_retry_at_ms: number;
  expires_at_ms: number | null;
  receipt_id: string | null;
}

function parseJson(text: string): unknown {
  return JSON.parse(text);
}

function toOutbox(row: OutboxRow): OutboxMessage {
  return OutboxMessageSchema.parse({
    packetId: row.packet_id,
    incidentId: row.incident_id,
    recipientDeviceId: row.recipient_device_id,
    kind: row.kind,
    eventIds: parseJson(row.event_ids),
    capsuleId: row.capsule_id,
    status: row.status,
    attempts: row.attempts,
    createdAtMs: row.created_at_ms,
    lastAttemptAtMs: row.last_attempt_at_ms,
    nextRetryAtMs: row.next_retry_at_ms,
    expiresAtMs: row.expires_at_ms,
    receiptId: row.receipt_id,
  });
}

/** SQLite-backed store. Works on any SqlDriver; the caller must have run `migrate` first. */
export function createSqliteStore(driver: SqlDriver, migrationClock: () => number = () => 0): LedgerStore {
  return {
    transaction(fn) {
      return driver.transaction((tx) => fn(createSqliteStore(tx, migrationClock)));
    },

    async insertEvent(event: DomainEvent, origin: EventOrigin) {
      const result = await driver.run(
        `INSERT OR IGNORE INTO events (id, incident_id, type, device_id, seq, lamport, wall_clock_ms, origin, body)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          event.id,
          event.incidentId,
          event.type,
          event.actor.deviceId,
          event.clock.seq,
          event.clock.lamport,
          event.clock.wallClockMs,
          origin,
          JSON.stringify(event),
        ],
      );
      return result.changes > 0;
    },

    async eventsFor(incidentId) {
      const rows = await driver.all<{ body: string }>('SELECT body FROM events WHERE incident_id = ?', [incidentId]);
      return sortEvents(rows.map((r) => DomainEventSchema.parse(parseJson(r.body))));
    },

    async incidentIds() {
      const rows = await driver.all<{ incident_id: string }>(
        'SELECT incident_id FROM events GROUP BY incident_id ORDER BY MIN(rowid)',
      );
      return rows.map((r) => r.incident_id);
    },

    async insertOutbox(m: OutboxMessage) {
      const result = await driver.run(
        `INSERT OR IGNORE INTO outbox (packet_id, incident_id, recipient_device_id, kind, event_ids, capsule_id,
           status, attempts, created_at_ms, last_attempt_at_ms, next_retry_at_ms, expires_at_ms, receipt_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          m.packetId,
          m.incidentId,
          m.recipientDeviceId,
          m.kind,
          JSON.stringify(m.eventIds),
          m.capsuleId,
          m.status,
          m.attempts,
          m.createdAtMs,
          m.lastAttemptAtMs,
          m.nextRetryAtMs,
          m.expiresAtMs,
          m.receiptId,
        ],
      );
      return result.changes > 0;
    },

    async getOutbox(packetId) {
      const rows = await driver.all<OutboxRow>('SELECT * FROM outbox WHERE packet_id = ?', [packetId]);
      const row = rows[0];
      return row ? toOutbox(row) : null;
    },

    async updateOutbox(m: OutboxMessage) {
      await driver.run(
        `UPDATE outbox SET status = ?, attempts = ?, last_attempt_at_ms = ?, next_retry_at_ms = ?, receipt_id = ?
         WHERE packet_id = ?`,
        [m.status, m.attempts, m.lastAttemptAtMs, m.nextRetryAtMs, m.receiptId, m.packetId],
      );
    },

    async listOutbox(filter: { status?: OutboxStatus; incidentId?: string }) {
      const where: string[] = [];
      const params: SqlValue[] = [];
      if (filter.status !== undefined) {
        where.push('status = ?');
        params.push(filter.status);
      }
      if (filter.incidentId !== undefined) {
        where.push('incident_id = ?');
        params.push(filter.incidentId);
      }
      const rows = await driver.all<OutboxRow>(
        `SELECT * FROM outbox ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY created_at_ms, packet_id`,
        params,
      );
      return rows.map(toOutbox);
    },

    async insertInbox(m: InboxMessage) {
      const result = await driver.run(
        'INSERT OR IGNORE INTO inbox (packet_id, incident_id, from_device_id, received_at_ms) VALUES (?, ?, ?, ?)',
        [m.packetId, m.incidentId, m.fromDeviceId, m.receivedAtMs],
      );
      return result.changes > 0;
    },

    async getCursor(peerDeviceId, incidentId) {
      const rows = await driver.all<{ seq_by_device: string; updated_at_ms: number }>(
        'SELECT seq_by_device, updated_at_ms FROM sync_cursors WHERE peer_device_id = ? AND incident_id = ?',
        [peerDeviceId, incidentId],
      );
      const row = rows[0];
      if (!row) return null;
      return SyncCursorSchema.parse({
        peerDeviceId,
        incidentId,
        seqByDevice: parseJson(row.seq_by_device),
        updatedAtMs: row.updated_at_ms,
      });
    },

    async putCursor(cursor: SyncCursor) {
      await driver.run(
        `INSERT OR REPLACE INTO sync_cursors (peer_device_id, incident_id, seq_by_device, updated_at_ms)
         VALUES (?, ?, ?, ?)`,
        [cursor.peerDeviceId, cursor.incidentId, JSON.stringify(cursor.seqByDevice), cursor.updatedAtMs],
      );
    },

    async insertQuarantine(entry: QuarantinedEvent) {
      await driver.run(
        'INSERT INTO quarantine (incident_id, event_id, stage, body, received_at_ms) VALUES (?, ?, ?, ?, ?)',
        [entry.incidentId, entry.eventId, entry.stage, entry.body, entry.receivedAtMs],
      );
    },

    async listQuarantine() {
      const rows = await driver.all<{
        incident_id: string | null;
        event_id: string | null;
        stage: string;
        body: string;
        received_at_ms: number;
      }>('SELECT incident_id, event_id, stage, body, received_at_ms FROM quarantine ORDER BY id');
      return rows.map((r) => ({
        incidentId: r.incident_id,
        eventId: r.event_id,
        stage: r.stage,
        body: r.body,
        receivedAtMs: r.received_at_ms,
      }));
    },

    async reset() {
      // Dropping the tables is the only way to clear the insert-only ledger; it is a hard reset of the whole store.
      await driver.transaction(async (tx) => {
        for (const table of DATA_TABLES) await tx.exec(`DROP TABLE IF EXISTS ${table}`);
        await tx.exec('DROP TABLE IF EXISTS schema_migrations');
      });
      await migrate(driver, migrationClock());
    },
  };
}
