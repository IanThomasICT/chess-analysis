import { memo, useEffect, useMemo, useRef } from "react";
import { classToColor, type MoveClass } from "../lib/classify";

interface MoveListProps {
  moves: string[];
  currentMove: number;
  onSelectMove: (moveIndex: number) => void;
  classifications: MoveClass[];
  motifs?: Record<string, string[]>;
}

/** Replace underscores with spaces so tooltips render "back rank mate" not "back_rank_mate". */
function motifTitle(tags: string[]): string {
  return tags.map((t) => t.replace(/_/g, " ")).join(", ");
}

export const MoveList = memo(function MoveList({
  moves,
  currentMove,
  onSelectMove,
  classifications,
  motifs,
}: MoveListProps) {
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [currentMove]);

  // Group moves into pairs (white, black) — only recomputes when moves change.
  const movePairs = useMemo(() => {
    const pairs: Array<{
      number: number;
      white: { san: string; index: number };
      black?: { san: string; index: number };
    }> = [];

    for (let i = 0; i < moves.length; i += 2) {
      const hasBlack = i + 1 < moves.length;
      pairs.push({
        number: Math.floor(i / 2) + 1,
        white: { san: moves[i], index: i + 1 },
        black: hasBlack ? { san: moves[i + 1], index: i + 2 } : undefined,
      });
    }
    return pairs;
  }, [moves]);

  return (
    <div className="p-2 text-sm">
      <div className="grid grid-cols-[30px_1fr_1fr] gap-y-0.5">
        {movePairs.map((pair) => {
          const blackPly = pair.black;
          return (
            <div key={pair.number} className="contents">
              <span className="text-gray-400 dark:text-gray-500 text-right pr-1">
                {pair.number}.
              </span>
              <button
                type="button"
                ref={currentMove === pair.white.index ? activeRef : null}
                onClick={() => { onSelectMove(pair.white.index); }}
                className={`text-left px-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 ${
                  currentMove === pair.white.index
                    ? "bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200"
                    : "text-gray-900 dark:text-gray-100"
                } ${classToColor(classifications[pair.white.index - 1] ?? "good")}`}
              >
                {pair.white.san}
                {(motifs?.[String(pair.white.index)] ?? []).length > 0 && (
                  <span
                    className="ml-1 text-[10px] text-purple-600 dark:text-purple-300 cursor-help"
                    title={motifTitle(motifs?.[String(pair.white.index)] ?? [])}
                  >
                    {(motifs?.[String(pair.white.index)] ?? []).map((t) => t.charAt(0).toUpperCase()).join("")}
                  </span>
                )}
              </button>
              {blackPly !== undefined ? (
                <button
                  type="button"
                  ref={currentMove === blackPly.index ? activeRef : null}
                  onClick={() => { onSelectMove(blackPly.index); }}
                  className={`text-left px-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 ${
                    currentMove === blackPly.index
                      ? "bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200"
                      : "text-gray-900 dark:text-gray-100"
                  } ${classToColor(classifications[blackPly.index - 1] ?? "good")}`}
                >
                  {blackPly.san}
                  {(motifs?.[String(blackPly.index)] ?? []).length > 0 && (
                    <span
                      className="ml-1 text-[10px] text-purple-600 dark:text-purple-300 cursor-help"
                      title={motifTitle(motifs?.[String(blackPly.index)] ?? [])}
                    >
                      {(motifs?.[String(blackPly.index)] ?? []).map((t) => t.charAt(0).toUpperCase()).join("")}
                    </span>
                  )}
                </button>
              ) : (
                <span />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});
