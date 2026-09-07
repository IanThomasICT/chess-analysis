import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { migrations } from "../server/lib/db";
import {
  computeAndStoreMetrics,
  computeAnalysisSig,
  isMetricsStale,
  metricsAreFresh,
} from "../server/lib/metrics-store";
import { loadOpenings } from "../server/lib/openings";

loadOpenings();

function makeTestDb(): Database {
  const database = new Database(":memory:");
  database.run(`CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY, username TEXT NOT NULL, pgn TEXT NOT NULL, white TEXT, black TEXT, result TEXT, time_class TEXT, end_time INTEGER, created_at INTEGER DEFAULT (unixepoch()))`);
  database.run(`CREATE TABLE IF NOT EXISTS analysis (game_id TEXT NOT NULL, move_index INTEGER NOT NULL, fen TEXT NOT NULL, move_san TEXT, score_cp INTEGER, score_mate INTEGER, best_move TEXT, depth INTEGER, PRIMARY KEY (game_id, move_index), FOREIGN KEY (game_id) REFERENCES games(id))`);
  database.run(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);
  for (const m of migrations) {m.up(database);}
  return database;
}

function seedGame(db: Database): void {
  db.prepare(
    `INSERT INTO games (id, username, pgn, white, black, result, time_class, end_time, is_standard)
     VALUES ('g1', 'alice', '1. e4 e5 1-0', 'alice', 'bob', '1-0', 'blitz', 1700000000, 1)`,
  ).run();

  const insert = db.prepare(
    `INSERT INTO analysis (game_id, move_index, multipv_rank, fen, fen_key, move_san, score_cp, score_mate, best_move, pv, depth)
     VALUES ('g1', ?, ?, ?, NULL, ?, ?, NULL, 'e2e4', NULL, 20)`,
  );
  // White (alice) blunders + an opponent blunder + a critical rank-2 gap.
  const cps = [10, -10, 10, -10, 10, -10, 300, -300, 300, -300, 10, -10];
  cps.forEach((cp, i) => {
    insert.run(i, 1, `fen_${String(i)}`, i > 0 ? `m${String(i)}` : null, cp);
  });
  // rank-2 at position 8 (White to move): best (300) far better than 2nd (0).
  insert.run(8, 2, "fen_8", null, 0);
}

let db: Database;
beforeEach(() => {
  db = makeTestDb();
});

describe("computeAnalysisSig + isMetricsStale", () => {
  it("builds a deterministic signature", () => {
    expect(computeAnalysisSig(20, 12)).toBe("20:12");
  });
  it("null row is stale; matching version+sig is fresh", () => {
    expect(isMetricsStale(null, "20:12")).toBe(true);
    expect(isMetricsStale({ metrics_version: 2, analysis_sig: "20:12" }, "20:12")).toBe(false);
    expect(isMetricsStale({ metrics_version: 1, analysis_sig: "20:12" }, "20:12")).toBe(true);
    expect(isMetricsStale({ metrics_version: 2, analysis_sig: "18:12" }, "20:12")).toBe(true);
  });
});

describe("computeAndStoreMetrics", () => {
  it("writes game_metrics_ext + game_metrics and seeds the drill queue", () => {
    seedGame(db);
    const derived = computeAndStoreMetrics(db, "g1");
    expect(derived).not.toBeNull();

    const ext = db.prepare("SELECT * FROM game_metrics_ext WHERE game_id = 'g1'").get() as
      | { metrics_version: number; user_moves: number; critical_positions: number }
      | null;
    expect(ext).not.toBeNull();
    expect(ext?.metrics_version).toBe(2);
    expect(ext?.user_moves).toBeGreaterThan(0);

    const basic = db.prepare("SELECT metrics_version FROM game_metrics WHERE game_id = 'g1'").get() as
      | { metrics_version: number }
      | null;
    expect(basic?.metrics_version).toBe(2);

    const drillCount = db
      .prepare("SELECT COUNT(*) AS c FROM drill_attempts WHERE game_id = 'g1'")
      .get() as { c: number };
    expect(drillCount.c).toBeGreaterThan(0);
  });

  it("is idempotent: a second call leaves the cache fresh (no rewrite needed)", () => {
    seedGame(db);
    computeAndStoreMetrics(db, "g1");
    const row = db
      .prepare("SELECT metrics_version, analysis_sig FROM game_metrics_ext WHERE game_id = 'g1'")
      .get() as { metrics_version: number; analysis_sig: string };
    expect(isMetricsStale(row, row.analysis_sig)).toBe(false);

    // Second call should still succeed and keep the row current.
    const again = computeAndStoreMetrics(db, "g1");
    expect(again).not.toBeNull();
  });

  it("returns null for an unanalyzed game", () => {
    db.prepare(
      `INSERT INTO games (id, username, pgn, white, black, result, time_class, end_time, is_standard)
       VALUES ('empty', 'alice', '1. e4 e5 1-0', 'alice', 'bob', '1-0', 'blitz', 1, 1)`,
    ).run();
    expect(computeAndStoreMetrics(db, "empty")).toBeNull();
  });
});

describe("metricsAreFresh (resume fast-path)", () => {
  it("false before metrics are built, true after, without rebuilding", () => {
    seedGame(db);
    // No ext row yet → not fresh, must compute.
    expect(metricsAreFresh(db, "g1")).toBe(false);

    computeAndStoreMetrics(db, "g1");
    // Now the cache exists and the cheap sig check agrees it's current.
    expect(metricsAreFresh(db, "g1")).toBe(true);
  });

  it("goes stale when the underlying analysis changes (sig mismatch)", () => {
    seedGame(db);
    computeAndStoreMetrics(db, "g1");
    expect(metricsAreFresh(db, "g1")).toBe(true);

    // Deepen an analyzed position → MIN(depth) drops → analysis_sig changes.
    db.prepare("UPDATE analysis SET depth = 8 WHERE game_id = 'g1' AND move_index = 0 AND multipv_rank = 1").run();
    expect(metricsAreFresh(db, "g1")).toBe(false);
  });

  it("false for an unanalyzed game", () => {
    db.prepare(
      `INSERT INTO games (id, username, pgn, white, black, result, time_class, end_time, is_standard)
       VALUES ('empty', 'alice', '1. e4 e5 1-0', 'alice', 'bob', '1-0', 'blitz', 1, 1)`,
    ).run();
    expect(metricsAreFresh(db, "empty")).toBe(false);
  });
});
