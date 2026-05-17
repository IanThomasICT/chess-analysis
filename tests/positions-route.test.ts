import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { computePositionHistory } from "../server/routes/positions";
import { migrations } from "../server/lib/db";
import { fenKey } from "../server/lib/engine";

// ---------------------------------------------------------------------------
// In-memory DB setup
// ---------------------------------------------------------------------------

function makeTestDb(): Database {
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

  for (const migration of migrations) {
    migration.up(database);
  }

  return database;
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

function insertGame(
  database: Database,
  gameId: string,
  username: string,
  endTime: number,
  white = "White",
  black = "Black",
  result = "1-0",
): void {
  database
    .prepare(
      `INSERT INTO games (id, username, pgn, white, black, result, end_time)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(gameId, username.toLowerCase(), "1. e4 e5", white, black, result, endTime);
}

function insertAnalysis(
  database: Database,
  gameId: string,
  moveIndex: number,
  fen: string,
  scoreCp: number | null,
  scoreMate: number | null = null,
  moveSan: string | null = null,
  bestMove = "e2e4",
): void {
  const key = fenKey(fen);
  database
    .prepare(
      `INSERT INTO analysis (game_id, move_index, fen, fen_key, move_san, score_cp, score_mate, best_move, depth)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(gameId, moveIndex, fen, key, moveSan, scoreCp, scoreMate, bestMove, 20);
}

// A stable FEN to use across tests
const TEST_FEN =
  "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let testDb: Database;

beforeEach(() => {
  testDb = makeTestDb();
});

describe("computePositionHistory", () => {
  test("returns 3 entries ordered by end_time DESC when same fen_key appears in 3 games", () => {
    insertGame(testDb, "game-a", "alice", 1000);
    insertGame(testDb, "game-b", "alice", 3000);
    insertGame(testDb, "game-c", "alice", 2000);

    // Insert the target FEN at move_index 2 in each game
    for (const id of ["game-a", "game-b", "game-c"]) {
      insertAnalysis(testDb, id, 2, TEST_FEN, 0);
    }

    const results = computePositionHistory(testDb, TEST_FEN, "alice");

    expect(results).toHaveLength(3);
    // Should be ordered by end_time DESC: game-b (3000), game-c (2000), game-a (1000)
    expect(results[0].game_id).toBe("game-b");
    expect(results[1].game_id).toBe("game-c");
    expect(results[2].game_id).toBe("game-a");
  });

  test("returns [] when fen_key is not in any game", () => {
    insertGame(testDb, "game-nofenkey", "alice", 1000);
    const otherFen = "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq d3 0 1";
    insertAnalysis(testDb, "game-nofenkey", 2, otherFen, 0);

    const results = computePositionHistory(testDb, TEST_FEN, "alice");
    expect(results).toHaveLength(0);
  });

  test("returns [] when fen_key exists but username does not match", () => {
    insertGame(testDb, "game-user-mismatch", "bob", 1000);
    insertAnalysis(testDb, "game-user-mismatch", 2, TEST_FEN, 0);

    const results = computePositionHistory(testDb, TEST_FEN, "alice");
    expect(results).toHaveLength(0);
  });

  test("was_blunder=true when eval drops from +200 to -300 (mover perspective)", () => {
    // move_index=0 is White's move (isWhiteMove=true, even index)
    // Before: cp=+200 (White perspective), After: cp=-300 (White perspective)
    // Mover perspective (White): before=+200, after=-300 → large drop → blunder
    insertGame(testDb, "game-blunder", "alice", 1000);
    insertAnalysis(testDb, "game-blunder", 0, TEST_FEN, 200);
    const nextFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    insertAnalysis(testDb, "game-blunder", 1, nextFen, -300, null, "e7e5");

    const results = computePositionHistory(testDb, TEST_FEN, "alice");
    expect(results).toHaveLength(1);
    expect(results[0].was_blunder).toBe(true);
    expect(results[0].played_move).toBe("e7e5");
  });

  test("was_blunder=false for small eval change (+100 to +90)", () => {
    // move_index=0 is White's move. Small cp drop → inaccuracy or better, not blunder
    insertGame(testDb, "game-nonblunder", "alice", 1000);
    insertAnalysis(testDb, "game-nonblunder", 0, TEST_FEN, 100);
    const nextFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    insertAnalysis(testDb, "game-nonblunder", 1, nextFen, 90, null, "d7d5");

    const results = computePositionHistory(testDb, TEST_FEN, "alice");
    expect(results).toHaveLength(1);
    expect(results[0].was_blunder).toBe(false);
  });

  test("last position in game: was_blunder=false and played_move=null when no next row", () => {
    insertGame(testDb, "game-last-pos", "alice", 1000);
    // Only insert one row — no row at move_index+1
    insertAnalysis(testDb, "game-last-pos", 5, TEST_FEN, 50);

    const results = computePositionHistory(testDb, TEST_FEN, "alice");
    expect(results).toHaveLength(1);
    expect(results[0].was_blunder).toBe(false);
    expect(results[0].played_move).toBeNull();
  });

  test("username lookup is case-insensitive", () => {
    insertGame(testDb, "game-case", "Alice", 1000);
    insertAnalysis(testDb, "game-case", 2, TEST_FEN, 0);

    // Query with different cases
    expect(computePositionHistory(testDb, TEST_FEN, "ALICE")).toHaveLength(1);
    expect(computePositionHistory(testDb, TEST_FEN, "alice")).toHaveLength(1);
    expect(computePositionHistory(testDb, TEST_FEN, "Alice")).toHaveLength(1);
  });

  test("was_blunder=true for Black mover when eval rises (bad for Black)", () => {
    // move_index=1 → Black's move (odd index, isWhiteMove=false)
    // Before: cp=-300 White's perspective (good for Black)
    // After:  cp=+200 White's perspective (bad for Black)
    // Mover (Black) perspective: before=+300, after=-200 → large drop → blunder
    const blackMoveFen = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2";
    insertGame(testDb, "game-black-blunder", "alice", 1000);
    insertAnalysis(testDb, "game-black-blunder", 1, blackMoveFen, -300);
    const nextFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    insertAnalysis(testDb, "game-black-blunder", 2, nextFen, 200, null, "Nf6");

    const results = computePositionHistory(testDb, blackMoveFen, "alice");
    expect(results).toHaveLength(1);
    expect(results[0].was_blunder).toBe(true);
  });
});
