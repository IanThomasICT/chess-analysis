import { describe, it, expect } from "bun:test";

// =====================================================================
// EvalBar score clamping and display logic
// These tests extract and validate the pure logic used in EvalBar.tsx
// without needing React rendering.
// =====================================================================

/** Replicates EvalBar score clamping: [-10, 10] -> [0%, 100%] */
function computeWhiteHeight(score: number): number {
  const clamped = Math.max(-10, Math.min(10, score));
  return ((clamped + 10) / 20) * 100;
}

/** Replicates the EvalBar display label logic */
function computeDisplayScore(score: number): string {
  if (Math.abs(score) >= 10) {
    return score > 0 ? "M" : "-M";
  }
  return score > 0 ? `+${score.toFixed(1)}` : score.toFixed(1);
}

describe("EvalBar score clamping", () => {
  it("score 0 -> white fills 50%", () => {
    expect(computeWhiteHeight(0)).toBe(50);
  });

  it("score +10 -> white fills 100%", () => {
    expect(computeWhiteHeight(10)).toBe(100);
  });

  it("score -10 -> white fills 0%", () => {
    expect(computeWhiteHeight(-10)).toBe(0);
  });

  it("score +5 -> white fills 75%", () => {
    expect(computeWhiteHeight(5)).toBe(75);
  });

  it("score -5 -> white fills 25%", () => {
    expect(computeWhiteHeight(-5)).toBe(25);
  });

  it("scores beyond +10 are clamped to 100%", () => {
    expect(computeWhiteHeight(15)).toBe(100);
    expect(computeWhiteHeight(100)).toBe(100);
  });

  it("scores beyond -10 are clamped to 0%", () => {
    expect(computeWhiteHeight(-15)).toBe(0);
    expect(computeWhiteHeight(-100)).toBe(0);
  });

  it("white height is always between 0% and 100%", () => {
    const testScores = [-100, -10, -5, -1, 0, 0.5, 1, 5, 10, 100];
    for (const s of testScores) {
      const h = computeWhiteHeight(s);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(100);
    }
  });

  it("is monotonically increasing with score", () => {
    const scores = [-10, -5, -2, -1, 0, 1, 2, 5, 10];
    for (let i = 1; i < scores.length; i++) {
      expect(computeWhiteHeight(scores[i])).toBeGreaterThan(
        computeWhiteHeight(scores[i - 1])
      );
    }
  });
});

describe("EvalBar display label", () => {
  it('displays "M" for mate (score >= 10)', () => {
    expect(computeDisplayScore(10)).toBe("M");
    expect(computeDisplayScore(15)).toBe("M");
  });

  it('displays "-M" for negative mate (score <= -10)', () => {
    expect(computeDisplayScore(-10)).toBe("-M");
    expect(computeDisplayScore(-15)).toBe("-M");
  });

  it("displays positive scores with + prefix", () => {
    expect(computeDisplayScore(1.5)).toBe("+1.5");
    expect(computeDisplayScore(0.3)).toBe("+0.3");
  });

  it("displays zero as 0.0 (no + prefix)", () => {
    expect(computeDisplayScore(0)).toBe("0.0");
  });

  it("displays negative scores without extra prefix", () => {
    expect(computeDisplayScore(-2.5)).toBe("-2.5");
    expect(computeDisplayScore(-0.1)).toBe("-0.1");
  });
});

// =====================================================================
// MoveList classification logic
// Replicates getMoveClass() from MoveList.tsx
// =====================================================================

interface AnalysisEntry {
  move_index: number;
  score_cp: number | null;
  score_mate: number | null;
}

/**
 * Replicates getMoveClass from MoveList.tsx.
 * moveIndex is 0-indexed by position: position before this move.
 */
function getMoveClass(
  moveIndex: number,
  analysis: AnalysisEntry[]
): string {
  if (analysis.length === 0) return "";

  const before = analysis.find((a) => a.move_index === moveIndex);
  const after = analysis.find((a) => a.move_index === moveIndex + 1);

  if (before === undefined || after === undefined) return "";

  const scoreBefore =
    before.score_mate !== null
      ? before.score_mate > 0
        ? 1000
        : -1000
      : (before.score_cp ?? 0);

  const scoreAfter =
    after.score_mate !== null
      ? after.score_mate > 0
        ? 1000
        : -1000
      : (after.score_cp ?? 0);

  // Even position index = white just played
  const isWhiteMove = moveIndex % 2 === 0;

  const swing = isWhiteMove
    ? scoreAfter - scoreBefore // White moved: higher = better for white
    : scoreBefore - scoreAfter; // Black moved: lower eval = better for black

  if (swing < -300) return "text-red-500 font-bold"; // blunder
  if (swing < -100) return "text-orange-500 font-semibold"; // mistake
  if (swing < -50) return "text-yellow-500"; // inaccuracy

  return "";
}

describe("MoveList classification (getMoveClass)", () => {
  it("returns empty string when analysis is empty", () => {
    expect(getMoveClass(0, [])).toBe("");
  });

  it("returns empty string when analysis entries are missing", () => {
    const analysis: AnalysisEntry[] = [
      { move_index: 0, score_cp: 20, score_mate: null },
    ];
    // No entry for move_index 1
    expect(getMoveClass(0, analysis)).toBe("");
  });

  it("classifies a blunder (swing < -300cp) for white", () => {
    const analysis: AnalysisEntry[] = [
      { move_index: 0, score_cp: 200, score_mate: null }, // before White move
      { move_index: 1, score_cp: -200, score_mate: null }, // after: swing = -400
    ];
    expect(getMoveClass(0, analysis)).toBe("text-red-500 font-bold");
  });

  it("classifies a mistake (swing < -100cp) for white", () => {
    const analysis: AnalysisEntry[] = [
      { move_index: 0, score_cp: 100, score_mate: null },
      { move_index: 1, score_cp: -50, score_mate: null }, // swing = -150
    ];
    expect(getMoveClass(0, analysis)).toBe("text-orange-500 font-semibold");
  });

  it("classifies an inaccuracy (swing < -50cp) for white", () => {
    const analysis: AnalysisEntry[] = [
      { move_index: 0, score_cp: 50, score_mate: null },
      { move_index: 1, score_cp: -10, score_mate: null }, // swing = -60
    ];
    expect(getMoveClass(0, analysis)).toBe("text-yellow-500");
  });

  it("returns empty for a normal move (swing >= -50cp)", () => {
    const analysis: AnalysisEntry[] = [
      { move_index: 0, score_cp: 20, score_mate: null },
      { move_index: 1, score_cp: 15, score_mate: null }, // swing = -5
    ];
    expect(getMoveClass(0, analysis)).toBe("");
  });

  it("classifies a blunder for black (odd moveIndex)", () => {
    // Black move: moveIndex=1 (odd), so isWhiteMove=false
    // swing = scoreBefore - scoreAfter
    const analysis: AnalysisEntry[] = [
      { move_index: 1, score_cp: -200, score_mate: null }, // before Black move
      { move_index: 2, score_cp: 200, score_mate: null }, // after: swing = -200 - 200 = -400
    ];
    expect(getMoveClass(1, analysis)).toBe("text-red-500 font-bold");
  });

  it("classifies a mistake for black", () => {
    const analysis: AnalysisEntry[] = [
      { move_index: 1, score_cp: -100, score_mate: null },
      { move_index: 2, score_cp: 50, score_mate: null }, // swing = -100 - 50 = -150
    ];
    expect(getMoveClass(1, analysis)).toBe("text-orange-500 font-semibold");
  });

  it("handles a good move for white (eval improves)", () => {
    const analysis: AnalysisEntry[] = [
      { move_index: 0, score_cp: 0, score_mate: null },
      { move_index: 1, score_cp: 100, score_mate: null }, // swing = +100
    ];
    expect(getMoveClass(0, analysis)).toBe(""); // good move, no annotation
  });

  it("handles mate scores correctly", () => {
    // White blunders: had +200cp, now Black has forced mate
    const analysis: AnalysisEntry[] = [
      { move_index: 0, score_cp: 200, score_mate: null },
      { move_index: 1, score_cp: null, score_mate: -3 }, // Black mates in 3 -> -1000
    ];
    // swing = -1000 - 200 = -1200
    expect(getMoveClass(0, analysis)).toBe("text-red-500 font-bold");
  });

  it("handles mate-to-mate transition", () => {
    // White had forced mate, still has it after move
    const analysis: AnalysisEntry[] = [
      { move_index: 0, score_cp: null, score_mate: 5 }, // +1000
      { move_index: 1, score_cp: null, score_mate: 4 }, // +1000
    ];
    // swing = 1000 - 1000 = 0
    expect(getMoveClass(0, analysis)).toBe("");
  });
});

// =====================================================================
// EvalGraph clamping logic
// =====================================================================

/** Replicates EvalGraph clamping: Y axis is [-5, 5] */
function clampEvalGraphScore(score: number): number {
  return Math.max(-5, Math.min(5, score));
}

/** Detect inflection points: |score[i] - score[i-1]| > 0.5 */
function isInflection(score: number, prevScore: number): boolean {
  return Math.abs(score - prevScore) > 0.5;
}

describe("EvalGraph score clamping", () => {
  it("clamps scores to [-5, 5] range", () => {
    expect(clampEvalGraphScore(0)).toBe(0);
    expect(clampEvalGraphScore(3)).toBe(3);
    expect(clampEvalGraphScore(-3)).toBe(-3);
    expect(clampEvalGraphScore(10)).toBe(5);
    expect(clampEvalGraphScore(-10)).toBe(-5);
    expect(clampEvalGraphScore(100)).toBe(5);
    expect(clampEvalGraphScore(-100)).toBe(-5);
  });
});

describe("EvalGraph inflection detection", () => {
  it("detects inflection when delta > 0.5", () => {
    expect(isInflection(1.0, 0.0)).toBe(true); // delta = 1.0
  });

  it("does not flag small changes", () => {
    expect(isInflection(0.3, 0.1)).toBe(false); // delta = 0.2
  });

  it("detects negative inflections", () => {
    expect(isInflection(-1.0, 0.0)).toBe(true); // delta = 1.0
  });

  it("boundary: exactly 0.5 is not an inflection", () => {
    expect(isInflection(0.5, 0.0)).toBe(false); // delta = 0.5, need > 0.5
  });

  it("boundary: 0.51 is an inflection", () => {
    expect(isInflection(0.51, 0.0)).toBe(true);
  });
});

// =====================================================================
// Score conversion (centipawns -> pawns, mate handling)
// From analysis.$gameId.tsx getCurrentScore logic
// =====================================================================

interface AnalysisRowScore {
  score_cp: number | null;
  score_mate: number | null;
}

/** Replicates getCurrentScore from analysis.$gameId.tsx */
function getCurrentScore(entry: AnalysisRowScore | undefined): number {
  if (entry === undefined) return 0;
  if (entry.score_mate !== null) {
    return entry.score_mate > 0 ? 10 : -10;
  }
  return (entry.score_cp ?? 0) / 100;
}

describe("score conversion (cp to pawns)", () => {
  it("returns 0 when no analysis entry exists", () => {
    expect(getCurrentScore(undefined)).toBe(0);
  });

  it("converts centipawns to pawns", () => {
    expect(getCurrentScore({ score_cp: 150, score_mate: null })).toBe(1.5);
    expect(getCurrentScore({ score_cp: -200, score_mate: null })).toBe(-2);
    expect(getCurrentScore({ score_cp: 0, score_mate: null })).toBe(0);
  });

  it("returns +10 for positive mate score", () => {
    expect(getCurrentScore({ score_cp: null, score_mate: 3 })).toBe(10);
    expect(getCurrentScore({ score_cp: null, score_mate: 1 })).toBe(10);
  });

  it("returns -10 for negative mate score", () => {
    expect(getCurrentScore({ score_cp: null, score_mate: -3 })).toBe(-10);
    expect(getCurrentScore({ score_cp: null, score_mate: -1 })).toBe(-10);
  });

  it("mate score takes precedence over cp score", () => {
    // Even if both are set, mate wins
    expect(getCurrentScore({ score_cp: 500, score_mate: -2 })).toBe(-10);
  });

  it("null score_cp defaults to 0", () => {
    expect(getCurrentScore({ score_cp: null, score_mate: null })).toBe(0);
  });
});

// =====================================================================
// Result mapping (Chess.com -> standard notation)
// From home.tsx loader
// =====================================================================

interface ChessComPlayer {
  result: string;
}

function mapResult(
  white: ChessComPlayer,
  black: ChessComPlayer
): string {
  if (white.result === "win") return "1-0";
  if (black.result === "win") return "0-1";
  return "1/2-1/2";
}

describe("result mapping (Chess.com -> standard)", () => {
  it('maps white win to "1-0"', () => {
    expect(
      mapResult({ result: "win" }, { result: "resigned" })
    ).toBe("1-0");
  });

  it('maps black win to "0-1"', () => {
    expect(
      mapResult({ result: "timeout" }, { result: "win" })
    ).toBe("0-1");
  });

  it('maps draws to "1/2-1/2"', () => {
    expect(
      mapResult({ result: "stalemate" }, { result: "stalemate" })
    ).toBe("1/2-1/2");
    expect(
      mapResult({ result: "agreed" }, { result: "agreed" })
    ).toBe("1/2-1/2");
    expect(
      mapResult({ result: "insufficient" }, { result: "insufficient" })
    ).toBe("1/2-1/2");
  });

  it("handles timeout result correctly", () => {
    expect(
      mapResult({ result: "win" }, { result: "timeout" })
    ).toBe("1-0");
    expect(
      mapResult({ result: "timeout" }, { result: "win" })
    ).toBe("0-1");
  });
});

// =====================================================================
// Result filtering logic (from home.tsx)
// =====================================================================

interface FilterableGame {
  white: string;
  black: string;
  result: string;
  time_class: string;
}

function matchesFilters(
  game: FilterableGame,
  username: string,
  textFilter: string,
  timeClassFilter: string,
  resultFilter: string
): boolean {
  // Text search
  if (textFilter !== "") {
    const search = textFilter.toLowerCase();
    const matchesWhite = game.white.toLowerCase().includes(search);
    const matchesBlack = game.black.toLowerCase().includes(search);
    if (!matchesWhite && !matchesBlack) return false;
  }

  // Time class filter
  if (timeClassFilter !== "all" && game.time_class !== timeClassFilter) {
    return false;
  }

  // Result filter
  if (resultFilter !== "all") {
    const isWhite = game.white.toLowerCase() === username.toLowerCase();
    const userWon =
      (isWhite && game.result === "1-0") ||
      (!isWhite && game.result === "0-1");
    const userLost =
      (isWhite && game.result === "0-1") ||
      (!isWhite && game.result === "1-0");
    const isDraw = game.result === "1/2-1/2";

    if (resultFilter === "win" && !userWon) return false;
    if (resultFilter === "loss" && !userLost) return false;
    if (resultFilter === "draw" && !isDraw) return false;
  }

  return true;
}

describe("game filtering logic", () => {
  const game: FilterableGame = {
    white: "Alice",
    black: "Bob",
    result: "1-0",
    time_class: "blitz",
  };

  it("no filters -> all games pass", () => {
    expect(matchesFilters(game, "alice", "", "all", "all")).toBe(true);
  });

  it("text filter matches white player name", () => {
    expect(matchesFilters(game, "alice", "Ali", "all", "all")).toBe(true);
  });

  it("text filter matches black player name", () => {
    expect(matchesFilters(game, "alice", "bob", "all", "all")).toBe(true);
  });

  it("text filter is case-insensitive", () => {
    expect(matchesFilters(game, "alice", "ALICE", "all", "all")).toBe(true);
    expect(matchesFilters(game, "alice", "BOB", "all", "all")).toBe(true);
  });

  it("text filter excludes non-matching games", () => {
    expect(matchesFilters(game, "alice", "carol", "all", "all")).toBe(false);
  });

  it("time class filter works", () => {
    expect(matchesFilters(game, "alice", "", "blitz", "all")).toBe(true);
    expect(matchesFilters(game, "alice", "", "rapid", "all")).toBe(false);
    expect(matchesFilters(game, "alice", "", "bullet", "all")).toBe(false);
  });

  it("result filter: wins (user is white and result is 1-0)", () => {
    expect(matchesFilters(game, "alice", "", "all", "win")).toBe(true);
    expect(matchesFilters(game, "alice", "", "all", "loss")).toBe(false);
  });

  it("result filter: wins (user is black and result is 0-1)", () => {
    const blackWin: FilterableGame = {
      white: "Alice",
      black: "Bob",
      result: "0-1",
      time_class: "blitz",
    };
    expect(matchesFilters(blackWin, "bob", "", "all", "win")).toBe(true);
    expect(matchesFilters(blackWin, "alice", "", "all", "win")).toBe(false);
  });

  it("result filter: losses", () => {
    expect(matchesFilters(game, "bob", "", "all", "loss")).toBe(true); // Bob lost (black, result 1-0)
    expect(matchesFilters(game, "alice", "", "all", "loss")).toBe(false);
  });

  it("result filter: draws", () => {
    const draw: FilterableGame = {
      white: "Alice",
      black: "Bob",
      result: "1/2-1/2",
      time_class: "rapid",
    };
    expect(matchesFilters(draw, "alice", "", "all", "draw")).toBe(true);
    expect(matchesFilters(draw, "bob", "", "all", "draw")).toBe(true);
    expect(matchesFilters(draw, "alice", "", "all", "win")).toBe(false);
  });

  it("multiple filters combine (AND logic)", () => {
    expect(matchesFilters(game, "alice", "bob", "blitz", "win")).toBe(true);
    expect(matchesFilters(game, "alice", "bob", "rapid", "win")).toBe(false);
    expect(matchesFilters(game, "alice", "carol", "blitz", "win")).toBe(false);
  });
});

// =====================================================================
// Game ID extraction (from Chess.com URL)
// =====================================================================

function extractGameId(url: string): string {
  return url.split("/").pop() ?? url;
}

describe("game ID extraction from Chess.com URL", () => {
  it("extracts numeric ID from full URL", () => {
    expect(
      extractGameId("https://www.chess.com/game/live/123456789")
    ).toBe("123456789");
  });

  it("handles URL without trailing slash", () => {
    expect(extractGameId("https://chess.com/game/42")).toBe("42");
  });

  it("returns input if no slashes", () => {
    expect(extractGameId("abc")).toBe("abc");
  });
});
