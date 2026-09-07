import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { db } from "../lib/db";
import {
  SESSION_BREAK_MIN,
  TREND_WINDOW_GAMES,
  LOSING_WP,
  WINNING_WP,
} from "../lib/metrics-config";

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
// Accuracy trend (per-game Lichess-style accuracy for the user's side)
// ---------------------------------------------------------------------------

export interface AccuracyTrendPoint {
  t: number;   // unix epoch seconds
  accuracy: number;
}

interface AccuracyTrendRow {
  end_time: number;
  accuracy_white: number;
  accuracy_black: number;
  white: string;
}

/**
 * Returns ascending-time series of per-game accuracy for the user's side
 * (white accuracy if user played white, black accuracy otherwise).
 * Only games that have a matching game_metrics row are included.
 */
export function computeAccuracyTrend(
  database: Database,
  username: string,
  timeClass: string,
): AccuracyTrendPoint[] {
  const lower = username.toLowerCase();
  const rows = database
    .prepare(`
      SELECT g.end_time, gm.accuracy_white, gm.accuracy_black, g.white
        FROM games g
        JOIN game_metrics gm ON g.id = gm.game_id
       WHERE lower(g.username) = ? AND g.time_class = ?
       ORDER BY g.end_time ASC
    `)
    .all(lower, timeClass) as AccuracyTrendRow[];
  return rows.map((r) => ({
    t: r.end_time,
    accuracy: r.white.toLowerCase() === lower ? r.accuracy_white : r.accuracy_black,
  }));
}

stats.get("/stats/:username/accuracy-trend", (c) => {
  const username = c.req.param("username");
  const timeClass = c.req.query("time_class") ?? "blitz";
  if (!USERNAME_PATTERN.test(username)) {
    return c.json({ error: "Invalid username format" }, 400);
  }
  if (!TIME_CLASS_PATTERN.test(timeClass)) {
    return c.json({ error: "Invalid time_class" }, 400);
  }
  return c.json(computeAccuracyTrend(db, username, timeClass));
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
  from?: number,
  to?: number,
): TimeOfDayBucket[] {
  const lower = username.toLowerCase();
  const dateClauses: string[] = [];
  const dateBinds: number[] = [];
  if (from !== undefined) { dateClauses.push("end_time >= ?"); dateBinds.push(from); }
  if (to !== undefined) { dateClauses.push("end_time <= ?"); dateBinds.push(to); }
  const dateClause = dateClauses.length > 0 ? `AND ${dateClauses.join(" AND ")}` : "";
  const rows = database
    .prepare(`
      SELECT end_time, result, white, black FROM games
       WHERE lower(username) = ? AND end_time IS NOT NULL ${dateClause}
    `)
    .all(lower, ...dateBinds) as RawRow[];

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
  const fromStr = c.req.query("from");
  const toStr = c.req.query("to");
  const from = fromStr !== undefined ? parseInt(fromStr, 10) : undefined;
  const to = toStr !== undefined ? parseInt(toStr, 10) : undefined;
  return c.json(computeByTimeOfDay(db, username, from, to));
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

// ---------------------------------------------------------------------------
// Motif stats
// ---------------------------------------------------------------------------

export interface MotifStat {
  tag: string;
  count: number;
  example_game_id: string;
  example_move_index: number;
}

interface RawMotifRow {
  tag: string;
  count: number;
  example_game_id: string;
  example_move_index: number;
}

/**
 * Aggregate blunder_tags for moves the USER made (not the opponent).
 * Mover is white when (move_index - 1) is even; user_color is white when
 * lower(games.white) === lower(games.username). Only matching pairs are counted.
 */
export function computeMotifStats(
  database: Database,
  username: string,
  from?: number,
  to?: number,
): MotifStat[] {
  const lower = username.toLowerCase();
  const whereDate: string[] = [];
  const bindDate: number[] = [];
  if (from !== undefined) { whereDate.push("g.end_time >= ?"); bindDate.push(from); }
  if (to !== undefined) { whereDate.push("g.end_time <= ?"); bindDate.push(to); }
  const dateClause = whereDate.length > 0 ? `AND ${whereDate.join(" AND ")}` : "";

  const rows = database
    .prepare(`
      SELECT bt.tag AS tag,
             COUNT(*) AS count,
             MIN(bt.game_id) AS example_game_id,
             MIN(bt.move_index) AS example_move_index
        FROM blunder_tags bt
        JOIN games g ON bt.game_id = g.id
       WHERE lower(g.username) = ?
         AND (
              (lower(g.white) = lower(g.username) AND ((bt.move_index - 1) % 2) = 0)
           OR (lower(g.black) = lower(g.username) AND ((bt.move_index - 1) % 2) = 1)
         )
         ${dateClause}
       GROUP BY bt.tag
       ORDER BY count DESC
    `)
    .all(lower, ...bindDate) as RawMotifRow[];

  return rows;
}

stats.get("/stats/:username/motifs", (c) => {
  const username = c.req.param("username");
  if (!USERNAME_PATTERN.test(username)) {
    return c.json({ error: "Invalid username format" }, 400);
  }
  const fromStr = c.req.query("from");
  const toStr = c.req.query("to");
  const from = fromStr !== undefined ? parseInt(fromStr, 10) : undefined;
  const to = toStr !== undefined ? parseInt(toStr, 10) : undefined;
  return c.json(computeMotifStats(db, username, from, to));
});

// ---------------------------------------------------------------------------
// Drill progress
// ---------------------------------------------------------------------------

export interface DrillProgress {
  total_attempts: number;
  accuracy_pct: number;
  due_today: number;
  current_streak: number;
}

interface AttemptCounts {
  total: number;
  correct: number | null;
}

interface DueRow {
  count: number;
}

interface AttemptDay {
  attempted_at: number;
}

/**
 * Computes drill progress stats for a user:
 * - total_attempts: total rows in drill_attempts with attempted_at IS NOT NULL
 * - accuracy_pct: percentage of correct attempts (0..100)
 * - due_today: count of cards with due <= end of today (local time)
 * - current_streak: consecutive days (local timezone) with >= 1 correct attempt, ending today
 */
export function computeDrillProgress(database: Database, username: string): DrillProgress {
  const lower = username.toLowerCase();

  const counts = database
    .prepare(`
      SELECT COUNT(*) AS total, SUM(COALESCE(correct, 0)) AS correct
        FROM drill_attempts
       WHERE lower(username) = ? AND attempted_at IS NOT NULL
    `)
    .get(lower) as AttemptCounts;

  const total = counts.total;
  const correct = counts.correct ?? 0;

  const endOfToday = Math.floor(new Date().setHours(23, 59, 59, 999) / 1000);
  const due = database
    .prepare(`
      SELECT COUNT(*) AS count FROM drill_attempts
       WHERE lower(username) = ? AND due IS NOT NULL AND due <= ?
    `)
    .get(lower, endOfToday) as DueRow;

  // Pull distinct days (local) where the user had >= 1 correct attempt.
  const correctDays = database
    .prepare(`
      SELECT attempted_at FROM drill_attempts
       WHERE lower(username) = ? AND correct = 1 AND attempted_at IS NOT NULL
       ORDER BY attempted_at DESC
       LIMIT 365
    `)
    .all(lower) as AttemptDay[];

  // Convert each timestamp to a local day key and walk backward from today.
  const dayKeys = new Set<string>();
  for (const r of correctDays) {
    const d = new Date(r.attempted_at * 1000);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    dayKeys.add(key);
  }
  let streak = 0;
  const cursor = new Date();
  for (;;) {
    const key = `${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`;
    if (!dayKeys.has(key)) {break;}
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return {
    total_attempts: total,
    accuracy_pct: total > 0 ? (correct / total) * 100 : 0,
    due_today: due.count,
    current_streak: streak,
  };
}

stats.get("/stats/:username/drill-progress", (c) => {
  const username = c.req.param("username");
  if (!USERNAME_PATTERN.test(username)) {
    return c.json({ error: "Invalid username format" }, 400);
  }
  return c.json(computeDrillProgress(db, username));
});

// ---------------------------------------------------------------------------
// R21: Consistency — accuracy std-dev + mean
// ---------------------------------------------------------------------------

export interface ConsistencyResponse {
  accuracy_stddev: number | null;
  accuracy_mean: number | null;
  games: number;
}

interface UserAccuracyRow {
  accuracy: number;
}

/**
 * Returns population std-dev and mean of the user's per-game accuracy.
 * Only games with a game_metrics row are included.
 */
export function computeConsistency(
  database: Database,
  username: string,
): ConsistencyResponse {
  const lower = username.toLowerCase();
  const rows = database
    .prepare(`
      SELECT CASE WHEN lower(g.white) = ? THEN gm.accuracy_white ELSE gm.accuracy_black END AS accuracy
        FROM games g
        JOIN game_metrics gm ON g.id = gm.game_id
       WHERE lower(g.username) = ?
    `)
    .all(lower, lower) as UserAccuracyRow[];

  const n = rows.length;
  if (n === 0) {
    return { accuracy_stddev: null, accuracy_mean: null, games: 0 };
  }

  const sum = rows.reduce((acc, r) => acc + r.accuracy, 0);
  const mean = sum / n;
  const variance = rows.reduce((acc, r) => acc + (r.accuracy - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);

  return {
    accuracy_stddev: stddev,
    accuracy_mean: mean,
    games: n,
  };
}

stats.get("/stats/:username/consistency", (c) => {
  const username = c.req.param("username");
  if (!USERNAME_PATTERN.test(username)) {
    return c.json({ error: "Invalid username format" }, 400);
  }
  return c.json(computeConsistency(db, username));
});

// ---------------------------------------------------------------------------
// R22/D11: Session fatigue — win_rate + avg_accuracy by game index in session
// ---------------------------------------------------------------------------

export interface SessionFatigueBucket {
  game_in_session: number;
  games: number;
  wins: number;
  win_rate: number;
  avg_accuracy: number | null;
}

interface SessionGameRow {
  end_time: number;
  result: string;
  white: string;
  accuracy: number | null;
}

/**
 * Groups user games into sessions (60-min gap = new session), assigns each
 * game its 1-based index within its session, then aggregates.
 */
export function computeSessionFatigue(
  database: Database,
  username: string,
): SessionFatigueBucket[] {
  const lower = username.toLowerCase();
  const rows = database
    .prepare(`
      SELECT g.end_time,
             g.result,
             g.white,
             CASE WHEN lower(g.white) = ? THEN gm.accuracy_white ELSE gm.accuracy_black END AS accuracy
        FROM games g
        LEFT JOIN game_metrics gm ON g.id = gm.game_id
       WHERE lower(g.username) = ? AND g.end_time IS NOT NULL
       ORDER BY g.end_time ASC
    `)
    .all(lower, lower) as SessionGameRow[];

  if (rows.length === 0) {
    return [];
  }

  const SESSION_BREAK_S = SESSION_BREAK_MIN * 60;
  interface Acc { games: number; wins: number; accuracySum: number; accuracyCount: number }
  const buckets = new Map<number, Acc>();

  let prevEndTime = rows[0].end_time;
  let sessionIndex = 1;

  for (const r of rows) {
    if (r.end_time - prevEndTime >= SESSION_BREAK_S) {
      sessionIndex = 1;
    }

    const isWhite = r.white.toLowerCase() === lower;
    const userWon = (isWhite && r.result === "1-0") || (!isWhite && r.result === "0-1");

    const acc = buckets.get(sessionIndex) ?? { games: 0, wins: 0, accuracySum: 0, accuracyCount: 0 };
    acc.games += 1;
    if (userWon) { acc.wins += 1; }
    if (r.accuracy !== null) {
      acc.accuracySum += r.accuracy;
      acc.accuracyCount += 1;
    }
    buckets.set(sessionIndex, acc);

    prevEndTime = r.end_time;
    sessionIndex += 1;
  }

  const result: SessionFatigueBucket[] = [];
  for (const [idx, acc] of buckets) {
    result.push({
      game_in_session: idx,
      games: acc.games,
      wins: acc.wins,
      win_rate: acc.games > 0 ? acc.wins / acc.games : 0,
      avg_accuracy: acc.accuracyCount > 0 ? acc.accuracySum / acc.accuracyCount : null,
    });
  }
  result.sort((a, b) => a.game_in_session - b.game_in_session);
  return result;
}

stats.get("/stats/:username/session-fatigue", (c) => {
  const username = c.req.param("username");
  if (!USERNAME_PATTERN.test(username)) {
    return c.json({ error: "Invalid username format" }, 400);
  }
  return c.json(computeSessionFatigue(db, username));
});

// ---------------------------------------------------------------------------
// R23: Vs-opponent — win_rate + accuracy by rating differential bucket
// ---------------------------------------------------------------------------

export interface VsOpponentBucket {
  bucket: string;
  games: number;
  win_rate: number;
  avg_accuracy: number | null;
  avg_acl_middlegame: number | null;
}

interface VsOpponentRow {
  bucket: string;
  games: number;
  wins: number;
  avg_accuracy: number | null;
  avg_acl_middlegame: number | null;
}

/**
 * Buckets games by (opponent_elo - user_elo) differential and returns
 * win_rate + avg user accuracy + avg acl_middlegame per bucket.
 */
export function computeVsOpponent(
  database: Database,
  username: string,
  from?: number,
  to?: number,
): VsOpponentBucket[] {
  const lower = username.toLowerCase();
  const dateClauses: string[] = [];
  const dateBinds: number[] = [];
  if (from !== undefined) { dateClauses.push("g.end_time >= ?"); dateBinds.push(from); }
  if (to !== undefined) { dateClauses.push("g.end_time <= ?"); dateBinds.push(to); }
  const dateClause = dateClauses.length > 0 ? `AND ${dateClauses.join(" AND ")}` : "";
  const rows = database
    .prepare(`
      SELECT
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
        END AS bucket,
        COUNT(*) AS games,
        SUM(CASE
          WHEN (lower(g.white) = ? AND g.result = '1-0') OR (lower(g.black) = ? AND g.result = '0-1')
          THEN 1 ELSE 0 END) AS wins,
        AVG(CASE WHEN lower(g.white) = ? THEN gm.accuracy_white ELSE gm.accuracy_black END) AS avg_accuracy,
        AVG(CASE WHEN lower(g.white) = ? THEN gme.acl_middlegame ELSE gme.acl_middlegame END) AS avg_acl_middlegame
      FROM games g
      LEFT JOIN game_metrics gm ON g.id = gm.game_id
      LEFT JOIN game_metrics_ext gme ON g.id = gme.game_id
      WHERE lower(g.username) = ? ${dateClause}
      GROUP BY bucket
      ORDER BY games DESC
    `)
    .all(lower, lower, lower, lower, lower, lower, lower, lower, lower, lower, ...dateBinds) as VsOpponentRow[];

  return rows.map((r) => ({
    bucket: r.bucket,
    games: r.games,
    win_rate: r.games > 0 ? r.wins / r.games : 0,
    avg_accuracy: r.avg_accuracy,
    avg_acl_middlegame: r.avg_acl_middlegame,
  }));
}

stats.get("/stats/:username/vs-opponent", (c) => {
  const username = c.req.param("username");
  if (!USERNAME_PATTERN.test(username)) {
    return c.json({ error: "Invalid username format" }, 400);
  }
  const fromStr = c.req.query("from");
  const toStr = c.req.query("to");
  const from = fromStr !== undefined ? parseInt(fromStr, 10) : undefined;
  const to = toStr !== undefined ? parseInt(toStr, 10) : undefined;
  return c.json(computeVsOpponent(db, username, from, to));
});

// ---------------------------------------------------------------------------
// R27/D24: ACL trend — per-game ACL + rolling mean
// ---------------------------------------------------------------------------

export interface AclTrendPoint {
  t: number;
  acl: number;
  rolling: number;
}

interface AclTrendRow {
  end_time: number;
  acl_white: number;
  acl_black: number;
  white: string;
}

/**
 * Returns ascending-time series of per-game user ACL with trailing rolling mean
 * over TREND_WINDOW_GAMES games.
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

  const perGame = rows.map((r) => ({
    t: r.end_time,
    acl: r.white.toLowerCase() === lower ? r.acl_white : r.acl_black,
  }));

  return perGame.map((pt, i) => {
    const start = Math.max(0, i - TREND_WINDOW_GAMES + 1);
    const window = perGame.slice(start, i + 1);
    const sum = window.reduce((acc, p) => acc + p.acl, 0);
    const rolling = sum / window.length;
    return { t: pt.t, acl: pt.acl, rolling };
  });
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
// R28: Leak closure — motif frequency in first vs second half of games
// ---------------------------------------------------------------------------

export interface LeakClosureRow {
  tag: string;
  first_half: number;
  second_half: number;
  delta: number;
}

interface LeakHalfRow {
  tag: string;
  half: number;
  count: number;
}

/**
 * Splits user games by median end_time into older (first) and newer (second) halves.
 * Counts each motif tag's frequency per half (user-mover only, same parity as computeMotifStats).
 * delta = second_half - first_half (negative = improving).
 */
export function computeLeakClosure(
  database: Database,
  username: string,
  from?: number,
  to?: number,
): LeakClosureRow[] {
  const lower = username.toLowerCase();

  const dateClauses: string[] = [];
  const dateBinds: number[] = [];
  if (from !== undefined) { dateClauses.push("g.end_time >= ?"); dateBinds.push(from); }
  if (to !== undefined) { dateClauses.push("g.end_time <= ?"); dateBinds.push(to); }
  const dateClauseG = dateClauses.length > 0 ? `AND ${dateClauses.join(" AND ")}` : "";

  // Median bound (unprefixed `end_time` for the bare `games` query).
  const medianDateClauses: string[] = [];
  if (from !== undefined) { medianDateClauses.push("end_time >= ?"); }
  if (to !== undefined) { medianDateClauses.push("end_time <= ?"); }
  const medianDateClause = medianDateClauses.length > 0 ? `AND ${medianDateClauses.join(" AND ")}` : "";

  // Find median end_time for the windowed set of user games.
  const medianRow = database
    .prepare(`
      SELECT end_time FROM games
       WHERE lower(username) = ? AND end_time IS NOT NULL ${medianDateClause}
       ORDER BY end_time ASC
       LIMIT 1 OFFSET (SELECT COUNT(*) FROM games WHERE lower(username) = ? AND end_time IS NOT NULL ${medianDateClause}) / 2
    `)
    .get(lower, ...dateBinds, lower, ...dateBinds) as { end_time: number } | null;

  if (medianRow === null) {
    return [];
  }
  const medianTime = medianRow.end_time;

  const rows = database
    .prepare(`
      SELECT bt.tag,
             CASE WHEN g.end_time < ? THEN 1 ELSE 2 END AS half,
             COUNT(*) AS count
        FROM blunder_tags bt
        JOIN games g ON bt.game_id = g.id
       WHERE lower(g.username) = ?
         AND (
              (lower(g.white) = lower(g.username) AND ((bt.move_index - 1) % 2) = 0)
           OR (lower(g.black) = lower(g.username) AND ((bt.move_index - 1) % 2) = 1)
         )
         AND g.end_time IS NOT NULL
         ${dateClauseG}
       GROUP BY bt.tag, half
       ORDER BY bt.tag, half
    `)
    .all(medianTime, lower, ...dateBinds) as LeakHalfRow[];

  // Aggregate into tag → {first, second}
  const tagMap = new Map<string, { first_half: number; second_half: number }>();
  for (const r of rows) {
    const entry = tagMap.get(r.tag) ?? { first_half: 0, second_half: 0 };
    if (r.half === 1) {
      entry.first_half = r.count;
    } else {
      entry.second_half = r.count;
    }
    tagMap.set(r.tag, entry);
  }

  const result: LeakClosureRow[] = [];
  for (const [tag, entry] of tagMap) {
    result.push({
      tag,
      first_half: entry.first_half,
      second_half: entry.second_half,
      delta: entry.second_half - entry.first_half,
    });
  }
  return result;
}

stats.get("/stats/:username/leak-closure", (c) => {
  const username = c.req.param("username");
  if (!USERNAME_PATTERN.test(username)) {
    return c.json({ error: "Invalid username format" }, 400);
  }
  const fromStr = c.req.query("from");
  const toStr = c.req.query("to");
  const from = fromStr !== undefined ? parseInt(fromStr, 10) : undefined;
  const to = toStr !== undefined ? parseInt(toStr, 10) : undefined;
  return c.json(computeLeakClosure(db, username, from, to));
});

// ---------------------------------------------------------------------------
// R29: TPR — Tournament performance rating
// ---------------------------------------------------------------------------

export interface TprResponse {
  tpr: number | null;
  games: number;
  score: number;
  avg_opponent_elo: number | null;
}

interface TprRow {
  games: number;
  wins: number;
  draws: number;
  avg_opponent_elo: number | null;
}

// Standard FIDE dp (score% → rating difference) table
// p values from 0.01 to 0.99, rating diffs from -677 to +677
// Source: FIDE Handbook B.02 (Annex 2)
const FIDE_DP_TABLE: ReadonlyArray<readonly [number, number]> = [
  [0.01, -677], [0.02, -589], [0.03, -538], [0.04, -501], [0.05, -470],
  [0.06, -444], [0.07, -422], [0.08, -401], [0.09, -383], [0.10, -366],
  [0.11, -351], [0.12, -336], [0.13, -322], [0.14, -309], [0.15, -296],
  [0.16, -284], [0.17, -273], [0.18, -262], [0.19, -251], [0.20, -240],
  [0.21, -230], [0.22, -220], [0.23, -211], [0.24, -202], [0.25, -193],
  [0.26, -184], [0.27, -175], [0.28, -166], [0.29, -158], [0.30, -149],
  [0.31, -141], [0.32, -133], [0.33, -125], [0.34, -117], [0.35, -110],
  [0.36, -102], [0.37, -95],  [0.38, -87],  [0.39, -80],  [0.40, -72],
  [0.41, -65],  [0.42, -57],  [0.43, -50],  [0.44, -43],  [0.45, -36],
  [0.46, -29],  [0.47, -21],  [0.48, -14],  [0.49, -7],   [0.50, 0],
  [0.51, 7],    [0.52, 14],   [0.53, 21],   [0.54, 29],   [0.55, 36],
  [0.56, 43],   [0.57, 50],   [0.58, 57],   [0.59, 65],   [0.60, 72],
  [0.61, 80],   [0.62, 87],   [0.63, 95],   [0.64, 102],  [0.65, 110],
  [0.66, 117],  [0.67, 125],  [0.68, 133],  [0.69, 141],  [0.70, 149],
  [0.71, 158],  [0.72, 166],  [0.73, 175],  [0.74, 184],  [0.75, 193],
  [0.76, 202],  [0.77, 211],  [0.78, 220],  [0.79, 230],  [0.80, 240],
  [0.81, 251],  [0.82, 262],  [0.83, 273],  [0.84, 284],  [0.85, 296],
  [0.86, 309],  [0.87, 322],  [0.88, 336],  [0.89, 351],  [0.90, 366],
  [0.91, 383],  [0.92, 401],  [0.93, 422],  [0.94, 444],  [0.95, 470],
  [0.96, 501],  [0.97, 538],  [0.98, 589],  [0.99, 677],
] as const;

/**
 * FIDE rating-difference from score fraction p (0..1).
 * Uses linear interpolation between table entries; clamps at ±677.
 */
export function dpFromScore(p: number): number {
  if (p <= 0.01) { return -677; }
  if (p >= 0.99) { return 677; }

  // Find surrounding table entries
  for (let i = 0; i < FIDE_DP_TABLE.length - 1; i++) {
    const lo = FIDE_DP_TABLE[i];
    const hi = FIDE_DP_TABLE[i + 1];
    if (p >= lo[0] && p <= hi[0]) {
      // linear interpolation
      const t = (p - lo[0]) / (hi[0] - lo[0]);
      return lo[1] + t * (hi[1] - lo[1]);
    }
  }
  return 0; // p=0.5 fallback (unreachable given clamping)
}

/**
 * Computes TPR = avg_opponent_elo + dp(score_fraction).
 * Only games where user_elo and opponent elo are both non-null are included.
 */
export function computeTpr(
  database: Database,
  username: string,
  timeClass: string,
): TprResponse {
  const lower = username.toLowerCase();
  const row = database
    .prepare(`
      SELECT
        COUNT(*) AS games,
        SUM(CASE
          WHEN (lower(g.white) = ? AND g.result = '1-0') OR (lower(g.black) = ? AND g.result = '0-1')
          THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN g.result = '1/2-1/2' THEN 1 ELSE 0 END) AS draws,
        AVG(CASE WHEN lower(g.white) = ? THEN g.black_elo ELSE g.white_elo END) AS avg_opponent_elo
      FROM games g
      WHERE lower(g.username) = ?
        AND g.time_class = ?
        AND g.user_elo IS NOT NULL
        AND (CASE WHEN lower(g.white) = ? THEN g.black_elo ELSE g.white_elo END) IS NOT NULL
    `)
    .get(lower, lower, lower, lower, timeClass, lower) as TprRow;

  const games = row.games;
  const wins = row.wins;
  const draws = row.draws;
  const avgOppElo = row.avg_opponent_elo;

  if (games === 0 || avgOppElo === null) {
    return { tpr: null, games, score: 0, avg_opponent_elo: null };
  }

  const score = wins + draws * 0.5;
  const scoreFraction = score / games;
  const dp = dpFromScore(scoreFraction);
  const tpr = avgOppElo + dp;

  return { tpr, games, score, avg_opponent_elo: avgOppElo };
}

stats.get("/stats/:username/tpr", (c) => {
  const username = c.req.param("username");
  const timeClass = c.req.query("time_class") ?? "blitz";
  if (!USERNAME_PATTERN.test(username)) {
    return c.json({ error: "Invalid username format" }, 400);
  }
  if (!TIME_CLASS_PATTERN.test(timeClass)) {
    return c.json({ error: "Invalid time_class" }, 400);
  }
  return c.json(computeTpr(db, username, timeClass));
});

// ---------------------------------------------------------------------------
// R30: Repertoire — ECO grouping with out-of-book ply
// ---------------------------------------------------------------------------

export interface RepertoireRow {
  eco: string;
  opening: string | null;
  games: number;
  win_rate: number;
  avg_accuracy: number | null;
  avg_out_of_book_ply: number | null;
}

interface RawRepertoireRow {
  eco: string;
  opening: string | null;
  games: number;
  wins: number;
  avg_accuracy: number | null;
  avg_out_of_book_ply: number | null;
}

const COLOR_PATTERN = /^(white|black)$/;

/**
 * Groups games by ECO for the user playing the given color.
 * Includes avg out_of_book_ply from game_metrics_ext.
 */
export function computeRepertoire(
  database: Database,
  username: string,
  color: "white" | "black",
): RepertoireRow[] {
  const lower = username.toLowerCase();
  const colorFilter = color === "white" ? "lower(g.white) = ?" : "lower(g.black) = ?";
  const accuracyCol = color === "white" ? "gm.accuracy_white" : "gm.accuracy_black";

  const rows = database
    .prepare(`
      SELECT
        COALESCE(g.eco, 'unknown') AS eco,
        g.opening,
        COUNT(*) AS games,
        SUM(CASE
          WHEN (lower(g.white) = ? AND g.result = '1-0') OR (lower(g.black) = ? AND g.result = '0-1')
          THEN 1 ELSE 0 END) AS wins,
        AVG(${accuracyCol}) AS avg_accuracy,
        AVG(gme.out_of_book_ply) AS avg_out_of_book_ply
      FROM games g
      LEFT JOIN game_metrics gm ON g.id = gm.game_id
      LEFT JOIN game_metrics_ext gme ON g.id = gme.game_id
      WHERE lower(g.username) = ? AND ${colorFilter}
      GROUP BY eco, g.opening
      ORDER BY games DESC
    `)
    .all(lower, lower, lower, lower) as RawRepertoireRow[];

  return rows.map((r) => ({
    eco: r.eco,
    opening: r.opening,
    games: r.games,
    win_rate: r.games > 0 ? r.wins / r.games : 0,
    avg_accuracy: r.avg_accuracy,
    avg_out_of_book_ply: r.avg_out_of_book_ply,
  }));
}

stats.get("/stats/:username/repertoire", (c) => {
  const username = c.req.param("username");
  if (!USERNAME_PATTERN.test(username)) {
    return c.json({ error: "Invalid username format" }, 400);
  }
  const colorParam = c.req.query("color") ?? "white";
  if (!COLOR_PATTERN.test(colorParam)) {
    return c.json({ error: "Invalid color" }, 400);
  }
  const color = colorParam as "white" | "black";
  return c.json(computeRepertoire(db, username, color));
});

// ---------------------------------------------------------------------------
// R31: Counterplay — saves from losing positions
// ---------------------------------------------------------------------------

export interface CounterplayResponse {
  games_reached_losing: number;
  saves: number;
  save_rate: number | null;
}

interface CounterplayRow {
  games_reached_losing: number;
  saves: number | null;
}

/**
 * A game "reached losing" when ext.trough_eval_wp <= LOSING_WP (20).
 * A "save" = reached losing AND result is win or draw for the user.
 */
export function computeCounterplay(
  database: Database,
  username: string,
): CounterplayResponse {
  const lower = username.toLowerCase();
  const row = database
    .prepare(`
      SELECT
        COUNT(*) AS games_reached_losing,
        SUM(CASE
          WHEN (lower(g.white) = ? AND g.result = '1-0')
            OR (lower(g.black) = ? AND g.result = '0-1')
            OR g.result = '1/2-1/2'
          THEN 1 ELSE 0 END) AS saves
      FROM games g
      JOIN game_metrics_ext gme ON g.id = gme.game_id
      WHERE lower(g.username) = ?
        AND gme.trough_eval_wp <= ?
    `)
    .get(lower, lower, lower, LOSING_WP) as CounterplayRow;

  const reached = row.games_reached_losing;
  const saves = row.saves ?? 0;

  return {
    games_reached_losing: reached,
    saves,
    save_rate: reached > 0 ? saves / reached : null,
  };
}

stats.get("/stats/:username/counterplay", (c) => {
  const username = c.req.param("username");
  if (!USERNAME_PATTERN.test(username)) {
    return c.json({ error: "Invalid username format" }, 400);
  }
  return c.json(computeCounterplay(db, username));
});

// ---------------------------------------------------------------------------
// R32: Endgame conversion — converting winning positions
// ---------------------------------------------------------------------------

export interface EndgameConversionResponse {
  games_reached_winning: number;
  conversions: number;
  conversion_rate: number | null;
  avg_endgame_accuracy: number | null;
}

interface EndgameConversionRow {
  games_reached_winning: number;
  conversions: number | null;
  avg_endgame_accuracy: number | null;
}

/**
 * "Reached winning" = ext.peak_eval_wp >= WINNING_WP (80).
 * conversion = reached winning AND user won.
 * avg_endgame_accuracy = AVG(ext.accuracy_endgame) over those games.
 */
export function computeEndgameConversion(
  database: Database,
  username: string,
): EndgameConversionResponse {
  const lower = username.toLowerCase();
  const row = database
    .prepare(`
      SELECT
        COUNT(*) AS games_reached_winning,
        SUM(CASE
          WHEN (lower(g.white) = ? AND g.result = '1-0')
            OR (lower(g.black) = ? AND g.result = '0-1')
          THEN 1 ELSE 0 END) AS conversions,
        AVG(gme.accuracy_endgame) AS avg_endgame_accuracy
      FROM games g
      JOIN game_metrics_ext gme ON g.id = gme.game_id
      WHERE lower(g.username) = ?
        AND gme.peak_eval_wp >= ?
    `)
    .get(lower, lower, lower, WINNING_WP) as EndgameConversionRow;

  const reached = row.games_reached_winning;
  const conversions = row.conversions ?? 0;

  return {
    games_reached_winning: reached,
    conversions,
    conversion_rate: reached > 0 ? conversions / reached : null,
    avg_endgame_accuracy: row.avg_endgame_accuracy,
  };
}

stats.get("/stats/:username/endgame-conversion", (c) => {
  const username = c.req.param("username");
  if (!USERNAME_PATTERN.test(username)) {
    return c.json({ error: "Invalid username format" }, 400);
  }
  return c.json(computeEndgameConversion(db, username));
});

export default stats;
