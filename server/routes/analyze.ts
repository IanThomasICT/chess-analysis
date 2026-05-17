import { Hono } from "hono";
import { Chess } from "chess.js";
import { db } from "../lib/db";
import { pgnToFens, pgnToMoves } from "../lib/pgn";
import {
  analyzeGame,
  acquireAnalysisSlot,
  releaseAnalysisSlot,
} from "../lib/engine";
import { tagMoveIfBlunder, type AnalysisSnapshot } from "../lib/motif-tagging";

/** Game IDs: alphanumeric, underscores, hyphens, up to 50 chars */
const GAME_ID_PATTERN = /^[a-zA-Z0-9_-]{1,50}$/;

/** Convert a SAN move to UCI using chess.js. Returns null if invalid. */
function sanToUci(fenBefore: string, san: string): string | null {
  try {
    const chess = new Chess(fenBefore);
    const m = chess.move(san);
    return `${m.from}${m.to}${m.promotion ?? ""}`;
  } catch {
    return null;
  }
}

interface GameRow {
  id: string;
  pgn: string;
}

const analyze = new Hono();

analyze.get("/analyze/:gameId", (c) => {
  const gameId = c.req.param("gameId");

  if (!GAME_ID_PATTERN.test(gameId)) {
    return c.json({ error: "Invalid game ID format" }, 400);
  }

  const game = db
    .prepare("SELECT id, pgn FROM games WHERE id = ?")
    .get(gameId) as GameRow | null;

  if (game === null) {
    return c.json({ error: "Game not found" }, 404);
  }

  let fens: string[];
  let moves: string[];
  try {
    fens = pgnToFens(game.pgn);
    moves = pgnToMoves(game.pgn).map((m) => m.san);
  } catch {
    return c.json({ error: "Failed to parse game data" }, 500);
  }

  const multipvRaw = c.req.query("multipv");
  const multipv = multipvRaw === "3" ? 3 : 1;

  if (!acquireAnalysisSlot()) {
    return c.json(
      { error: "Server is busy, please try again later" },
      429,
    );
  }

  // Invalidate any cached metrics for this game — fresh analysis is about to be written
  db.prepare(`DELETE FROM game_metrics WHERE game_id = ?`).run(gameId);

  const encoder = new TextEncoder();
  const capturedGame = game;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        let prior: AnalysisSnapshot | null = null;
        let priorIndex = -1;

        for await (const result of analyzeGame(capturedGame.id, fens, moves, multipv)) {
          const data = JSON.stringify({
            moveIndex: result.moveIndex,
            multipvRank: result.multipvRank,
            fen: result.fen,
            scoreCp: result.scoreCp,
            scoreMate: result.scoreMate,
            bestMove: result.bestMove,
            pv: result.pv,
            depth: result.depth,
            total: result.total,
          });
          controller.enqueue(encoder.encode(`data: ${  data  }\n\n`));

          // Motif tagging — rank 1 events only, move_index > 0
          if (
            result.multipvRank === 1 &&
            prior !== null &&
            result.moveIndex > 0 &&
            result.moveIndex === priorIndex + 1
          ) {
            const playedMoveSan = moves[result.moveIndex - 1];
            const playedUci = sanToUci(prior.fen, playedMoveSan);
            if (playedUci !== null) {
              try {
                tagMoveIfBlunder(
                  db,
                  capturedGame.id,
                  result.moveIndex,
                  prior,
                  {
                    fen: result.fen,
                    score_cp: result.scoreCp,
                    score_mate: result.scoreMate,
                    best_move: result.bestMove,
                    pv: result.pv,
                    move_san: playedMoveSan,
                  },
                  playedUci,
                );
              } catch {
                // best-effort: tagging bug must not kill the SSE stream
              }
            }
          }

          if (result.multipvRank === 1) {
            prior = {
              fen: result.fen,
              score_cp: result.scoreCp,
              score_mate: result.scoreMate,
              best_move: result.bestMove,
              pv: result.pv,
              move_san: moves[result.moveIndex - 1] ?? null,
            };
            priorIndex = result.moveIndex;
          }
        }

        // Signal completion
        controller.enqueue(
          encoder.encode(`data: ${  JSON.stringify({ done: true })  }\n\n`),
        );
      } catch (error: unknown) {
        console.error(
          "Analysis error:",
          error instanceof Error ? error.message : "Unknown error",
        );
        controller.enqueue(
          encoder.encode(
            `data: ${  JSON.stringify({ error: "Analysis failed" })  }\n\n`,
          ),
        );
      } finally {
        releaseAnalysisSlot();
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

export default analyze;
