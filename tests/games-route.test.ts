import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import {
  buildGameRow,
  computeAndCacheMetrics,
  fetchBulkMetricsFor,
} from "../server/routes/games";
import type { ChessComGame } from "../server/lib/chesscom";
import { migrations } from "../server/lib/db";
import { loadOpenings } from "../server/lib/openings";

loadOpenings();

// ---------------------------------------------------------------------------
// PGN fixtures
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

const NO_ELO_PGN = `[Event "Live Chess"]
[White "Alice"]
[Black "Bob"]
[ECO "D00"]
[Opening "Queen's Pawn"]
[Result "1/2-1/2"]

1. d4 d5 1/2-1/2`;

const KINGS_INDIAN_NO_ECO_PGN = `[Event "Live Chess"]
[White "Alice"]
[Black "Bob"]
[WhiteElo "1600"]
[BlackElo "1550"]
[Result "1-0"]

1. d4 Nf6 2. c4 g6 1-0`;

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeGame(overrides: Partial<ChessComGame> = {}): ChessComGame {
  return {
    url: "https://www.chess.com/game/live/12345",
    pgn: FULL_PGN,
    time_control: "600",
    time_class: "rapid",
    end_time: 1700000000,
    rated: true,
    rules: "chess",
    white: { username: "Alice", rating: 1500, result: "win" },
    black: { username: "Bob", rating: 1450, result: "resigned" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildGameRow", () => {
  test("username matches white (case-insensitive) → userElo equals whiteElo", () => {
    const row = buildGameRow("alice", makeGame());
    expect(row.user_elo).toBe(1500);
    expect(row.white_elo).toBe(1500);
    expect(row.black_elo).toBe(1450);
  });

  test("username matches black (case-insensitive) → userElo equals blackElo", () => {
    const row = buildGameRow("BOB", makeGame());
    expect(row.user_elo).toBe(1450);
    expect(row.white_elo).toBe(1500);
    expect(row.black_elo).toBe(1450);
  });

  test("PGN without ECO header → hybrid fallback classifies from moves", () => {
    // NO_ECO_PGN uses 1. e4 e5 → hybrid fallback → C20 "King's Pawn Game"
    const row = buildGameRow("alice", makeGame({ pgn: NO_ECO_PGN }));
    expect(row.eco).toBe("C20");
    expect(row.opening).toBe("King's Pawn Game");
  });

  test("PGN without WhiteElo/BlackElo headers → whiteElo and blackElo are null", () => {
    const row = buildGameRow("alice", makeGame({ pgn: NO_ELO_PGN }));
    expect(row.white_elo).toBeNull();
    expect(row.black_elo).toBeNull();
  });

  test("PGN with all headers → all five new fields populated", () => {
    const row = buildGameRow("alice", makeGame({ pgn: FULL_PGN }));
    expect(row.white_elo).toBe(1500);
    expect(row.black_elo).toBe(1450);
    expect(row.user_elo).toBe(1500);
    expect(row.eco).toBe("C50");
    expect(row.opening).toBe("Italian Game");
  });

  test("game id is derived from url (last path segment)", () => {
    const row = buildGameRow("alice", makeGame());
    expect(row.id).toBe("12345");
  });

  test("username is lowercased in stored row", () => {
    const row = buildGameRow("ALICE", makeGame());
    expect(row.username).toBe("alice");
  });

  test("white wins → result is '1-0'", () => {
    const row = buildGameRow("alice", makeGame());
    expect(row.result).toBe("1-0");
  });

  test("black wins → result is '0-1'", () => {
    const g = makeGame({
      white: { username: "Alice", rating: 1500, result: "resigned" },
      black: { username: "Bob", rating: 1450, result: "win" },
    });
    const row = buildGameRow("alice", g);
    expect(row.result).toBe("0-1");
  });

  test("neither wins → result is '1/2-1/2'", () => {
    const g = makeGame({
      white: { username: "Alice", rating: 1500, result: "agreed" },
      black: { username: "Bob", rating: 1450, result: "agreed" },
    });
    const row = buildGameRow("alice", g);
    expect(row.result).toBe("1/2-1/2");
  });

  test("hybrid fallback: d4 Nf6 c4 g6 with no ECO header → eco starts with E", () => {
    const row = buildGameRow("alice", makeGame({ pgn: KINGS_INDIAN_NO_ECO_PGN }));
    expect(row.eco).not.toBeNull();
    expect(row.eco?.startsWith("E")).toBe(true);
    expect(row.opening).not.toBeNull();
  });

  test("hybrid fallback: header ECO present → header value is NOT overridden by hybrid", () => {
    // FULL_PGN has ECO "C50" and Opening "Italian Game" in headers
    const row = buildGameRow("alice", makeGame({ pgn: FULL_PGN }));
    expect(row.eco).toBe("C50");
    expect(row.opening).toBe("Italian Game");
  });
});

// ---------------------------------------------------------------------------
// computeAndCacheMetrics — in-memory DB tests
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

function insertTestGame(database: Database, gameId: string): void {
  database
    .prepare(`INSERT INTO games (id, username, pgn) VALUES (?, ?, ?)`)
    .run(gameId, "testuser", "1. e4 e5");
}

function insertAnalysisRow(
  database: Database,
  gameId: string,
  moveIndex: number,
  scoreCp: number,
): void {
  database
    .prepare(
      `INSERT INTO analysis
         (game_id, move_index, fen, move_san, score_cp, score_mate, best_move, depth)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      gameId,
      moveIndex,
      `fen_${String(moveIndex)}`,
      moveIndex > 0 ? "e4" : null,
      scoreCp,
      null,
      "e2e4",
      20,
    );
}

/** Seed 12 analysis rows so ACL logic (skip first 8 plies) has enough data. */
function seedAnalysis(database: Database, gameId: string): void {
  for (let i = 0; i < 12; i++) {
    insertAnalysisRow(database, gameId, i, i % 2 === 0 ? 20 : -20);
  }
}

let testDb: Database;

beforeEach(() => {
  testDb = makeTestDb();
});

describe("computeAndCacheMetrics", () => {
  test("returns null for a game with no analysis rows (unanalyzed)", () => {
    insertTestGame(testDb, "unanalyzed-game");
    const result = computeAndCacheMetrics(testDb, "unanalyzed-game");
    expect(result).toBeNull();
  });

  test("compute path: returns metrics and inserts into game_metrics", () => {
    insertTestGame(testDb, "game-compute");
    seedAnalysis(testDb, "game-compute");

    const result = computeAndCacheMetrics(testDb, "game-compute");

    expect(result).not.toBeNull();
    expect(result?.gameId).toBe("game-compute");
    expect(typeof result?.white.accuracy).toBe("number");
    expect(typeof result?.black.accuracy).toBe("number");
    expect(typeof result?.computedAt).toBe("number");
    expect(result?.computedAt).toBeGreaterThan(0);

    // Verify the row was written to game_metrics
    const cached = testDb
      .prepare(`SELECT * FROM game_metrics WHERE game_id = ?`)
      .get("game-compute") as { computed_at: number } | null;
    expect(cached).not.toBeNull();
    expect(cached?.computed_at).toBe(result?.computedAt);
  });

  test("cache path: second call returns cached row (computed_at unchanged)", () => {
    insertTestGame(testDb, "game-cache");
    seedAnalysis(testDb, "game-cache");

    const first = computeAndCacheMetrics(testDb, "game-cache");
    expect(first).not.toBeNull();

    // Insert an extra analysis row — cache should still win so result is unchanged
    insertAnalysisRow(testDb, "game-cache", 12, 50);

    const second = computeAndCacheMetrics(testDb, "game-cache");
    expect(second).not.toBeNull();
    expect(second?.computedAt).toBe(first?.computedAt);
  });

  test("invalidation: DELETE then recompute produces fresh computed_at", () => {
    insertTestGame(testDb, "game-invalidate");
    seedAnalysis(testDb, "game-invalidate");

    const first = computeAndCacheMetrics(testDb, "game-invalidate");
    expect(first).not.toBeNull();
    const firstAt = first?.computedAt ?? 0;

    // Simulate cache invalidation (as done by analyze.ts)
    testDb
      .prepare(`DELETE FROM game_metrics WHERE game_id = ?`)
      .run("game-invalidate");

    // Wait 1.1 s so unixepoch() advances (computed_at is in whole seconds)
    const future = firstAt + 2;
    testDb
      .prepare(
        `INSERT INTO game_metrics (
           game_id,
           accuracy_white, accuracy_black,
           blunders_white, mistakes_white, inaccuracies_white,
           blunders_black, mistakes_black, inaccuracies_black,
           acl_white, acl_black,
           computed_at
         ) VALUES (?, 90, 80, 0, 0, 0, 0, 0, 0, 0, 0, ?)`,
      )
      .run("game-invalidate", future);

    const second = computeAndCacheMetrics(testDb, "game-invalidate");
    expect(second).not.toBeNull();
    expect(second?.computedAt).toBe(future);
  });
});

// ---------------------------------------------------------------------------
// fetchBulkMetricsFor — bulk endpoint helper tests
// ---------------------------------------------------------------------------

/** Insert a game row with a known end_time for ordering. */
function insertGameWithTime(
  database: Database,
  gameId: string,
  username: string,
  endTime: number,
): void {
  database
    .prepare(
      `INSERT INTO games (id, username, pgn, end_time) VALUES (?, ?, ?, ?)`,
    )
    .run(gameId, username.toLowerCase(), "1. e4 e5", endTime);
}

/** Pre-populate game_metrics directly (simulates an already-cached result). */
function insertCachedMetrics(database: Database, gameId: string): void {
  database
    .prepare(
      `INSERT INTO game_metrics (
         game_id,
         accuracy_white, accuracy_black,
         blunders_white, mistakes_white, inaccuracies_white,
         blunders_black, mistakes_black, inaccuracies_black,
         acl_white, acl_black,
         computed_at
       ) VALUES (?, 85, 75, 1, 2, 3, 0, 1, 2, 10, 15, 1700000001)`,
    )
    .run(gameId);
}

describe("fetchBulkMetricsFor", () => {
  test("user with 3 unanalyzed games → all 3 keys map to null", () => {
    for (let i = 1; i <= 3; i++) {
      insertGameWithTime(testDb, `bulk-none-${String(i)}`, "bulkuser", i);
    }

    const result = fetchBulkMetricsFor(testDb, "bulkuser");

    expect(Object.keys(result)).toHaveLength(3);
    for (let i = 1; i <= 3; i++) {
      expect(result[`bulk-none-${String(i)}`]).toBeNull();
    }
  });

  test("user with 2 analyzed games (cache miss) → both compute on-the-fly with valid metrics", () => {
    insertGameWithTime(testDb, "bulk-hit-1", "bulkhituser", 1000);
    insertGameWithTime(testDb, "bulk-hit-2", "bulkhituser", 2000);
    seedAnalysis(testDb, "bulk-hit-1");
    seedAnalysis(testDb, "bulk-hit-2");

    const result = fetchBulkMetricsFor(testDb, "bulkhituser");

    expect(Object.keys(result)).toHaveLength(2);
    const m1 = result["bulk-hit-1"];
    const m2 = result["bulk-hit-2"];
    expect(m1).not.toBeNull();
    expect(m2).not.toBeNull();
    expect(typeof m1?.white.accuracy).toBe("number");
    expect(typeof m2?.black.accuracy).toBe("number");
  });

  test("user with 25 unanalyzed games → first 20 attempted (return null), last 5 are null without compute attempt", () => {
    // Insert 25 games ordered by end_time DESC: ids bulk-cap-25 down to bulk-cap-1
    for (let i = 1; i <= 25; i++) {
      insertGameWithTime(testDb, `bulk-cap-${String(i)}`, "bulkcapuser", i);
    }
    // No analysis rows inserted → computeAndCacheMetrics returns null for each
    const result = fetchBulkMetricsFor(testDb, "bulkcapuser");

    expect(Object.keys(result)).toHaveLength(25);
    // All 25 must be null (unanalyzed → compute returns null regardless of cap)
    for (const val of Object.values(result)) {
      expect(val).toBeNull();
    }
  });

  test("beyond-limit games return null even when analysis rows exist", () => {
    // Insert 21 games with analysis rows. First 20 (by end_time DESC) will be
    // computed; game #1 (oldest) is beyond the BULK_COMPUTE_LIMIT and must be null.
    for (let i = 1; i <= 21; i++) {
      insertGameWithTime(testDb, `bulk-limit-${String(i)}`, "bulklimituser", i);
      seedAnalysis(testDb, `bulk-limit-${String(i)}`);
    }

    const result = fetchBulkMetricsFor(testDb, "bulklimituser");

    expect(Object.keys(result)).toHaveLength(21);

    // Games 21 down to 2 (end_time 21..2) are the first 20 by DESC order
    let nonNullCount = 0;
    let nullCount = 0;
    for (const val of Object.values(result)) {
      if (val === null) {
        nullCount += 1;
      } else {
        nonNullCount += 1;
      }
    }
    expect(nonNullCount).toBe(20);
    expect(nullCount).toBe(1);

    // The oldest game (end_time=1) should be the one capped
    expect(result["bulk-limit-1"]).toBeNull();
  });

  test("mixed cache hits + misses: cached rows served without recompute, misses computed up to limit", () => {
    // 2 pre-cached games, 2 cache-miss games (with analysis)
    insertGameWithTime(testDb, "bulk-mix-cached-1", "bulkmixuser", 100);
    insertGameWithTime(testDb, "bulk-mix-cached-2", "bulkmixuser", 200);
    insertGameWithTime(testDb, "bulk-mix-miss-1", "bulkmixuser", 300);
    insertGameWithTime(testDb, "bulk-mix-miss-2", "bulkmixuser", 400);

    insertCachedMetrics(testDb, "bulk-mix-cached-1");
    insertCachedMetrics(testDb, "bulk-mix-cached-2");
    seedAnalysis(testDb, "bulk-mix-miss-1");
    seedAnalysis(testDb, "bulk-mix-miss-2");

    const result = fetchBulkMetricsFor(testDb, "bulkmixuser");

    expect(Object.keys(result)).toHaveLength(4);

    // All 4 should have non-null metrics
    expect(result["bulk-mix-cached-1"]).not.toBeNull();
    expect(result["bulk-mix-cached-2"]).not.toBeNull();
    expect(result["bulk-mix-miss-1"]).not.toBeNull();
    expect(result["bulk-mix-miss-2"]).not.toBeNull();

    // Cached rows must reflect the pre-inserted values (accuracy_white=85)
    expect(result["bulk-mix-cached-1"]?.white.accuracy).toBe(85);
    expect(result["bulk-mix-cached-2"]?.white.accuracy).toBe(85);
  });

  test("username lookup is case-insensitive", () => {
    insertGameWithTime(testDb, "bulk-case-game", "CaseUser", 1000);
    seedAnalysis(testDb, "bulk-case-game");

    const resultLower = fetchBulkMetricsFor(testDb, "caseuser");
    const resultUpper = fetchBulkMetricsFor(testDb, "CASEUSER");

    expect(Object.keys(resultLower)).toHaveLength(1);
    expect(Object.keys(resultUpper)).toHaveLength(1);
    expect(resultLower["bulk-case-game"]).not.toBeNull();
    expect(resultUpper["bulk-case-game"]).not.toBeNull();
  });

  test("user with no games → empty result object", () => {
    const result = fetchBulkMetricsFor(testDb, "nosuchuser");
    expect(Object.keys(result)).toHaveLength(0);
  });

  test("idempotent: calling twice for cached game returns same computedAt", () => {
    insertGameWithTime(testDb, "bulk-idem-game", "idemuser", 1000);
    seedAnalysis(testDb, "bulk-idem-game");

    const first = fetchBulkMetricsFor(testDb, "idemuser");
    const second = fetchBulkMetricsFor(testDb, "idemuser");

    expect(first["bulk-idem-game"]?.computedAt).toBe(
      second["bulk-idem-game"]?.computedAt,
    );
  });
});
