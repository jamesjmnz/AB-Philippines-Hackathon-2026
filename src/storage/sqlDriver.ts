/** The smallest SQL surface the repository needs, so the same statements run on expo-sqlite and better-sqlite3. */
export type SqlValue = string | number | null;

export interface SqlRunResult {
  changes: number;
}

export interface SqlDriver {
  /** Run one or more statements without parameters. */
  exec(sql: string): Promise<void>;
  run(sql: string, params?: readonly SqlValue[]): Promise<SqlRunResult>;
  all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  /**
   * Run `fn` atomically: everything it does through `tx` commits together or not at all.
   * Calling `transaction` on `tx` joins the surrounding transaction.
   */
  transaction<T>(fn: (tx: SqlDriver) => Promise<T>): Promise<T>;
}
