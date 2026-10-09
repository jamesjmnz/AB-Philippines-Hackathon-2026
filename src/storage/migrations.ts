import type { SqlDriver } from './sqlDriver';

export interface Migration {
  version: number;
  name: string;
  statements: readonly string[];
}

/**
 * Versioned schema. Add a new entry to change the schema; never edit an applied one.
 * The events table is insert-only: triggers abort any UPDATE or DELETE.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'ledger_outbox_inbox',
    statements: [
      `CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY NOT NULL,
        incident_id TEXT NOT NULL,
        type TEXT NOT NULL,
        device_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        lamport INTEGER NOT NULL,
        wall_clock_ms INTEGER NOT NULL,
        origin TEXT NOT NULL,
        body TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS events_by_incident ON events (incident_id, lamport, device_id, id)`,
      `CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events
        BEGIN SELECT RAISE(ABORT, 'events are append-only'); END`,
      `CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events
        BEGIN SELECT RAISE(ABORT, 'events are append-only'); END`,
      `CREATE TABLE IF NOT EXISTS quarantine (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        incident_id TEXT,
        event_id TEXT,
        stage TEXT NOT NULL,
        body TEXT NOT NULL,
        received_at_ms INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS outbox (
        packet_id TEXT PRIMARY KEY NOT NULL,
        incident_id TEXT NOT NULL,
        recipient_device_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        event_ids TEXT NOT NULL,
        capsule_id TEXT,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        created_at_ms INTEGER NOT NULL,
        last_attempt_at_ms INTEGER,
        next_retry_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER,
        receipt_id TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS outbox_pending ON outbox (status, next_retry_at_ms)`,
      `CREATE TABLE IF NOT EXISTS inbox (
        packet_id TEXT PRIMARY KEY NOT NULL,
        incident_id TEXT,
        from_device_id TEXT,
        received_at_ms INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS sync_cursors (
        peer_device_id TEXT NOT NULL,
        incident_id TEXT NOT NULL,
        seq_by_device TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY (peer_device_id, incident_id)
      )`,
    ],
  },
];

/** Tables holding incident data, dropped by `reset()`. */
export const DATA_TABLES = ['events', 'quarantine', 'outbox', 'inbox', 'sync_cursors'] as const;

const MIGRATIONS_TABLE = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  applied_at_ms INTEGER NOT NULL
)`;

/** Applies every migration not yet recorded. Safe to call on every start. Returns the versions applied now. */
export async function migrate(driver: SqlDriver, nowMs: number): Promise<number[]> {
  await driver.exec(MIGRATIONS_TABLE);
  const rows = await driver.all<{ version: number }>('SELECT version FROM schema_migrations');
  const done = new Set(rows.map((r) => r.version));
  const applied: number[] = [];
  for (const migration of [...MIGRATIONS].sort((a, b) => a.version - b.version)) {
    if (done.has(migration.version)) continue;
    await driver.transaction(async (tx) => {
      for (const statement of migration.statements) await tx.exec(statement);
      await tx.run('INSERT INTO schema_migrations (version, name, applied_at_ms) VALUES (?, ?, ?)', [
        migration.version,
        migration.name,
        nowMs,
      ]);
    });
    applied.push(migration.version);
  }
  return applied;
}

export async function schemaVersion(driver: SqlDriver): Promise<number> {
  await driver.exec(MIGRATIONS_TABLE);
  const rows = await driver.all<{ version: number | null }>('SELECT MAX(version) AS version FROM schema_migrations');
  return rows[0]?.version ?? 0;
}
