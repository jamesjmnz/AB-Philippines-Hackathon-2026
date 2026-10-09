import Database from 'better-sqlite3';

import type { SqlDriver, SqlValue } from '../sqlDriver';

/**
 * TEST ONLY. SqlDriver over better-sqlite3 so Jest runs the same SQL as the app.
 * Never import this from app code: better-sqlite3 is a Node native module.
 */
export interface BetterSqliteHandle {
  driver: SqlDriver;
  close(): void;
}

export function openBetterSqlite(filename = ':memory:'): BetterSqliteHandle {
  const db = new Database(filename);
  let queue: Promise<unknown> = Promise.resolve();

  const tx: SqlDriver = {
    async exec(sql) {
      db.exec(sql);
    },
    async run(sql, params: readonly SqlValue[] = []) {
      return { changes: db.prepare(sql).run(...params).changes };
    },
    async all<T>(sql: string, params: readonly SqlValue[] = []) {
      return db.prepare<SqlValue[], T>(sql).all(...params);
    },
    transaction(fn) {
      return fn(tx);
    },
  };

  const driver: SqlDriver = {
    exec: tx.exec,
    run: tx.run,
    all: tx.all,
    transaction<T>(fn: (inner: SqlDriver) => Promise<T>): Promise<T> {
      const run = async (): Promise<T> => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const value = await fn(tx);
          db.exec('COMMIT');
          return value;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      };
      const next = queue.then(run, run);
      queue = next.catch(() => undefined);
      return next;
    },
  };

  return { driver, close: () => db.close() };
}
