import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import type { Migration } from "../server/lib/db";
import { backfillGameHeaders, backfillAnalysisFenKeys, backfillMotifs } from "../server/lib/backfill";
import { fenKey } from "../server/lib/engine";
import { loadOpenings } from "../server/lib/openings";

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
      multipv_rank INTEGER NOT NULL DEFAULT 1,
      fen TEXT NOT NULL,
      fen_key TEXT,
      move_san TEXT,
      score_cp INTEGER,
      score_mate INTEGER,
      best_move TEXT NOT NULL DEFAULT '',
      pv TEXT,
      depth INTEGER,
      PRIMARY KEY (game_id, move_index, multipv_rank),
      FOREIGN KEY (game_id) REFERENCES games(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS blunder_tags (
      game_id TEXT NOT NULL,
      move_index INTEGER NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY (game_id, move_index, tag)
    )
  `);

  db.run(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);

  // Run migration #2 to add the new columns
  migration2.up(db);

  // Run migration #3 — index on analysis.fen
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_analysis_fen ON analysis(fen)",
  );

  // Run migration #6 — fen_key index (column already in schema above)
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_analysis_fen_key ON analysis(fen_key)",
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

const SICILIAN_NO_ECO_PGN = `[Event "Live Chess"]
[White "Alice"]
[Black "Bob"]
[WhiteElo "1600"]
[BlackElo "1550"]
[Result "1-0"]

1. e4 c5 2. Nf3 1-0`;

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

  test("game with missing ECO header — hybrid fallback populates eco/opening from moves", () => {
    insertGame(db, "g1", "alice", "Alice", "Bob", NO_ECO_PGN);

    backfillGameHeaders(db);

    const row = getGame(db, "g1");
    // Hybrid fallback: 1. e4 e5 → C20 "King's Pawn Game"
    expect(row?.eco).toBe("C20");
    expect(row?.opening).toBe("King's Pawn Game");
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

  test("hybrid fallback: Sicilian moves with no ECO header → eco starts with B, name contains Sicilian", () => {
    loadOpenings();
    insertGame(db, "g1", "alice", "Alice", "Bob", SICILIAN_NO_ECO_PGN);

    backfillGameHeaders(db);

    const row = getGame(db, "g1");
    expect(row?.eco).not.toBeNull();
    expect(row?.eco?.startsWith("B")).toBe(true);
    expect(row?.opening).not.toBeNull();
    expect(row?.opening?.toLowerCase()).toContain("sicilian");
  });

  test("hybrid fallback: header ECO present → header value is NOT overridden", () => {
    loadOpenings();
    // FULL_PGN has ECO "C50" and Opening "Italian Game" in headers
    insertGame(db, "g1", "alice", "Alice", "Bob", FULL_PGN);

    backfillGameHeaders(db);

    const row = getGame(db, "g1");
    expect(row?.eco).toBe("C50");
    expect(row?.opening).toBe("Italian Game");
  });
});

// ---------------------------------------------------------------------------
// fenKey helper unit tests
// ---------------------------------------------------------------------------

describe("fenKey", () => {
  test("strips halfmove and fullmove counters from starting FEN", () => {
    const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    expect(fenKey(fen)).toBe("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -");
  });

  test("preserves board, side-to-move, castling, and en-passant fields exactly", () => {
    const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
    expect(fenKey(fen)).toBe("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3");
  });

  test("works for mid-game FEN with partial castling rights", () => {
    const fen = "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 4 5";
    expect(fenKey(fen)).toBe("r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq -");
  });
});

// ---------------------------------------------------------------------------
// backfillAnalysisFenKeys tests
// ---------------------------------------------------------------------------

interface AnalysisRowFenKey {
  game_id: string;
  move_index: number;
  fen_key: string | null;
}

function insertAnalysisRow(
  database: Database,
  gameId: string,
  moveIndex: number,
  fen: string,
): void {
  database
    .prepare(
      `INSERT INTO analysis (game_id, move_index, fen, best_move, depth)
       VALUES (?, ?, ?, '', 0)`,
    )
    .run(gameId, moveIndex, fen);
}

function getAnalysisFenKeys(database: Database): AnalysisRowFenKey[] {
  return database
    .prepare(
      `SELECT game_id, move_index, fen_key FROM analysis ORDER BY game_id, move_index`,
    )
    .all() as AnalysisRowFenKey[];
}

describe("backfillAnalysisFenKeys", () => {
  test("backfills 3 rows with fen_key IS NULL — returns 3, all rows populated", () => {
    // Seed a game row first (FK constraint)
    db.prepare(
      `INSERT INTO games (id, username, pgn, white, black) VALUES (?, ?, ?, ?, ?)`,
    ).run("g1", "alice", "", "Alice", "Bob");

    insertAnalysisRow(db, "g1", 0, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    insertAnalysisRow(db, "g1", 1, "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1");
    insertAnalysisRow(db, "g1", 2, "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2");

    const count = backfillAnalysisFenKeys(db);
    expect(count).toBe(3);

    const rows = getAnalysisFenKeys(db);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.fen_key).toBe("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -");
    expect(rows[1]?.fen_key).toBe("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3");
    expect(rows[2]?.fen_key).toBe("rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6");
  });

  test("re-running backfill is idempotent — returns 0 on second call", () => {
    db.prepare(
      `INSERT INTO games (id, username, pgn, white, black) VALUES (?, ?, ?, ?, ?)`,
    ).run("g2", "alice", "", "Alice", "Bob");

    insertAnalysisRow(db, "g2", 0, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");

    const first = backfillAnalysisFenKeys(db);
    expect(first).toBe(1);

    const second = backfillAnalysisFenKeys(db);
    expect(second).toBe(0);
  });

  test("starting position FEN produces correct fen_key", () => {
    db.prepare(
      `INSERT INTO games (id, username, pgn, white, black) VALUES (?, ?, ?, ?, ?)`,
    ).run("g3", "alice", "", "Alice", "Bob");

    const startFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    insertAnalysisRow(db, "g3", 0, startFen);

    backfillAnalysisFenKeys(db);

    const rows = getAnalysisFenKeys(db);
    const row = rows.find((r) => r.game_id === "g3" && r.move_index === 0);
    expect(row?.fen_key).toBe("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -");
  });

  test("returns 0 when no rows have fen_key IS NULL", () => {
    const count = backfillAnalysisFenKeys(db);
    expect(count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// backfillMotifs tests
// ---------------------------------------------------------------------------

// One-move PGN: 1. e4 → positions 0 (start) and 1 (after e4)
const ONE_MOVE_PGN = `[White "A"][Black "B"][Result "*"]

1. e4 *`;

// Two-move PGN: 1. e4 e5 → positions 0, 1, 2
const TWO_MOVE_PGN = `[White "A"][Black "B"][Result "*"]

1. e4 e5 *`;

const START_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_E4_FEN =
  "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";

function insertGameForMotif(
  database: Database,
  gameId: string,
  pgn: string = ONE_MOVE_PGN,
): void {
  database
    .prepare(
      `INSERT INTO games (id, username, pgn, white, black, white_elo, black_elo, user_elo)
       VALUES (?, ?, ?, ?, ?, 1500, 1500, 1500)`,
    )
    .run(gameId, "alice", pgn, "A", "B");
}

function insertAnalysisForMotif(
  database: Database,
  gameId: string,
  moveIndex: number,
  fen: string,
  opts: {
    score_cp?: number | null;
    score_mate?: number | null;
    best_move?: string;
    pv?: string | null;
  } = {},
): void {
  database
    .prepare(
      `INSERT INTO analysis
         (game_id, move_index, multipv_rank, fen, score_cp, score_mate, best_move, pv, depth)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, 20)`,
    )
    .run(
      gameId,
      moveIndex,
      fen,
      opts.score_cp ?? null,
      opts.score_mate ?? null,
      opts.best_move ?? "",
      opts.pv ?? null,
    );
}

function getBlunderTags(
  database: Database,
  gameId: string,
): Array<{ move_index: number; tag: string }> {
  return database
    .prepare(
      `SELECT move_index, tag FROM blunder_tags WHERE game_id = ? ORDER BY move_index, tag`,
    )
    .all(gameId) as Array<{ move_index: number; tag: string }>;
}

describe("backfillMotifs", () => {
  test("missed mate-in-2 → returns 1, blunder_tags has missed_mate", () => {
    insertGameForMotif(db, "g1");
    // move_index 0: white has mate-in-2 (scoreMateBefore=2)
    insertAnalysisForMotif(db, "g1", 0, START_FEN, {
      score_mate: 2,
      best_move: "e2e4",
    });
    // move_index 1: after white plays e4, mate is gone (scoreMateAfter=null, cp=0)
    insertAnalysisForMotif(db, "g1", 1, AFTER_E4_FEN, {
      score_cp: 0,
      best_move: "e7e5",
    });

    const count = backfillMotifs(db);
    expect(count).toBe(1);

    const tags = getBlunderTags(db, "g1");
    const tagNames = tags.map((t) => t.tag);
    expect(tagNames).toContain("missed_mate");
  });

  test("no mistakes/blunders → returns 1, no blunder_tags inserted", () => {
    insertGameForMotif(db, "g2");
    // Both positions equal — no eval swing
    insertAnalysisForMotif(db, "g2", 0, START_FEN, {
      score_cp: 0,
      best_move: "e2e4",
    });
    insertAnalysisForMotif(db, "g2", 1, AFTER_E4_FEN, {
      score_cp: 0,
      best_move: "e7e5",
    });

    const count = backfillMotifs(db);
    expect(count).toBe(1);

    const tags = getBlunderTags(db, "g2");
    expect(tags).toHaveLength(0);
  });

  test("re-running is idempotent — second call returns 0", () => {
    insertGameForMotif(db, "g3");
    insertAnalysisForMotif(db, "g3", 0, START_FEN, {
      score_mate: 2,
      best_move: "e2e4",
    });
    insertAnalysisForMotif(db, "g3", 1, AFTER_E4_FEN, {
      score_cp: 0,
      best_move: "e7e5",
    });

    const first = backfillMotifs(db);
    expect(first).toBe(1);

    const second = backfillMotifs(db);
    expect(second).toBe(0);
  });

  test("limit parameter respected — seed 5 games, call with limit=2 → 2 processed", () => {
    for (let i = 1; i <= 5; i++) {
      const gameId = `limit_g${String(i)}`;
      insertGameForMotif(db, gameId, TWO_MOVE_PGN);
      // Flat eval — no blunders, but game will still be processed
      insertAnalysisForMotif(db, gameId, 0, START_FEN, {
        score_cp: 0,
        best_move: "e2e4",
      });
      insertAnalysisForMotif(db, gameId, 1, AFTER_E4_FEN, {
        score_cp: 0,
        best_move: "e7e5",
      });
    }

    const count = backfillMotifs(db, 2);
    expect(count).toBe(2);
  });
});
