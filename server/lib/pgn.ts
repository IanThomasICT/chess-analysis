import { Chess } from "chess.js";

export interface MoveInfo {
  san: string;
  from: string;
  to: string;
  fen: string;
}

/**
 * Parse a PGN string and return an array of FENs (starting from the initial position).
 */
export function pgnToFens(pgn: string): string[] {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const history = chess.history({ verbose: true });

  const fens: string[] = [];
  const replay = new Chess();
  fens.push(replay.fen()); // starting position

  for (const move of history) {
    replay.move(move.san);
    fens.push(replay.fen());
  }

  return fens;
}

/**
 * Parse a PGN string and return detailed move information.
 */
export function pgnToMoves(pgn: string): MoveInfo[] {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const history = chess.history({ verbose: true });

  const moves: MoveInfo[] = [];
  const replay = new Chess();

  for (const move of history) {
    replay.move(move.san);
    moves.push({
      san: move.san,
      from: move.from,
      to: move.to,
      fen: replay.fen(),
    });
  }

  return moves;
}

/**
 * Extract a game result string from PGN headers or game data.
 */
export function getGameResult(pgn: string): string | null {
  const match = pgn.match(/\[Result\s+"([^"]+)"\]/);
  return match ? match[1] : null;
}
