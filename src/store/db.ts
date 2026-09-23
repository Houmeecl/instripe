import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

function openDatabase(filePath: string): DatabaseSync {
  const require = createRequire(import.meta.url);
  const sqlite = require("node:" + "sqlite") as typeof import("node:sqlite");
  return new sqlite.DatabaseSync(filePath);
}

/**
 * Local database for the platform. One row per record.
 * `:memory:` is per process and is what the tests use.
 */
export class PlatformStore {
  private readonly db: DatabaseSync;

  constructor(filePath: string) {
    if (filePath !== ":memory:") {
      mkdirSync(path.dirname(filePath), { recursive: true });
    }
    this.db = openDatabase(filePath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS records (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        body TEXT NOT NULL,
        PRIMARY KEY (collection, id)
      );
    `);
  }

  put(collection: string, id: string, body: unknown): void {
    this.db
      .prepare(
        `INSERT INTO records (collection, id, body) VALUES (?, ?, ?)
         ON CONFLICT (collection, id) DO UPDATE SET body = excluded.body`,
      )
      .run(collection, id, JSON.stringify(body));
  }

  delete(collection: string, id: string): void {
    this.db.prepare("DELETE FROM records WHERE collection = ? AND id = ?").run(collection, id);
  }

  get<T>(collection: string, id: string): T | undefined {
    const row = this.db.prepare("SELECT body FROM records WHERE collection = ? AND id = ?").get(collection, id) as
      | { body: string }
      | undefined;
    return row ? (JSON.parse(row.body) as T) : undefined;
  }

  list<T>(collection: string): T[] {
    const rows = this.db.prepare("SELECT body FROM records WHERE collection = ? ORDER BY rowid").all(collection) as {
      body: string;
    }[];
    return rows.map((row) => JSON.parse(row.body) as T);
  }

  transaction(run: () => void): void {
    this.db.exec("BEGIN");
    try {
      run();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
