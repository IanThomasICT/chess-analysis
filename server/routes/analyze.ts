import { Hono } from "hono";
import { db } from "../lib/db";
import { pgnToFens, pgnToMoves } from "../lib/pgn";
import { analyzeGame } from "../lib/stockfish";

interface GameRow {
  id: string;
  pgn: string;
}

const analyze = new Hono();

analyze.get("/analyze/:gameId", (c) => {
  const gameId = c.req.param("gameId");

  const game = db
    .prepare("SELECT id, pgn FROM games WHERE id = ?")
    .get(gameId) as GameRow | null;

  if (game === null) {
    return c.json({ error: "Game not found" }, 404);
  }

  const fens = pgnToFens(game.pgn);
  const moves = pgnToMoves(game.pgn).map((m) => m.san);

  const encoder = new TextEncoder();
  const capturedGame = game;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const result of analyzeGame(capturedGame.id, fens, moves)) {
          const data = JSON.stringify({
            moveIndex: result.moveIndex,
            fen: result.fen,
            scoreCp: result.scoreCp,
            scoreMate: result.scoreMate,
            bestMove: result.bestMove,
            depth: result.depth,
            total: result.total,
          });
          controller.enqueue(encoder.encode("data: " + data + "\n\n"));
        }

        // Signal completion
        controller.enqueue(
          encoder.encode("data: " + JSON.stringify({ done: true }) + "\n\n")
        );
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Analysis failed";
        controller.enqueue(
          encoder.encode(
            "data: " + JSON.stringify({ error: message }) + "\n\n"
          )
        );
      } finally {
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
