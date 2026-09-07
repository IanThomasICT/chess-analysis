import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { db } from "../lib/db";
import { computeAndStoreMetrics } from "../lib/metrics-store";
import { WINNING_WP, LOSING_WP, SWINDLE_ACC, UNLUCKY_ACC } from "../lib/metrics-config";
import type { CriticalMove, MissedConversion } from "../lib/game-metrics";

const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{1,50}$/;
const GAME_ID_PATTERN = /^[a-zA-Z0-9_-]{1,50}$/;

export type ResultForUser = "win" | "loss" | "draw";

/** Map a PGN result + the user's color to the user's outcome. */
export function resultForUser(result: string, userIsWhite: boolean): ResultForUser {
  if (result === "1/2-1/2") {return "draw";}
  const whiteWon = result === "1-0";
  return whiteWon === userIsWhite ? "win" : "loss";
}

export interface ConversionFlags {
  reachedWinning: boolean;
  reachedLosing: boolean;
  converted: boolean;
  saved: boolean;
}

/** Conversion / defense flags from the user's peak & trough Win% (D10). */
export function conversionFlags(
  outcome: ResultForUser,
  peakWp: number | null,
  troughWp: number | null,
): ConversionFlags {
  const reachedWinning = peakWp !== null && peakWp >= WINNING_WP;
  const reachedLosing = troughWp !== null && troughWp <= LOSING_WP;
  return {
    reachedWinning,
    reachedLosing,
    converted: reachedWinning && outcome === "win",
    saved: reachedLosing && (outcome === "win" || outcome === "draw"),
  };
}

export type ResultQuality =
  | "swindle_win" | "clean_win"
  | "unlucky_loss" | "clean_loss"
  | "hold_draw" | "even_draw";

/** Qualitative result label (D12). */
export function resultQuality(
  outcome: ResultForUser,
  accuracy: number | null,
  reachedLosing: boolean,
): ResultQuality {
  if (outcome === "win") {
    const lowAcc = accuracy !== null && accuracy < SWINDLE_ACC;
    return lowAcc || reachedLosing ? "swindle_win" : "clean_win";
  }
  if (outcome === "loss") {
    return accuracy !== null && accuracy >= UNLUCKY_ACC ? "unlucky_loss" : "clean_loss";
  }
  return reachedLosing ? "hold_draw" : "even_draw";
}

interface ListRow {
  id: string;
  end_time: number;
  time_class: string;
  white: string;
  result: string;
  user_elo: number | null;
  opponent_elo: number | null;
  accuracy_white: number | null;
  accuracy_black: number | null;
  acl_white: number | null;
  acl_black: number | null;
  accuracy_opening: number | null;
  accuracy_middlegame: number | null;
  accuracy_endgame: number | null;
  peak_eval_wp: number | null;
  trough_eval_wp: number | null;
  time_trouble_moves: number | null;
  critical_positions: number | null;
  max_blunder_run: number | null;
}

export interface GameMetricSummary {
  gameId: string;
  endTime: number;
  timeClass: string;
  userColor: "w" | "b";
  result: ResultForUser;
  accuracy: number | null;
  acl: number | null;
  accuracyOpening: number | null;
  accuracyMiddlegame: number | null;
  accuracyEndgame: number | null;
  eloDelta: number | null;
  resultQuality: ResultQuality;
  reachedWinning: boolean;
  reachedLosing: boolean;
  converted: boolean;
  saved: boolean;
  timeTroubleFlag: boolean;
  criticalPositions: number | null;
  maxBlunderRun: number | null;
}

/** Pick the user's side value from a white/black pair given the user's color. */
function userSide<T>(userIsWhite: boolean, white: T, black: T): T {
  return userIsWhite ? white : black;
}

function summarize(row: ListRow, username: string, eloDelta: number | null): GameMetricSummary {
  const userIsWhite = row.white.toLowerCase() === username.toLowerCase();
  const outcome = resultForUser(row.result, userIsWhite);
  const accuracy = userSide(userIsWhite, row.accuracy_white, row.accuracy_black);
  const acl = userSide(userIsWhite, row.acl_white, row.acl_black);
  const flags = conversionFlags(outcome, row.peak_eval_wp, row.trough_eval_wp);
  return {
    gameId: row.id,
    endTime: row.end_time,
    timeClass: row.time_class,
    userColor: userIsWhite ? "w" : "b",
    result: outcome,
    accuracy,
    acl,
    accuracyOpening: row.accuracy_opening,
    accuracyMiddlegame: row.accuracy_middlegame,
    accuracyEndgame: row.accuracy_endgame,
    eloDelta,
    resultQuality: resultQuality(outcome, accuracy, flags.reachedLosing),
    reachedWinning: flags.reachedWinning,
    reachedLosing: flags.reachedLosing,
    converted: flags.converted,
    saved: flags.saved,
    timeTroubleFlag: row.time_trouble_moves !== null && row.time_trouble_moves > 0,
    criticalPositions: row.critical_positions,
    maxBlunderRun: row.max_blunder_run,
  };
}

const LIST_SQL = `
  SELECT g.id, g.end_time, g.time_class, g.white, g.result, g.user_elo,
         CASE WHEN lower(g.white) = lower(?) THEN g.black_elo ELSE g.white_elo END AS opponent_elo,
         gm.accuracy_white, gm.accuracy_black, gm.acl_white, gm.acl_black,
         ext.accuracy_opening, ext.accuracy_middlegame, ext.accuracy_endgame,
         ext.peak_eval_wp, ext.trough_eval_wp, ext.time_trouble_moves,
         ext.critical_positions, ext.max_blunder_run
    FROM games g
    LEFT JOIN game_metrics gm ON g.id = gm.game_id
    LEFT JOIN game_metrics_ext ext ON g.id = ext.game_id
   WHERE lower(g.username) = lower(?)
   ORDER BY g.end_time ASC
`;

/**
 * Per-game metric summaries for a user, with read-time Elo delta computed within
 * each time class (D5). Returned newest-first.
 */
export function listGameMetrics(database: Database, username: string): GameMetricSummary[] {
  const rows = database.prepare(LIST_SQL).all(username, username) as ListRow[];
  const prevElo = new Map<string, number>();
  const ascending: GameMetricSummary[] = rows.map((row) => {
    let eloDelta: number | null = null;
    if (row.user_elo !== null) {
      const prior = prevElo.get(row.time_class);
      if (prior !== undefined) {eloDelta = row.user_elo - prior;}
      prevElo.set(row.time_class, row.user_elo);
    }
    return summarize(row, username, eloDelta);
  });
  return ascending.reverse();
}

const metrics = new Hono();

// `/metrics/game/:gameId` must precede `/metrics/:username` so "game" isn't
// captured as a username.
metrics.get("/metrics/game/:gameId", (c) => {
  const gameId = c.req.param("gameId");
  if (!GAME_ID_PATTERN.test(gameId)) {
    return c.json({ error: "Invalid game ID format" }, 400);
  }
  // Ensure metrics are current (rebuild from stored analysis; no engine run).
  const derived = computeAndStoreMetrics(db, gameId);
  if (derived === null) {
    return c.json({ error: "Game not analyzed" }, 404);
  }

  const summaries = listGameMetrics(db, derived.game.username);
  const summary = summaries.find((s) => s.gameId === gameId);
  if (summary === undefined) {
    return c.json({ error: "Game not analyzed" }, 404);
  }

  const ext = derived.ext;
  const criticalMoves: CriticalMove[] = ext.criticalMoves;
  const missedConversions: MissedConversion[] = ext.missedConversions;

  return c.json({
    ...summary,
    phases: {
      middlegameStartPly: ext.middlegameStartPly,
      endgameStartPly: ext.endgameStartPly,
      timeOpeningS: ext.timeOpeningS,
      timeMiddlegameS: ext.timeMiddlegameS,
      timeEndgameS: ext.timeEndgameS,
    },
    accuracyCritical: ext.accuracyCritical,
    accuracyQuiet: ext.accuracyQuiet,
    timeAllocEfficiency: ext.timeAllocEfficiency,
    avgMoveTimeS: ext.avgMoveTimeS,
    recoveryAccuracy: ext.recoveryAccuracy,
    timeTroubleErrors: ext.timeTroubleErrors,
    outOfBookPly: ext.outOfBookPly,
    outOfBookEcoFallback: ext.outOfBookEcoFallback,
    postBookAccuracy: ext.postBookAccuracy,
    evalOpeningEndWp: ext.evalOpeningEndWp,
    peakEvalWp: ext.peakEvalWp,
    troughEvalWp: ext.troughEvalWp,
    clocksAvailable: ext.clocksAvailable,
    engineDepthMin: ext.engineDepthMin,
    criticalMoves,
    missedConversions,
  });
});

const CSV_COLUMNS: Array<keyof GameMetricSummary> = [
  "gameId", "endTime", "timeClass", "userColor", "result", "accuracy", "acl",
  "accuracyOpening", "accuracyMiddlegame", "accuracyEndgame", "eloDelta",
  "resultQuality", "reachedWinning", "reachedLosing", "converted", "saved",
  "timeTroubleFlag", "criticalPositions", "maxBlunderRun",
];

function toCsv(summaries: GameMetricSummary[]): string {
  const header = CSV_COLUMNS.join(",");
  const lines = summaries.map((s) =>
    CSV_COLUMNS.map((col) => {
      const v = s[col];
      return v === null ? "" : String(v);
    }).join(","),
  );
  return [header, ...lines].join("\n");
}

// `/metrics/:username/export` before `/metrics/:username` for the same reason.
metrics.get("/metrics/:username/export", (c) => {
  const username = c.req.param("username");
  if (!USERNAME_PATTERN.test(username)) {
    return c.json({ error: "Invalid username format" }, 400);
  }
  const format = c.req.query("format") === "json" ? "json" : "csv";
  const summaries = listGameMetrics(db, username);
  if (format === "json") {
    return c.json(summaries);
  }
  return c.body(toCsv(summaries), 200, {
    "Content-Type": "text/csv",
    "Content-Disposition": `attachment; filename="${username}-metrics.csv"`,
  });
});

metrics.get("/metrics/:username", (c) => {
  const username = c.req.param("username");
  if (!USERNAME_PATTERN.test(username)) {
    return c.json({ error: "Invalid username format" }, 400);
  }
  return c.json(listGameMetrics(db, username));
});

export default metrics;
