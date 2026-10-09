import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { type IncidentRepository } from './incidentRepository';
import type { SqlDriver, SqlValue } from './sqlDriver';
import { createSqliteIncidentRepository } from './sqliteRepository';

export const LIVE_DATABASE_NAME = 'pulse-live.db';

function wrap(db: SQLiteDatabase, insideTransaction: boolean): SqlDriver {
  const driver: SqlDriver = {
    async exec(sql) {
      await db.execAsync(sql);
    },
    async run(sql, params = []) {
      const result = await db.runAsync(sql, [...params]);
      return { changes: result.changes };
    },
    all<T>(sql: string, params: readonly SqlValue[] = []) {
      return db.getAllAsync<T>(sql, [...params]);
    },
    async transaction<T>(fn: (tx: SqlDriver) => Promise<T>): Promise<T> {
      if (insideTransaction) return fn(driver);
      // Exclusive: runs on its own connection, so statements issued elsewhere while it is open
      // cannot slip into the transaction. A throw rolls everything back.
      let outcome: { value: T } | null = null;
      await db.withExclusiveTransactionAsync(async (txn) => {
        outcome = { value: await fn(wrap(txn, true)) };
      });
      const settled = outcome as { value: T } | null;
      if (settled === null) throw new Error('transaction finished without a result');
      return settled.value;
    },
  };
  return driver;
}

/** SqlDriver over an open expo-sqlite database (async API). */
export function createExpoSqlDriver(db: SQLiteDatabase): SqlDriver {
  return wrap(db, false);
}

/** Opens (or creates) the on-device database, migrates it and returns the live repository. */
export async function openExpoIncidentRepository(
  databaseName: string = LIVE_DATABASE_NAME,
  nowMs: () => number = () => Date.now(),
): Promise<{ repository: IncidentRepository; close: () => Promise<void> }> {
  const db = await openDatabaseAsync(databaseName);
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const repository = await createSqliteIncidentRepository(createExpoSqlDriver(db), nowMs);
  return { repository, close: () => db.closeAsync() };
}
