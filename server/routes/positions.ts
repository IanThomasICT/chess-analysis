import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { db } from "../lib/db";
import { fenKey } from "../lib/engine";
import { classifyMove, cpToWinPct, mateToCp } from "../lib/metrics";

const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{1,50}$/;

export interface PositionHistoryEntry {
  game_id: string;
  move_index: number;
  end_time: number;
  white: string;
  black: string;
  result: string;
  was_blunder: boolean;
  played_move: string | null;
  best_move: string | null;
}

interface RawRow {
  game_id: string;
  move_index: number;
  fen: string;
  score_cp: number | null;
  score_mate: number | null;
  best_move: string | null;
  end_time: number;
  white: string;
  black: string;
  result: string;
}

interface NextRow {
  score_cp: number | null;
  score_mate: number | null;
  move_san: string | null;
}

function rowEvalCp(scoreCp: number | null, scoreMate: number | null): number {
  if (scoreMate !== null) {return mateToCp(scoreMate);}
  return scoreCp ?? 0;
}

export function computePositionHistory(
  database: Database,
  fen: string,
  username: string,
  limit = 50,
): PositionHistoryEntry[] {
  const key = fenKey(fen);
  const rows = database
    .prepare(`
      SELECT a.game_id, a.move_index, a.fen, a.score_cp, a.score_mate, a.best_move,
             g.end_time, g.white, g.black, g.result
        FROM analysis a
        JOIN games g ON a.game_id = g.id
       WHERE a.fen_key = ? AND lower(g.username) = lower(?)
       ORDER BY g.end_time DESC
       LIMIT ?
    `)
    .all(key, username, limit) as RawRow[];

  if (rows.length === 0) {return [];}

  // Batch-fetch all "next" analysis rows for the matching game_ids to avoid N+1.
  // Build a Map<gameId, Map<move_index, NextRow>>.
  const gameIds = Array.from(new Set(rows.map((r) => r.game_id)));
  const placeholders = gameIds.map(() => "?").join(",");
  const nextRows = database
    .prepare(`
      SELECT game_id, move_index, score_cp, score_mate, move_san
        FROM analysis
       WHERE game_id IN (${placeholders})
    `)
    .all(...gameIds) as Array<NextRow & { game_id: string; move_index: number }>;

  const byGame = new Map<string, Map<number, NextRow>>();
  for (const r of nextRows) {
    let inner = byGame.get(r.game_id);
    if (inner === undefined) {
      inner = new Map();
      byGame.set(r.game_id, inner);
    }
    inner.set(r.move_index, {
      score_cp: r.score_cp,
      score_mate: r.score_mate,
      move_san: r.move_san,
    });
  }

  return rows.map((r): PositionHistoryEntry => {
    const next = byGame.get(r.game_id)?.get(r.move_index + 1);
    let was_blunder = false;
    let played_move: string | null = null;
    if (next !== undefined) {
      played_move = next.move_san;
      const beforeCp = rowEvalCp(r.score_cp, r.score_mate);
      const afterCp = rowEvalCp(next.score_cp, next.score_mate);
      // Mover perspective: white moves from even-indexed positions (move_index even)
      const isWhiteMove = r.move_index % 2 === 0;
      const wpBefore = cpToWinPct(isWhiteMove ? beforeCp : -beforeCp);
      const wpAfter = cpToWinPct(isWhiteMove ? afterCp : -afterCp);
      was_blunder = classifyMove(wpBefore, wpAfter) === "blunder";
    }
    return {
      game_id: r.game_id,
      move_index: r.move_index,
      end_time: r.end_time,
      white: r.white,
      black: r.black,
      result: r.result,
      was_blunder,
      played_move,
      best_move: r.best_move,
    };
  });
}

const positions = new Hono();

positions.get("/positions/history", (c) => {
  const fen = c.req.query("fen");
  const username = c.req.query("username");
  if (fen === undefined || fen === "") {
    return c.json({ error: "fen required" }, 400);
  }
  if (fen.split(" ").length < 4) {
    return c.json({ error: "invalid fen" }, 400);
  }
  if (username === undefined || !USERNAME_PATTERN.test(username)) {
    return c.json({ error: "Invalid username format" }, 400);
  }
  return c.json(computePositionHistory(db, fen, username));
});

export default positions;
