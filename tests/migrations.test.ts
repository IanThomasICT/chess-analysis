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

  test("migration #8 creates blunder_tags table", () => {
    const db = makeDb();
    db.run(`CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY, username TEXT NOT NULL, pgn TEXT NOT NULL, white TEXT, black TEXT, result TEXT, time_class TEXT, end_time INTEGER, created_at INTEGER DEFAULT (unixepoch()))`);
    db.run(`CREATE TABLE IF NOT EXISTS analysis (game_id TEXT NOT NULL, move_index INTEGER NOT NULL, fen TEXT NOT NULL, move_san TEXT, score_cp INTEGER, score_mate INTEGER, best_move TEXT, depth INTEGER, PRIMARY KEY (game_id, move_index), FOREIGN KEY (game_id) REFERENCES games(id))`);
    runMigrations(db);
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='blunder_tags'`)
      .all() as Array<{ name: string }>;
    expect(tables).toHaveLength(1);
  });

  test("migration #7 preserves existing analysis rows with multipv_rank=1", () => {
    // Bootstrap old schema (pre-migration #7), apply migrations 1-6, insert rows,
    // then apply migration #7 and verify rows survive with multipv_rank=1.
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

    // Seed a game so FK constraints are satisfied
    db.run(
      `INSERT INTO games (id, username, pgn, white, black, result, time_class, end_time)
       VALUES ('game1', 'testuser', '', 'White', 'Black', '1-0', 'rapid', 0)`,
    );

    // Apply migrations 1-6 only
    const migrationsUpTo6 = migrations.filter((m) => m.id <= 6);
    runWith(db, migrationsUpTo6);
    expect(schemaVersion(db)).toBe(6);

    // Insert 2 analysis rows (no multipv_rank column yet)
    db.run(
      `INSERT INTO analysis (game_id, move_index, fen, move_san, score_cp, score_mate, best_move, depth)
       VALUES ('game1', 0, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'e4', 30, NULL, 'e2e4', 18)`,
    );
    db.run(
      `INSERT INTO analysis (game_id, move_index, fen, move_san, score_cp, score_mate, best_move, depth)
       VALUES ('game1', 1, 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', 'e5', -10, NULL, 'e7e5', 18)`,
    );

    // Apply migration #7
    const migration7 = migrations.find((m) => m.id === 7);
    if (migration7 === undefined) { throw new Error("Migration #7 not found"); }
    runWith(db, [migration7]);
    expect(schemaVersion(db)).toBe(7);

    // Verify both rows survived with multipv_rank=1
    interface AnalysisRow {
      game_id: string;
      move_index: number;
      multipv_rank: number;
      pv: string | null;
      move_san: string | null;
    }
    const rows = db
      .prepare<AnalysisRow, []>(
        "SELECT game_id, move_index, multipv_rank, pv, move_san FROM analysis ORDER BY move_index",
      )
      .all();

    expect(rows).toHaveLength(2);
    expect(rows[0].multipv_rank).toBe(1);
    expect(rows[0].pv).toBeNull();
    expect(rows[0].move_san).toBe("e4");
    expect(rows[1].multipv_rank).toBe(1);
    expect(rows[1].pv).toBeNull();
    expect(rows[1].move_san).toBe("e5");
  });
});
