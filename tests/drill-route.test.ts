import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { migrations } from "../server/lib/db";
import { computeDrillQueue, processDrillAttempt, type AttemptRequest } from "../server/routes/drill";

// ---------------------------------------------------------------------------
// In-memory DB setup — apply all migrations
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
  id: string,
  username: string,
  white: string,
  black: string,
): void {
  database
    .prepare(
      `INSERT INTO games (id, username, pgn, white, black, result)
       VALUES (?, ?, '', ?, ?, '1-0')`,
    )
    .run(id, username, white, black);
}

function insertAnalysis(
  database: Database,
  gameId: string,
  moveIndex: number,
  fen: string,
  bestMove: string,
  multipvRank = 1,
): void {
  database
    .prepare(
      `INSERT INTO analysis (game_id, move_index, multipv_rank, fen, best_move, depth)
       VALUES (?, ?, ?, ?, ?, 20)`,
    )
    .run(gameId, moveIndex, multipvRank, fen, bestMove);
}

function insertBlunderTag(
  database: Database,
  gameId: string,
  moveIndex: number,
  tag: string,
): void {
  database
    .prepare(
      `INSERT INTO blunder_tags (game_id, move_index, tag) VALUES (?, ?, ?)`,
    )
    .run(gameId, moveIndex, tag);
}

function insertDrillAttempt(
  database: Database,
  username: string,
  gameId: string,
  moveIndex: number,
  fen: string,
  bestMove: string,
  due: number | null,
): void {
  database
    .prepare(
      `INSERT INTO drill_attempts (username, game_id, move_index, fen, best_move, due)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(username, gameId, moveIndex, fen, bestMove, due);
}

// ---------------------------------------------------------------------------
// Shared FEN strings (content doesn't matter for logic tests)
// ---------------------------------------------------------------------------

const FEN0 = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const FEN1 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
const FEN2 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let db: Database;

beforeEach(() => {
  db = makeTestDb();
});

describe("computeDrillQueue — new cards", () => {
  test("returns 5 new cards when user has 5 user-side blunder_tags with no drill_attempts", () => {
    // User plays White: move_index 1, 3, 5 are White's moves
    insertGame(db, "g1", "alice", "alice", "bob");
    for (let mi = 1; mi <= 5; mi += 2) {
      // White's moves: 1, 3, 5
      insertAnalysis(db, "g1", mi - 1, FEN0, "e2e4"); // before-position
      insertBlunderTag(db, "g1", mi, "hanging_piece");
    }

    const cards = computeDrillQueue(db, "alice", 20);
    expect(cards.length).toBe(3); // 3 white moves: 1, 3, 5 → move_index-1 = 0, 2, 4
    for (const card of cards) {
      expect(card.source).toBe("new");
      expect(card.fen).toBe(FEN0);
      expect(card.best_move).toBe("e2e4");
    }
  });

  test("returns new cards with motifs populated", () => {
    insertGame(db, "g1", "alice", "alice", "bob");
    // White blunders on move 1 (move_index 1, before = move_index 0)
    insertAnalysis(db, "g1", 0, FEN0, "e2e4");
    insertBlunderTag(db, "g1", 1, "fork");
    insertBlunderTag(db, "g1", 1, "pin");

    const cards = computeDrillQueue(db, "alice", 20);
    expect(cards.length).toBe(1);
    expect(cards[0].motifs.sort()).toEqual(["fork", "pin"]);
  });

  test("limit is respected — request limit=3, 5 new available → returns 3", () => {
    insertGame(db, "g1", "alice", "alice", "bob");
    // White moves at move_index 1, 3, 5, 7, 9 → 5 blunders
    for (let mi = 1; mi <= 9; mi += 2) {
      insertAnalysis(db, "g1", mi - 1, FEN0, "e2e4");
      insertBlunderTag(db, "g1", mi, "hanging_piece");
    }

    const cards = computeDrillQueue(db, "alice", 3);
    expect(cards.length).toBe(3);
  });

  test("opponent blunders (wrong parity) are excluded", () => {
    // alice plays White; Black's blunders are at even move_index values (2, 4, …)
    insertGame(db, "g1", "alice", "alice", "bob");
    // Black's moves: move_index 2, 4 → ((mi-1)%2) = 1 → these are Black's blunders
    insertAnalysis(db, "g1", 1, FEN1, "e7e5"); // before move_index=2
    insertBlunderTag(db, "g1", 2, "hanging_piece");
    insertAnalysis(db, "g1", 3, FEN2, "d2d4"); // before move_index=4
    insertBlunderTag(db, "g1", 4, "fork");

    const cards = computeDrillQueue(db, "alice", 20);
    expect(cards.length).toBe(0);
  });

  test("blunder_tag with no analysis row at move_index-1 is skipped", () => {
    insertGame(db, "g1", "alice", "alice", "bob");
    // No analysis row at move_index 0 → should be skipped
    insertBlunderTag(db, "g1", 1, "hanging_piece");
    // Second blunder with analysis row → should be included
    insertAnalysis(db, "g1", 2, FEN0, "e2e4");
    insertBlunderTag(db, "g1", 3, "fork");

    const cards = computeDrillQueue(db, "alice", 20);
    expect(cards.length).toBe(1);
    expect(cards[0].move_index).toBe(3);
  });

  test("case-insensitive username matching", () => {
    insertGame(db, "g1", "Alice", "Alice", "bob");
    insertAnalysis(db, "g1", 0, FEN0, "e2e4");
    insertBlunderTag(db, "g1", 1, "fork");

    // Query with lowercase
    const cards = computeDrillQueue(db, "alice", 20);
    expect(cards.length).toBe(1);
    expect(cards[0].source).toBe("new");
  });
});

describe("computeDrillQueue — due cards", () => {
  test("returns due cards first, before new cards", () => {
    const now = Math.floor(Date.now() / 1000);

    insertGame(db, "g1", "alice", "alice", "bob");
    // Due card (overdue)
    insertDrillAttempt(db, "alice", "g1", 1, FEN0, "e2e4", now - 60);
    // New blunder card
    insertAnalysis(db, "g1", 2, FEN1, "e7e5");
    insertBlunderTag(db, "g1", 3, "fork");

    const cards = computeDrillQueue(db, "alice", 20);
    expect(cards.length).toBe(2);
    expect(cards[0].source).toBe("due");
    expect(cards[1].source).toBe("new");
  });

  test("future due cards are not returned", () => {
    const now = Math.floor(Date.now() / 1000);
    insertGame(db, "g1", "alice", "alice", "bob");
    insertDrillAttempt(db, "alice", "g1", 1, FEN0, "e2e4", now + 86400);

    const cards = computeDrillQueue(db, "alice", 20);
    expect(cards.length).toBe(0);
  });

  test("due cards fill limit, no new cards returned when limit reached", () => {
    const now = Math.floor(Date.now() / 1000);
    insertGame(db, "g1", "alice", "alice", "bob");

    // Insert 3 due cards
    for (let mi = 1; mi <= 5; mi += 2) {
      insertDrillAttempt(db, "alice", `g1`, mi, FEN0, "e2e4", now - mi * 10);
    }

    // Also insert new blunder
    insertAnalysis(db, "g1", 6, FEN1, "e7e5");
    insertBlunderTag(db, "g1", 7, "fork"); // black's blunder — would be excluded anyway

    const cards = computeDrillQueue(db, "alice", 3);
    expect(cards.length).toBe(3);
    expect(cards.every((c) => c.source === "due")).toBe(true);
  });
});

describe("computeDrillQueue — black player", () => {
  test("includes black user blunders (odd move_index parity)", () => {
    // alice plays Black: Black's moves are at move_index 2, 4, 6, …
    // ((move_index - 1) % 2) === 1 for Black's moves
    insertGame(db, "g1", "alice", "bob", "alice");
    insertAnalysis(db, "g1", 1, FEN1, "e7e5"); // before move_index=2
    insertBlunderTag(db, "g1", 2, "hanging_piece");

    const cards = computeDrillQueue(db, "alice", 20);
    expect(cards.length).toBe(1);
    expect(cards[0].source).toBe("new");
    expect(cards[0].fen).toBe(FEN1);
    expect(cards[0].best_move).toBe("e7e5");
  });

  test("excludes white blunders when alice plays black", () => {
    insertGame(db, "g1", "alice", "bob", "alice");
    // White's blunders at move_index 1, 3 → excluded
    insertAnalysis(db, "g1", 0, FEN0, "e2e4");
    insertBlunderTag(db, "g1", 1, "fork");
    insertAnalysis(db, "g1", 2, FEN2, "d2d4");
    insertBlunderTag(db, "g1", 3, "pin");

    const cards = computeDrillQueue(db, "alice", 20);
    expect(cards.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// processDrillAttempt — unit tests
// ---------------------------------------------------------------------------

describe("attempt endpoint helper", () => {
  function makeBody(overrides: Partial<AttemptRequest> = {}): AttemptRequest {
    return {
      username: "alice",
      game_id: "g1",
      move_index: 1,
      attempted_move: "e2e4",
      ...overrides,
    };
  }

  test("correct move → correct=true, next_due in future, stability written", () => {
    insertGame(db, "g1", "alice", "alice", "bob");
    // analysis row at move_index=0 (before-position for move 1)
    insertAnalysis(db, "g1", 0, FEN0, "e2e4");

    const now = new Date();
    const result = processDrillAttempt(db, makeBody({ attempted_move: "e2e4" }), now);

    expect("error" in result).toBe(false);
    if ("error" in result) {return;}

    expect(result.correct).toBe(true);
    expect(result.best_move).toBe("e2e4");
    expect(result.next_due).toBeGreaterThan(Math.floor(now.getTime() / 1000));

    // Row should be persisted in drill_attempts
    const row = db
      .prepare(`SELECT stability, difficulty, state FROM drill_attempts WHERE game_id = 'g1' AND move_index = 1`)
      .get() as { stability: number; difficulty: number; state: number } | null;
    expect(row).not.toBeNull();
    expect(row?.stability).toBeGreaterThan(0);
    expect(row?.difficulty).toBeGreaterThan(0);
    // State 1 = Learning (new card answered correctly)
    expect(row?.state).toBe(1);
  });

  test("wrong move → correct=false, next_due is near-term (Again rating)", () => {
    insertGame(db, "g1", "alice", "alice", "bob");
    insertAnalysis(db, "g1", 0, FEN0, "e2e4");

    const now = new Date();
    const result = processDrillAttempt(db, makeBody({ attempted_move: "d2d4" }), now);

    expect("error" in result).toBe(false);
    if ("error" in result) {return;}

    expect(result.correct).toBe(false);
    expect(result.best_move).toBe("e2e4");
    // Again → short interval (≤ 10 minutes = 600 seconds from now)
    const secsFromNow = result.next_due - Math.floor(now.getTime() / 1000);
    expect(secsFromNow).toBeLessThanOrEqual(600);
  });

  test("second attempt on same position updates existing row (upsert)", () => {
    insertGame(db, "g1", "alice", "alice", "bob");
    insertAnalysis(db, "g1", 0, FEN0, "e2e4");

    const now = new Date();
    // First attempt — wrong
    processDrillAttempt(db, makeBody({ attempted_move: "d2d4" }), now);

    // Verify only 1 row exists
    const countBefore = (db
      .prepare(`SELECT COUNT(*) as n FROM drill_attempts WHERE game_id = 'g1' AND move_index = 1`)
      .get() as { n: number }).n;
    expect(countBefore).toBe(1);

    // Second attempt — correct
    const result2 = processDrillAttempt(db, makeBody({ attempted_move: "e2e4" }), new Date());
    expect("error" in result2).toBe(false);
    if ("error" in result2) {return;}
    expect(result2.correct).toBe(true);

    // Still only 1 row (upserted, not inserted again)
    const countAfter = (db
      .prepare(`SELECT COUNT(*) as n FROM drill_attempts WHERE game_id = 'g1' AND move_index = 1`)
      .get() as { n: number }).n;
    expect(countAfter).toBe(1);
  });

  test("slow correct (elapsed_ms >= 30000) uses Hard rating → shorter interval than Good", () => {
    insertGame(db, "g1-slow", "alice", "alice", "bob");
    insertAnalysis(db, "g1-slow", 0, FEN0, "e2e4");

    insertGame(db, "g2-fast", "alice", "alice", "bob");
    insertAnalysis(db, "g2-fast", 0, FEN0, "e2e4");

    const now = new Date();

    const slowResult = processDrillAttempt(
      db,
      { username: "alice", game_id: "g1-slow", move_index: 1, attempted_move: "e2e4", elapsed_ms: 35_000 },
      now,
    );
    const fastResult = processDrillAttempt(
      db,
      { username: "alice", game_id: "g2-fast", move_index: 1, attempted_move: "e2e4", elapsed_ms: 5_000 },
      now,
    );

    expect("error" in slowResult).toBe(false);
    expect("error" in fastResult).toBe(false);
    if ("error" in slowResult || "error" in fastResult) {return;}

    // Hard rating → shorter interval than Good
    expect(slowResult.next_due).toBeLessThanOrEqual(fastResult.next_due);
  });

  test("position not in analysis table → returns 404 error", () => {
    insertGame(db, "g1", "alice", "alice", "bob");
    // No analysis row at move_index = 0

    const result = processDrillAttempt(db, makeBody({ attempted_move: "e2e4" }), new Date());

    expect("error" in result).toBe(true);
    if (!("error" in result)) {return;}
    expect(result.status).toBe(404);
    expect(result.error).toBe("Position not analyzed");
  });

  test("motifs are returned for the position", () => {
    insertGame(db, "g1", "alice", "alice", "bob");
    insertAnalysis(db, "g1", 0, FEN0, "e2e4");
    insertBlunderTag(db, "g1", 1, "fork");
    insertBlunderTag(db, "g1", 1, "pin");

    const result = processDrillAttempt(db, makeBody({ attempted_move: "e2e4" }), new Date());

    expect("error" in result).toBe(false);
    if ("error" in result) {return;}
    expect(result.motifs.sort()).toEqual(["fork", "pin"]);
  });
});
