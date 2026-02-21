interface EvalBarProps {
  score: number; // in pawns, from White's perspective
}

export function EvalBar({ score }: EvalBarProps) {
  // Clamp score to [-10, 10] pawns
  const clamped = Math.max(-10, Math.min(10, score));
  // Convert to percentage (white on bottom)
  const whiteHeight = ((clamped + 10) / 20) * 100;

  const displayScore =
    Math.abs(score) >= 10
      ? score > 0
        ? "M"
        : "-M"
      : score > 0
      ? `+${score.toFixed(1)}`
      : score.toFixed(1);

  const blackHeight = String(100 - whiteHeight);
  const whiteHeightStr = String(whiteHeight);
  const topOffset = String(100 - whiteHeight + 2);
  const bottomOffset = String(whiteHeight + 2);

  return (
    <div className="w-full h-full flex flex-col rounded overflow-hidden border border-gray-300 dark:border-gray-600 relative">
      {/* Black section (top) */}
      <div
        className="bg-gray-800 transition-all duration-300 ease-out"
        style={{ height: `${blackHeight}%` }}
      />
      {/* White section (bottom) */}
      <div
        className="bg-white transition-all duration-300 ease-out"
        style={{ height: `${whiteHeightStr}%` }}
      />
      {/* Score label */}
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          className={`text-[10px] font-bold ${
            score >= 0 ? "text-gray-800" : "text-white"
          }`}
          style={{
            top: score >= 0 ? `${topOffset}%` : undefined,
            bottom: score < 0 ? `${bottomOffset}%` : undefined,
            position: "absolute",
          }}
        >
          {displayScore}
        </span>
      </div>
    </div>
  );
}
