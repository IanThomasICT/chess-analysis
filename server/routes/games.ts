import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { db } from "../lib/db";
import { fetchRecentGames, type ChessComGame } from "../lib/chesscom";
import { pgnToFens, pgnToMoves, pgnHeaders, pgnFinalClocks } from "../lib/pgn";
import { isGameAnalyzed, getGameAnalysis, type AnalysisRow } from "../lib/engine";
import { parseEloHeader } from "../lib/backfill";
import { classifyOpening } from "../lib/openings";
import { gameMetrics } from "../lib/metrics";

const BULK_COMPUTE_LIMIT = 20;

function normalizeHeader(raw: string | undefined): string | null {
  if (raw === undefined || raw.trim() === "") {
    return null;
  }
  return raw;
}

/** Chess.com usernames: alphanumeric, underscores, hyphens, up to 50 chars */
const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{1,50}$/;

/** Game IDs: alphanumeric, underscores, hyphens, up to 50 chars */
const GAME_ID_PATTERN = /^[a-zA-Z0-9_-]{1,50}$/;

interface GameRow {
  id: string;
  username: string;
  pgn: string;
  white: string;
  black: string;
  result: string;
  time_class: string;
  end_time: number;
  white_elo: number | null;
  black_elo: number | null;
  user_elo: number | null;
  eco: string | null;
  opening: string | null;
  white_clock_final_s: number | null;
  black_clock_final_s: number | null;
  termination: string | null;
}

export interface GameRowData {
  id: string;
  username: string;
  pgn: string;
  white: string;
  black: string;
  result: string;
  time_class: string;
  end_time: number;
  white_elo: number | null;
  black_elo: number | null;
  user_elo: number | null;
  eco: string | null;
  opening: string | null;
  white_clock_final_s: number | null;
  black_clock_final_s: number | null;
  termination: string | null;
}

/** Build a fully-populated game row from a ChessComGame and the requesting username. */
export function buildGameRow(
  username: string,
  g: ChessComGame,
): GameRowData {
  const gameId = g.url.split("/").pop() ?? g.url;

  let result: "1-0" | "0-1" | "1/2-1/2";
  if (g.white.result === "win") {
    result = "1-0";
  } else if (g.black.result === "win") {
    result = "0-1";
  } else {
    result = "1/2-1/2";
  }

  const h = pgnHeaders(g.pgn);
  const white_elo = parseEloHeader(h.WhiteElo);
  const black_elo = parseEloHeader(h.BlackElo);
  const userColor =
    username.toLowerCase() === g.white.username.toLowerCase() ? "w" : "b";
  const user_elo = userColor === "w" ? white_elo : black_elo;
  let eco = normalizeHeader(h.ECO);
  let opening = normalizeHeader(h.Opening);

  if (eco === null || opening === null) {
    try {
      const moves = pgnToMoves(g.pgn).map((m) => m.san);
      const classified = classifyOpening(moves);
      if (classified !== null) {
        eco ??= classified.eco;
        opening ??= classified.name;
      }
    } catch {
      // ignore PGN parse failures
    }
  }

  const clocks = pgnFinalClocks(g.pgn);
  const termination = normalizeHeader(h.Termination);

  return {
    id: gameId,
    username: username.toLowerCase(),
    pgn: g.pgn,
    white: g.white.username,
    black: g.black.username,
    result,
    time_class: g.time_class,
    end_time: g.end_time,
    white_elo,
    black_elo,
    user_elo,
    eco,
    opening,
    white_clock_final_s: clocks.white,
    black_clock_final_s: clocks.black,
    termination,
  };
}

const games = new Hono();

// Bulk metrics — MUST be registered before /games/:gameId, otherwise Hono
// captures "metrics" as a gameId.
games.get("/games/metrics", (c) => {
  const username = c.req.query("username");
  if (username === undefined || username === "") {
    return c.json({ error: "username required" }, 400);
  }
  if (!USERNAME_PATTERN.test(username)) {
    return c.json({ error: "Invalid username format" }, 400);
  }
  return c.json(fetchBulkMetricsFor(db, username));
});

games.get("/games", async (c) => {
  const username = c.req.query("username");
  if (username === undefined || username === "") {
    return c.json({ games: [], username: null });
  }

  if (!USERNAME_PATTERN.test(username)) {
    return c.json({ error: "Invalid username format" }, 400);
  }

  // Fetch from Chess.com + upsert
  try {
    const chessComGames = await fetchRecentGames(username, 3);

    const upsert = db.prepare(`
      INSERT OR REPLACE INTO games
        (id, username, pgn, white, black, result, time_class, end_time,
         white_elo, black_elo, user_elo, eco, opening,
         white_clock_final_s, black_clock_final_s, termination)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const upsertMany = db.transaction((gamesToUpsert: ChessComGame[]) => {
      for (const g of gamesToUpsert) {
        const row = buildGameRow(username, g);
        upsert.run(
          row.id,
          row.username,
          row.pgn,
          row.white,
          row.black,
          row.result,
          row.time_class,
          row.end_time,
          row.white_elo,
          row.black_elo,
          row.user_elo,
          row.eco,
          row.opening,
          row.white_clock_final_s,
          row.black_clock_final_s,
          row.termination,
        );
      }
    });

    upsertMany(chessComGames);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Failed to fetch from Chess.com:", message);
    // Fall through to load from DB cache
  }

  // Load from DB
  const rows = db
    .prepare(
      `SELECT id, username, pgn, white, black, result, time_class, end_time,
              white_elo, black_elo, user_elo, eco, opening,
              white_clock_final_s, black_clock_final_s, termination
       FROM games
       WHERE username = ?
       ORDER BY end_time DESC`,
    )
    .all(username.toLowerCase()) as GameRow[];

  return c.json({ games: rows, username });
});

games.get("/games/:gameId", (c) => {
  const gameId = c.req.param("gameId");

  if (!GAME_ID_PATTERN.test(gameId)) {
    return c.json({ error: "Invalid game ID format" }, 400);
  }

  const game = db
    .prepare("SELECT * FROM games WHERE id = ?")
    .get(gameId) as GameRow | null;

  if (game === null) {
    return c.json({ error: "Game not found" }, 404);
  }

  let fens: string[];
  let moves: Array<{ san: string; from: string; to: string }>;
  try {
    fens = pgnToFens(game.pgn);
    moves = pgnToMoves(game.pgn).map((m) => ({
      san: m.san,
      from: m.from,
      to: m.to,
    }));
  } catch {
    return c.json({ error: "Failed to parse game data" }, 500);
  }

  const analyzed = isGameAnalyzed(gameId, fens.length);
  const analysis: AnalysisRow[] = analyzed ? getGameAnalysis(gameId) : [];

  const motifRows = db
    .prepare(`SELECT move_index, tag FROM blunder_tags WHERE game_id = ?`)
    .all(gameId) as Array<{ move_index: number; tag: string }>;
  const motifs: Record<string, string[]> = {};
  for (const r of motifRows) {
    const key = String(r.move_index);
    const arr = motifs[key] ?? [];
    arr.push(r.tag);
    motifs[key] = arr;
  }

  return c.json({
    game: {
      id: game.id,
      white: game.white,
      black: game.black,
      result: game.result,
      timeClass: game.time_class,
      endTime: game.end_time,
      username: game.username,
      whiteElo: game.white_elo,
      blackElo: game.black_elo,
      userElo: game.user_elo,
      eco: game.eco,
      opening: game.opening,
      whiteClockFinalS: game.white_clock_final_s,
      blackClockFinalS: game.black_clock_final_s,
      termination: game.termination,
    },
    fens,
    moves,
    analysis,
    analyzed,
    motifs,
  });
});

// ---------------------------------------------------------------------------
// Metrics types + helpers
// ---------------------------------------------------------------------------

export interface GameMetricsRow {
  game_id: string;
  accuracy_white: number;
  accuracy_black: number;
  blunders_white: number;
  mistakes_white: number;
  inaccuracies_white: number;
  blunders_black: number;
  mistakes_black: number;
  inaccuracies_black: number;
  acl_white: number;
  acl_black: number;
  computed_at: number;
}

export function toMetricsResponse(row: GameMetricsRow) {
  return {
    gameId: row.game_id,
    white: {
      accuracy: row.accuracy_white,
      blunders: row.blunders_white,
      mistakes: row.mistakes_white,
      inaccuracies: row.inaccuracies_white,
      acl: row.acl_white,
    },
    black: {
      accuracy: row.accuracy_black,
      blunders: row.blunders_black,
      mistakes: row.mistakes_black,
      inaccuracies: row.inaccuracies_black,
      acl: row.acl_black,
    },
    computedAt: row.computed_at,
  };
}

/**
 * Compute metrics for a game and cache them in game_metrics.
 * Returns the response shape, or null if the game has no analysis rows.
 */
export function computeAndCacheMetrics(
  database: Database,
  gameId: string,
): ReturnType<typeof toMetricsResponse> | null {
  // Try cache first
  const cached = database
    .prepare("SELECT * FROM game_metrics WHERE game_id = ?")
    .get(gameId) as GameMetricsRow | null;
  if (cached !== null) {
    return toMetricsResponse(cached);
  }

  // Cache miss — compute from analysis rows
  const rows = database
    .prepare(
      `SELECT move_index, fen, move_san, score_cp, score_mate, best_move, depth
       FROM analysis WHERE game_id = ? ORDER BY move_index`,
    )
    .all(gameId) as AnalysisRow[];

  if (rows.length === 0) {
    return null;
  }

  const computed = gameMetrics(rows);
  const computedAt = Math.floor(Date.now() / 1000);

  database
    .prepare(
      `INSERT OR REPLACE INTO game_metrics (
        game_id,
        accuracy_white, accuracy_black,
        blunders_white, mistakes_white, inaccuracies_white,
        blunders_black, mistakes_black, inaccuracies_black,
        acl_white, acl_black,
        computed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      gameId,
      computed.white.accuracy,
      computed.black.accuracy,
      computed.white.blunders,
      computed.white.mistakes,
      computed.white.inaccuracies,
      computed.black.blunders,
      computed.black.mistakes,
      computed.black.inaccuracies,
      computed.white.acl,
      computed.black.acl,
      computedAt,
    );

  return toMetricsResponse({
    game_id: gameId,
    accuracy_white: computed.white.accuracy,
    accuracy_black: computed.black.accuracy,
    blunders_white: computed.white.blunders,
    mistakes_white: computed.white.mistakes,
    inaccuracies_white: computed.white.inaccuracies,
    blunders_black: computed.black.blunders,
    mistakes_black: computed.black.mistakes,
    inaccuracies_black: computed.black.inaccuracies,
    acl_white: computed.white.acl,
    acl_black: computed.black.acl,
    computed_at: computedAt,
  });
}

// ---------------------------------------------------------------------------
// Bulk metrics helper + route
// ---------------------------------------------------------------------------

interface JoinRow {
  id: string;
  game_id: string | null;
  accuracy_white: number | null;
  accuracy_black: number | null;
  blunders_white: number | null;
  mistakes_white: number | null;
  inaccuracies_white: number | null;
  blunders_black: number | null;
  mistakes_black: number | null;
  inaccuracies_black: number | null;
  acl_white: number | null;
  acl_black: number | null;
  computed_at: number | null;
}

/**
 * Pure helper — fetches all games for a username, returns a map of gameId →
 * GameMetrics (from cache or computed on-the-fly) or null if the game has no
 * analysis and the on-the-fly compute cap has been reached.
 */
export function fetchBulkMetricsFor(
  database: Database,
  username: string,
): Record<string, ReturnType<typeof toMetricsResponse> | null> {
  const joined = database
    .prepare(
      `SELECT g.id,
              gm.game_id, gm.accuracy_white, gm.accuracy_black,
              gm.blunders_white, gm.mistakes_white, gm.inaccuracies_white,
              gm.blunders_black, gm.mistakes_black, gm.inaccuracies_black,
              gm.acl_white, gm.acl_black, gm.computed_at
         FROM games g
         LEFT JOIN game_metrics gm ON g.id = gm.game_id
        WHERE lower(g.username) = lower(?)
        ORDER BY g.end_time DESC`,
    )
    .all(username) as JoinRow[];

  const result: Record<string, ReturnType<typeof toMetricsResponse> | null> =
    {};
  let computesRemaining = BULK_COMPUTE_LIMIT;

  for (const row of joined) {
    if (row.game_id !== null) {
      // Cache hit — build response directly from joined columns
      result[row.id] = toMetricsResponse({
        game_id: row.game_id,
        accuracy_white: row.accuracy_white ?? 0,
        accuracy_black: row.accuracy_black ?? 0,
        blunders_white: row.blunders_white ?? 0,
        mistakes_white: row.mistakes_white ?? 0,
        inaccuracies_white: row.inaccuracies_white ?? 0,
        blunders_black: row.blunders_black ?? 0,
        mistakes_black: row.mistakes_black ?? 0,
        inaccuracies_black: row.inaccuracies_black ?? 0,
        acl_white: row.acl_white ?? 0,
        acl_black: row.acl_black ?? 0,
        computed_at: row.computed_at ?? 0,
      });
    } else if (computesRemaining > 0) {
      // Cache miss — attempt compute on-the-fly
      result[row.id] = computeAndCacheMetrics(database, row.id);
      computesRemaining -= 1;
    } else {
      // Over compute cap — client must lazy-load
      result[row.id] = null;
    }
  }

  return result;
}

games.get("/games/:gameId/metrics", (c) => {
  const gameId = c.req.param("gameId");
  if (!GAME_ID_PATTERN.test(gameId)) {
    return c.json({ error: "Invalid game ID format" }, 400);
  }

  const result = computeAndCacheMetrics(db, gameId);
  if (result === null) {
    return c.json({ error: "Game not analyzed" }, 404);
  }

  return c.json(result);
});

games.get("/games/:gameId/alternatives/:moveIndex", (c) => {
  const gameId = c.req.param("gameId");
  if (!GAME_ID_PATTERN.test(gameId)) {
    return c.json({ error: "Invalid game ID format" }, 400);
  }
  const moveIndexStr = c.req.param("moveIndex");
  const moveIndex = parseInt(moveIndexStr, 10);
  if (Number.isNaN(moveIndex) || moveIndex < 0) {
    return c.json({ error: "Invalid moveIndex" }, 400);
  }
  interface AltRow {
    multipv_rank: number;
    score_cp: number | null;
    score_mate: number | null;
    best_move: string;
    pv: string | null;
    depth: number;
  }
  const rows = db
    .prepare(
      `SELECT multipv_rank, score_cp, score_mate, best_move, pv, depth
         FROM analysis
        WHERE game_id = ? AND move_index = ?
        ORDER BY multipv_rank ASC`,
    )
    .all(gameId, moveIndex) as AltRow[];
  return c.json({
    gameId,
    moveIndex,
    alternatives: rows.map((r) => ({
      multipvRank: r.multipv_rank,
      scoreCp: r.score_cp,
      scoreMate: r.score_mate,
      bestMove: r.best_move,
      pv: r.pv,
      depth: r.depth,
    })),
  });
});

export default games;
