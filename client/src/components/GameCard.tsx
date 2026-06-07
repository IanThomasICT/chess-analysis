import { Link } from "react-router";
import { AlertTriangle, Clock, Flag } from "lucide-react";
import { Chip, type ChipTone } from "./ui/Chip";
import { TimeClassIcon } from "./ui/TimeClassIcon";

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
  /** resultQuality from extended metrics — chips shown for swindle_win / unlucky_loss only. */
  resultQuality?: string;
  /** When true the user was in time trouble. */
  timeTroubleFlag?: boolean;
}

function accuracyBarColor(acc: number): string {
  if (acc >= 90) {return "bg-win";}
  if (acc >= 70) {return "bg-inaccuracy";}
  return "bg-loss";
}

function accuracyTextColor(acc: number): string {
  if (acc >= 90) {return "text-win";}
  if (acc >= 70) {return "text-inaccuracy";}
  return "text-loss";
}

function resultInfo(
  result: string,
  white: string,
  username: string,
): { label: string; tone: ChipTone } {
  const isWhite = white.toLowerCase() === username.toLowerCase();
  if (result === "1-0") {
    return isWhite ? { label: "Win", tone: "win" } : { label: "Loss", tone: "loss" };
  }
  if (result === "0-1") {
    return isWhite ? { label: "Loss", tone: "loss" } : { label: "Win", tone: "win" };
  }
  return { label: "Draw", tone: "draw" };
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
  resultQuality,
  timeTroubleFlag,
}: GameCardProps) {
  const date = new Date(endTime * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const { label: resultLabel, tone: resultTone } = resultInfo(result, white, username);
  const lostOnTime = userLostOnTime(
    result,
    white,
    username,
    termination,
    whiteClockFinalS,
    blackClockFinalS,
  );
  const hasChips =
    accuracy !== undefined ||
    (blunders !== undefined && blunders > 0) ||
    resultQuality === "swindle_win" ||
    resultQuality === "unlucky_loss" ||
    timeTroubleFlag === true ||
    lostOnTime;

  return (
    <Link
      to={`/analysis/${id}`}
      className="block rounded-lg border border-line bg-surface p-3 transition-all hover:border-accent hover:bg-raised"
    >
      <div className="mb-2 flex items-center justify-between">
        <Chip tone={resultTone}>{resultLabel}</Chip>
        <span className="flex items-center gap-1 text-xs capitalize text-muted">
          <TimeClassIcon timeClass={timeClass} size={13} />
          {timeClass}
        </span>
      </div>

      <div className="space-y-0.5">
        <div className="flex items-center gap-1.5 text-sm text-fg">
          <span className="text-base leading-none">&#9812;</span>
          <span className="truncate">{white}</span>
        </div>
        <div className="flex items-center gap-1.5 text-sm text-fg">
          <span className="text-base leading-none text-muted">&#9818;</span>
          <span className="truncate">{black}</span>
        </div>
      </div>

      {accuracy !== undefined && (
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised">
            <div
              className={`h-full ${accuracyBarColor(accuracy)}`}
              style={{ width: `${String(Math.round(accuracy))}%` }}
            />
          </div>
          <span className={`font-mono text-xs font-semibold tabular-nums ${accuracyTextColor(accuracy)}`}>
            {Math.round(accuracy)}%
          </span>
        </div>
      )}

      {hasChips && (
        <div className="mt-2 flex flex-wrap gap-1">
          {blunders !== undefined && blunders > 0 && (
            <Chip
              tone={blunders >= 3 ? "blunder" : "mistake"}
              icon={<AlertTriangle size={11} />}
            >
              {blunders} blunder{blunders === 1 ? "" : "s"}
            </Chip>
          )}
          {resultQuality === "swindle_win" && <Chip tone="swindle">Swindle</Chip>}
          {resultQuality === "unlucky_loss" && <Chip tone="info">Unlucky</Chip>}
          {timeTroubleFlag === true && (
            <Chip tone="mistake" icon={<Clock size={11} />} title="Time trouble during the game">
              time
            </Chip>
          )}
          {lostOnTime && (
            <Chip tone="info" icon={<Flag size={11} />} title="Lost on time">
              flag
            </Chip>
          )}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between text-[11px] text-faint">
        <span>{date}</span>
        {(typeof whiteClockFinalS === "number" || typeof blackClockFinalS === "number") && (
          <span className="flex gap-2 font-mono">
            {typeof whiteClockFinalS === "number" && (
              <span>&#9812; {fmtClock(whiteClockFinalS)}</span>
            )}
            {typeof blackClockFinalS === "number" && (
              <span>&#9818; {fmtClock(blackClockFinalS)}</span>
            )}
          </span>
        )}
      </div>
    </Link>
  );
}
