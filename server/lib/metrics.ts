import { classifySwing, type MoveClass } from "../../shared/classify";
import type { AnalysisRow } from "./engine";

/** Clamp helper. */
function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Lichess Win% from centipawn. cp clamped to ±1000.
 * Win% = 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)
 * Output is [0, 100].
 */
export function cpToWinPct(cp: number): number {
  const clamped = clamp(cp, -1000, 1000);
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clamped)) - 1);
}

/** Convert mate-in-N to a cp surrogate per D1: sign(mate) * 1000. */
export function mateToCp(mate: number): number {
  if (mate > 0) {return 1000;}
  if (mate < 0) {return -1000;}
  return 0;
}

/**
 * Lichess accuracy formula on Win%-delta (wp_delta = wpBefore - wpAfter, mover's perspective, ≥ 0).
 * accuracy = clamp(0, 100, 103.1668 * exp(-0.04354 * wp_delta) - 3.1669 + 1)
 */
export function moveAccuracy(wpBefore: number, wpAfter: number): number {
  const wpDelta = Math.max(0, wpBefore - wpAfter);
  const raw = 103.1668 * Math.exp(-0.04354 * wpDelta) - 3.1669 + 1;
  return clamp(raw, 0, 100);
}

/** Classify a move using the shared classifier on wpDelta in [0, 1] scale. */
export function classifyMove(wpBefore: number, wpAfter: number): MoveClass {
  const wpDelta01 = Math.max(0, (wpBefore - wpAfter) / 100);
  return classifySwing(wpDelta01);
}

export interface PerSideMetrics {
  accuracy: number;      // 0..100 — bucket-based weighted mean (see classAccuracyScore)
  blunders: number;
  mistakes: number;
  inaccuracies: number;
  acl: number;           // average centipawn loss (skip first 8 plies, only positive losses)
}

/**
 * Map a move classification to an accuracy bucket score, Chess.com-style.
 * Chess.com's CAPS2 is proprietary, but their published behaviour is
 * "category-based with dampening". We use the same shape with conservative
 * scores derived from the wp-delta thresholds.
 */
function classAccuracyScore(c: MoveClass): number {
  switch (c) {
    case "best":       return 100;
    case "good":       return 90;
    case "inaccuracy": return 70;
    case "mistake":    return 40;
    case "blunder":    return 10;
  }
}

/** Weight applied to a blunder beyond the first in a consecutive run. */
const CONSECUTIVE_BLUNDER_DAMPING = 0.3;

/**
 * Game-level accuracy aggregation. Takes a flat array of (classification, score)
 * for one side and returns 0..100. Consecutive blunders past the first are
 * dampened so a single bad streak doesn't tank the whole game's accuracy.
 */
export function aggregateAccuracy(classes: MoveClass[]): number {
  if (classes.length === 0) {return 0;}
  let weightedSum = 0;
  let weightTotal = 0;
  let consecutiveBlunders = 0;
  for (const c of classes) {
    let weight = 1;
    if (c === "blunder") {
      consecutiveBlunders++;
      if (consecutiveBlunders > 1) {weight = CONSECUTIVE_BLUNDER_DAMPING;}
    } else {
      consecutiveBlunders = 0;
    }
    weightedSum += classAccuracyScore(c) * weight;
    weightTotal += weight;
  }
  return weightTotal > 0 ? weightedSum / weightTotal : 0;
}

const ZERO_METRICS: PerSideMetrics = {
  accuracy: 0,
  blunders: 0,
  mistakes: 0,
  inaccuracies: 0,
  acl: 0,
};

/**
 * Convert a row's eval to cp from White's perspective.
 * Uses mate surrogate if score_mate is non-null.
 */
function rowToCp(row: AnalysisRow): number {
  if (row.score_mate !== null) {return mateToCp(row.score_mate);}
  return row.score_cp ?? 0;
}

/**
 * Per-side metrics from an ordered analysis array (move_index 0..N).
 * Position index 0 is the starting position; transition i → i+1 is the move played
 * by side `i % 2 === 0 ? "w" : "b"`.
 * Skip first 8 plies for ACL only. Classification (blunder/mistake/inaccuracy counts)
 * still applies to those plies.
 *
 * Returns { white, black } regardless of userColor — caller can pick the relevant side.
 */
export function gameMetrics(
  positions: AnalysisRow[],
): { white: PerSideMetrics; black: PerSideMetrics } {
  if (positions.length < 2) {
    return { white: { ...ZERO_METRICS }, black: { ...ZERO_METRICS } };
  }

  // Per-side accumulators
  const classes: { w: MoveClass[]; b: MoveClass[] } = { w: [], b: [] };
  const counts = {
    w: { blunders: 0, mistakes: 0, inaccuracies: 0 },
    b: { blunders: 0, mistakes: 0, inaccuracies: 0 },
  };
  const aclSums = { w: 0, b: 0 };
  const aclCounts = { w: 0, b: 0 };

  for (let i = 0; i < positions.length - 1; i++) {
    const before = positions[i];
    const after = positions[i + 1];

    // i even → White moves (transition i → i+1), i odd → Black moves
    const side: "w" | "b" = i % 2 === 0 ? "w" : "b";

    // cp from White's perspective for both positions
    const cpBeforeWhite = rowToCp(before);
    const cpAfterWhite = rowToCp(after);

    // Flip to mover's perspective
    const cpBeforeMover = side === "w" ? cpBeforeWhite : -cpBeforeWhite;
    const cpAfterMover = side === "w" ? cpAfterWhite : -cpAfterWhite;

    // Win% from mover's perspective
    const wpBefore = cpToWinPct(cpBeforeMover);
    const wpAfter = cpToWinPct(cpAfterMover);

    // Classification (applies to all plies including first 8)
    const cls = classifyMove(wpBefore, wpAfter);
    classes[side].push(cls);
    if (cls === "blunder") {counts[side].blunders++;}
    else if (cls === "mistake") {counts[side].mistakes++;}
    else if (cls === "inaccuracy") {counts[side].inaccuracies++;}

    // ACL: skip first 8 plies (transitions 0→1 through 7→8, i.e. i in 0..7)
    if (i >= 8) {
      // cpLoss from mover's perspective, clamped ≥ 0, cap at 1000
      const cpLoss = clamp(cpBeforeMover - cpAfterMover, 0, 1000);
      aclSums[side] += cpLoss;
      aclCounts[side]++;
    }
  }

  const makeMetrics = (side: "w" | "b"): PerSideMetrics => ({
    accuracy: aggregateAccuracy(classes[side]),
    blunders: counts[side].blunders,
    mistakes: counts[side].mistakes,
    inaccuracies: counts[side].inaccuracies,
    acl: aclCounts[side] > 0 ? aclSums[side] / aclCounts[side] : 0,
  });

  return {
    white: makeMetrics("w"),
    black: makeMetrics("b"),
  };
}
