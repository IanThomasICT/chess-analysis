import { Hono } from "hono";
import { db } from "../lib/db";
import { fetchRecentGames } from "../lib/chesscom";
import { pgnToFens, pgnToMoves } from "../lib/pgn";
import { isGameAnalyzed, getGameAnalysis } from "../lib/stockfish";

import type { ChessComGame } from "../lib/chesscom";
import type { AnalysisRow } from "../lib/stockfish";

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
      INSERT OR REPLACE INTO games (id, username, pgn, white, black, result, time_class, end_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const upsertMany = db.transaction((gamesToUpsert: ChessComGame[]) => {
      for (const g of gamesToUpsert) {
        const gameId = g.url.split("/").pop() ?? g.url;
        const result =
          g.white.result === "win"
            ? "1-0"
            : g.black.result === "win"
              ? "0-1"
              : "1/2-1/2";

        upsert.run(
          gameId,
          username.toLowerCase(),
          g.pgn,
          g.white.username,
          g.black.username,
          result,
          g.time_class,
          g.end_time,
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
      `SELECT id, username, pgn, white, black, result, time_class, end_time
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
  let moves: { san: string; from: string; to: string }[];
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
  let analysis: AnalysisRow[] = [];
  if (analyzed) {
    analysis = getGameAnalysis(gameId);
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
    },
    fens,
    moves,
    analysis,
    analyzed,
  });
});

export default games;
