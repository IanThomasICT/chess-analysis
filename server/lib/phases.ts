/**
 * Lichess-style game-phase divider (D0).
 *
 * Pure function over board states (FENs). Returns the ply at which the
 * middlegame and endgame begin, derived from minor+major material count and
 * back-rank sparseness — a material+structure approximation of scalachess's
 * `Divider.scala`. Region intermingling ("mixedness") is intentionally omitted
 * (TODO) since material + back-rank cover the vast majority of games.
 *
 * Ply indices are positions into the `fens` array (0 = starting position).
 */

export interface PhaseBoundaries {
  /** First ply classified as middlegame, or null if never reached. */
  middlegameStartPly: number | null;
  /** First ply classified as endgame, or null if never reached. */
  endgameStartPly: number | null;
}

/** mm threshold (minor+major pieces) at/below which the middlegame has begun. */
const MIDDLEGAME_MM = 10;
/** mm threshold at/below which the endgame has begun. */
const ENDGAME_MM = 6;
/** A side is "back-rank sparse" with fewer than this many own pieces on its back rank. */
const BACK_RANK_SPARSE = 4;

/** Count minor+major pieces (knights, bishops, rooks, queens) on the board; excludes kings and pawns. */
function minorMajorCount(piecePlacement: string): number {
  let count = 0;
  for (const ch of piecePlacement) {
    if (ch === "n" || ch === "N" || ch === "b" || ch === "B" ||
        ch === "r" || ch === "R" || ch === "q" || ch === "Q") {
      count++;
    }
  }
  return count;
}

/** Count own pieces (any type) on a single rank string from the FEN. */
function ownPiecesOnRank(rank: string, color: "w" | "b"): number {
  let count = 0;
  for (const ch of rank) {
    if (ch >= "1" && ch <= "8") {continue;}
    const isWhite = ch === ch.toUpperCase();
    if (color === "w" && isWhite) {count++;}
    else if (color === "b" && !isWhite) {count++;}
  }
  return count;
}

/** True when either side has fewer than BACK_RANK_SPARSE own pieces on its back rank. */
function isBackRankSparse(piecePlacement: string): boolean {
  const ranks = piecePlacement.split("/");
  if (ranks.length !== 8) {return false;}
  // ranks[0] = rank 8 (Black back rank), ranks[7] = rank 1 (White back rank)
  const whiteBackRank = ownPiecesOnRank(ranks[7], "w");
  const blackBackRank = ownPiecesOnRank(ranks[0], "b");
  return whiteBackRank < BACK_RANK_SPARSE || blackBackRank < BACK_RANK_SPARSE;
}

/**
 * Determine middlegame/endgame start plies from a sequence of FENs.
 * Boundaries are monotonic: once the middlegame begins it stays at/after that
 * ply; the endgame likewise. Either may be null if never reached.
 */
export function dividePhases(fens: string[]): PhaseBoundaries {
  let middlegameStartPly: number | null = null;
  let endgameStartPly: number | null = null;

  for (let ply = 0; ply < fens.length; ply++) {
    const placement = fens[ply].split(" ")[0];
    const mm = minorMajorCount(placement);

    if (middlegameStartPly === null && (mm <= MIDDLEGAME_MM || isBackRankSparse(placement))) {
      middlegameStartPly = ply;
    }
    if (mm <= ENDGAME_MM) {
      // First ply at/below the endgame material threshold. The middlegame check
      // above already set middlegameStartPly this ply (mm ≤ 6 ⊂ mm ≤ 10).
      endgameStartPly = ply;
      break;
    }
  }

  return { middlegameStartPly, endgameStartPly };
}
