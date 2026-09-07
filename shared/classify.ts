export type MoveClass = "best" | "good" | "inaccuracy" | "mistake" | "blunder";

/**
 * Lichess-style classification thresholds on Win%-delta in [0, 1] scale.
 * Per DESIGN D1: inaccuracy ≥ 0.10, mistake ≥ 0.20, blunder ≥ 0.30.
 * "best" reserved for wpDelta < ~0.02 (Lichess: top move match). Default boundary 0.02.
 */
const CLASSIFY_THRESHOLDS = {
  best: 0.02,
  inaccuracy: 0.10,
  mistake: 0.20,
  blunder: 0.30,
} as const;

/**
 * Classify a move from its Win-percent delta (mover's perspective, ≥ 0).
 * wpDelta is on the [0, 1] scale (0.05 = 5 percentage points lost).
 */
export function classifySwing(wpDelta: number): MoveClass {
  const d = Math.max(0, wpDelta);
  if (d >= CLASSIFY_THRESHOLDS.blunder) return "blunder";
  if (d >= CLASSIFY_THRESHOLDS.mistake) return "mistake";
  if (d >= CLASSIFY_THRESHOLDS.inaccuracy) return "inaccuracy";
  if (d <= CLASSIFY_THRESHOLDS.best) return "best";
  return "good";
}

/** CSS class for rendering a move classification in MoveList. Returns "" for "best"/"good". */
export function classToColor(c: MoveClass): string {
  switch (c) {
    case "blunder": return "text-red-500 font-bold";
    case "mistake": return "text-orange-500 font-semibold";
    case "inaccuracy": return "text-yellow-500";
    case "good":
    case "best":
      return "";
  }
}
