import type { Database } from "bun:sqlite";
import { detectMotifs, type Motif } from "./motifs";
import { classifyMove, cpToWinPct, mateToCp } from "./metrics";

export interface AnalysisSnapshot {
  fen: string;
  score_cp: number | null;
  score_mate: number | null;
  best_move: string;
  pv: string | null;
  move_san: string | null;
}

/**
 * Given two adjacent analysis rows (before and after a move was played),
 * classify the move; if mistake or blunder, detect motifs and persist tags.
 * Returns the tags persisted (may be empty).
 */
export function tagMoveIfBlunder(
  database: Database,
  gameId: string,
  moveIndex: number,
  before: AnalysisSnapshot,
  after: AnalysisSnapshot,
  playedMoveUci: string,
): Motif[] {
  const beforeCp =
    before.score_mate !== null
      ? mateToCp(before.score_mate)
      : (before.score_cp ?? 0);
  const afterCp =
    after.score_mate !== null
      ? mateToCp(after.score_mate)
      : (after.score_cp ?? 0);

  // Mover perspective: moveIndex is the after-position index.
  // Transition (moveIndex-1) → moveIndex: mover is white when (moveIndex-1) is even.
  const isWhiteMove = (moveIndex - 1) % 2 === 0;
  const wpBefore = cpToWinPct(isWhiteMove ? beforeCp : -beforeCp);
  const wpAfter = cpToWinPct(isWhiteMove ? afterCp : -afterCp);

  const cls = classifyMove(wpBefore, wpAfter);
  if (cls !== "mistake" && cls !== "blunder") {return [];}

  const tags = detectMotifs({
    fenBefore: before.fen,
    playedMove: playedMoveUci,
    bestMove: before.best_move,
    scoreCpBefore: before.score_cp,
    scoreCpAfter: after.score_cp,
    scoreMateBefore: before.score_mate,
    scoreMateAfter: after.score_mate,
    bestPv: before.pv ?? undefined,
  });

  if (tags.length === 0) {return [];}

  const insert = database.prepare(
    `INSERT OR IGNORE INTO blunder_tags (game_id, move_index, tag) VALUES (?, ?, ?)`,
  );
  for (const t of tags) {
    insert.run(gameId, moveIndex, t);
  }
  return tags;
}
