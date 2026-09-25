import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export type DocKind =
  | "entity"
  | "principal"
  | "agent"
  | "mission"
  | "policy"
  | "resource"
  | "lease"
  | "approval"
  | "pending"
  | "decision"
  | "connector"
  | "proposal"
  | "session"
  | "meta";

/**
 * One server-owned SQLite database. Every domain object is stored as a JSON
 * document keyed by (kind, id); governance events live in an append-only
 * table with a monotonically increasing sequence.
 */
export class Db {
  readonly sqlite: DatabaseSync;

  constructor(location: string) {
    if (location !== ":memory:") {
      fs.mkdirSync(path.dirname(location), { recursive: true });
    }
    this.sqlite = new DatabaseSync(location);
    this.sqlite.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS docs (
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (kind, id)
      );
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        data TEXT NOT NULL
      );
    `);
  }

  get<T>(kind: DocKind, id: string): T | null {
    const row = this.sqlite
      .prepare("SELECT data FROM docs WHERE kind = ? AND id = ?")
      .get(kind, id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as T) : null;
  }

  list<T>(kind: DocKind): T[] {
    const rows = this.sqlite
      .prepare("SELECT data FROM docs WHERE kind = ? ORDER BY rowid ASC")
      .all(kind) as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as T);
  }

  put<T extends { id: string }>(kind: DocKind, doc: T): T {
    this.sqlite
      .prepare(
        "INSERT INTO docs (kind, id, data) VALUES (?, ?, ?) ON CONFLICT(kind, id) DO UPDATE SET data = excluded.data",
      )
      .run(kind, doc.id, JSON.stringify(doc));
    return doc;
  }

  deleteAll(kind: DocKind): void {
    this.sqlite.prepare("DELETE FROM docs WHERE kind = ?").run(kind);
  }

  appendEvent<T extends { id: string }>(event: T): number {
    const result = this.sqlite
      .prepare("INSERT INTO events (id, data) VALUES (?, ?)")
      .run(event.id, JSON.stringify(event));
    return Number(result.lastInsertRowid);
  }

  updateEvent<T extends { id: string }>(event: T): void {
    this.sqlite
      .prepare("UPDATE events SET data = ? WHERE id = ?")
      .run(JSON.stringify(event), event.id);
  }

  listEvents<T>(): Array<T & { seq: number }> {
    const rows = this.sqlite
      .prepare("SELECT seq, data FROM events ORDER BY seq ASC")
      .all() as Array<{ seq: number; data: string }>;
    return rows.map((r) => ({ ...(JSON.parse(r.data) as T), seq: r.seq }));
  }

  clearEvents(): void {
    this.sqlite.exec("DELETE FROM events; DELETE FROM sqlite_sequence WHERE name = 'events';");
  }

  /**
   * Serialized critical section. node:sqlite is synchronous, so everything
   * inside `fn` runs atomically with respect to other requests on this process
   * and is committed as one SQLite transaction.
   */
  transaction<T>(fn: () => T): T {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.sqlite.exec("COMMIT");
      return result;
    } catch (err) {
      this.sqlite.exec("ROLLBACK");
      throw err;
    }
  }

  close(): void {
    this.sqlite.close();
  }
}
