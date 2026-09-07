import { describe, it, expect, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, rmSync } from "node:fs";
import { buildTimeline } from "../server/lib/ply-timeline";
import { buildGameMetrics, type GameMetricsContext } from "../server/lib/game-metrics";
import { setExplorerDbPath, EXPLORER_SCHEMA, EXPLORER_TABLE } from "../server/lib/explorer";
import type { AnalysisRowMPV } from "../server/lib/engine";
import type { PhaseBoundaries } from "../server/lib/phases";

const NO_PHASES: PhaseBoundaries = { middlegameStartPly: null, endgameStartPly: null };

function r(moveIndex: number, rank: number, cp: number | null, mate: number | null = null): AnalysisRowMPV {
  return {
    move_index: moveIndex,
    multipv_rank: rank,
    fen: `fen_${String(moveIndex)}`,
    fen_key: null,
    move_san: moveIndex > 0 ? `m${String(moveIndex)}` : null,
    score_cp: cp,
    score_mate: mate,
    best_move: "e2e4",
    pv: null,
    depth: 20,
  };
}

function rank1(cps: Array<number | null>): AnalysisRowMPV[] {
  return cps.map((cp, i) => r(i, 1, cp));
}

function ctx(over: Partial<GameMetricsContext> = {}): GameMetricsContext {
  return {
    pgn: "",
    userColor: "w",
    phases: NO_PHASES,
    baseSeconds: null,
    engineDepthMin: 20,
    rank1Count: 0,
    multipvMax: 1,
    ...over,
  };
}

describe("buildGameMetrics — provenance + no clocks", () => {
  it("stamps version, analysis_sig, and reports no clocks", () => {
    const rows = rank1([10, -10, 10, -10, 10]);
    const tl = buildTimeline("", rows, "w", NO_PHASES);
    const m = buildGameMetrics(tl, ctx({ rank1Count: 5 }));
    expect(m.metricsVersion).toBe(2);
    expect(m.analysisSig).toBe("20:5");
    expect(m.clocksAvailable).toBe(0);
    expect(m.timeTroubleMoves).toBeNull();
    expect(m.avgMoveTimeS).toBeNull();
    expect(m.timeAllocEfficiency).toBeNull();
  });
});

describe("buildGameMetrics — blunder run + recovery", () => {
  it("zero blunders → maxRun 0, recovery null", () => {
    const tl = buildTimeline("", rank1([10, -10, 10, -10, 10, -10]), "w", NO_PHASES);
    const m = buildGameMetrics(tl, ctx());
    expect(m.maxBlunderRun).toBe(0);
    expect(m.recoveryAccuracy).toBeNull();
  });

  it("two consecutive White blunders → maxRun 2, recovery from later moves", () => {
    // White (user) blunders at plies 7 and 9 (consecutive White moves), recovers on 11.
    const cps = [10, -10, 10, -10, 10, -10, 300, -300, 300, -300, 10, -10];
    const tl = buildTimeline("", rank1(cps), "w", NO_PHASES);
    const m = buildGameMetrics(tl, ctx());
    expect(m.maxBlunderRun).toBe(2);
    expect(m.recoveryAccuracy).not.toBeNull();
  });
});

describe("buildGameMetrics — missed conversions", () => {
  it("opponent blunder followed by a non-best user move is flagged", () => {
    // Black blunders at ply 8 (cp -300 → +300), White fails to punish on ply 9.
    const cps = [10, -10, 10, -10, 10, -10, 300, -300, 300, -300, 10, -10];
    const tl = buildTimeline("", rank1(cps), "w", NO_PHASES);
    const m = buildGameMetrics(tl, ctx());
    expect(m.missedConversions.length).toBeGreaterThanOrEqual(1);
    expect(m.missedConversions[0].beforeFen).toContain("fen_");
  });
});

describe("buildGameMetrics — critical moves (rank-2)", () => {
  it("surfaces a critical user move when rank-2 gap is large", () => {
    const rows: AnalysisRowMPV[] = [
      r(0, 1, 300), r(0, 2, 0),  // White on move: best far better than 2nd best
      r(1, 1, 280),
    ];
    const tl = buildTimeline("", rows, "w", NO_PHASES);
    const m = buildGameMetrics(tl, ctx({ multipvMax: 2 }));
    expect(m.criticalPositions).toBeGreaterThanOrEqual(1);
    expect(m.criticalMoves.length).toBeGreaterThanOrEqual(1);
    expect(m.criticalMoves[0].bestMove).toBe("e2e4");
  });
});

describe("buildGameMetrics — phase accuracy + ACL", () => {
  it("splits accuracy/ACL across phases and skips opening for ACL", () => {
    // 12 plies; middlegame from pos 4, endgame from pos 9.
    const cps = [10, 20, 15, 25, 18, 40, 30, 35, 28, 33, 26, 31, 29];
    const phases: PhaseBoundaries = { middlegameStartPly: 4, endgameStartPly: 9 };
    const tl = buildTimeline("", rank1(cps), "w", phases);
    const m = buildGameMetrics(tl, ctx({ phases }));
    expect(m.middlegameStartPly).toBe(4);
    expect(m.endgameStartPly).toBe(9);
    expect(m.accuracyOpening).not.toBeNull();
    expect(m.accuracyMiddlegame).not.toBeNull();
    // ACL skips the first 8 plies, so opening ACL (all ≤ ply 8) is null.
    expect(m.aclOpening).toBeNull();
  });
});

describe("buildGameMetrics — out-of-book (explorer D29 / ECO fallback D33)", () => {
  const EXP_DB = "test_gm_explorer.db";
  // Real SAN so buildTimeline's moveSans are populated; fens stay synthetic
  // (fen_0, fen_1, …) so fenKey is the bare string and seeding is predictable.
  const PGN = "1. e4 e5 2. Nf3";

  function seedExplorer(rows: Array<[string, string, number]>): void {
    if (existsSync(EXP_DB)) {rmSync(EXP_DB);}
    const db = new Database(EXP_DB, { create: true });
    db.run(EXPLORER_SCHEMA);
    const ins = db.prepare(
      `INSERT INTO ${EXPLORER_TABLE} (fen_key, move, count) VALUES (?, ?, ?)`,
    );
    for (const [k, m, c] of rows) {ins.run(k, m, c);}
    db.close();
    setExplorerDbPath(EXP_DB);
  }

  afterEach(() => {
    setExplorerDbPath(null);
    if (existsSync(EXP_DB)) {rmSync(EXP_DB);}
  });

  it("flags out-of-book at ply 1 when the played move is below the frequency floor", () => {
    seedExplorer([["fen_0", "e4", 1], ["fen_0", "d4", 99]]); // e4 = 1% < 5%
    const tl = buildTimeline(PGN, rank1([10, -10, 10, -10]), "w", NO_PHASES);
    const m = buildGameMetrics(tl, ctx({ pgn: PGN }));
    expect(m.outOfBookPly).toBe(1);
    expect(m.outOfBookEcoFallback).toBe(0);
  });

  it("scans past in-book plies to the first below-floor move", () => {
    seedExplorer([
      ["fen_0", "e4", 90], ["fen_0", "d4", 10], // e4 = 90% (in book)
      ["fen_1", "e5", 2], ["fen_1", "c5", 98], // e5 = 2% < 5% at ply 2
    ]);
    const tl = buildTimeline(PGN, rank1([10, -10, 10, -10]), "w", NO_PHASES);
    const m = buildGameMetrics(tl, ctx({ pgn: PGN }));
    expect(m.outOfBookPly).toBe(2);
    expect(m.outOfBookEcoFallback).toBe(0);
  });

  it("falls back to named-ECO (ecoFallback=1) when no explorer table exists", () => {
    setExplorerDbPath("test_gm_missing.db"); // absent file → all lookups null
    const tl = buildTimeline(PGN, rank1([10, -10, 10, -10]), "w", NO_PHASES);
    const m = buildGameMetrics(tl, ctx({ pgn: PGN }));
    expect(m.outOfBookEcoFallback).toBe(1);
  });
});

describe("buildGameMetrics — clocks → time trouble + alloc", () => {
  const CLOCK_PGN = `[TimeControl "60"]

1. e4 {[%clk 0:01:00]} e5 {[%clk 0:01:00]} 2. Nf3 {[%clk 0:00:20]} Nc6 {[%clk 0:00:55]} 3. Bc4 {[%clk 0:00:10]} Bc5 {[%clk 0:00:50]} 1-0`;

  it("counts user moves under the time-trouble threshold", () => {
    const tl = buildTimeline(CLOCK_PGN, rank1([10, 12, 8, 14, 9, 11, 7]), "w", NO_PHASES);
    const m = buildGameMetrics(tl, ctx({ pgn: CLOCK_PGN, baseSeconds: 60 }));
    expect(m.clocksAvailable).toBe(1);
    // Threshold = max(30, 0.2·60) = 30s. White hits 20s then 10s → 2 moves in trouble.
    expect(m.timeTroubleMoves).toBe(2);
    expect(m.avgMoveTimeS).not.toBeNull();
  });
});
