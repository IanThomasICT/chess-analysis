import { Hono } from "hono";
import { Chess } from "chess.js";
import { db } from "../lib/db";
import { pgnToFens, pgnToMoves } from "../lib/pgn";
import {
  analyzeGame,
  acquireAnalysisSlot,
  releaseAnalysisSlot,
  isGameAnalyzed,
} from "../lib/engine";
import { tagMoveIfBlunder, type AnalysisSnapshot } from "../lib/motif-tagging";

/**
 * Two-phase analysis:
 *   1. Shallow scan — MultiPV=1, ~50ms/pos (sub-10s for typical 110-position games).
 *      Streams to client immediately so eval bar/graph/move colors populate fast.
 *      Persisted (rank-1 best moves available in DB right away). Deep phase overwrites.
 *   2. Deep refinement — MultiPV=3, full SEARCH_MOVETIME, persisted + motif tagging.
 *
 * Skipped if the game is already fully analyzed — analyzeGame yields cached rows.
 * Override with SHALLOW_MOVETIME_MS env var.
 */
const SHALLOW_MOVETIME_MS: number = ((): number => {
  const override = process.env.SHALLOW_MOVETIME_MS;
  if (override !== undefined && override !== "") {
    const n = parseInt(override, 10);
    if (!Number.isNaN(n) && n > 0) {return n;}
  }
  return 50;
})();

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

  const alreadyAnalyzed = isGameAnalyzed(capturedGame.id, fens.length);

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (
        result: {
          moveIndex: number;
          multipvRank: number;
          fen: string;
          scoreCp: number | null;
          scoreMate: number | null;
          bestMove: string;
          pv: string;
          depth: number;
          total: number;
        },
        phase: "shallow" | "deep",
      ): void => {
        const data = JSON.stringify({
          phase,
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
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      try {
        // Phase 1 — shallow scan (skipped if game already analyzed; deep phase
        // will yield cached rows for instant load).
        if (!alreadyAnalyzed) {
          // Persist shallow rank-1 — best-move arrow data lands in DB
          // immediately. Deep phase upserts overwrite with deeper rows.
          for await (const result of analyzeGame(capturedGame.id, fens, moves, {
            multipv: 1,
            movetimeMs: SHALLOW_MOVETIME_MS,
            persist: true,
          })) {
            emit(result, "shallow");
          }
        }

        // Phase 2 — deep analysis with MultiPV (persisted + motif tagging).
        let prior: AnalysisSnapshot | null = null;
        let priorIndex = -1;

        for await (const result of analyzeGame(capturedGame.id, fens, moves, {
          multipv,
          persist: true,
        })) {
          emit(result, "deep");

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
