import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { migrations } from "../server/lib/db";
import {
  resultForUser,
  conversionFlags,
  resultQuality,
  listGameMetrics,
} from "../server/routes/metrics";

function makeDb(): Database {
  const db = new Database(":memory:");
  db.run(`CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY, username TEXT NOT NULL, pgn TEXT NOT NULL, white TEXT, black TEXT, result TEXT, time_class TEXT, end_time INTEGER, created_at INTEGER DEFAULT (unixepoch()))`);
  db.run(`CREATE TABLE IF NOT EXISTS analysis (game_id TEXT NOT NULL, move_index INTEGER NOT NULL, fen TEXT NOT NULL, move_san TEXT, score_cp INTEGER, score_mate INTEGER, best_move TEXT, depth INTEGER, PRIMARY KEY (game_id, move_index))`);
  db.run(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);
  for (const m of migrations) {m.up(db);}
  return db;
}

function seedGame(
  db: Database,
  id: string,
  opts: { white: string; result: string; endTime: number; userElo: number; timeClass?: string },
): void {
  db.prepare(
    `INSERT INTO games (id, username, pgn, white, black, result, time_class, end_time, user_elo, is_standard)
     VALUES (?, 'alice', '1. e4 e5', ?, ?, ?, ?, ?, ?, 1)`,
  ).run(
    id,
    opts.white,
    opts.white === "alice" ? "bob" : "alice",
    opts.result,
    opts.timeClass ?? "blitz",
    opts.endTime,
    opts.userElo,
  );
}

function seedMetrics(
  db: Database,
  id: string,
  accWhite: number,
  peak: number,
  trough: number,
): void {
  db.prepare(
    `INSERT INTO game_metrics (game_id, accuracy_white, accuracy_black, blunders_white, mistakes_white, inaccuracies_white, blunders_black, mistakes_black, inaccuracies_black, acl_white, acl_black, computed_at, metrics_version)
     VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, 20, 25, 1, 2)`,
  ).run(id, accWhite, 70);
  db.prepare(
    `INSERT INTO game_metrics_ext (game_id, metrics_version, analysis_sig, multipv_max, peak_eval_wp, trough_eval_wp, time_trouble_moves, critical_positions, max_blunder_run, user_moves, clocks_available, engine_depth_min, out_of_book_eco_fallback)
     VALUES (?, 2, '20:10', 3, ?, ?, 2, 4, 1, 20, 1, 20, 1)`,
  ).run(id, peak, trough);
}

describe("resultForUser", () => {
  it("maps results from the user's color", () => {
    expect(resultForUser("1-0", true)).toBe("win");
    expect(resultForUser("1-0", false)).toBe("loss");
    expect(resultForUser("0-1", false)).toBe("win");
    expect(resultForUser("1/2-1/2", true)).toBe("draw");
  });
});

describe("conversionFlags", () => {
  it("flags converted wins and saves", () => {
    expect(conversionFlags("win", 90, 50)).toMatchObject({ reachedWinning: true, converted: true, saved: false });
    expect(conversionFlags("draw", 60, 10)).toMatchObject({ reachedLosing: true, saved: true });
    expect(conversionFlags("loss", 60, 10)).toMatchObject({ saved: false });
    expect(conversionFlags("win", null, null)).toMatchObject({ reachedWinning: false, converted: false });
  });
});

describe("resultQuality", () => {
  it("classifies the six outcomes", () => {
    expect(resultQuality("win", 90, false)).toBe("clean_win");
    expect(resultQuality("win", 50, false)).toBe("swindle_win");
    expect(resultQuality("win", 90, true)).toBe("swindle_win");
    expect(resultQuality("loss", 85, false)).toBe("unlucky_loss");
    expect(resultQuality("loss", 50, false)).toBe("clean_loss");
    expect(resultQuality("draw", null, true)).toBe("hold_draw");
    expect(resultQuality("draw", null, false)).toBe("even_draw");
  });
});

describe("listGameMetrics", () => {
  it("returns newest-first with per-time-class Elo delta", () => {
    const db = makeDb();
    seedGame(db, "g1", { white: "alice", result: "1-0", endTime: 100, userElo: 1500 });
    seedGame(db, "g2", { white: "bob", result: "1-0", endTime: 200, userElo: 1512 });
    seedMetrics(db, "g1", 92, 90, 40);
    seedMetrics(db, "g2", 60, 50, 10);

    const list = listGameMetrics(db, "alice");
    expect(list).toHaveLength(2);
    // newest-first
    expect(list[0].gameId).toBe("g2");
    // g2: alice is black, white won → loss; eloDelta = 1512 - 1500 = 12
    expect(list[0].result).toBe("loss");
    expect(list[0].eloDelta).toBe(12);
    // g1 is the first game in its class → no delta
    expect(list[1].eloDelta).toBeNull();
    expect(list[1].result).toBe("win");
    expect(list[1].converted).toBe(true);
    expect(list[0].saved).toBe(false);
    expect(list[0].timeTroubleFlag).toBe(true);
  });
});
