/**
 * Platform-agnostic SQLite driver interface.
 * Implemented by BetterSqlite3Driver (desktop) and CapacitorSQLiteDriver (mobile).
 */
export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

export interface SQLiteDriver {
  run(sql: string, params?: unknown[]): RunResult;
  get<T>(sql: string, params?: unknown[]): T | undefined;
  all<T>(sql: string, params?: unknown[]): T[];
  exec(sql: string): void;
  transaction<T>(fn: () => T): T;
  close(): void;
}
