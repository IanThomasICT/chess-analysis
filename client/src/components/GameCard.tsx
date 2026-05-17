import { Link } from "react-router";

interface GameCardProps {
  id: string;
  white: string;
  black: string;
  result: string;
  timeClass: string;
  endTime: number;
  username: string;
  /** Accuracy 0..100 for the searched user's side, if metrics are available. */
  accuracy?: number;
  /** Blunder count for the searched user's side. */
  blunders?: number;
}

function accuracyColor(acc: number): string {
  if (acc >= 90) {return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";}
  if (acc >= 70) {return "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200";}
  return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
}

function blunderColor(b: number): string {
  if (b >= 3) {return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";}
  return "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200";
}

const TIME_CLASS_ICONS: Record<string, string> = {
  bullet: "🔫",
  blitz: "⚡",
  rapid: "🕐",
  daily: "📅",
};

function ResultBadge({
  result,
  username,
  white,
}: {
  result: string;
  username: string;
  white: string;
}) {
  const isWhite = white.toLowerCase() === username.toLowerCase();
  let label: string;
  let colorClass: string;

  if (result === "1-0") {
    label = isWhite ? "Win" : "Loss";
    colorClass = isWhite
      ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
      : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
  } else if (result === "0-1") {
    label = isWhite ? "Loss" : "Win";
    colorClass = isWhite
      ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
      : "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
  } else {
    label = "Draw";
    colorClass =
      "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200";
  }

  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${colorClass}`}
    >
      {label}
    </span>
  );
}

export function GameCard({
  id,
  white,
  black,
  result,
  timeClass,
  endTime,
  username,
  accuracy,
  blunders,
}: GameCardProps) {
  const date = new Date(endTime * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const icon = TIME_CLASS_ICONS[timeClass] ?? "♟️";

  return (
    <Link
      to={`/analysis/${id}`}
      className="block p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-md transition-all bg-white dark:bg-gray-800"
    >
      <div className="flex items-center justify-between mb-2">
        <ResultBadge result={result} username={username} white={white} />
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {icon} {timeClass}
        </span>
      </div>
      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
        <span className="text-white-piece">♔</span> {white}
      </div>
      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
        <span className="text-black-piece">♚</span> {black}
      </div>
      <div className="text-xs text-gray-400 dark:text-gray-500 mt-2">
        {date}
      </div>
      {(accuracy !== undefined || (blunders !== undefined && blunders > 0)) && (
        <div className="flex flex-wrap gap-1 mt-2">
          {accuracy !== undefined && (
            <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${accuracyColor(accuracy)}`}>
              {Math.round(accuracy)}% acc
            </span>
          )}
          {blunders !== undefined && blunders > 0 && (
            <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${blunderColor(blunders)}`}>
              {blunders} blunder{blunders === 1 ? "" : "s"}
            </span>
          )}
        </div>
      )}
    </Link>
  );
}
