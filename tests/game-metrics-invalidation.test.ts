import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { migrations } from "../server/lib/db";

// ---------------------------------------------------------------------------
// Schema helpers — bootstraps the base schema and applies migrations 1-4
// ---------------------------------------------------------------------------

function makeDb(): Database {
  const db = new Database(":memory:");

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

  db.run(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);

  // Apply all migrations up to and including #4
  for (const migration of migrations) {
    migration.up(db);
  }

  return db;
}

interface TableInfo {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}

interface CountRow {
  count: number;
}

interface MetricsRow {
  game_id: string;
  accuracy_white: number;
  accuracy_black: number;
  blunders_white: number;
  mistakes_white: number;
  inaccuracies_white: number;
  blunders_black: number;
  mistakes_black: number;
  inaccuracies_black: number;
  acl_white: number;
  acl_black: number;
  computed_at: number;
}

function insertGame(db: Database, id: string): void {
  db.prepare(
    `INSERT INTO games (id, username, pgn) VALUES (?, ?, ?)`,
  ).run(id, "testuser", "1. e4 e5");
}

function insertMetrics(db: Database, gameId: string): void {
  db.prepare(`
    INSERT INTO game_metrics (
      game_id, accuracy_white, accuracy_black,
      blunders_white, mistakes_white, inaccuracies_white,
      blunders_black, mistakes_black, inaccuracies_black,
      acl_white, acl_black, computed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(gameId, 85.5, 72.3, 1, 2, 3, 0, 1, 2, 0.15, 0.22, Date.now());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let db: Database;

beforeEach(() => {
  db = makeDb();
});

describe("game_metrics table — migration #4", () => {
  test("migration #4 creates game_metrics table with expected columns", () => {
    const tableExists = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='game_metrics'`,
      )
      .get() as { name: string } | null;

    expect(tableExists).not.toBeNull();
    expect(tableExists?.name).toBe("game_metrics");

    const columns = db
      .prepare(`PRAGMA table_info(game_metrics)`)
      .all() as TableInfo[];

    const colNames = columns.map((c) => c.name);
    expect(colNames).toContain("game_id");
    expect(colNames).toContain("accuracy_white");
    expect(colNames).toContain("accuracy_black");
    expect(colNames).toContain("blunders_white");
    expect(colNames).toContain("mistakes_white");
    expect(colNames).toContain("inaccuracies_white");
    expect(colNames).toContain("blunders_black");
    expect(colNames).toContain("mistakes_black");
    expect(colNames).toContain("inaccuracies_black");
    expect(colNames).toContain("acl_white");
    expect(colNames).toContain("acl_black");
    expect(colNames).toContain("computed_at");

    // game_id is the primary key
    const pk = columns.find((c) => c.name === "game_id");
    expect(pk?.pk).toBe(1);

    // All columns are NOT NULL (notnull = 1)
    const nonNullable = [
      "accuracy_white", "accuracy_black",
      "blunders_white", "mistakes_white", "inaccuracies_white",
      "blunders_black", "mistakes_black", "inaccuracies_black",
      "acl_white", "acl_black", "computed_at",
    ];
    for (const col of nonNullable) {
      const info = columns.find((c) => c.name === col);
      expect(info?.notnull).toBe(1);
    }
  });

  test("DELETE removes a seeded game_metrics row", () => {
    insertGame(db, "game-abc");
    insertMetrics(db, "game-abc");

    // Verify it was inserted
    const before = db
      .prepare(`SELECT count(*) as count FROM game_metrics WHERE game_id = ?`)
      .get("game-abc") as CountRow;
    expect(before.count).toBe(1);

    // Execute the same DELETE used by the analyze route
    db.prepare(`DELETE FROM game_metrics WHERE game_id = ?`).run("game-abc");

    const after = db
      .prepare(`SELECT count(*) as count FROM game_metrics WHERE game_id = ?`)
      .get("game-abc") as CountRow;
    expect(after.count).toBe(0);
  });

  test("DELETE on non-existent game_id is a no-op — no error thrown", () => {
    expect(() => {
      db.prepare(`DELETE FROM game_metrics WHERE game_id = ?`).run("nonexistent-id");
    }).not.toThrow();

    const row = db
      .prepare(`SELECT * FROM game_metrics WHERE game_id = ?`)
      .get("nonexistent-id") as MetricsRow | null;
    expect(row).toBeNull();
  });
});
