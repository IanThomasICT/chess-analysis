import { Hono } from "hono";
import { db } from "../lib/db";
import { fetchRecentGames, type ChessComGame } from "../lib/chesscom";
import { pgnToFens, pgnToMoves, pgnHeaders } from "../lib/pgn";
import { isGameAnalyzed, getGameAnalysis, type AnalysisRow } from "../lib/engine";
import { parseEloHeader } from "../lib/backfill";

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
  const eco = normalizeHeader(h.ECO);
  const opening = normalizeHeader(h.Opening);

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
  };
}

const games = new Hono();

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
         white_elo, black_elo, user_elo, eco, opening)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
              white_elo, black_elo, user_elo, eco, opening
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
    },
    fens,
    moves,
    analysis,
    analyzed,
  });
});

export default games;
