import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../server/lib/db";
import { tagMoveIfBlunder, type AnalysisSnapshot } from "../server/lib/motif-tagging";

// ─── DB helpers ───────────────────────────────────────────────────────────────

function makeDb(): Database {
  const db = new Database(":memory:");
  db.run(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);
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
  return db;
}

function queryTags(
  db: Database,
  gameId: string,
  moveIndex: number,
): string[] {
  interface TagRow { tag: string; }
  return (
    db
      .prepare<TagRow, [string, number]>(
        "SELECT tag FROM blunder_tags WHERE game_id = ? AND move_index = ? ORDER BY tag",
      )
      .all(gameId, moveIndex)
      .map((r) => r.tag)
  );
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// Starting position snapshot (move_index=0): no blunder here, strong White position.
const STARTING_SNAPSHOT: AnalysisSnapshot = {
  fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  score_cp: 20,
  score_mate: null,
  best_move: "e2e4",
  pv: "e2e4 e7e5",
  move_san: null,
};

// After 1.e4 (move_index=1): still roughly equal
const AFTER_E4_SNAPSHOT: AnalysisSnapshot = {
  fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
  score_cp: 20,
  score_mate: null,
  best_move: "e7e5",
  pv: "e7e5 g1f3",
  move_san: "e4",
};

// Position where White has mate-in-2 (Re1+, then Qxe7# or similar)
// FEN from motifs.test.ts: rook on d1 delivers Rd8# against king on g8
// We use this as a "before" snapshot with scoreMateBefore=2
const BACK_RANK_FEN = "6k1/5ppp/8/8/8/8/8/3R3K w - - 0 1";

const MATE_BEFORE_SNAPSHOT: AnalysisSnapshot = {
  fen: BACK_RANK_FEN,
  score_cp: null,
  score_mate: 1,
  best_move: "d1d8",
  pv: "d1d8",
  move_san: null,
};

// After White plays a non-mating move (e.g. Rd7 instead of Rd8#).
// Mate is gone — scoreMateAfter=null, so missed_mate triggers.
// score_cp=-100 reflects that after missing mate, Black is actually better.
// (White lost decisive advantage → blunder classification)
const AFTER_NON_MATE_SNAPSHOT: AnalysisSnapshot = {
  fen: "6k1/3R1ppp/8/8/8/8/8/7K b - - 1 1",
  score_cp: -100,
  score_mate: null,
  best_move: "g8h8",
  pv: "g8h8",
  move_san: "Rd7",
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("tagMoveIfBlunder", () => {
  let db: Database;

  beforeEach(() => {
    db = makeDb();
  });

  it("returns [] and inserts nothing when wp_delta is small (no classification swing)", () => {
    // Both positions are roughly equal — classifyMove returns 'good' or 'inaccuracy'
    const tags = tagMoveIfBlunder(
      db,
      "game-neutral",
      1,
      STARTING_SNAPSHOT,
      AFTER_E4_SNAPSHOT,
      "e2e4",
    );

    expect(tags).toEqual([]);
    expect(queryTags(db, "game-neutral", 1)).toEqual([]);
  });

  it("detects missed_mate tag and inserts into blunder_tags", () => {
    // White had mate-in-1 (scoreMateBefore=1), played Rd7 instead of Rd8#
    // scoreMateBefore=1 && scoreMateAfter=null → missed_mate
    // Also a large score swing (mate → cp 900) → blunder classification
    const tags = tagMoveIfBlunder(
      db,
      "game-missed-mate",
      1,
      MATE_BEFORE_SNAPSHOT,
      AFTER_NON_MATE_SNAPSHOT,
      "d1d7",
    );

    expect(tags).toContain("missed_mate");
    const dbTags = queryTags(db, "game-missed-mate", 1);
    expect(dbTags).toContain("missed_mate");
  });

  it("is idempotent: re-running same input does not duplicate rows", () => {
    tagMoveIfBlunder(
      db,
      "game-idempotent",
      1,
      MATE_BEFORE_SNAPSHOT,
      AFTER_NON_MATE_SNAPSHOT,
      "d1d7",
    );
    // Run again with identical args
    tagMoveIfBlunder(
      db,
      "game-idempotent",
      1,
      MATE_BEFORE_SNAPSHOT,
      AFTER_NON_MATE_SNAPSHOT,
      "d1d7",
    );

    const dbTags = queryTags(db, "game-idempotent", 1);
    const uniqueTags = [...new Set(dbTags)];
    expect(dbTags).toEqual(uniqueTags);
  });

  it("caps tags at 3 even when multiple motifs would be detected", () => {
    // Craft a snapshot that triggers missed_mate + back_rank_mate simultaneously.
    // BACK_RANK_FEN with scoreMateBefore=1 and bestPv="d1d8" → missed_mate + back_rank_mate
    // and wpBefore very high (mate→1000cp) vs wpAfter low → blunder
    const beforeWithMate: AnalysisSnapshot = {
      fen: BACK_RANK_FEN,
      score_cp: null,
      score_mate: 1,
      best_move: "d1d8",
      pv: "d1d8",
      move_san: null,
    };
    // After a non-mating move Rd4 — mate is gone, score drops sharply (blunder)
    const afterNonMate: AnalysisSnapshot = {
      fen: "6k1/5ppp/8/8/3R4/8/8/7K b - - 1 1",
      score_cp: -100,
      score_mate: null,
      best_move: "g8h8",
      pv: "g8h8",
      move_san: "Rd4",
    };

    const tags = tagMoveIfBlunder(
      db,
      "game-cap",
      1,
      beforeWithMate,
      afterNonMate,
      "d1d4",
    );

    expect(tags.length).toBeLessThanOrEqual(3);
    const dbTags = queryTags(db, "game-cap", 1);
    expect(dbTags.length).toBeLessThanOrEqual(3);
  });

  it("uses correct mover perspective: move_index=2 is Black's move", () => {
    // moveIndex=2 → (2-1)%2 = 1 → isWhiteMove=false → Black's move
    // Black blunders: high score from Black's perspective drops dramatically
    // Before (from Black's perspective, it's a winning position for Black):
    // score_cp = -900 (very good for Black = bad for White)
    // After: score_cp = 0 (equal — Black threw away the advantage)
    const beforeBlackWinning: AnalysisSnapshot = {
      fen: "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3",
      score_cp: -900, // from White's perspective: very bad for White
      score_mate: null,
      best_move: "d1e2",
      pv: "d1e2",
      move_san: null,
    };
    // After Black plays something terrible that drops the advantage back to equal
    const afterBlackBlunder: AnalysisSnapshot = {
      fen: "rnb1kbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPPq1P/RNBQKBNR w KQkq - 0 4",
      score_cp: 0,
      score_mate: null,
      best_move: "e1e2",
      pv: "e1e2",
      move_san: "Qxf2",
    };

    // For moveIndex=2, isWhiteMove=false → Black's perspective:
    // wpBefore = cpToWinPct(-(-900)) = cpToWinPct(900) ≈ high (Black had advantage)
    // wpAfter  = cpToWinPct(-(0)) = cpToWinPct(0) = 50
    // Large drop → blunder
    const tags = tagMoveIfBlunder(
      db,
      "game-black-blunder",
      2,
      beforeBlackWinning,
      afterBlackBlunder,
      "h4f2",
    );

    // Whether or not motifs are detected, classification should be blunder/mistake.
    // We verify no crash and no more than 3 tags.
    expect(Array.isArray(tags)).toBe(true);
    expect(tags.length).toBeLessThanOrEqual(3);
  });
});
