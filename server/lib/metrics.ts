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
 * Lichess per-move accuracy from before/after Win% (mover's perspective).
 * Verbatim constants from lila `AccuracyPercent.fromWinPercents`:
 *   if after ≥ before → 100 (a non-losing move is perfect)
 *   else 103.1668100711649·exp(-0.04354415386753951·winDiff) − 3.166924740191411 + 1
 * The trailing +1 is the "uncertainty bonus". Output clamped to [0, 100].
 */
export function moveAccuracy(wpBefore: number, wpAfter: number): number {
  if (wpAfter >= wpBefore) {return 100;}
  const winDiff = wpBefore - wpAfter;
  const raw =
    103.1668100711649 * Math.exp(-0.04354415386753951 * winDiff) -
    3.166924740191411 +
    1;
  return clamp(raw, 0, 100);
}

/** Population standard deviation (divide by N). Null for empty input. */
function populationStdDev(values: number[]): number | null {
  if (values.length === 0) {return null;}
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((acc, x) => acc + (x - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Per-ply accuracy with its volatility weight (mover's perspective). */
export interface PlyAccuracy {
  accuracy: number;
  /** Volatility weight: clamp(rolling std-dev of win%, 0.5, 12). */
  weight: number;
}

/**
 * Lichess accuracy primitive: per-ply accuracy + volatility weight from a
 * White-perspective Win% sequence (`winPctWhite[i]` = Win% at position i,
 * length N+1 for N plies). Mirrors lila `AccuracyPercent` exactly:
 *   windowSize = clamp(floor(N / 10), 2, 8)
 *   windows = (windowSize−2) copies of winPctWhite[0..windowSize) ++ sliding(windowSize)
 *   weight[j] = clamp(popStdDev(windows[j]), 0.5, 12)
 *   accuracy[j] = moveAccuracy from mover's perspective (flip Win% for Black plies)
 * Returns one entry per ply (index j → move j; mover is White when j is even).
 */
export function plyAccuracies(winPctWhite: number[]): PlyAccuracy[] {
  const plies = winPctWhite.length - 1;
  if (plies < 1) {return [];}

  const windowSize = clamp(Math.floor(plies / 10), 2, 8);
  const leadingCount = Math.min(windowSize, winPctWhite.length) - 2;
  const leadingWindow = winPctWhite.slice(0, windowSize);

  const windows: number[][] = [];
  for (let i = 0; i < leadingCount; i++) {
    windows.push(leadingWindow);
  }
  for (let i = 0; i + windowSize <= winPctWhite.length; i++) {
    windows.push(winPctWhite.slice(i, i + windowSize));
  }

  const result: PlyAccuracy[] = [];
  for (let j = 0; j < plies; j++) {
    const before = winPctWhite[j];
    const after = winPctWhite[j + 1];
    const moverIsWhite = j % 2 === 0;
    const beforeMover = moverIsWhite ? before : 100 - before;
    const afterMover = moverIsWhite ? after : 100 - after;
    const sd = populationStdDev(windows[j] ?? leadingWindow);
    const weight = sd === null ? 0.5 : clamp(sd, 0.5, 12);
    result.push({ accuracy: moveAccuracy(beforeMover, afterMover), weight });
  }
  return result;
}

/**
 * Combine per-ply accuracy entries into a single 0..100 accuracy, per lila:
 * mean of the volatility-weighted mean and the harmonic mean. The harmonic
 * mean floors each accuracy at 1 to avoid div-by-zero. Null if no entries.
 */
export function combineAccuracy(entries: PlyAccuracy[]): number | null {
  if (entries.length === 0) {return null;}
  let weightedSum = 0;
  let weightTotal = 0;
  let reciprocalSum = 0;
  for (const e of entries) {
    weightedSum += e.accuracy * e.weight;
    weightTotal += e.weight;
    reciprocalSum += 1 / Math.max(1, e.accuracy);
  }
  if (weightTotal === 0) {return null;}
  const weightedMean = weightedSum / weightTotal;
  const harmonicMean = entries.length / reciprocalSum;
  return (weightedMean + harmonicMean) / 2;
}

/** Classify a move using the shared classifier on wpDelta in [0, 1] scale. */
export function classifyMove(wpBefore: number, wpAfter: number): MoveClass {
  const wpDelta01 = Math.max(0, (wpBefore - wpAfter) / 100);
  return classifySwing(wpDelta01);
}

export interface PerSideMetrics {
  accuracy: number;      // 0..100 — Lichess game accuracy (weighted+harmonic mean of per-move accuracy)
  blunders: number;
  mistakes: number;
  inaccuracies: number;
  acl: number;           // average centipawn loss (skip first 8 plies, only positive losses)
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

  // Per-side accumulators (counts + ACL). Accuracy is computed separately below
  // via the Lichess primitives over the full White-perspective Win% sequence.
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

  // Lichess accuracy over the full game Win% sequence (White's perspective).
  const winPctWhite = positions.map((p) => cpToWinPct(rowToCp(p)));
  const ply = plyAccuracies(winPctWhite);
  const whiteEntries = ply.filter((_, j) => j % 2 === 0);
  const blackEntries = ply.filter((_, j) => j % 2 === 1);
  const accuracy = {
    w: combineAccuracy(whiteEntries) ?? 0,
    b: combineAccuracy(blackEntries) ?? 0,
  };

  const makeMetrics = (side: "w" | "b"): PerSideMetrics => ({
    accuracy: accuracy[side],
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
