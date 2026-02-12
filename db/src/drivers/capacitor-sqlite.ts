import { SQLiteDriver, RunResult } from '../driver';

/**
 * SQLiteDriver implementation for Capacitor using @capacitor-community/sqlite.
 * This driver wraps the synchronous interface provided by jeep-sqlite (web)
 * or the native Capacitor SQLite plugin.
 *
 * Note: The actual Capacitor SQLite plugin is async. This driver is designed
 * to work with the synchronous wrapper that @capacitor-community/sqlite
 * provides through its web implementation (jeep-sqlite/sql.js WASM).
 * For native Android/iOS, the api-bridge handles async-to-sync translation.
 */
export interface CapacitorSQLiteConnection {
  run(statement: string, values?: unknown[]): { changes: { changes: number; lastId: number } };
  query(statement: string, values?: unknown[]): { values: unknown[] };
  execute(statements: string): { changes: { changes: number } };
  isTransactionActive(): boolean;
  beginTransaction(): void;
  commitTransaction(): void;
  rollbackTransaction(): void;
  close(): void;
}

export class CapacitorSQLiteDriver implements SQLiteDriver {
  private connection: CapacitorSQLiteConnection;

  constructor(connection: CapacitorSQLiteConnection) {
    this.connection = connection;
  }

  run(sql: string, params?: unknown[]): RunResult {
    const result = this.connection.run(sql, params);
    return {
      changes: result.changes.changes,
      lastInsertRowid: result.changes.lastId,
    };
  }

  get<T>(sql: string, params?: unknown[]): T | undefined {
    const result = this.connection.query(sql, params);
    return (result.values.length > 0 ? result.values[0] : undefined) as T | undefined;
  }

  all<T>(sql: string, params?: unknown[]): T[] {
    const result = this.connection.query(sql, params);
    return result.values as T[];
  }

  exec(sql: string): void {
    this.connection.execute(sql);
  }

  transaction<T>(fn: () => T): T {
    this.connection.beginTransaction();
    try {
      const result = fn();
      this.connection.commitTransaction();
      return result;
    } catch (error) {
      this.connection.rollbackTransaction();
      throw error;
    }
  }

  close(): void {
    this.connection.close();
  }
}
