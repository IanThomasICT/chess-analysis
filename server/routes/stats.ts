import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { db } from "../lib/db";

const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{1,50}$/;

const stats = new Hono();

export interface SideStats {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  win_rate: number;
  avg_accuracy: number | null;
  blunders_per_game: number | null;
}

export interface BySideResponse {
  white: SideStats;
  black: SideStats;
}

interface BySideRow {
  side: "white" | "black";
  games: number;
  wins: number;
  draws: number;
  losses: number;
  avg_accuracy: number | null;
  avg_blunders: number | null;
}

/**
 * Pure helper — computes by-side stats from the `games` + `game_metrics` join.
 * Username is lowercased before comparison.
 */
export function computeBySide(database: Database, username: string): BySideResponse {
  const lower = username.toLowerCase();
  const rows = database
    .prepare(`
      SELECT
        CASE WHEN lower(g.white) = ? THEN 'white' ELSE 'black' END AS side,
        COUNT(*) AS games,
        SUM(CASE
          WHEN (lower(g.white) = ? AND g.result = '1-0') OR (lower(g.black) = ? AND g.result = '0-1')
          THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN g.result = '1/2-1/2' THEN 1 ELSE 0 END) AS draws,
        SUM(CASE
          WHEN (lower(g.white) = ? AND g.result = '0-1') OR (lower(g.black) = ? AND g.result = '1-0')
          THEN 1 ELSE 0 END) AS losses,
        AVG(CASE WHEN lower(g.white) = ? THEN gm.accuracy_white ELSE gm.accuracy_black END) AS avg_accuracy,
        AVG(CASE WHEN lower(g.white) = ? THEN gm.blunders_white ELSE gm.blunders_black END) AS avg_blunders
      FROM games g
      LEFT JOIN game_metrics gm ON g.id = gm.game_id
      WHERE lower(g.username) = ?
      GROUP BY side
    `)
    .all(lower, lower, lower, lower, lower, lower, lower, lower) as BySideRow[];

  const empty: SideStats = {
    games: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    win_rate: 0,
    avg_accuracy: null,
    blunders_per_game: null,
  };

  const result: BySideResponse = { white: { ...empty }, black: { ...empty } };

  for (const r of rows) {
    const sideStats: SideStats = {
      games: r.games,
      wins: r.wins,
      draws: r.draws,
      losses: r.losses,
      win_rate: r.games > 0 ? r.wins / r.games : 0,
      avg_accuracy: r.avg_accuracy,
      blunders_per_game: r.avg_blunders,
    };
    result[r.side] = sideStats;
  }

  return result;
}

stats.get("/stats/:username/by-side", (c) => {
  const username = c.req.param("username");
  if (!USERNAME_PATTERN.test(username)) {
    return c.json({ error: "Invalid username format" }, 400);
  }
  return c.json(computeBySide(db, username));
});

export default stats;
