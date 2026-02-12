import BetterSqlite3 = require('better-sqlite3');
import { SQLiteDriver, RunResult } from '../driver';

export class BetterSqlite3Driver implements SQLiteDriver {
  private db: BetterSqlite3.Database;

  constructor(db: BetterSqlite3.Database) {
    this.db = db;
  }

  get rawDb(): BetterSqlite3.Database {
    return this.db;
  }

  run(sql: string, params?: unknown[]): RunResult {
    const result = this.db.prepare(sql).run(...(params ?? []));
    return {
      changes: result.changes,
      lastInsertRowid: Number(result.lastInsertRowid),
    };
  }

  get<T>(sql: string, params?: unknown[]): T | undefined {
    return this.db.prepare(sql).get(...(params ?? [])) as T | undefined;
  }

  all<T>(sql: string, params?: unknown[]): T[] {
    return this.db.prepare(sql).all(...(params ?? [])) as T[];
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  close(): void {
    this.db.close();
  }
}
