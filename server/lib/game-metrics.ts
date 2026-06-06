import { combineAccuracy, plyAccuracies, type PlyAccuracy } from "./metrics";
import { isCritical, type EnrichedPly, type Phase } from "./ply-timeline";
import { classifyOpening } from "./openings";
import { pgnToMoves } from "./pgn";
import type { PhaseBoundaries } from "./phases";
import {
  METRICS_VERSION,
  ACL_SKIP_PLIES,
  TIME_TROUBLE_MIN_S,
  TIME_TROUBLE_PCT,
} from "./metrics-config";

/** A high-criticality user move surfaced for review / drill feed (R5/R16). */
export interface CriticalMove {
  plyIndex: number;
  moveSan: string | null;
  wpBefore: number;
  wpAfter: number;
  moveClass: string;
  phase: string;
  thinkTimeS: number | null;
  beforeFen: string;
  bestMove: string;
}

/** A position where the user failed to punish an opponent blunder (R6/R16). */
export interface MissedConversion {
  plyIndex: number;
  moveSan: string | null;
  thinkTimeS: number | null;
  beforeFen: string;
  bestMove: string;
}

/**
 * L2 extended per-game metrics. Scalar fields map 1:1 to game_metrics_ext columns
 * (see db.ts migration #11). `criticalMoves`/`missedConversions` are returned for
 * the drill auto-feed and live UI but are NOT stored (D3) — they re-derive from L1.
 */
export interface ExtendedGameMetrics {
  metricsVersion: number;
  analysisSig: string;
  multipvMax: number;
  accuracyOpening: number | null;
  accuracyMiddlegame: number | null;
  accuracyEndgame: number | null;
  aclOpening: number | null;
  aclMiddlegame: number | null;
  aclEndgame: number | null;
  middlegameStartPly: number | null;
  endgameStartPly: number | null;
  timeOpeningS: number | null;
  timeMiddlegameS: number | null;
  timeEndgameS: number | null;
  avgMoveTimeS: number | null;
  accuracyCritical: number | null;
  accuracyQuiet: number | null;
  criticalPositions: number;
  timeAllocEfficiency: number | null;
  maxBlunderRun: number;
  recoveryAccuracy: number | null;
  timeTroubleMoves: number | null;
  timeTroubleErrors: number | null;
  peakEvalWp: number | null;
  troughEvalWp: number | null;
  outOfBookPly: number | null;
  outOfBookEcoFallback: number;
  postBookAccuracy: number | null;
  evalOpeningEndWp: number | null;
  userMoves: number;
  clocksAvailable: number;
  engineDepthMin: number;
  criticalMoves: CriticalMove[];
  missedConversions: MissedConversion[];
}

/** Provenance + context the builder needs that isn't in the timeline. */
export interface GameMetricsContext {
  pgn: string;
  userColor: "w" | "b";
  phases: PhaseBoundaries;
  baseSeconds: number | null;
  engineDepthMin: number;
  rank1Count: number;
  multipvMax: number;
}

interface PlyEntry {
  ply: EnrichedPly;
  acc: PlyAccuracy | undefined;
}

/** Reconstruct the White-perspective Win% sequence (length N+1) from the timeline. */
function whitePerspectiveWp(timeline: EnrichedPly[]): number[] {
  if (timeline.length === 0) {return [];}
  const toWhite = (mover: number, side: "w" | "b"): number =>
    side === "w" ? mover : 100 - mover;
  const wp: number[] = [toWhite(timeline[0].winPctBefore, timeline[0].side)];
  for (const p of timeline) {
    wp.push(toWhite(p.winPctAfter, p.side));
  }
  return wp;
}

/** Accuracy over the user's non-decided moves matching a predicate. */
function accuracyWhere(
  entries: PlyEntry[],
  pred: (p: EnrichedPly) => boolean,
): number | null {
  const accs: PlyAccuracy[] = [];
  for (const e of entries) {
    if (e.acc !== undefined && e.ply.isUserMove && !e.ply.isDecided && pred(e.ply)) {
      accs.push(e.acc);
    }
  }
  return combineAccuracy(accs);
}

/** Mean centipawn loss over the user's non-decided moves past the opening, matching a predicate. */
function aclWhere(
  timeline: EnrichedPly[],
  pred: (p: EnrichedPly) => boolean,
): number | null {
  let sum = 0;
  let count = 0;
  for (const p of timeline) {
    if (p.isUserMove && !p.isDecided && p.plyIndex > ACL_SKIP_PLIES && pred(p)) {
      sum += p.cpLoss;
      count++;
    }
  }
  return count > 0 ? sum / count : null;
}

/** Sum of think time over the user's moves in a phase (null-think excluded). */
function timeInPhase(timeline: EnrichedPly[], phase: Phase): number | null {
  let sum = 0;
  let any = false;
  for (const p of timeline) {
    if (p.isUserMove && p.phase === phase && p.thinkTimeS !== null) {
      sum += p.thinkTimeS;
      any = true;
    }
  }
  return any ? sum : null;
}

/** Average rank with tie handling (1-based). */
function averageRanks(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = Array.from({ length: values.length }, () => 0);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) {j++;}
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) {ranks[indexed[k].i] = avg;}
    i = j + 1;
  }
  return ranks;
}

/** Spearman rank correlation, or null when fewer than 2 paired samples. */
function spearman(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2) {return null;}
  const rx = averageRanks(xs);
  const ry = averageRanks(ys);
  let dsum = 0;
  for (let i = 0; i < n; i++) {
    const d = rx[i] - ry[i];
    dsum += d * d;
  }
  return 1 - (6 * dsum) / (n * (n * n - 1));
}

/** Longest run of consecutive user blunders and the entry index where it ends. */
function blunderRun(userEntries: PlyEntry[]): { maxRun: number; endIdx: number } {
  let maxRun = 0;
  let cur = 0;
  let endIdx = -1;
  for (let i = 0; i < userEntries.length; i++) {
    if (userEntries[i].ply.moveClass === "blunder") {
      cur++;
      if (cur > maxRun) {
        maxRun = cur;
        endIdx = i;
      }
    } else {
      cur = 0;
    }
  }
  return { maxRun, endIdx };
}

/** Top-3 critical user moves by criticality, descending. */
function topCriticalMoves(timeline: EnrichedPly[]): CriticalMove[] {
  return timeline
    .filter((p) => p.isUserMove && isCritical(p))
    .sort((a, b) => (b.criticality ?? 0) - (a.criticality ?? 0))
    .slice(0, 3)
    .map((p) => ({
      plyIndex: p.plyIndex,
      moveSan: p.moveSan,
      wpBefore: p.winPctBefore,
      wpAfter: p.winPctAfter,
      moveClass: p.moveClass,
      phase: p.phase,
      thinkTimeS: p.thinkTimeS,
      beforeFen: p.beforeFen,
      bestMove: p.bestMove,
    }));
}

/** User moves that failed to capitalize on the opponent's preceding blunder (D2). */
function missedConversions(timeline: EnrichedPly[]): MissedConversion[] {
  const result: MissedConversion[] = [];
  for (let j = 1; j < timeline.length; j++) {
    const ply = timeline[j];
    const prev = timeline[j - 1];
    const oppBlundered = !prev.isUserMove && prev.wpLoss >= 30;
    const capitalized = ply.moveClass === "best" || ply.moveClass === "good";
    if (ply.isUserMove && oppBlundered && !capitalized) {
      result.push({
        plyIndex: ply.plyIndex,
        moveSan: ply.moveSan,
        thinkTimeS: ply.thinkTimeS,
        beforeFen: ply.beforeFen,
        bestMove: ply.bestMove,
      });
    }
  }
  return result;
}

/** Time-trouble counts (D8), or null when the game has no clock data. */
function timeTrouble(
  timeline: EnrichedPly[],
  baseSeconds: number | null,
  clocksAvailable: boolean,
): { moves: number | null; errors: number | null } {
  if (!clocksAvailable) {return { moves: null, errors: null }; }
  const threshold = baseSeconds !== null
    ? Math.max(TIME_TROUBLE_MIN_S, TIME_TROUBLE_PCT * baseSeconds)
    : TIME_TROUBLE_MIN_S;
  let moves = 0;
  let errors = 0;
  for (const p of timeline) {
    if (p.isUserMove && p.clockS !== null && p.clockS < threshold) {
      moves++;
      if (p.moveClass === "mistake" || p.moveClass === "blunder") {errors++;}
    }
  }
  return { moves, errors };
}

/**
 * Build the L2 extended metrics from an L1 timeline (pure — no DB).
 * Accuracy/ACL folds use the user's non-decided moves; ACL also skips the opening.
 */
export function buildGameMetrics(
  timeline: EnrichedPly[],
  ctx: GameMetricsContext,
): ExtendedGameMetrics {
  const whiteWp = whitePerspectiveWp(timeline);
  const per = plyAccuracies(whiteWp);
  const entries: PlyEntry[] = timeline.map((ply, j) => ({ ply, acc: per[j] }));
  const userEntries = entries.filter((e) => e.ply.isUserMove);

  const userWp = whiteWp.map((w) => (ctx.userColor === "w" ? w : 100 - w));
  const clocksAvailable = timeline.some((p) => p.clockS !== null);

  const { maxRun, endIdx } = blunderRun(userEntries);
  const recoveryAccuracy =
    maxRun > 0
      ? combineAccuracy(
          userEntries.slice(endIdx + 1).flatMap((e) => (e.acc !== undefined ? [e.acc] : [])),
        )
      : null;

  // Time-allocation efficiency: Spearman(think time, criticality) over user plies
  // with both a clock and a criticality value.
  const allocThink: number[] = [];
  const allocCrit: number[] = [];
  for (const p of timeline) {
    if (p.isUserMove && p.thinkTimeS !== null && p.criticality !== null) {
      allocThink.push(p.thinkTimeS);
      allocCrit.push(p.criticality);
    }
  }

  let sans: string[];
  try {
    sans = pgnToMoves(ctx.pgn).map((m) => m.san);
  } catch {
    sans = [];
  }
  const opening = classifyOpening(sans);
  const outOfBookPly = opening?.depth ?? 0;

  const avgThinkEntries = timeline.filter((p) => p.isUserMove && p.thinkTimeS !== null);
  const avgMoveTimeS =
    avgThinkEntries.length > 0
      ? avgThinkEntries.reduce((s, p) => s + (p.thinkTimeS ?? 0), 0) / avgThinkEntries.length
      : null;

  const tt = timeTrouble(timeline, ctx.baseSeconds, clocksAvailable);

  const openingEndIdx = ctx.phases.middlegameStartPly ?? outOfBookPly;
  const evalOpeningEndWp =
    openingEndIdx >= 0 && openingEndIdx < userWp.length ? userWp[openingEndIdx] : null;

  return {
    metricsVersion: METRICS_VERSION,
    analysisSig: `${String(ctx.engineDepthMin)}:${String(ctx.rank1Count)}`,
    multipvMax: ctx.multipvMax,
    accuracyOpening: accuracyWhere(entries, (p) => p.phase === "opening"),
    accuracyMiddlegame: accuracyWhere(entries, (p) => p.phase === "middlegame"),
    accuracyEndgame: accuracyWhere(entries, (p) => p.phase === "endgame"),
    aclOpening: aclWhere(timeline, (p) => p.phase === "opening"),
    aclMiddlegame: aclWhere(timeline, (p) => p.phase === "middlegame"),
    aclEndgame: aclWhere(timeline, (p) => p.phase === "endgame"),
    middlegameStartPly: ctx.phases.middlegameStartPly,
    endgameStartPly: ctx.phases.endgameStartPly,
    timeOpeningS: timeInPhase(timeline, "opening"),
    timeMiddlegameS: timeInPhase(timeline, "middlegame"),
    timeEndgameS: timeInPhase(timeline, "endgame"),
    avgMoveTimeS,
    accuracyCritical: accuracyWhere(entries, isCritical),
    accuracyQuiet: accuracyWhere(entries, (p) => !isCritical(p)),
    criticalPositions: userEntries.filter((e) => isCritical(e.ply)).length,
    timeAllocEfficiency: spearman(allocThink, allocCrit),
    maxBlunderRun: maxRun,
    recoveryAccuracy,
    timeTroubleMoves: tt.moves,
    timeTroubleErrors: tt.errors,
    peakEvalWp: userWp.length > 0 ? Math.max(...userWp) : null,
    troughEvalWp: userWp.length > 0 ? Math.min(...userWp) : null,
    outOfBookPly,
    outOfBookEcoFallback: 1,
    postBookAccuracy: accuracyWhere(entries, (p) => p.plyIndex > outOfBookPly),
    evalOpeningEndWp,
    userMoves: userEntries.length,
    clocksAvailable: clocksAvailable ? 1 : 0,
    engineDepthMin: ctx.engineDepthMin,
    criticalMoves: topCriticalMoves(timeline),
    missedConversions: missedConversions(timeline),
  };
}
