import { describe, it, expect } from "bun:test";
import {
  detectMotifs,
  detectMissedMate,
  detectHangingPiece,
  detectFork,
  detectPin,
  detectSkewer,
  detectBackRankMate,
  type DetectMotifInput,
} from "../server/lib/motifs";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function base(overrides: Partial<DetectMotifInput> = {}): DetectMotifInput {
  return {
    fenBefore: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    playedMove: "e2e4",
    bestMove: "e2e4",
    scoreCpBefore: 20,
    scoreCpAfter: 20,
    scoreMateBefore: null,
    scoreMateAfter: null,
    ...overrides,
  };
}

// ─── detectMissedMate ─────────────────────────────────────────────────────────

describe("detectMissedMate", () => {
  it("returns true when mate-in-2 is available but not played", () => {
    expect(
      detectMissedMate(
        base({ scoreMateBefore: 2, scoreMateAfter: null, scoreCpAfter: -50 })
      )
    ).toBe(true);
  });

  it("returns true when mate-in-1 is missed", () => {
    expect(
      detectMissedMate(
        base({ scoreMateBefore: 1, scoreMateAfter: null, scoreCpAfter: 100 })
      )
    ).toBe(true);
  });

  it("returns true when opponent had mate-in-4 and it is now gone", () => {
    // negative mate: opponent's forced mate
    expect(
      detectMissedMate(
        base({ scoreMateBefore: -4, scoreMateAfter: null, scoreCpAfter: 50 })
      )
    ).toBe(true);
  });

  it("returns false when no mate was available", () => {
    expect(
      detectMissedMate(
        base({ scoreMateBefore: null, scoreMateAfter: null })
      )
    ).toBe(false);
  });

  it("returns false when scoreMateBefore is 0 (no mate)", () => {
    expect(
      detectMissedMate(
        base({ scoreMateBefore: 0, scoreMateAfter: null })
      )
    ).toBe(false);
  });

  it("returns false when mate is still available after move", () => {
    expect(
      detectMissedMate(
        base({ scoreMateBefore: 3, scoreMateAfter: 2 })
      )
    ).toBe(false);
  });
});

// ─── detectHangingPiece ───────────────────────────────────────────────────────

// After Qh5, the queen on h5 is attacked by black knight on f6 with no defender.
// FEN before Qh5: position after 1.e4 e5 2.Nc3 Nf6 (it is white's turn → white plays Qh5)
// playedMove = d1h5 (Queen from d1 to h5)
// After d1h5: Qh5 is attacked by Nf6, no white defender on h5.
const HANGING_QUEEN_FEN =
  "r1bqkb1r/pppp1ppp/2n2n2/4p3/4P3/2N5/PPPP1PPP/R1BQKBNR w KQkq - 2 3";

// White plays a move that leaves a rook on e1 hanging (knight takes it):
// Position: white rook e1, black knight d3 attacks e1, no defender
// FEN: 4k3/8/8/8/8/3n4/8/4R2K w - - 0 1 (white to move, plays h1g1 leaving Re1 still attacked)
const HANGING_ROOK_FEN = "4k3/8/8/8/8/3n4/8/4R2K w - - 0 1";

// White bishop d3, black rook d5 (same file = attacks d3), white plays King away (e1f1)
// leaving Bd3 undefended against Rd5.
const HANGING_BISHOP_FEN = "4k3/8/8/3r4/8/3B4/8/4K3 w - - 0 1";

describe("detectHangingPiece", () => {
  it("detects hanging queen after bad move", () => {
    expect(
      detectHangingPiece(
        base({ fenBefore: HANGING_QUEEN_FEN, playedMove: "d1h5" })
      )
    ).toBe(true);
  });

  it("detects hanging rook when mover ignores attacker", () => {
    // White plays h1g1, rook on e1 remains attacked by Nd3 (d3e1 knight move)
    // Nd3 attacks e1: from d3 a knight can go to (c1, b2, b4, c5, e5, f4, f2, e1) YES e1 is attacked
    expect(
      detectHangingPiece(
        base({ fenBefore: HANGING_ROOK_FEN, playedMove: "h1g1" })
      )
    ).toBe(true);
  });

  it("detects hanging bishop left under attack", () => {
    // White plays Ke1-f1, leaving Bd3 attacked by Rd5 with no defender
    expect(
      detectHangingPiece(
        base({ fenBefore: HANGING_BISHOP_FEN, playedMove: "e1f1" })
      )
    ).toBe(true);
  });

  it("returns false when piece is defended after move", () => {
    // Starting position: after e4, pawn e4 is defended by Nf3 (not yet) but no attacker
    expect(
      detectHangingPiece(
        base({
          fenBefore:
            "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
          playedMove: "e2e4",
        })
      )
    ).toBe(false);
  });

  it("returns false for invalid move", () => {
    expect(
      detectHangingPiece(base({ playedMove: "z9z9" }))
    ).toBe(false);
  });
});

// ─── detectFork ───────────────────────────────────────────────────────────────

// White knight on a4 moves to c5, forking black queen on d7 and black rook on b7.
// FEN: 1k6/1r1q4/8/8/N7/8/8/4K3 w - - 0 1
// bestMove: a4c5
const FORK_FEN = "1k6/1r1q4/8/8/N7/8/8/4K3 w - - 0 1";

// White knight on d3, bestMove d3e5. After Ne5: attacks d7(queen) and f7(rook).
// From e5: d7 diff(-1,+2) YES, f7 diff(+1,+2) YES.
const FORK_FEN2 = "1k6/3q1r2/8/8/8/3N4/8/4K3 w - - 0 1";

// White knight d4 bestMove d4e6 forks black queen d8 and black rook f8.
// From e6: d8 diff(-1,+2) YES, f8 diff(+1,+2) YES.
const FORK_FEN3 = "1k1q1r2/8/8/8/3N4/8/8/4K3 w - - 0 1";

describe("detectFork", () => {
  it("detects knight fork on queen and rook (a4c5)", () => {
    expect(
      detectFork(
        base({ fenBefore: FORK_FEN, bestMove: "a4c5" })
      )
    ).toBe(true);
  });

  it("detects knight fork after d3e5 (queen + rook)", () => {
    expect(
      detectFork(
        base({ fenBefore: FORK_FEN2, bestMove: "d3e5" })
      )
    ).toBe(true);
  });

  it("detects knight fork d4e6 (queen d8 + rook f8)", () => {
    expect(
      detectFork(
        base({ fenBefore: FORK_FEN3, bestMove: "d4e6" })
      )
    ).toBe(true);
  });

  it("returns false when piece attacks only one target", () => {
    // Knight on a4 moves to c5 but only one enemy piece nearby
    const singleTargetFen = "1k6/3q4/8/8/N7/8/8/4K3 w - - 0 1";
    expect(
      detectFork(
        base({ fenBefore: singleTargetFen, bestMove: "a4c5" })
      )
    ).toBe(false);
  });

  it("returns false for invalid bestMove", () => {
    expect(
      detectFork(base({ fenBefore: FORK_FEN, bestMove: "z9z9" }))
    ).toBe(false);
  });
});

// ─── detectPin ────────────────────────────────────────────────────────────────

// White bishop moves d3->c4, pinning black knight on f7 to black king on g8.
// Ray: c4->d5->e6->f7(knight)->g8(king). Knight < King → pin.
const PIN_FEN = "6k1/5n2/8/8/8/3B4/8/4K3 w - - 0 1";

// White rook moves a1->a6, pinning black bishop on a7 to black king on a8.
// FEN: 'k7/b7/8/8/8/8/8/R3K3 w Q - 0 1' (king a8, bishop a7)
// Ray: a6->a7(bishop)->a8(king). Bishop(3) < King(999) → pin.
const PIN_FEN2 = "k7/b7/8/8/8/8/8/R3K3 w Q - 0 1";

// White queen on d2 moves to e2, pinning black knight on e6 to black king on e8.
// Ray e2->e3->e4->e5->e6(knight)->e7->e8(king). Knight(3) < King → pin.
const PIN_FEN3 = "4k3/8/4n3/8/8/8/3Q4/4K3 w - - 0 1";

describe("detectPin", () => {
  it("detects bishop pin of knight against king (d3c4)", () => {
    expect(
      detectPin(
        base({ fenBefore: PIN_FEN, bestMove: "d3c4" })
      )
    ).toBe(true);
  });

  it("detects rook pin of bishop against king on a-file (a1a6)", () => {
    expect(
      detectPin(
        base({ fenBefore: PIN_FEN2, bestMove: "a1a6" })
      )
    ).toBe(true);
  });

  it("detects queen pin of knight to king on e-file (d2e2)", () => {
    expect(
      detectPin(
        base({ fenBefore: PIN_FEN3, bestMove: "d2e2" })
      )
    ).toBe(true);
  });

  it("returns false when sliding piece has no pin ray", () => {
    // Bishop on d3 moves to c4, no piece on the diagonal
    const noPin = "6k1/8/8/8/8/3B4/8/4K3 w - - 0 1";
    expect(
      detectPin(
        base({ fenBefore: noPin, bestMove: "d3c4" })
      )
    ).toBe(false);
  });

  it("returns false for non-sliding bestMove piece (knight)", () => {
    // Knight can't create a pin
    const knightFen = "1k3r2/3q4/8/8/8/3N4/8/4K3 w - - 0 1";
    expect(
      detectPin(
        base({ fenBefore: knightFen, bestMove: "d3e5" })
      )
    ).toBe(false);
  });
});

// ─── detectSkewer ─────────────────────────────────────────────────────────────

// White rook a1 moves to a2, skewering black queen on a7 (value 9) against black king on a8.
// Queen (9) is more valuable than king? No, king=999. Actually queen(9) < king(999).
// Skewer: MORE valuable piece closer, less valuable piece behind.
// So: rook attacks KING first, then QUEEN behind? That doesn't make chess sense normally.
//
// Re-read: skewer = the closer piece is MORE valuable than the one behind.
// Classic skewer: Rook attacks King, king moves, rook takes queen behind.
// So: closer = King (999? or less valuable...?). Hmm king is most valuable.
//
// Actually in practice: King is "forced to move" and then the piece behind gets taken.
// Closer piece (King, effectively max value for game purposes) vs farther piece (Queen, value 9).
// PIECE_VALUE: K=999, Q=9. So king(999) > queen(9) → skewer correctly: closer(King) > farther(Queen).
//
// FEN: black king on a8, black queen on a4, white rook moves from a1 to a2 to attack a-file
// Wait, let's ensure the ray goes: a2 -> a3 -> a4(queen, val 9) -> ... -> a8(king, val 999)?
// That would be a PIN (closer=queen val 9 < king val 999).
// For SKEWER we need: a2 -> a8 (king first) -> no queen behind (queen must be BEHIND king)
// So: ray goes up, hits king at a8 first, then if queen at... a9 doesn't exist.
//
// A proper skewer: white ROOK on a1, black KING on a3, black QUEEN on a7.
// Ray goes: a2->a3(king)->a4->...->a7(queen). King(999) > Queen(9). Closer is king → SKEWER.

// Black king a6, black queen a8. White rook on a1 moves to a4 (bestMove a1a4):
// After Ra4: ray goes a5->a6(king, 999)->a7->a8(queen, 9). King(999) > Queen(9) → SKEWER.
const SKEWER_FEN2 = "q7/8/k7/8/8/8/8/R3K3 w Q - 0 1";

// Rook on h1 skewers king on h7 with queen on h8 behind:
// bestMove h1h4: ray h5->h6->h7(king)->h8(queen). King(999) > Queen(9) → SKEWER.
const SKEWER_FEN3 = "7q/7k/8/8/8/8/8/4K2R w K - 0 1";

describe("detectSkewer", () => {
  it("detects rook skewer of king against queen on a-file", () => {
    expect(
      detectSkewer(
        base({ fenBefore: SKEWER_FEN2, bestMove: "a1a4" })
      )
    ).toBe(true);
  });

  it("detects rook skewer of king against queen on h-file", () => {
    expect(
      detectSkewer(
        base({ fenBefore: SKEWER_FEN3, bestMove: "h1h4" })
      )
    ).toBe(true);
  });

  it("detects bishop skewer on diagonal", () => {
    // White bishop on b2 moves to a1, skewering black king on c3 against black rook on e5.
    // From a1 NE: b2(empty after move)->c3(king, 999)->d4->e5(rook, 5). King(999) > Rook(5) → SKEWER.
    // White king on a2 (not e1) to avoid rook check on e-file.
    const bishopSkewerFen = "8/8/8/4r3/8/2k5/KB6/8 w - - 0 1";
    expect(
      detectSkewer(
        base({ fenBefore: bishopSkewerFen, bestMove: "b2a1" })
      )
    ).toBe(true);
  });

  it("returns false when closer piece is less valuable (that is a pin)", () => {
    // PIN scenario: bishop on c4, knight on f7 (val 3) closer, king on g8 (val 999) farther
    // Closer (3) < farther (999) → PIN, not skewer
    expect(
      detectSkewer(
        base({ fenBefore: PIN_FEN, bestMove: "d3c4" })
      )
    ).toBe(false);
  });

  it("returns false for invalid bestMove", () => {
    expect(
      detectSkewer(base({ bestMove: "z9z9" }))
    ).toBe(false);
  });
});

// ─── detectBackRankMate ───────────────────────────────────────────────────────

// White rook on d1 delivers back-rank mate with Rd8#
// FEN: 6k1/5ppp/8/8/8/8/8/3R3K w - - 0 1
// bestPv: 'd1d8' → checkmate, piece lands on d8 (rank 8)
const BACK_RANK_FEN = "6k1/5ppp/8/8/8/8/8/3R3K w - - 0 1";

// White queen on d1 delivers back-rank mate on d8 (king on g8, f7/g7/h7 pawns block escape).
// FEN: '6k1/5ppp/8/8/8/8/8/3Q3K w - - 0 1'
// bestPv: 'd1d8' → Qd8#
const BACK_RANK_FEN2 = "6k1/5ppp/8/8/8/8/8/3Q3K w - - 0 1";

// Back-rank mate from black side (rank 1):
// Black queen on d7 delivers mate on d1, white king a1 blocked by a2/b2/c2 pawns.
// FEN: '1k6/3q4/8/8/8/8/PPP5/K7 b - - 0 1'
// bestPv: 'd7d1' → Qd1#, checkmate on rank 1
const BACK_RANK_BLACK_FEN = "1k6/3q4/8/8/8/8/PPP5/K7 b - - 0 1";

describe("detectBackRankMate", () => {
  it("detects back-rank mate via PV on rank 8 (Rd8#)", () => {
    expect(
      detectBackRankMate(
        base({
          fenBefore: BACK_RANK_FEN,
          bestPv: "d1d8",
        })
      )
    ).toBe(true);
  });

  it("detects queen back-rank mate via PV on rank 8 (Qd8#)", () => {
    expect(
      detectBackRankMate(
        base({
          fenBefore: BACK_RANK_FEN2,
          bestPv: "d1d8",
        })
      )
    ).toBe(true);
  });

  it("detects back-rank mate on rank 1 by black queen (Qd1#)", () => {
    expect(
      detectBackRankMate(
        base({
          fenBefore: BACK_RANK_BLACK_FEN,
          bestPv: "d7d1",
        })
      )
    ).toBe(true);
  });

  it("returns false when PV is empty", () => {
    expect(
      detectBackRankMate(
        base({ fenBefore: BACK_RANK_FEN, bestPv: "" })
      )
    ).toBe(false);
  });

  it("returns false when PV is undefined", () => {
    expect(
      detectBackRankMate(
        base({ fenBefore: BACK_RANK_FEN, bestPv: undefined })
      )
    ).toBe(false);
  });

  it("returns false when PV move is checkmate but NOT on rank 1 or 8", () => {
    // Scholar's mate: queen on f7 is rank 7, not rank 1 or 8
    // FEN before Qxf7#: r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4
    const scholarsMateFen =
      "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
    expect(
      detectBackRankMate(
        base({ fenBefore: scholarsMateFen, bestPv: "h5f7" })
      )
    ).toBe(false);
  });
});

// ─── detectMotifs integration ─────────────────────────────────────────────────

describe("detectMotifs", () => {
  it("returns missed_mate first when available", () => {
    const result = detectMotifs(
      base({ scoreMateBefore: 1, scoreMateAfter: null, scoreCpAfter: 200 })
    );
    expect(result[0]).toBe("missed_mate");
  });

  it("caps results at 3 motifs", () => {
    // Create conditions for multiple motifs simultaneously
    // missed_mate is easy to trigger; others require board setup
    const result = detectMotifs(
      base({
        scoreMateBefore: 2,
        scoreMateAfter: null,
        scoreCpAfter: -100,
        fenBefore: BACK_RANK_FEN,
        bestMove: "d1d8",
        bestPv: "d1d8",
      })
    );
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it("returns empty array when no motifs detected", () => {
    // Normal opening move, no tactical themes
    const result = detectMotifs(
      base({
        fenBefore:
          "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        playedMove: "e2e4",
        bestMove: "e2e4",
        scoreMateBefore: null,
        scoreMateAfter: null,
      })
    );
    expect(result).toEqual([]);
  });

  it("respects priority order: missed_mate before back_rank_mate", () => {
    const result = detectMotifs(
      base({
        fenBefore: BACK_RANK_FEN,
        playedMove: "d1d7",
        bestMove: "d1d8",
        bestPv: "d1d8",
        scoreMateBefore: 1,
        scoreMateAfter: null,
        scoreCpAfter: 500,
      })
    );
    const missedIdx = result.indexOf("missed_mate");
    const backRankIdx = result.indexOf("back_rank_mate");
    if (missedIdx !== -1 && backRankIdx !== -1) {
      expect(missedIdx).toBeLessThan(backRankIdx);
    }
  });

  it("returns fork when fork is detected", () => {
    const result = detectMotifs(
      base({ fenBefore: FORK_FEN, bestMove: "a4c5" })
    );
    expect(result).toContain("fork");
  });

  it("returns hanging_piece when piece is hanging after move", () => {
    const result = detectMotifs(
      base({ fenBefore: HANGING_QUEEN_FEN, playedMove: "d1h5" })
    );
    expect(result).toContain("hanging_piece");
  });
});
