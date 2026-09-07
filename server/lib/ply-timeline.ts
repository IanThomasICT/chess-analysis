import { cpToWinPct, mateToCp } from "./metrics";
import { classifySwing, type MoveClass } from "../../shared/classify";
import type { AnalysisRowMPV } from "./engine";
import type { PhaseBoundaries } from "./phases";
import { parseTimeControl, pgnPerPlyClocks, pgnToMoves } from "./pgn";
import {
  CRITICALITY_GAP_PCT,
  DECIDED_WIN_PCT,
  DECIDED_MATE_HOLD_K,
  MATE_DISTANCE_EPSILON,
} from "./metrics-config";

export type Phase = "opening" | "middlegame" | "endgame";

/**
 * One enriched ply (move) in a game's timeline. The L1 layer: a pure function of
 * raw PGN + analysis rows, shared by the batch builder and the Analysis page so
 * a backfilled game and a freshly-analyzed game are byte-for-byte identical.
 *
 * Indexing convention:
 *   plyIndex  — 1-based ply number (1 = White's first move). Equals the
 *               after-move position index in `analysis.move_index` and
 *               `blunder_tags.move_index`. The before-position index is plyIndex-1.
 *   moveIndex — 0-based index into the SAN move array (= plyIndex - 1).
 * Win% fields are from the MOVER's perspective; wpLoss = max(0, before - after).
 */
export interface EnrichedPly {
  plyIndex: number;
  moveIndex: number;
  side: "w" | "b";
  isUserMove: boolean;
  moveSan: string | null;
  winPctBefore: number;
  winPctAfter: number;
  wpLoss: number;
  /** Centipawn loss (mover perspective), clamped [0, 1000]; mate uses ±1000 surrogate. For ACL. */
  cpLoss: number;
  moveClass: MoveClass;
  thinkTimeS: number | null;
  /** Remaining clock in seconds after this ply (D8 time trouble), null if no clocks. */
  clockS: number | null;
  phase: Phase;
  /** rank1−rank2 Win% gap at the before-position (mover perspective), null if no rank-2. */
  criticality: number | null;
  /** rank-2 Win% at the before-position (mover perspective), null if absent. */
  rank2WinPct: number | null;
  /** True when the game is already decided and this is the leading side's move (excluded from accuracy). */
  isDecided: boolean;
  beforeFen: string;
  bestMove: string;
}

/** Synthetic White-perspective Win% with mate-distance decay (D27). */
function syntheticWinPctWhite(row: AnalysisRowMPV): number {
  if (row.score_mate !== null) {
    const dist = Math.abs(row.score_mate) * MATE_DISTANCE_EPSILON;
    return row.score_mate > 0 ? 100 - dist : dist;
  }
  return cpToWinPct(row.score_cp ?? 0);
}

/** White-perspective centipawn value (mate → ±1000 surrogate). */
function cpWhite(row: AnalysisRowMPV): number {
  if (row.score_mate !== null) {return mateToCp(row.score_mate);}
  return row.score_cp ?? 0;
}

/** Mate side at a position, or null if not a mate score. */
function mateSide(row: AnalysisRowMPV | undefined): "w" | "b" | null {
  const mate = row?.score_mate ?? null;
  if (mate === null) {return null;}
  return mate > 0 ? "w" : "b";
}

/** Phase of a move played from a given before-position index. */
function phaseAt(pos: number, b: PhaseBoundaries): Phase {
  if (b.endgameStartPly !== null && pos >= b.endgameStartPly) {return "endgame";}
  if (b.middlegameStartPly !== null && pos >= b.middlegameStartPly) {return "middlegame";}
  return "opening";
}

/** Group MultiPV rows by move_index → (rank → row). */
function groupByMoveIndex(
  rows: AnalysisRowMPV[],
): Map<number, Map<number, AnalysisRowMPV>> {
  const byIndex = new Map<number, Map<number, AnalysisRowMPV>>();
  for (const row of rows) {
    let ranks = byIndex.get(row.move_index);
    if (ranks === undefined) {
      ranks = new Map();
      byIndex.set(row.move_index, ranks);
    }
    ranks.set(row.multipv_rank, row);
  }
  return byIndex;
}

interface DecidedState {
  decidedFrom: number | null; // before-position index from which the game is decided
  leadingSide: "w" | "b" | null;
}

/**
 * Determine the position from which the game is decided (D22 + D28).
 * Fires on EITHER: a Win% ≥ DECIDED_WIN_PCT held by one side through the end of
 * the game, OR a mate score held by one side for DECIDED_MATE_HOLD_K plies.
 * `whiteWp[i]` is the White-perspective synthetic Win% at position i.
 */
function computeDecided(
  whiteWp: number[],
  ranks: Map<number, Map<number, AnalysisRowMPV>>,
): DecidedState {
  const losing = 100 - DECIDED_WIN_PCT;
  // Suffix-hold: earliest position from which one side stays decided to the end.
  let whiteFrom: number | null = null;
  let blackFrom: number | null = null;
  for (let i = whiteWp.length - 1; i >= 0; i--) {
    if (whiteWp[i] >= DECIDED_WIN_PCT) {whiteFrom = i;} else {break;}
  }
  for (let i = whiteWp.length - 1; i >= 0; i--) {
    if (whiteWp[i] <= losing) {blackFrom = i;} else {break;}
  }

  // Mate-hold: earliest run of K consecutive same-side mates.
  let mateFrom: number | null = null;
  let mateLeader: "w" | "b" | null = null;
  let runStart = 0;
  let runSide: "w" | "b" | null = null;
  for (let i = 0; i < whiteWp.length; i++) {
    const side = mateSide(ranks.get(i)?.get(1));
    if (side !== null && side === runSide) {
      if (i - runStart + 1 >= DECIDED_MATE_HOLD_K && mateFrom === null) {
        mateFrom = runStart;
        mateLeader = side;
      }
    } else {
      runSide = side;
      runStart = i;
    }
  }

  // Pick the earliest trigger.
  const candidates: Array<{ from: number; side: "w" | "b" }> = [];
  if (whiteFrom !== null) {candidates.push({ from: whiteFrom, side: "w" });}
  if (blackFrom !== null) {candidates.push({ from: blackFrom, side: "b" });}
  if (mateFrom !== null && mateLeader !== null) {candidates.push({ from: mateFrom, side: mateLeader });}
  if (candidates.length === 0) {return { decidedFrom: null, leadingSide: null };}
  candidates.sort((a, b) => a.from - b.from);
  return { decidedFrom: candidates[0].from, leadingSide: candidates[0].side };
}

/** Per-ply think time in seconds (D4), or null when clocks/time-control are missing. */
function thinkTimeFor(
  plyIndex: number,
  clocks: Array<number | null>,
  baseSeconds: number | null,
  incrementSeconds: number,
): number | null {
  // Guard out-of-range first so missing clocks (empty array) yield null, not NaN.
  if (plyIndex - 1 >= clocks.length) {return null;}
  const thisClk = clocks[plyIndex - 1];
  if (thisClk === null) {return null;}
  // Same side's previous remaining clock is two plies earlier; first move uses base.
  const prevClk = plyIndex > 2 ? clocks[plyIndex - 3] : baseSeconds;
  if (prevClk === null) {return null;}
  return Math.max(0, prevClk - thisClk + incrementSeconds);
}

/**
 * Build the enriched per-ply timeline (L1). Pure — no DB access.
 * `analysisRows` must include MultiPV ranks (use getGameAnalysisMultiPV).
 */
export function buildTimeline(
  pgn: string,
  analysisRows: AnalysisRowMPV[],
  userColor: "w" | "b",
  phases: PhaseBoundaries,
): EnrichedPly[] {
  const ranks = groupByMoveIndex(analysisRows);
  const positionCount = ranks.size;
  if (positionCount < 2) {return [];}

  // White-perspective Win% per position (for decided detection).
  const whiteWp: number[] = [];
  for (let i = 0; i < positionCount; i++) {
    const r1 = ranks.get(i)?.get(1);
    whiteWp.push(r1 !== undefined ? syntheticWinPctWhite(r1) : 50);
  }
  const decided = computeDecided(whiteWp, ranks);

  let moveSans: string[];
  try {
    moveSans = pgnToMoves(pgn).map((m) => m.san);
  } catch {
    moveSans = [];
  }
  const clocks = pgnPerPlyClocks(pgn);
  const tc = parseTimeControl(pgn);
  const baseSeconds = tc?.baseSeconds ?? null;
  const incrementSeconds = tc?.incrementSeconds ?? 0;

  const timeline: EnrichedPly[] = [];
  const lastPosition = positionCount - 1;
  for (let plyIndex = 1; plyIndex <= lastPosition; plyIndex++) {
    const beforePos = plyIndex - 1;
    const beforeRanks = ranks.get(beforePos);
    const afterR1 = ranks.get(plyIndex)?.get(1);
    const beforeR1 = beforeRanks?.get(1);
    if (beforeR1 === undefined || afterR1 === undefined) {continue;}

    const side: "w" | "b" = beforePos % 2 === 0 ? "w" : "b";
    const flip = (whitePct: number): number => (side === "w" ? whitePct : 100 - whitePct);

    const winPctBefore = flip(syntheticWinPctWhite(beforeR1));
    const winPctAfter = flip(syntheticWinPctWhite(afterR1));
    const wpLoss = Math.max(0, winPctBefore - winPctAfter);

    // Centipawn loss from the mover's perspective (for ACL).
    const cpBeforeMover = side === "w" ? cpWhite(beforeR1) : -cpWhite(beforeR1);
    const cpAfterMover = side === "w" ? cpWhite(afterR1) : -cpWhite(afterR1);
    const cpLoss = Math.min(1000, Math.max(0, cpBeforeMover - cpAfterMover));

    const clockS = plyIndex - 1 < clocks.length ? clocks[plyIndex - 1] : null;

    const beforeR2 = beforeRanks?.get(2);
    const rank2WinPct = beforeR2 !== undefined ? flip(syntheticWinPctWhite(beforeR2)) : null;
    const criticality = rank2WinPct !== null ? Math.max(0, winPctBefore - rank2WinPct) : null;

    const isLeadingSideMove = decided.decidedFrom !== null &&
      beforePos >= decided.decidedFrom && side === decided.leadingSide;

    timeline.push({
      plyIndex,
      moveIndex: plyIndex - 1,
      side,
      isUserMove: side === userColor,
      moveSan: moveSans[plyIndex - 1] ?? beforeR1.move_san,
      winPctBefore,
      winPctAfter,
      wpLoss,
      cpLoss,
      moveClass: classifySwing(wpLoss / 100),
      thinkTimeS: thinkTimeFor(plyIndex, clocks, baseSeconds, incrementSeconds),
      clockS,
      phase: phaseAt(beforePos, phases),
      criticality,
      rank2WinPct,
      isDecided: isLeadingSideMove,
      beforeFen: beforeR1.fen,
      bestMove: beforeR1.best_move,
    });
  }
  return timeline;
}

/** A ply is "critical" when the best move is materially better than the 2nd best (D9). */
export function isCritical(ply: EnrichedPly): boolean {
  return ply.criticality !== null && ply.criticality >= CRITICALITY_GAP_PCT;
}
