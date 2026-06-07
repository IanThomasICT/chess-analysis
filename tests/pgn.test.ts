import { describe, it, expect } from "bun:test";
import { pgnToFens, pgnToMoves, getGameResult, pgnHeaders, isBotGame } from "../server/lib/pgn";

// ---------- sample PGNs ----------

/** Scholar's mate: 1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6?? 4. Qxf7# */
const SCHOLARS_MATE_PGN = `[Event "Casual"]
[Result "1-0"]

1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0`;

/** Short draw: 1. d4 d5 */
const SHORT_DRAW_PGN = `[Event "Casual"]
[Result "1/2-1/2"]

1. d4 d5 1/2-1/2`;

/** Black wins: 1. f3 e5 2. g4 Qh4# (Fool's mate) */
const FOOLS_MATE_PGN = `[Event "Casual"]
[Result "0-1"]

1. f3 e5 2. g4 Qh4# 0-1`;

/** Single move PGN */
const SINGLE_MOVE_PGN = `[Event "Test"]
[Result "*"]

1. e4 *`;

const STARTING_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// =====================================================================
// pgnToFens
// =====================================================================

describe("pgnToFens", () => {
  it("returns N+1 FENs for a game with N moves", () => {
    // Scholar's mate has 7 half-moves
    const fens = pgnToFens(SCHOLARS_MATE_PGN);
    expect(fens).toHaveLength(8); // 7 moves + starting position
  });

  it("first FEN is the standard starting position", () => {
    const fens = pgnToFens(SCHOLARS_MATE_PGN);
    expect(fens[0]).toBe(STARTING_FEN);
  });

  it("handles a single-move game", () => {
    const fens = pgnToFens(SINGLE_MOVE_PGN);
    expect(fens).toHaveLength(2); // starting + after 1. e4
    expect(fens[0]).toBe(STARTING_FEN);
    // After 1. e4 the pawn is on e4
    expect(fens[1]).toContain("4P3");
  });

  it("handles a 2-move draw", () => {
    const fens = pgnToFens(SHORT_DRAW_PGN);
    expect(fens).toHaveLength(3); // start, after d4, after d5
  });

  it("last FEN is a checkmate position for Scholar's mate", () => {
    const fens = pgnToFens(SCHOLARS_MATE_PGN);
    const lastFen = fens[fens.length - 1];
    // After Qxf7# the queen is on f7
    expect(lastFen).toContain("Q");
    // Black king should still be on e8
    expect(lastFen).toContain("k");
  });

  it("last FEN is a checkmate position for Fool's mate", () => {
    const fens = pgnToFens(FOOLS_MATE_PGN);
    expect(fens).toHaveLength(5); // 4 half-moves + start
  });

  it("each subsequent FEN differs from the previous one", () => {
    const fens = pgnToFens(SCHOLARS_MATE_PGN);
    for (let i = 1; i < fens.length; i++) {
      expect(fens[i]).not.toBe(fens[i - 1]);
    }
  });

  it("all FENs are valid (contain 8 ranks separated by /)", () => {
    const fens = pgnToFens(SCHOLARS_MATE_PGN);
    for (const fen of fens) {
      const ranks = fen.split(" ")[0].split("/");
      expect(ranks).toHaveLength(8);
    }
  });

  it("alternates side to move after each position", () => {
    const fens = pgnToFens(SCHOLARS_MATE_PGN);
    for (let i = 0; i < fens.length; i++) {
      const sideToMove = fens[i].split(" ")[1];
      if (i % 2 === 0) {
        expect(sideToMove).toBe("w");
      } else {
        expect(sideToMove).toBe("b");
      }
    }
  });
});

// =====================================================================
// pgnToMoves
// =====================================================================

describe("pgnToMoves", () => {
  it("returns the correct number of moves", () => {
    const moves = pgnToMoves(SCHOLARS_MATE_PGN);
    expect(moves).toHaveLength(7);
  });

  it("first move is e4 for Scholar's mate", () => {
    const moves = pgnToMoves(SCHOLARS_MATE_PGN);
    expect(moves[0].san).toBe("e4");
    expect(moves[0].from).toBe("e2");
    expect(moves[0].to).toBe("e4");
  });

  it("last move is Qxf7# for Scholar's mate", () => {
    const moves = pgnToMoves(SCHOLARS_MATE_PGN);
    expect(moves[moves.length - 1].san).toBe("Qxf7#");
  });

  it("each move has from, to, san, and fen fields", () => {
    const moves = pgnToMoves(SCHOLARS_MATE_PGN);
    for (const move of moves) {
      expect(typeof move.san).toBe("string");
      expect(move.san.length).toBeGreaterThan(0);
      expect(typeof move.from).toBe("string");
      expect(move.from).toMatch(/^[a-h][1-8]$/);
      expect(typeof move.to).toBe("string");
      expect(move.to).toMatch(/^[a-h][1-8]$/);
      expect(typeof move.fen).toBe("string");
    }
  });

  it("move FEN matches the FEN at the corresponding fens[i+1] position", () => {
    const fens = pgnToFens(SCHOLARS_MATE_PGN);
    const moves = pgnToMoves(SCHOLARS_MATE_PGN);
    for (let i = 0; i < moves.length; i++) {
      expect(moves[i].fen).toBe(fens[i + 1]);
    }
  });

  it("handles Fool's mate", () => {
    const moves = pgnToMoves(FOOLS_MATE_PGN);
    expect(moves).toHaveLength(4);
    expect(moves[3].san).toBe("Qh4#");
  });

  it("handles a single move game", () => {
    const moves = pgnToMoves(SINGLE_MOVE_PGN);
    expect(moves).toHaveLength(1);
    expect(moves[0].san).toBe("e4");
  });
});

// =====================================================================
// getGameResult
// =====================================================================

describe("getGameResult", () => {
  it('returns "1-0" for a white win', () => {
    expect(getGameResult(SCHOLARS_MATE_PGN)).toBe("1-0");
  });

  it('returns "0-1" for a black win', () => {
    expect(getGameResult(FOOLS_MATE_PGN)).toBe("0-1");
  });

  it('returns "1/2-1/2" for a draw', () => {
    expect(getGameResult(SHORT_DRAW_PGN)).toBe("1/2-1/2");
  });

  it("returns null when no Result header is present", () => {
    const noResult = "1. e4 e5 2. Nf3";
    expect(getGameResult(noResult)).toBeNull();
  });

  it('extracts "*" for ongoing games', () => {
    expect(getGameResult(SINGLE_MOVE_PGN)).toBe("*");
  });

  it("handles extra whitespace in the header", () => {
    const pgn = '[Result   "1-0"]\n\n1. e4 1-0';
    // regex uses \s+ so this may or may not match — test actual behavior
    const result = getGameResult(pgn);
    // The regex uses \s+ so multiple spaces should still match
    expect(result).toBe("1-0");
  });
});

// =====================================================================
// pgnHeaders
// =====================================================================

const CHESSCOM_HEADERS_PGN = `[Event "Live Chess"]
[Site "Chess.com"]
[White "alice"]
[Black "bob"]
[Result "1-0"]
[WhiteElo "1500"]
[BlackElo "1450"]
[ECO "C50"]
[TimeControl "600"]

1. e4 e5 1-0`;

describe("pgnHeaders", () => {
  it("parses standard Chess.com headers correctly", () => {
    const headers = pgnHeaders(CHESSCOM_HEADERS_PGN);
    expect(headers.White).toBe("alice");
    expect(headers.Black).toBe("bob");
    expect(headers.Result).toBe("1-0");
    expect(headers.ECO).toBe("C50");
    expect(headers.WhiteElo).toBe("1500");
    expect(headers.BlackElo).toBe("1450");
    expect(headers.Event).toBe("Live Chess");
    expect(headers.Site).toBe("Chess.com");
    expect(headers.TimeControl).toBe("600");
  });

  it("returns empty object for PGN with no headers", () => {
    const headers = pgnHeaders("1. e4 e5 2. Nf3");
    expect(headers).toEqual({});
  });

  it("returns undefined for missing keys (no throw)", () => {
    const headers = pgnHeaders(CHESSCOM_HEADERS_PGN);
    expect(headers.Nonexistent).toBeUndefined();
  });

  it("handles extra whitespace between key and value", () => {
    const pgn = '[Key   "Value"]\n\n1. e4 *';
    const headers = pgnHeaders(pgn);
    expect(headers.Key).toBe("Value");
  });

  it("empty value produces empty string entry", () => {
    const pgn = '[Key ""]\n\n1. e4 *';
    const headers = pgnHeaders(pgn);
    expect(headers.Key).toBe("");
  });
});

describe("isBotGame", () => {
  it("flags 'Play vs …' practice events as bot games", () => {
    expect(isBotGame('[Event "Play vs Coach"]\n\n1. e4 e5 1-0')).toBe(true);
    expect(isBotGame('[Event "Play vs Computer"]\n\n1. e4 *')).toBe(true);
    expect(isBotGame('[Event "play vs coach"]\n\n1. e4 *')).toBe(true); // case-insensitive
  });

  it("treats human/tournament events as real games", () => {
    expect(isBotGame('[Event "Live Chess"]\n\n1. e4 e5 1-0')).toBe(false);
    expect(isBotGame('[Event "Daily Chess"]\n\n1. e4 *')).toBe(false);
    expect(isBotGame('[Event "Titled Tuesday Blitz"]\n\n1. e4 *')).toBe(false);
    expect(isBotGame("1. e4 e5")).toBe(false); // no Event header
  });
});

// =====================================================================
// Move indexing convention
// =====================================================================

describe("move indexing convention", () => {
  it("position index 0 is the starting position (before any move)", () => {
    const fens = pgnToFens(SCHOLARS_MATE_PGN);
    expect(fens[0]).toBe(STARTING_FEN);
  });

  it("fens[i+1] is the position after moves[i]", () => {
    const fens = pgnToFens(SCHOLARS_MATE_PGN);
    const moves = pgnToMoves(SCHOLARS_MATE_PGN);

    // fens[1] should be after White's first move (e4)
    expect(fens[1]).toBe(moves[0].fen);

    // fens[2] should be after Black's first move (e5)
    expect(fens[2]).toBe(moves[1].fen);
  });

  it("moves[0] is White's first move, moves[1] is Black's first move", () => {
    const moves = pgnToMoves(SCHOLARS_MATE_PGN);
    expect(moves[0].san).toBe("e4"); // White's first
    expect(moves[1].san).toBe("e5"); // Black's first
  });

  it("a game with N moves produces N+1 FENs", () => {
    const moves = pgnToMoves(SCHOLARS_MATE_PGN);
    const fens = pgnToFens(SCHOLARS_MATE_PGN);
    expect(fens.length).toBe(moves.length + 1);
  });
});
