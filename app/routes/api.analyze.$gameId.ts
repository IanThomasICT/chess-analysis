import type { Route } from "./+types/api.analyze.$gameId";
import { db } from "../lib/db.server";
import { pgnToFens, pgnToMoves } from "../lib/pgn";
import { analyzeGame } from "../lib/stockfish.server";

interface GameRow {
  id: string;
  pgn: string;
}

export async function loader({ params }: Route.LoaderArgs) {
  const { gameId } = params;

  const game = db
    .prepare("SELECT id, pgn FROM games WHERE id = ?")
    .get(gameId) as GameRow | null;

  if (!game) {
    return new Response("Game not found", { status: 404 });
  }

  const fens = pgnToFens(game.pgn);
  const moves = pgnToMoves(game.pgn).map((m) => m.san);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const result of analyzeGame(game.id, fens, moves)) {
          const data = JSON.stringify({
            moveIndex: result.moveIndex,
            fen: result.fen,
            scoreCp: result.scoreCp,
            scoreMate: result.scoreMate,
            bestMove: result.bestMove,
            depth: result.depth,
            total: result.total,
          });
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        }

        // Signal completion
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`)
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Analysis failed";
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: message })}\n\n`
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
}
