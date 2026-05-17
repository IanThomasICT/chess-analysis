import { Chess, type Square, type Color } from "chess.js";

export type Motif =
  | "hanging_piece"
  | "fork"
  | "pin"
  | "skewer"
  | "back_rank_mate"
  | "missed_mate";

export interface DetectMotifInput {
  fenBefore: string; // position BEFORE the played move
  playedMove: string; // UCI of move played by the user (e.g. "e2e4")
  bestMove: string; // UCI of engine's best move at fenBefore
  scoreCpBefore: number | null;
  scoreCpAfter: number | null;
  scoreMateBefore: number | null;
  scoreMateAfter: number | null;
  bestPv?: string; // engine PV after bestMove, space-separated UCI
}

// Piece values for hanging/fork/pin/skewer calculations
const PIECE_VALUE: Record<string, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 999,
};

// Ray directions for sliding pieces
const BISHOP_RAYS: Array<[number, number]> = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const ROOK_RAYS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const QUEEN_RAYS: Array<[number, number]> = [...BISHOP_RAYS, ...ROOK_RAYS];

function squareToCoords(sq: Square): [number, number] {
  const file = sq.charCodeAt(0) - "a".charCodeAt(0); // 0–7
  const rank = parseInt(sq[1], 10) - 1; // 0–7
  return [file, rank];
}

function coordsToSquare(file: number, rank: number): Square | null {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) {return null;}
  const sq = String.fromCharCode("a".charCodeAt(0) + file) + String(rank + 1);
  return sq as Square;
}

function uciToMove(uci: string): { from: Square; to: Square; promotion?: string } {
  return {
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
    promotion: uci[4],
  };
}

/** Apply a UCI move to a position. Returns new Chess instance or null on failure. */
function applyUci(fen: string, uci: string): Chess | null {
  try {
    const chess = new Chess(fen);
    const { from, to, promotion } = uciToMove(uci);
    chess.move({ from, to, promotion });
    return chess;
  } catch {
    return null;
  }
}

/**
 * missed_mate: the mover had a forced mate, played a non-mating move,
 * and the position is no longer a forced mate after their move.
 */
export function detectMissedMate(input: DetectMotifInput): boolean {
  const { scoreMateBefore, scoreMateAfter } = input;
  return (
    scoreMateBefore !== null &&
    scoreMateBefore !== 0 &&
    scoreMateAfter === null
  );
}

/**
 * hanging_piece: after the played move, one of the mover's pieces is attacked
 * by the opponent with no equal-or-greater-value defender.
 */
export function detectHangingPiece(input: DetectMotifInput): boolean {
  const after = applyUci(input.fenBefore, input.playedMove);
  if (after === null) {return false;}

  // The mover's color is the one who just moved (opposite of whose turn it now is)
  const opponentColor = after.turn(); // after the move, it's the opponent's turn
  const moverColor: Color = opponentColor === "w" ? "b" : "w";

  for (const sq of getAllSquares()) {
    const piece = after.get(sq);
    if (piece?.color !== moverColor) {continue;}
    if (piece.type === "k") {continue;} // skip king

    const attackers = after.attackers(sq, opponentColor);
    if (attackers.length === 0) {continue;}

    const defenders = after.attackers(sq, moverColor);

    if (defenders.length === 0) {
      // Attacked with no defenders → hanging
      return true;
    }

    // Check if lowest-value attacker beats the piece with no sufficient defense
    const pieceVal = PIECE_VALUE[piece.type] ?? 1;
    const minAttackerVal = Math.min(
      ...attackers.map((s) => {
        const p = after.get(s);
        return p !== undefined ? (PIECE_VALUE[p.type] ?? 1) : 999;
      })
    );
    const minDefenderVal = Math.min(
      ...defenders.map((s) => {
        const p = after.get(s);
        return p !== undefined ? (PIECE_VALUE[p.type] ?? 1) : 999;
      })
    );

    // If the attacker can take without losing material (attacker value < piece value,
    // and no sufficient defender to recapture at profit)
    if (minAttackerVal < pieceVal && minDefenderVal > pieceVal) {
      return true;
    }
  }

  return false;
}

/**
 * fork: after bestMove, the moved piece attacks ≥ 2 opponent pieces of value ≥ 3.
 */
export function detectFork(input: DetectMotifInput): boolean {
  const { fenBefore, bestMove } = input;
  if (bestMove === "" || bestMove.length < 4) {return false;}

  const after = applyUci(fenBefore, bestMove);
  if (after === null) {return false;}

  // After bestMove it is the opponent's turn; the mover is the opposite
  const opponentColor = after.turn(); // opponent
  const landSq = bestMove.slice(2, 4) as Square;

  const movedPiece = after.get(landSq);
  if (movedPiece === undefined) {return false;}

  // Count enemy pieces of value ≥ 3 attacked by the piece that just moved
  let targets = 0;
  for (const sq of getAllSquares()) {
    const piece = after.get(sq);
    if (piece?.color !== opponentColor) {continue;}
    const val = PIECE_VALUE[piece.type] ?? 1;
    if (val < 3) {continue;} // only minor pieces and above
    const attackers = after.attackers(sq, movedPiece.color);
    if (attackers.includes(landSq)) {
      targets++;
    }
  }

  return targets >= 2;
}

/**
 * pin: after bestMove, the moved sliding piece (B/R/Q) has a ray where
 * there is an enemy piece with a MORE valuable enemy piece behind it.
 * (Closer = less valuable → pin)
 */
export function detectPin(input: DetectMotifInput): boolean {
  const { fenBefore, bestMove } = input;
  if (bestMove === "" || bestMove.length < 4) {return false;}

  const after = applyUci(fenBefore, bestMove);
  if (after === null) {return false;}

  const opponentColor = after.turn();
  const landSq = bestMove.slice(2, 4) as Square;
  const movedPiece = after.get(landSq);
  if (movedPiece === undefined) {return false;}

  const rays = getSlidingRays(movedPiece.type);
  if (rays === null) {return false;}

  const [startFile, startRank] = squareToCoords(landSq);

  for (const [df, dr] of rays) {
    const pieces: Array<{ type: string; color: Color }> = [];
    let f = startFile + df;
    let r = startRank + dr;

    while (f >= 0 && f <= 7 && r >= 0 && r <= 7) {
      const sq = coordsToSquare(f, r);
      if (sq !== null) {
        const p = after.get(sq);
        if (p !== undefined) {
          if (p.color === opponentColor) {
            pieces.push(p);
          } else {
            break; // own piece blocks the ray
          }
          if (pieces.length >= 2) {break;}
        }
      }
      f += df;
      r += dr;
    }

    if (pieces.length === 2) {
      const closerVal = PIECE_VALUE[pieces[0].type] ?? 1;
      const fartherVal = PIECE_VALUE[pieces[1].type] ?? 999;
      // Pin: closer piece is LESS valuable than the one behind
      if (closerVal < fartherVal) {
        return true;
      }
    }
  }

  return false;
}

/**
 * skewer: after bestMove, the moved sliding piece (B/R/Q) has a ray where
 * the closer enemy piece is MORE valuable than the one behind it.
 * (Opposite of pin)
 */
export function detectSkewer(input: DetectMotifInput): boolean {
  const { fenBefore, bestMove } = input;
  if (bestMove === "" || bestMove.length < 4) {return false;}

  const after = applyUci(fenBefore, bestMove);
  if (after === null) {return false;}

  const opponentColor = after.turn();
  const landSq = bestMove.slice(2, 4) as Square;
  const movedPiece = after.get(landSq);
  if (movedPiece === undefined) {return false;}

  const rays = getSlidingRays(movedPiece.type);
  if (rays === null) {return false;}

  const [startFile, startRank] = squareToCoords(landSq);

  for (const [df, dr] of rays) {
    const pieces: Array<{ type: string; color: Color }> = [];
    let f = startFile + df;
    let r = startRank + dr;

    while (f >= 0 && f <= 7 && r >= 0 && r <= 7) {
      const sq = coordsToSquare(f, r);
      if (sq !== null) {
        const p = after.get(sq);
        if (p !== undefined) {
          if (p.color === opponentColor) {
            pieces.push(p);
          } else {
            break;
          }
          if (pieces.length >= 2) {break;}
        }
      }
      f += df;
      r += dr;
    }

    if (pieces.length === 2) {
      const closerVal = PIECE_VALUE[pieces[0].type] ?? 1;
      const fartherVal = PIECE_VALUE[pieces[1].type] ?? 1;
      // Skewer: closer piece is MORE valuable than the one behind
      if (closerVal > fartherVal) {
        return true;
      }
    }
  }

  return false;
}

/**
 * back_rank_mate: the engine's PV ends in checkmate, and the mating piece
 * lands on rank 1 or rank 8.
 */
export function detectBackRankMate(input: DetectMotifInput): boolean {
  const { fenBefore, bestPv } = input;
  if (bestPv === undefined || bestPv === "") {return false;}

  const pvMoves = bestPv.trim().split(/\s+/).filter((m) => m.length >= 4);
  if (pvMoves.length === 0) {return false;}

  let chess: Chess;
  try {
    chess = new Chess(fenBefore);
  } catch {
    return false;
  }

  let lastTo = "";
  for (const uci of pvMoves) {
    try {
      const { from, to, promotion } = uciToMove(uci);
      chess.move({ from, to, promotion });
      lastTo = to;
    } catch {
      return false;
    }
  }

  if (!chess.isCheckmate()) {return false;}
  if (lastTo.length < 2) {return false;}
  const rank = lastTo[1];
  return rank === "1" || rank === "8";
}

// ─── Priority + cap ───────────────────────────────────────────────────────────

const PRIORITY: readonly Motif[] = [
  "missed_mate",
  "back_rank_mate",
  "fork",
  "pin",
  "skewer",
  "hanging_piece",
];

/**
 * Detect up to 3 motifs for this blunder position.
 * Returns tags in priority order (highest priority first).
 */
export function detectMotifs(input: DetectMotifInput): Motif[] {
  const all: Motif[] = [];
  if (detectMissedMate(input)) {all.push("missed_mate");}
  if (detectBackRankMate(input)) {all.push("back_rank_mate");}
  if (detectFork(input)) {all.push("fork");}
  if (detectPin(input)) {all.push("pin");}
  if (detectSkewer(input)) {all.push("skewer");}
  if (detectHangingPiece(input)) {all.push("hanging_piece");}
  return all.slice(0, 3);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function getAllSquares(): Square[] {
  const squares: Square[] = [];
  for (let f = 0; f < 8; f++) {
    for (let r = 0; r < 8; r++) {
      const sq = coordsToSquare(f, r);
      if (sq !== null) {squares.push(sq);}
    }
  }
  return squares;
}

function getSlidingRays(pieceType: string): Array<[number, number]> | null {
  switch (pieceType) {
    case "b":
      return BISHOP_RAYS;
    case "r":
      return ROOK_RAYS;
    case "q":
      return QUEEN_RAYS;
    default:
      return null;
  }
}

// Re-export types for consumers
export type { Square, Color };

// Silence unused PRIORITY warning — used for documentation
void (PRIORITY satisfies readonly Motif[]);
