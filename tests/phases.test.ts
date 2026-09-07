import { describe, it, expect } from "bun:test";
import { Chess } from "chess.js";
import { dividePhases } from "../server/lib/phases";

/** Build FENs from a PGN string (including the start position at index 0). */
function fensFromPgn(pgn: string): string[] {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const history = chess.history();
  const replay = new Chess();
  const fens = [replay.fen()];
  for (const san of history) {
    replay.move(san);
    fens.push(replay.fen());
  }
  return fens;
}

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("dividePhases", () => {
  it("start position has full material (mm = 14, no phase reached)", () => {
    const { middlegameStartPly, endgameStartPly } = dividePhases([START_FEN]);
    expect(middlegameStartPly).toBeNull();
    expect(endgameStartPly).toBeNull();
  });

  it("Scholar's mate stays in the opening (never reaches mm ≤ 10)", () => {
    const fens = fensFromPgn(`[Result "1-0"]

1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0`);
    const { middlegameStartPly, endgameStartPly } = dividePhases(fens);
    expect(middlegameStartPly).toBeNull();
    expect(endgameStartPly).toBeNull();
  });

  it("heavy-trade position reaches endgame (mm ≤ 6)", () => {
    // King + rook vs king — mm = 1, back-rank sparse.
    const krk = "8/8/8/8/8/8/4k3/R3K3 w - - 0 1";
    const { middlegameStartPly, endgameStartPly } = dividePhases([START_FEN, krk]);
    expect(middlegameStartPly).toBe(1);
    expect(endgameStartPly).toBe(1);
  });

  it("middlegame without endgame: mm between 7 and 10", () => {
    // 8 minor/major pieces present (mm = 8 > 6, so no endgame), back ranks still full.
    const mid = "rnbk3r/pppppppp/8/8/8/8/PPPPPPPP/RNBK3R w - - 0 1";
    const { middlegameStartPly, endgameStartPly } = dividePhases([START_FEN, mid]);
    expect(middlegameStartPly).toBe(1);
    expect(endgameStartPly).toBeNull();
  });

  it("back-rank sparseness alone triggers middlegame even with high mm", () => {
    // White developed almost everything off the back rank (< 4 own pieces there),
    // while material count is still high.
    const developed = "rnbqkbnr/pppppppp/8/8/8/2NNBB2/PPPQPPPP/R3K2R w KQkq - 0 1";
    const { middlegameStartPly } = dividePhases([START_FEN, developed]);
    expect(middlegameStartPly).toBe(1);
  });
});
