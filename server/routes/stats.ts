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

// ---------------------------------------------------------------------------
// Elo trend
// ---------------------------------------------------------------------------

export interface EloTrendPoint {
  t: number;   // unix epoch seconds
  elo: number;
}

interface EloTrendRow {
  end_time: number;
  user_elo: number;
}

const TIME_CLASS_PATTERN = /^(bullet|blitz|rapid|daily)$/;

/**
 * Returns ascending-time series of user_elo for the given time class.
 * Filters out rows where user_elo IS NULL.
 */
export function computeEloTrend(
  database: Database,
  username: string,
  timeClass: string,
): EloTrendPoint[] {
  const rows = database
    .prepare(`
      SELECT end_time, user_elo FROM games
       WHERE lower(username) = lower(?) AND time_class = ? AND user_elo IS NOT NULL
       ORDER BY end_time ASC
    `)
    .all(username, timeClass) as EloTrendRow[];
  return rows.map((r) => ({ t: r.end_time, elo: r.user_elo }));
}

stats.get("/stats/:username/elo-trend", (c) => {
  const username = c.req.param("username");
  const timeClass = c.req.query("time_class") ?? "blitz";
  if (!USERNAME_PATTERN.test(username)) {
    return c.json({ error: "Invalid username format" }, 400);
  }
  if (!TIME_CLASS_PATTERN.test(timeClass)) {
    return c.json({ error: "Invalid time_class" }, 400);
  }
  return c.json(computeEloTrend(db, username, timeClass));
});

// ---------------------------------------------------------------------------
// ACL trend
// ---------------------------------------------------------------------------

export interface AclTrendPoint {
  t: number;   // unix epoch seconds
  acl: number;
}

interface AclTrendRow {
  end_time: number;
  acl_white: number;
  acl_black: number;
  white: string;
}

/**
 * Returns ascending-time series of per-game ACL for the user's side
 * (white ACL if user played white, black ACL otherwise).
 * Only games that have a matching game_metrics row are included.
 */
export function computeAclTrend(
  database: Database,
  username: string,
  timeClass: string,
): AclTrendPoint[] {
  const lower = username.toLowerCase();
  const rows = database
    .prepare(`
      SELECT g.end_time, gm.acl_white, gm.acl_black, g.white
        FROM games g
        JOIN game_metrics gm ON g.id = gm.game_id
       WHERE lower(g.username) = ? AND g.time_class = ?
       ORDER BY g.end_time ASC
    `)
    .all(lower, timeClass) as AclTrendRow[];
  return rows.map((r) => ({
    t: r.end_time,
    acl: r.white.toLowerCase() === lower ? r.acl_white : r.acl_black,
  }));
}

stats.get("/stats/:username/acl-trend", (c) => {
  const username = c.req.param("username");
  const timeClass = c.req.query("time_class") ?? "blitz";
  if (!USERNAME_PATTERN.test(username)) {
    return c.json({ error: "Invalid username format" }, 400);
  }
  if (!TIME_CLASS_PATTERN.test(timeClass)) {
    return c.json({ error: "Invalid time_class" }, 400);
  }
  return c.json(computeAclTrend(db, username, timeClass));
});

// ---------------------------------------------------------------------------
// Time-of-day bucketing
// ---------------------------------------------------------------------------

export interface TimeOfDayBucket {
  hour: number;
  day: number;
  games: number;
  wins: number;
  win_rate: number;
}

interface RawRow {
  end_time: number;
  result: string;
  white: string;
  black: string;
}

const DAY_LOOKUP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Bucket games by (hour, day-of-week) in the USER_TZ timezone (read at call
 * time so tests can override process.env.USER_TZ before calling).
 * Returns one entry per non-empty bucket; missing buckets are omitted.
 */
export function computeByTimeOfDay(
  database: Database,
  username: string,
): TimeOfDayBucket[] {
  const lower = username.toLowerCase();
  const rows = database
    .prepare(`
      SELECT end_time, result, white, black FROM games
       WHERE lower(username) = ? AND end_time IS NOT NULL
    `)
    .all(lower) as RawRow[];

  const userTz = process.env.USER_TZ ?? "America/Los_Angeles";

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: userTz,
    hour: "numeric",
    weekday: "short",
    hour12: false,
  });

  interface Acc { games: number; wins: number }
  const buckets = new Map<string, Acc>(); // key = "${day}|${hour}"

  for (const r of rows) {
    const date = new Date(r.end_time * 1000);
    const parts = formatter.formatToParts(date);
    let hour = 0;
    let weekday: string | null = null;
    for (const p of parts) {
      if (p.type === "hour") {
        hour = parseInt(p.value, 10);
        if (hour === 24) {hour = 0;}
      } else if (p.type === "weekday") {
        weekday = p.value;
      }
    }
    if (weekday === null) {continue;}
    const day = DAY_LOOKUP[weekday] ?? 0;
    const key = `${day}|${hour}`;

    const isWhite = r.white.toLowerCase() === lower;
    const userWon =
      (isWhite && r.result === "1-0") || (!isWhite && r.result === "0-1");

    const acc = buckets.get(key) ?? { games: 0, wins: 0 };
    acc.games += 1;
    if (userWon) {acc.wins += 1;}
    buckets.set(key, acc);
  }

  const result: TimeOfDayBucket[] = [];
  for (const [key, acc] of buckets) {
    const [dayStr, hourStr] = key.split("|");
    result.push({
      day: parseInt(dayStr, 10),
      hour: parseInt(hourStr, 10),
      games: acc.games,
      wins: acc.wins,
      win_rate: acc.games > 0 ? acc.wins / acc.games : 0,
    });
  }
  return result;
}

stats.get("/stats/:username/by-time-of-day", (c) => {
  const username = c.req.param("username");
  if (!USERNAME_PATTERN.test(username)) {
    return c.json({ error: "Invalid username format" }, 400);
  }
  return c.json(computeByTimeOfDay(db, username));
});

// ---------------------------------------------------------------------------
// Win-rate slice
// ---------------------------------------------------------------------------

export type Slice = "color" | "time_class" | "rating_bucket" | "opening";

const SLICE_PATTERN = /^(color|time_class|rating_bucket|opening)$/;

export interface WinRateSliceRow {
  key: string;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  win_rate: number;
  avg_accuracy: number | null;
  opening?: string;
}

interface RawSliceRow {
  key: string | null;
  opening: string | null;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  avg_accuracy: number | null;
}

export function computeWinRateSlice(
  database: Database,
  username: string,
  slice: Slice,
  from?: number,
  to?: number,
): WinRateSliceRow[] {
  const lower = username.toLowerCase();

  // Build the slice-key expression per slice type
  let keyExpr: string;
  let openingExpr = "NULL AS opening";
  switch (slice) {
    case "color":
      keyExpr = "CASE WHEN lower(g.white) = ? THEN 'white' ELSE 'black' END";
      break;
    case "time_class":
      keyExpr = "COALESCE(g.time_class, 'unknown')";
      break;
    case "rating_bucket":
      // Diff = opponent_elo - user_elo.
      // Buckets: <-200, -200..-100, ±100, +100..+200, >+200.
      keyExpr = `
        CASE
          WHEN g.user_elo IS NULL THEN 'unrated'
          WHEN (CASE WHEN lower(g.white) = ? THEN g.black_elo ELSE g.white_elo END) IS NULL THEN 'unrated'
          ELSE
            CASE
              WHEN ((CASE WHEN lower(g.white) = ? THEN g.black_elo ELSE g.white_elo END) - g.user_elo) < -200 THEN '<-200'
              WHEN ((CASE WHEN lower(g.white) = ? THEN g.black_elo ELSE g.white_elo END) - g.user_elo) < -100 THEN '-200..-100'
              WHEN ((CASE WHEN lower(g.white) = ? THEN g.black_elo ELSE g.white_elo END) - g.user_elo) <=  100 THEN '±100'
              WHEN ((CASE WHEN lower(g.white) = ? THEN g.black_elo ELSE g.white_elo END) - g.user_elo) <=  200 THEN '+100..+200'
              ELSE '>+200'
            END
        END
      `;
      break;
    case "opening":
      keyExpr = "COALESCE(g.eco, 'unknown')";
      openingExpr = "g.opening AS opening";
      break;
  }

  // Bind parameters for keyExpr placeholders
  const keyBinds: string[] = [];
  if (slice === "color") {keyBinds.push(lower);}
  else if (slice === "rating_bucket") {keyBinds.push(lower, lower, lower, lower, lower);}

  const accuracyExpr = "CASE WHEN lower(g.white) = ? THEN gm.accuracy_white ELSE gm.accuracy_black END";

  const winsExpr = `SUM(CASE
    WHEN (lower(g.white) = ? AND g.result = '1-0') OR (lower(g.black) = ? AND g.result = '0-1')
    THEN 1 ELSE 0 END)`;
  const drawsExpr = `SUM(CASE WHEN g.result = '1/2-1/2' THEN 1 ELSE 0 END)`;
  const lossesExpr = `SUM(CASE
    WHEN (lower(g.white) = ? AND g.result = '0-1') OR (lower(g.black) = ? AND g.result = '1-0')
    THEN 1 ELSE 0 END)`;

  const whereClauses: string[] = [`lower(g.username) = ?`];
  const whereBinds: Array<string | number> = [lower];
  if (from !== undefined) {
    whereClauses.push("g.end_time >= ?");
    whereBinds.push(from);
  }
  if (to !== undefined) {
    whereClauses.push("g.end_time <= ?");
    whereBinds.push(to);
  }

  const sql = `
    SELECT
      ${keyExpr} AS key,
      ${openingExpr},
      COUNT(*) AS games,
      ${winsExpr} AS wins,
      ${drawsExpr} AS draws,
      ${lossesExpr} AS losses,
      AVG(${accuracyExpr}) AS avg_accuracy
    FROM games g
    LEFT JOIN game_metrics gm ON g.id = gm.game_id
    WHERE ${whereClauses.join(" AND ")}
    GROUP BY key${slice === "opening" ? ", g.opening" : ""}
    ORDER BY games DESC
  `;

  // Final bind order:
  //   keyBinds (keyExpr placeholders)
  //   then SELECT placeholders: winsExpr (2×lower), lossesExpr (2×lower), accuracyExpr (1×lower)
  //   then whereBinds
  const allBinds: Array<string | number> = [
    ...keyBinds,
    lower, lower, // winsExpr
    lower, lower, // lossesExpr
    lower,        // accuracyExpr
    ...whereBinds,
  ];

  const rows = database.prepare(sql).all(...allBinds) as RawSliceRow[];

  return rows.map((r) => ({
    key: r.key ?? "unknown",
    games: r.games,
    wins: r.wins,
    draws: r.draws,
    losses: r.losses,
    win_rate: r.games > 0 ? r.wins / r.games : 0,
    avg_accuracy: r.avg_accuracy,
    ...(slice === "opening" && r.opening !== null ? { opening: r.opening } : {}),
  }));
}

stats.get("/stats/:username/win-rate", (c) => {
  const username = c.req.param("username");
  if (!USERNAME_PATTERN.test(username)) {
    return c.json({ error: "Invalid username format" }, 400);
  }
  const sliceParam = c.req.query("slice") ?? "color";
  if (!SLICE_PATTERN.test(sliceParam)) {
    return c.json({ error: "Invalid slice" }, 400);
  }
  const slice = sliceParam as Slice;
  const fromStr = c.req.query("from");
  const toStr = c.req.query("to");
  const from = fromStr !== undefined ? parseInt(fromStr, 10) : undefined;
  const to = toStr !== undefined ? parseInt(toStr, 10) : undefined;
  return c.json(computeWinRateSlice(db, username, slice, from, to));
});

export default stats;
