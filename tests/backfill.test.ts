import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import type { Migration } from "../server/lib/db";
import { backfillGameHeaders } from "../server/lib/backfill";

// ---------------------------------------------------------------------------
// Schema helpers — mirrors db.ts bootstrap + migrations 1-3
// ---------------------------------------------------------------------------

const migration2: Migration = {
  id: 2,
  up: (db: Database) => {
    db.run("ALTER TABLE games ADD COLUMN white_elo INTEGER");
    db.run("ALTER TABLE games ADD COLUMN black_elo INTEGER");
    db.run("ALTER TABLE games ADD COLUMN user_elo INTEGER");
    db.run("ALTER TABLE games ADD COLUMN eco TEXT");
    db.run("ALTER TABLE games ADD COLUMN opening TEXT");
  },
};

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

  // Run migration #2 to add the new columns
  migration2.up(db);

  // Run migration #3 — index on analysis.fen
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_analysis_fen ON analysis(fen)",
  );

  return db;
}

interface GameRow {
  id: string;
  white_elo: number | null;
  black_elo: number | null;
  user_elo: number | null;
  eco: string | null;
  opening: string | null;
}

function insertGame(
  db: Database,
  id: string,
  username: string,
  white: string,
  black: string,
  pgn: string,
): void {
  db.prepare(
    `INSERT INTO games (id, username, pgn, white, black) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, username, pgn, white, black);
}

function getGame(db: Database, id: string): GameRow | null {
  return db
    .prepare(
      `SELECT id, white_elo, black_elo, user_elo, eco, opening FROM games WHERE id = ?`,
    )
    .get(id) as GameRow | null;
}

// ---------------------------------------------------------------------------
// Test PGN fixtures
// ---------------------------------------------------------------------------

const FULL_PGN = `[Event "Live Chess"]
[White "Alice"]
[Black "Bob"]
[WhiteElo "1500"]
[BlackElo "1450"]
[ECO "C50"]
[Opening "Italian Game"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 1-0`;

const NO_ECO_PGN = `[Event "Live Chess"]
[White "Alice"]
[Black "Bob"]
[WhiteElo "1500"]
[BlackElo "1450"]
[Result "1-0"]

1. e4 e5 1-0`;

const EMPTY_PGN = ``;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let db: Database;

beforeEach(() => {
  db = makeDb();
});

describe("backfillGameHeaders", () => {
  test("backfills 3 games with full headers — returns 3, all columns populated", () => {
    insertGame(db, "g1", "alice", "Alice", "Bob", FULL_PGN);
    insertGame(db, "g2", "bob", "Alice", "Bob", FULL_PGN);
    insertGame(db, "g3", "alice", "Alice", "Charlie", FULL_PGN);

    const count = backfillGameHeaders(db);
    expect(count).toBe(3);

    const row = getGame(db, "g1");
    expect(row).not.toBeNull();
    expect(row?.white_elo).toBe(1500);
    expect(row?.black_elo).toBe(1450);
    expect(row?.eco).toBe("C50");
    expect(row?.opening).toBe("Italian Game");
  });

  test("re-running backfill is idempotent — returns 0 on second call", () => {
    insertGame(db, "g1", "alice", "Alice", "Bob", FULL_PGN);

    const first = backfillGameHeaders(db);
    expect(first).toBe(1);

    const second = backfillGameHeaders(db);
    expect(second).toBe(0);
  });

  test("game with missing ECO header — eco is null, other fields populated", () => {
    insertGame(db, "g1", "alice", "Alice", "Bob", NO_ECO_PGN);

    backfillGameHeaders(db);

    const row = getGame(db, "g1");
    expect(row?.eco).toBeNull();
    expect(row?.opening).toBeNull();
    expect(row?.white_elo).toBe(1500);
    expect(row?.black_elo).toBe(1450);
  });

  test("user_elo = white_elo when username matches white (case-insensitive)", () => {
    insertGame(db, "g1", "alice", "Alice", "Bob", FULL_PGN);

    backfillGameHeaders(db);

    const row = getGame(db, "g1");
    expect(row?.user_elo).toBe(1500); // matches white
  });

  test("user_elo = black_elo when username matches black (case-insensitive)", () => {
    insertGame(db, "g1", "BOB", "Alice", "Bob", FULL_PGN);

    backfillGameHeaders(db);

    const row = getGame(db, "g1");
    expect(row?.user_elo).toBe(1450); // matches black
  });

  test("empty PGN — all five columns set to null, no error thrown", () => {
    insertGame(db, "g1", "alice", "Alice", "Bob", EMPTY_PGN);

    expect(() => backfillGameHeaders(db)).not.toThrow();

    const row = getGame(db, "g1");
    expect(row?.white_elo).toBeNull();
    expect(row?.black_elo).toBeNull();
    expect(row?.user_elo).toBeNull();
    expect(row?.eco).toBeNull();
    expect(row?.opening).toBeNull();
  });

  test("only rows with white_elo IS NULL are processed", () => {
    insertGame(db, "g1", "alice", "Alice", "Bob", FULL_PGN);
    insertGame(db, "g2", "alice", "Alice", "Bob", FULL_PGN);

    // Pre-populate g1 to simulate already-backfilled row
    db.prepare(
      `UPDATE games SET white_elo = 9999 WHERE id = ?`,
    ).run("g1");

    const count = backfillGameHeaders(db);
    expect(count).toBe(1); // only g2 was unprocessed

    const g1 = getGame(db, "g1");
    expect(g1?.white_elo).toBe(9999); // untouched
  });
});
