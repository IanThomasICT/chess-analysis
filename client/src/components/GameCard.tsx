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
  /** White's clock at the end of the game (seconds), if recorded. */
  whiteClockFinalS?: number | null;
  /** Black's clock at the end of the game (seconds), if recorded. */
  blackClockFinalS?: number | null;
  /** PGN Termination header, e.g. "Player won on time". */
  termination?: string | null;
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

/** Returns true if the searched user lost this game on time. */
function userLostOnTime(
  result: string,
  white: string,
  username: string,
  termination: string | null | undefined,
  whiteClock: number | null | undefined,
  blackClock: number | null | undefined,
): boolean {
  const userIsWhite = white.toLowerCase() === username.toLowerCase();
  const userLost = (userIsWhite && result === "0-1") || (!userIsWhite && result === "1-0");
  if (!userLost) {return false;}
  if (typeof termination === "string" && termination.toLowerCase().includes("on time")) {
    return true;
  }
  // Fall back to clock detection if termination not present.
  const userClock = userIsWhite ? whiteClock : blackClock;
  return typeof userClock === "number" && userClock <= 0.1;
}

/** Format seconds → "M:SS" (or "H:MM:SS" for ≥ 1h). */
function fmtClock(secs: number): string {
  const total = Math.max(0, Math.floor(secs));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  if (h > 0) {
    const mm = String(m).padStart(2, "0");
    return `${String(h)}:${mm}:${ss}`;
  }
  return `${String(m)}:${ss}`;
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
  whiteClockFinalS,
  blackClockFinalS,
  termination,
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
      {(accuracy !== undefined ||
        (blunders !== undefined && blunders > 0) ||
        userLostOnTime(result, white, username, termination, whiteClockFinalS, blackClockFinalS)) && (
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
          {userLostOnTime(result, white, username, termination, whiteClockFinalS, blackClockFinalS) && (
            <span
              className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200"
              title="Lost on time"
            >
              ⏱ flag
            </span>
          )}
        </div>
      )}
      {(typeof whiteClockFinalS === "number" || typeof blackClockFinalS === "number") && (
        <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1 flex gap-3">
          {typeof whiteClockFinalS === "number" && (
            <span>♔ {fmtClock(whiteClockFinalS)}</span>
          )}
          {typeof blackClockFinalS === "number" && (
            <span>♚ {fmtClock(blackClockFinalS)}</span>
          )}
        </div>
      )}
    </Link>
  );
}
