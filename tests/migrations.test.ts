import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations, migrations, type Migration } from "../server/lib/db";

/**
 * Bootstrap a fresh in-memory DB with the minimal schema the runner needs.
 */
function makeDb(): Database {
  const db = new Database(":memory:");
  db.run(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);
  return db;
}

/**
 * Read the current schema_version from meta, returning 0 if absent.
 */
function schemaVersion(db: Database): number {
  const row = db
    .prepare<{ value: string }, [string]>(
      "SELECT value FROM meta WHERE key = ?",
    )
    .get("schema_version");
  return row !== null ? parseInt(row.value, 10) : 0;
}

/**
 * Create a runMigrations-compatible runner against a custom migration list
 * and a given DB — avoids touching the production singleton.
 */
function runWith(db: Database, migrations: Migration[]): void {
  interface MetaRow {
    value: string;
  }

  function isMetaRow(v: unknown): v is MetaRow {
    if (typeof v !== "object" || v === null || !("value" in v)) {
      return false;
    }
    const c = v as { value: unknown };
    return typeof c.value === "string";
  }

  const row: unknown = db
    .prepare("SELECT value FROM meta WHERE key = ?")
    .get("schema_version");
  const current = isMetaRow(row) ? parseInt(row.value, 10) : 0;

  const pending = migrations.filter((m) => m.id > current);
  if (pending.length === 0) {
    return;
  }

  db.transaction(() => {
    for (const migration of pending) {
      migration.up(db);
    }
    const newVersion = pending[pending.length - 1].id;
    db.prepare(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run("schema_version", String(newVersion));
  })();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("migration runner", () => {
  test("fresh DB: schema_version advances to head id", () => {
    const db = makeDb();
    const fakeMigrations: Migration[] = [
      { id: 1, up: () => { /* no-op */ } },
    ];

    expect(schemaVersion(db)).toBe(0);
    runWith(db, fakeMigrations);
    expect(schemaVersion(db)).toBe(1);
  });

  test("re-running is idempotent — no errors, version unchanged", () => {
    const db = makeDb();
    const fakeMigrations: Migration[] = [
      { id: 1, up: () => { /* no-op */ } },
    ];

    runWith(db, fakeMigrations);
    expect(schemaVersion(db)).toBe(1);

    // Run again — should be a no-op
    runWith(db, fakeMigrations);
    expect(schemaVersion(db)).toBe(1);
  });

  test("migrations run in sequential id order", () => {
    const db = makeDb();
    const order: number[] = [];

    const fakeMigrations: Migration[] = [
      { id: 1, up: () => { order.push(1); } },
      { id: 2, up: () => { order.push(2); } },
      { id: 3, up: () => { order.push(3); } },
    ];

    runWith(db, fakeMigrations);

    expect(order).toEqual([1, 2, 3]);
    expect(schemaVersion(db)).toBe(3);
  });

  test("only migrations with id > current version are run", () => {
    const db = makeDb();
    // Manually set version to 2
    db.prepare(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run("schema_version", "2");

    const ran: number[] = [];
    const fakeMigrations: Migration[] = [
      { id: 1, up: () => { ran.push(1); } },
      { id: 2, up: () => { ran.push(2); } },
      { id: 3, up: () => { ran.push(3); } },
    ];

    runWith(db, fakeMigrations);

    expect(ran).toEqual([3]);
    expect(schemaVersion(db)).toBe(3);
  });

  test("production runMigrations on fresh in-memory DB advances version to head", () => {
    // Test against the real migrations array exported from db.ts.
    // Must include the base schema tables that migrations operate on.
    const db = makeDb();
    db.run(`
      CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        pgn TEXT NOT NULL,
        white TEXT,
        black TEXT,
        result TEXT,
        time_class TEXT,
        end_time INTEGER,
        created_at INTEGER DEFAULT (unixepoch())
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS analysis (
        game_id TEXT NOT NULL,
        move_index INTEGER NOT NULL,
        fen TEXT NOT NULL,
        move_san TEXT,
        score_cp INTEGER,
        score_mate INTEGER,
        best_move TEXT,
        depth INTEGER,
        PRIMARY KEY (game_id, move_index),
        FOREIGN KEY (game_id) REFERENCES games(id)
      )
    `);
    runMigrations(db);
    const headId = Math.max(...migrations.map((m) => m.id));
    expect(schemaVersion(db)).toBe(headId);
  });
});
