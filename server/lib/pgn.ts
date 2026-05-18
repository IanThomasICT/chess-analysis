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
 * Parse all PGN header tags and return them as a key→value record.
 * Matches lines of the form [Key "Value"]. Returns {} if no headers are found.
 */
export type PgnHeaders = Partial<Record<string, string>>;

export function pgnHeaders(pgn: string): PgnHeaders {
  const result: PgnHeaders = {};
  const re = /^\[(\w+)\s+"([^"]*)"\]/gm;
  let match = re.exec(pgn);
  while (match !== null) {
    result[match[1]] = match[2];
    match = re.exec(pgn);
  }
  return result;
}

/**
 * Extract a game result string from PGN headers or game data.
 */
export function getGameResult(pgn: string): string | null {
  return pgnHeaders(pgn).Result ?? null;
}

/**
 * Parse a `[%clk H:MM:SS.S]` string into total seconds. Returns null if unparseable.
 */
function clkToSeconds(clk: string): number | null {
  const m = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(clk);
  if (m === null) {return null;}
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const sec = parseFloat(m[3]);
  if (Number.isNaN(h) || Number.isNaN(min) || Number.isNaN(sec)) {return null;}
  return h * 3600 + min * 60 + sec;
}

/**
 * Walk PGN move list and pull the final `[%clk ...]` annotation for each side.
 * Chess.com PGNs annotate every move with the player's remaining clock AFTER they moved.
 * Plies alternate white/black starting from white; the LAST annotation for each side
 * is that side's remaining clock at the end of their last move played.
 *
 * Returns `{ white, black }` in seconds (float). Either side may be null if the PGN
 * has no clock annotations (e.g. daily games or older imports).
 */
export function pgnFinalClocks(pgn: string): {
  white: number | null;
  black: number | null;
} {
  const re = /\[%clk\s+([\d:.]+)\]/g;
  let i = 0;
  let lastWhite: number | null = null;
  let lastBlack: number | null = null;
  let m = re.exec(pgn);
  while (m !== null) {
    const secs = clkToSeconds(m[1]);
    if (secs !== null) {
      if (i % 2 === 0) {lastWhite = secs;}
      else {lastBlack = secs;}
    }
    i++;
    m = re.exec(pgn);
  }
  return { white: lastWhite, black: lastBlack };
}
