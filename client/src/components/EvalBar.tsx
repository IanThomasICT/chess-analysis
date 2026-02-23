import { memo } from "react";

interface EvalBarProps {
  score: number; // in pawns, from White's perspective
  scoreMate: number | null; // mate distance (positive = White mates), null when no forced mate
  orientation?: "white" | "black";
}

export const EvalBar = memo(function EvalBar({ score, scoreMate, orientation = "white" }: EvalBarProps) {
  // Exponential mapping via tanh — ±5.5 pawns fills nearly the entire bar,
  // reflecting the near-certain winning probability at that advantage.
  const whitePercent = 50 + 50 * Math.tanh(score / 3);

  const flipped = orientation === "black";

  let displayScore: string;
  if (scoreMate !== null) {
    const absDistance = Math.abs(scoreMate);
    displayScore = scoreMate > 0 ? `M${String(absDistance)}` : `-M${String(absDistance)}`;
  } else {
    displayScore = score > 0 ? `+${score.toFixed(1)}` : score.toFixed(1);
  }

  // When flipped (black on bottom), white section moves to top
  const topHeight = String(flipped ? whitePercent : 100 - whitePercent);
  const bottomHeight = String(flipped ? 100 - whitePercent : whitePercent);
  const topBg = flipped ? "bg-white" : "bg-gray-800";
  const bottomBg = flipped ? "bg-gray-800" : "bg-white";

  // Score label: 2% past the boundary, inside the winning side's section.
  // Boundary = distance from top to the dividing line between sections.
  const boundary = flipped ? whitePercent : 100 - whitePercent;
  const useTop = (score >= 0) !== flipped;
  const topPos = String(boundary + 2);
  const bottomPos = String(100 - boundary + 2);

  return (
    <div className="w-full h-full flex flex-col rounded overflow-hidden border border-gray-300 dark:border-gray-600 relative">
      {/* Top section */}
      <div
        className={`${topBg} transition-all duration-300 ease-out`}
        style={{ height: `${topHeight}%` }}
      />
      {/* Bottom section */}
      <div
        className={`${bottomBg} transition-all duration-300 ease-out`}
        style={{ height: `${bottomHeight}%` }}
      />
      {/* Score label */}
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          className={`text-[10px] font-bold ${
            score >= 0 ? "text-gray-800" : "text-white"
          }`}
          style={{
            top: useTop ? `${topPos}%` : undefined,
            bottom: !useTop ? `${bottomPos}%` : undefined,
            position: "absolute",
          }}
        >
          {displayScore}
        </span>
      </div>
    </div>
  );
});
