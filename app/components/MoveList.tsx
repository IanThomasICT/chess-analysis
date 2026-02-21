import { useEffect, useRef } from "react";

interface AnalysisEntry {
  move_index: number;
  score_cp: number | null;
  score_mate: number | null;
}

interface MoveListProps {
  moves: string[];
  currentMove: number;
  onSelectMove: (moveIndex: number) => void;
  analysis: AnalysisEntry[];
}

/**
 * Classify a move by comparing the eval before and after.
 * Returns a CSS class for the move annotation.
 */
function getMoveClass(
  moveIndex: number,
  analysis: AnalysisEntry[]
): string {
  if (analysis.length === 0) return "";

  // moveIndex is 1-indexed into the game moves, but analysis is 0-indexed by position
  // Position before this move = moveIndex, position after = moveIndex + 1
  const before = analysis.find((a) => a.move_index === moveIndex);
  const after = analysis.find((a) => a.move_index === moveIndex + 1);

  if (!before || !after) return "";

  const scoreBefore = before.score_mate !== null
    ? before.score_mate > 0 ? 1000 : -1000
    : (before.score_cp ?? 0);

  const scoreAfter = after.score_mate !== null
    ? after.score_mate > 0 ? 1000 : -1000
    : (after.score_cp ?? 0);

  // Determine if this was a white or black move
  // moveIndex 0 = position before any move, moveIndex 1 = after white's 1st, etc.
  const isWhiteMove = moveIndex % 2 === 0; // even position index = white just played

  // Eval swing from the side-to-move's perspective
  const swing = isWhiteMove
    ? scoreAfter - scoreBefore // White moved: higher = better for white
    : scoreBefore - scoreAfter; // Black moved: lower eval = better for black

  if (swing < -300) return "text-red-500 font-bold"; // blunder
  if (swing < -100) return "text-orange-500 font-semibold"; // mistake
  if (swing < -50) return "text-yellow-500"; // inaccuracy

  return "";
}

export function MoveList({
  moves,
  currentMove,
  onSelectMove,
  analysis,
}: MoveListProps) {
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [currentMove]);

  // Group moves into pairs (white, black)
  const movePairs: Array<{
    number: number;
    white: { san: string; index: number };
    black?: { san: string; index: number };
  }> = [];

  for (let i = 0; i < moves.length; i += 2) {
    movePairs.push({
      number: Math.floor(i / 2) + 1,
      white: { san: moves[i], index: i + 1 },
      black: moves[i + 1]
        ? { san: moves[i + 1], index: i + 2 }
        : undefined,
    });
  }

  return (
    <div className="p-2 text-sm">
      <div className="grid grid-cols-[30px_1fr_1fr] gap-y-0.5">
        {movePairs.map((pair) => (
          <div key={pair.number} className="contents">
            <span className="text-gray-400 dark:text-gray-500 text-right pr-1">
              {pair.number}.
            </span>
            <button
              ref={currentMove === pair.white.index ? activeRef : null}
              onClick={() => onSelectMove(pair.white.index)}
              className={`text-left px-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 ${
                currentMove === pair.white.index
                  ? "bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200"
                  : "text-gray-900 dark:text-gray-100"
              } ${getMoveClass(pair.white.index - 1, analysis)}`}
            >
              {pair.white.san}
            </button>
            {pair.black ? (
              <button
                ref={currentMove === pair.black.index ? activeRef : null}
                onClick={() => onSelectMove(pair.black.index)}
                className={`text-left px-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 ${
                  currentMove === pair.black.index
                    ? "bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200"
                    : "text-gray-900 dark:text-gray-100"
                } ${getMoveClass(pair.black.index - 1, analysis)}`}
              >
                {pair.black.san}
              </button>
            ) : (
              <span />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
