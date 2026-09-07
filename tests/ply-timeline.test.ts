import { describe, it, expect } from "bun:test";
import { buildTimeline, isCritical } from "../server/lib/ply-timeline";
import type { AnalysisRowMPV } from "../server/lib/engine";
import type { PhaseBoundaries } from "../server/lib/phases";

const NO_PHASES: PhaseBoundaries = { middlegameStartPly: null, endgameStartPly: null };

interface RowOpts {
  cp?: number | null;
  mate?: number | null;
  san?: string | null;
  best?: string;
}

function row(moveIndex: number, rank: number, o: RowOpts = {}): AnalysisRowMPV {
  return {
    move_index: moveIndex,
    multipv_rank: rank,
    fen: `fen_${String(moveIndex)}`,
    fen_key: null,
    move_san: o.san ?? (moveIndex > 0 ? `m${String(moveIndex)}` : null),
    score_cp: o.cp ?? null,
    score_mate: o.mate ?? null,
    best_move: o.best ?? "e2e4",
    pv: null,
    depth: 20,
  };
}

describe("buildTimeline — basic shape", () => {
  it("returns one entry per ply with correct side alternation", () => {
    const rows = [row(0, 1, { cp: 20 }), row(1, 1, { cp: 10 }), row(2, 1, { cp: 15 })];
    const tl = buildTimeline("", rows, "w", NO_PHASES);
    expect(tl).toHaveLength(2);
    expect(tl[0].side).toBe("w");
    expect(tl[0].plyIndex).toBe(1);
    expect(tl[1].side).toBe("b");
    expect(tl[0].isUserMove).toBe(true);
    expect(tl[1].isUserMove).toBe(false);
  });

  it("returns empty for fewer than 2 positions", () => {
    expect(buildTimeline("", [row(0, 1, { cp: 0 })], "w", NO_PHASES)).toHaveLength(0);
  });
});

describe("buildTimeline — wpLoss + classification", () => {
  it("a White move dropping +200 → -200 (White persp) is a blunder", () => {
    const rows = [row(0, 1, { cp: 200 }), row(1, 1, { cp: -200 })];
    const tl = buildTimeline("", rows, "w", NO_PHASES);
    expect(tl[0].wpLoss).toBeGreaterThan(30);
    expect(tl[0].moveClass).toBe("blunder");
  });

  it("a tiny eval change is classified best/good with near-zero wpLoss", () => {
    const rows = [row(0, 1, { cp: 20 }), row(1, 1, { cp: 18 })];
    const tl = buildTimeline("", rows, "w", NO_PHASES);
    expect(tl[0].wpLoss).toBeLessThan(2);
    expect(["best", "good"]).toContain(tl[0].moveClass);
  });
});

describe("buildTimeline — synthetic mate Win% (D27)", () => {
  it("mate-in-1 reads ~99.99, mate-in-7 ~99.93 (White perspective)", () => {
    const m1 = buildTimeline("", [row(0, 1, { cp: 0 }), row(1, 1, { mate: 1 })], "w", NO_PHASES);
    const m7 = buildTimeline("", [row(0, 1, { cp: 0 }), row(1, 1, { mate: 7 })], "w", NO_PHASES);
    // ply 0 is White's move; after-position is White-perspective via flip (white → no flip)
    expect(m1[0].winPctAfter).toBeCloseTo(99.99, 2);
    expect(m7[0].winPctAfter).toBeCloseTo(99.93, 2);
    expect(m1[0].winPctAfter).toBeGreaterThan(m7[0].winPctAfter);
  });
});

describe("buildTimeline — criticality (D9)", () => {
  it("rank-2 present → criticality = rank1−rank2 gap (mover perspective)", () => {
    const rows = [
      row(0, 1, { cp: 300 }),
      row(0, 2, { cp: 0 }),
      row(1, 1, { cp: 290 }),
    ];
    const tl = buildTimeline("", rows, "w", NO_PHASES);
    expect(tl[0].rank2WinPct).not.toBeNull();
    expect(tl[0].criticality).not.toBeNull();
    expect(tl[0].criticality ?? 0).toBeGreaterThan(15);
    expect(isCritical(tl[0])).toBe(true);
  });

  it("no rank-2 → criticality null and not critical", () => {
    const rows = [row(0, 1, { cp: 300 }), row(1, 1, { cp: 290 })];
    const tl = buildTimeline("", rows, "w", NO_PHASES);
    expect(tl[0].criticality).toBeNull();
    expect(isCritical(tl[0])).toBe(false);
  });
});

describe("buildTimeline — think time (D4)", () => {
  const CLOCK_PGN = `[TimeControl "180+2"]

1. e4 {[%clk 0:03:00]} e5 {[%clk 0:03:00]} 2. Nf3 {[%clk 0:02:50]} Nc6 {[%clk 0:02:55]} 1-0`;

  it("computes per-side think time including increment", () => {
    const rows = [
      row(0, 1, { cp: 20 }),
      row(1, 1, { cp: 15 }),
      row(2, 1, { cp: 10 }),
      row(3, 1, { cp: 12 }),
      row(4, 1, { cp: 8 }),
    ];
    const tl = buildTimeline(CLOCK_PGN, rows, "w", NO_PHASES);
    // White ply 1: base 180 → 180 remaining, +2 inc → think 2s.
    expect(tl[0].thinkTimeS).toBeCloseTo(2, 5);
    // White ply 3 (plyIndex 3): prev white clock 180, now 170, +2 → 12s.
    expect(tl[2].thinkTimeS).toBeCloseTo(12, 5);
  });

  it("no clocks → all think times null", () => {
    const rows = [row(0, 1, { cp: 20 }), row(1, 1, { cp: 15 }), row(2, 1, { cp: 10 })];
    const tl = buildTimeline("", rows, "w", NO_PHASES);
    expect(tl.every((p) => p.thinkTimeS === null)).toBe(true);
  });
});

describe("buildTimeline — decided positions (D22/D28)", () => {
  it("leading side's moves after the win is locked in are marked decided", () => {
    // White climbs to a winning eval (cp 1000 ≈ 97.5% ≥ 95) from position 3 onward.
    const rows = [
      row(0, 1, { cp: 20 }),
      row(1, 1, { cp: 50 }),
      row(2, 1, { cp: 300 }),
      row(3, 1, { cp: 1000 }),
      row(4, 1, { cp: 1000 }),
      row(5, 1, { cp: 1000 }),
      row(6, 1, { cp: 1000 }),
    ];
    const tl = buildTimeline("", rows, "w", NO_PHASES);
    // White move at beforePos 4 (plyIndex 5) is in a decided position → excluded.
    const whiteDecided = tl.find((p) => p.plyIndex === 5);
    expect(whiteDecided?.side).toBe("w");
    expect(whiteDecided?.isDecided).toBe(true);
    // A Black move (trailing side) is never marked decided.
    expect(tl.filter((p) => p.side === "b").every((p) => !p.isDecided)).toBe(true);
  });

  it("balanced game has no decided plies", () => {
    const rows = [row(0, 1, { cp: 10 }), row(1, 1, { cp: -5 }), row(2, 1, { cp: 8 })];
    const tl = buildTimeline("", rows, "w", NO_PHASES);
    expect(tl.every((p) => !p.isDecided)).toBe(true);
  });
});

describe("buildTimeline — phases", () => {
  it("assigns phase from boundaries by before-position index", () => {
    const rows = [
      row(0, 1, { cp: 10 }),
      row(1, 1, { cp: 10 }),
      row(2, 1, { cp: 10 }),
      row(3, 1, { cp: 10 }),
      row(4, 1, { cp: 10 }),
      row(5, 1, { cp: 10 }),
    ];
    const tl = buildTimeline("", rows, "w", { middlegameStartPly: 2, endgameStartPly: 4 });
    expect(tl[0].phase).toBe("opening");    // beforePos 0
    expect(tl[2].phase).toBe("middlegame"); // beforePos 2
    expect(tl[4].phase).toBe("endgame");    // plyIndex 5 → beforePos 4
  });
});
