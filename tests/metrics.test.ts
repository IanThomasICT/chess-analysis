import { describe, it, expect } from "bun:test";
import {
  cpToWinPct,
  mateToCp,
  moveAccuracy,
  classifyMove,
  gameMetrics,
  plyAccuracies,
  combineAccuracy,
} from "../server/lib/metrics";
import type { AnalysisRow } from "../server/lib/engine";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRow(
  move_index: number,
  score_cp: number | null,
  score_mate: number | null = null,
): AnalysisRow {
  return {
    move_index,
    fen: `fen_${move_index}`,
    move_san: move_index === 0 ? null : `move_${move_index}`,
    score_cp,
    score_mate,
    best_move: "e2e4",
    depth: 20,
  };
}

// ── cpToWinPct ────────────────────────────────────────────────────────────────

describe("cpToWinPct", () => {
  it("returns ~50 at cp=0", () => {
    expect(cpToWinPct(0)).toBeCloseTo(50, 5);
  });

  it("returns close to 100 at cp=1000", () => {
    const v = cpToWinPct(1000);
    // Lichess sigmoid at ±1000 reaches ~97.5/2.5, not exactly 100/0
    expect(v).toBeGreaterThan(96);
    expect(v).toBeLessThanOrEqual(100);
  });

  it("returns close to 0 at cp=-1000", () => {
    const v = cpToWinPct(-1000);
    expect(v).toBeLessThan(4);
    expect(v).toBeGreaterThanOrEqual(0);
  });

  it("clamps cp=5000 to the cp=1000 value (no NaN, no >100)", () => {
    const v5000 = cpToWinPct(5000);
    const v1000 = cpToWinPct(1000);
    expect(v5000).toBeCloseTo(v1000, 8);
    expect(v5000).toBeLessThanOrEqual(100);
    expect(Number.isNaN(v5000)).toBe(false);
  });
});

// ── mateToCp ─────────────────────────────────────────────────────────────────

describe("mateToCp", () => {
  it("returns 1000 for mate in 3 (positive)", () => {
    expect(mateToCp(3)).toBe(1000);
  });

  it("returns -1000 for mate in -5 (being mated)", () => {
    expect(mateToCp(-5)).toBe(-1000);
  });
});

// ── moveAccuracy ──────────────────────────────────────────────────────────────

describe("moveAccuracy", () => {
  it("returns ~100 when eval unchanged (no drop)", () => {
    expect(moveAccuracy(50, 50)).toBeCloseTo(100, 0);
  });

  it("returns significantly less accuracy for a large drop than a small drop", () => {
    const highAcc = moveAccuracy(60, 55);  // 5pp drop
    const lowAcc = moveAccuracy(60, 10);   // 50pp drop
    expect(highAcc).toBeGreaterThan(lowAcc + 10);
  });

  it("clamps return values to [0, 100]", () => {
    const high = moveAccuracy(50, 50);
    const low = moveAccuracy(99, 0);
    expect(high).toBeLessThanOrEqual(100);
    expect(low).toBeGreaterThanOrEqual(0);
  });
});

// ── classifyMove ──────────────────────────────────────────────────────────────

describe("classifyMove", () => {
  it("50 → 50 (wpDelta 0pp) classified as best", () => {
    expect(classifyMove(50, 50)).toBe("best");
  });

  it("50 → 35 (wpDelta 15pp / 0.15) classified as inaccuracy", () => {
    expect(classifyMove(50, 35)).toBe("inaccuracy");
  });

  it("50 → 25 (wpDelta 25pp / 0.25) classified as mistake", () => {
    expect(classifyMove(50, 25)).toBe("mistake");
  });

  it("50 → 10 (wpDelta 40pp / 0.40) classified as blunder", () => {
    expect(classifyMove(50, 10)).toBe("blunder");
  });
});

// ── Lichess accuracy aggregation (plyAccuracies + combineAccuracy) ─────────────

describe("plyAccuracies + combineAccuracy", () => {
  it("all-perfect game scores ~100", () => {
    const flat = [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50];
    const acc = combineAccuracy(plyAccuracies(flat));
    expect(acc).not.toBeNull();
    expect(acc ?? 0).toBeGreaterThan(99);
  });

  it("window size is clamp(floor(plies/10), 2, 8)", () => {
    // 5 plies → 6 win% values → windowSize 2 → one entry per ply
    expect(plyAccuracies([50, 50, 50, 50, 50, 50])).toHaveLength(5);
    // 0 plies → empty
    expect(plyAccuracies([50])).toHaveLength(0);
  });

  it("harmonic mean punishes one big blunder more than a plain average", () => {
    // Nine perfect moves (100) and one catastrophic move (~0).
    const entries = [
      ...Array.from({ length: 9 }, () => ({ accuracy: 100, weight: 1 })),
      { accuracy: 0, weight: 1 },
    ];
    const combined = combineAccuracy(entries);
    const plainAverage = (9 * 100 + 0) / 10; // 90
    expect(combined).not.toBeNull();
    // Harmonic-mean half drags the result well below the plain 90 average.
    expect(combined ?? 0).toBeLessThan(plainAverage);
  });

  it("returns null for no entries", () => {
    expect(combineAccuracy([])).toBeNull();
  });
});

// ── gameMetrics ───────────────────────────────────────────────────────────────

describe("gameMetrics", () => {
  it("returns zero metrics for empty positions", () => {
    const result = gameMetrics([]);
    expect(result.white.accuracy).toBe(0);
    expect(result.white.blunders).toBe(0);
    expect(result.white.mistakes).toBe(0);
    expect(result.white.inaccuracies).toBe(0);
    expect(result.white.acl).toBe(0);
    expect(result.black.accuracy).toBe(0);
    expect(Number.isNaN(result.white.accuracy)).toBe(false);
    expect(Number.isNaN(result.black.acl)).toBe(false);
  });

  it("returns zero metrics for single position (no transitions)", () => {
    const result = gameMetrics([makeRow(0, 20)]);
    expect(result.white.accuracy).toBe(0);
    expect(result.black.accuracy).toBe(0);
    expect(Number.isNaN(result.white.accuracy)).toBe(false);
  });

  it("handles mate positions without NaN", () => {
    const positions: AnalysisRow[] = [
      makeRow(0, null, 5),   // White has mate in 5
      makeRow(1, null, -4),  // Black is being mated in 4
      makeRow(2, null, 3),   // White has mate in 3
    ];
    const result = gameMetrics(positions);
    expect(Number.isNaN(result.white.accuracy)).toBe(false);
    expect(Number.isNaN(result.black.accuracy)).toBe(false);
    expect(Number.isNaN(result.white.acl)).toBe(false);
    expect(Number.isNaN(result.black.acl)).toBe(false);
  });

  it("accuracy is within [0, 100] for both sides", () => {
    // 10 positions (9 transitions), hand-crafted
    const positions: AnalysisRow[] = [
      makeRow(0, 20),   // start
      makeRow(1, 15),   // after White move 1 — small drop
      makeRow(2, -10),  // after Black move 1 — Black makes small drop
      makeRow(3, 10),   // after White move 2
      makeRow(4, 0),    // after Black move 2
      makeRow(5, 50),   // after White move 3 — big gain for White
      makeRow(6, -30),  // after Black move 3
      makeRow(7, 30),   // after White move 4
      makeRow(8, 10),   // after Black move 4
      makeRow(9, 5),    // after White move 5
    ];
    const result = gameMetrics(positions);
    expect(result.white.accuracy).toBeGreaterThanOrEqual(0);
    expect(result.white.accuracy).toBeLessThanOrEqual(100);
    expect(result.black.accuracy).toBeGreaterThanOrEqual(0);
    expect(result.black.accuracy).toBeLessThanOrEqual(100);
  });

  it("White makes exactly 1 blunder, Black makes 0 blunders", () => {
    // 11 positions (10 transitions = 5 White moves, 5 Black moves)
    // Transition i → i+1: i even = White's move, i odd = Black's move
    //
    // White's blunder: transition 8 → 9 (i=8, White's move)
    //   cp goes from +200 (White perspective) to -200 (White perspective)
    //   from White's perspective: wpBefore = cpToWinPct(200) ≈ 72, wpAfter = cpToWinPct(-200) ≈ 28
    //   wpDelta ≈ 44pp / 0.44 → blunder (>0.30)
    //
    // All other transitions: small swings (<10pp) → best/good, no blunders
    const positions: AnalysisRow[] = [
      makeRow(0, 20),   // start
      makeRow(1, 15),   // after White move 1 (i=0): 20→15 White persp, mover drop tiny
      makeRow(2, -10),  // after Black move 1 (i=1): -15 → -(-10)=10 mover, small drop
      makeRow(3, 10),   // after White move 2 (i=2)
      makeRow(4, -5),   // after Black move 2 (i=3)
      makeRow(5, 25),   // after White move 3 (i=4)
      makeRow(6, -20),  // after Black move 3 (i=5): White persp goes -25→-20, Black persp 25→20, tiny drop
      makeRow(7, 200),  // after White move 4 (i=6): big swing but White gains so no penalty
      makeRow(8, 200),  // after Black move 4 (i=7): -200 → -200 mover, no change
      makeRow(9, -200), // after White move 5 (i=8): White's blunder! 200 → -200 White persp
      makeRow(10, -190), // after Black move 5 (i=9): -(-200) → -(-190) = 200→190 mover, tiny
    ];
    const result = gameMetrics(positions);
    expect(result.white.blunders).toBe(1);
    expect(result.black.blunders).toBe(0);
  });

  it("mover identification: transition 0→1 is White's move, 1→2 is Black's", () => {
    // White blunders on transition 0→1 (i=0, White's move)
    // Black blunders on transition 1→2 (i=1, Black's move)
    // Both: cp swings from 0 to ±400 from White's perspective
    const positions: AnalysisRow[] = [
      makeRow(0, 0),    // start: equal
      makeRow(1, -400), // after White's move: White dropped badly (blunder for White)
      makeRow(2, 400),  // after Black's move: Black dropped badly (blunder for Black)
    ];
    const result = gameMetrics(positions);
    expect(result.white.blunders).toBe(1);
    expect(result.black.blunders).toBe(1);
  });

  it("first 8 plies are skipped for ACL but still classified", () => {
    // Make White blunder on ply 1 (i=0) and on ply 9 (i=8)
    // ACL should only count the ply 9 blunder (i>=8), not the ply 1 blunder
    const positions: AnalysisRow[] = [
      makeRow(0, 0),    // i=0: start
      makeRow(1, -400), // after White ply 1: big blunder — classified but NOT in ACL (i=0, skip plies 0..7)
      makeRow(2, -380), // after Black ply 1: tiny
      makeRow(3, -360), // after White ply 2: tiny
      makeRow(4, -340), // after Black ply 2: tiny
      makeRow(5, -320), // after White ply 3: tiny
      makeRow(6, -300), // after Black ply 3: tiny
      makeRow(7, -280), // after White ply 4: tiny
      makeRow(8, -260), // after Black ply 4: tiny
      makeRow(9, 300),  // after White ply 5 (i=8): White gains massively — but from White's perspective gain, not a blunder
    ];
    const result = gameMetrics(positions);
    // Blunder at i=0 (White) is still classified
    expect(result.white.blunders).toBeGreaterThanOrEqual(1);
    // ACL: only plies i>=8 count. For White: i=8 is the only qualifying White move.
    // White cp before (i=8): -280 → cpBeforeMover = -(-280)=280 (Black's move, wait...)
    // Actually i=8 is even so it's White's move. White cp before = positions[8] = -260 White persp → cpBeforeMover = -260
    // White cp after = positions[9] = 300 → cpAfterMover = 300. White GAINED, so cpLoss = -260 - 300 = -560, clamped to 0.
    // So white ACL should be 0 (no positive losses after ply 8)
    expect(result.white.acl).toBe(0);
  });
});
