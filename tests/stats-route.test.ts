import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { migrations, type Migration } from "../server/lib/db";
import { computeBySide } from "../server/routes/stats";

// ---------------------------------------------------------------------------
// Schema helpers — apply migrations 1-4 to an in-memory DB
// ---------------------------------------------------------------------------

function makeDb(): Database {
  const database = new Database(":memory:");

  database.run(`
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

  database.run(`
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

  database.run(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);

  // Apply migrations 1-4
  const migrationsToApply = migrations.filter(
    (m: Migration) => m.id >= 1 && m.id <= 4,
  );
  for (const migration of migrationsToApply) {
    migration.up(database);
  }

  return database;
}

function insertGame(
  database: Database,
  id: string,
  username: string,
  white: string,
  black: string,
  result: string,
): void {
  database
    .prepare(
      `INSERT INTO games (id, username, pgn, white, black, result)
       VALUES (?, ?, '', ?, ?, ?)`,
    )
    .run(id, username, white, black, result);
}

function insertMetrics(
  database: Database,
  gameId: string,
  accuracyWhite: number,
  accuracyBlack: number,
  blundersWhite: number,
  blundersBlack: number,
): void {
  database
    .prepare(
      `INSERT INTO game_metrics
         (game_id, accuracy_white, accuracy_black,
          blunders_white, mistakes_white, inaccuracies_white,
          blunders_black, mistakes_black, inaccuracies_black,
          acl_white, acl_black, computed_at)
       VALUES (?, ?, ?, ?, 0, 0, ?, 0, 0, 0, 0, 0)`,
    )
    .run(gameId, accuracyWhite, accuracyBlack, blundersWhite, blundersBlack);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let db: Database;

beforeEach(() => {
  db = makeDb();
});

describe("computeBySide", () => {
  test("counts wins/draws/losses correctly for white and black", () => {
    // 3 wins as white, 1 loss as white
    insertGame(db, "g1", "alice", "Alice", "Bob", "1-0"); // alice white win
    insertGame(db, "g2", "alice", "Alice", "Bob", "1-0"); // alice white win
    insertGame(db, "g3", "alice", "Alice", "Bob", "1-0"); // alice white win
    insertGame(db, "g4", "alice", "Alice", "Bob", "0-1"); // alice white loss
    // 2 wins as black
    insertGame(db, "g5", "alice", "Bob", "Alice", "0-1"); // alice black win
    insertGame(db, "g6", "alice", "Bob", "Alice", "0-1"); // alice black win

    const result = computeBySide(db, "alice");

    expect(result.white.games).toBe(4);
    expect(result.white.wins).toBe(3);
    expect(result.white.losses).toBe(1);
    expect(result.white.draws).toBe(0);

    expect(result.black.games).toBe(2);
    expect(result.black.wins).toBe(2);
    expect(result.black.losses).toBe(0);
    expect(result.black.draws).toBe(0);
  });

  test("username comparison is case-insensitive", () => {
    insertGame(db, "g1", "Alice", "Alice", "Bob", "1-0");
    insertGame(db, "g2", "alice", "Alice", "Bob", "1-0");
    insertGame(db, "g3", "ALICE", "Alice", "Bob", "0-1");

    // Query with different case — should match all three rows
    const result = computeBySide(db, "ALICE");

    expect(result.white.games).toBe(3);
    expect(result.white.wins).toBe(2);
    expect(result.white.losses).toBe(1);
  });

  test("user with 0 games returns zero-valued stats on both sides", () => {
    const result = computeBySide(db, "nobody");

    expect(result.white.games).toBe(0);
    expect(result.white.wins).toBe(0);
    expect(result.white.draws).toBe(0);
    expect(result.white.losses).toBe(0);
    expect(result.white.win_rate).toBe(0);
    expect(result.white.avg_accuracy).toBeNull();
    expect(result.white.blunders_per_game).toBeNull();

    expect(result.black.games).toBe(0);
    expect(result.black.wins).toBe(0);
    expect(result.black.avg_accuracy).toBeNull();
    expect(result.black.blunders_per_game).toBeNull();
  });

  test("avg_accuracy is null when no game_metrics rows exist", () => {
    insertGame(db, "g1", "alice", "Alice", "Bob", "1-0");
    insertGame(db, "g2", "alice", "Bob", "Alice", "0-1");

    const result = computeBySide(db, "alice");

    expect(result.white.avg_accuracy).toBeNull();
    expect(result.black.avg_accuracy).toBeNull();
    expect(result.white.blunders_per_game).toBeNull();
    expect(result.black.blunders_per_game).toBeNull();
  });

  test("avg_accuracy is the average only over games that have metrics", () => {
    insertGame(db, "g1", "alice", "Alice", "Bob", "1-0");
    insertGame(db, "g2", "alice", "Alice", "Bob", "1-0");
    insertGame(db, "g3", "alice", "Alice", "Bob", "1-0"); // no metrics

    insertMetrics(db, "g1", 80.0, 70.0, 1, 2);
    insertMetrics(db, "g2", 90.0, 60.0, 3, 1);
    // g3 intentionally has no metrics row

    const result = computeBySide(db, "alice");

    // AVG of 80 and 90 = 85; g3 contributes NULL which SQLite AVG ignores
    expect(result.white.avg_accuracy).toBeCloseTo(85.0, 5);
    expect(result.white.blunders_per_game).toBeCloseTo(2.0, 5); // (1+3)/2
  });

  test("win_rate computed correctly: 3 wins out of 5 games = 0.6", () => {
    insertGame(db, "g1", "alice", "Alice", "Bob", "1-0");
    insertGame(db, "g2", "alice", "Alice", "Bob", "1-0");
    insertGame(db, "g3", "alice", "Alice", "Bob", "1-0");
    insertGame(db, "g4", "alice", "Alice", "Bob", "0-1");
    insertGame(db, "g5", "alice", "Alice", "Bob", "1/2-1/2");

    const result = computeBySide(db, "alice");

    expect(result.white.games).toBe(5);
    expect(result.white.wins).toBe(3);
    expect(result.white.draws).toBe(1);
    expect(result.white.losses).toBe(1);
    expect(result.white.win_rate).toBeCloseTo(0.6, 10);
  });
});
