import { memo, useEffect, useRef } from "react";

interface MoveListProps {
  moves: string[];
  currentMove: number;
  onSelectMove: (moveIndex: number) => void;
  moveClasses: string[];
}

export const MoveList = memo(function MoveList({
  moves,
  currentMove,
  onSelectMove,
  moveClasses,
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
              } ${moveClasses[pair.white.index - 1] ?? ""}`}
            >
              {pair.white.san}
            </button>
            {pair.black ? (
              <button
                ref={currentMove === pair.black.index ? activeRef : null}
                onClick={() => {
                  if (pair.black) onSelectMove(pair.black.index);
                }}
                className={`text-left px-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 ${
                  currentMove === pair.black.index
                    ? "bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200"
                    : "text-gray-900 dark:text-gray-100"
                } ${moveClasses[pair.black.index - 1] ?? ""}`}
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
});
