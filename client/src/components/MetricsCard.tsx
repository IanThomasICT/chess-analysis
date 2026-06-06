import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchGameMetricDetail,
  type CriticalMove,
  type MissedConversion,
} from "../api";

interface Props {
  gameId: string;
}

const QUALITY_LABELS: Record<string, string> = {
  swindle_win: "Swindle win",
  clean_win: "Clean win",
  unlucky_loss: "Unlucky loss",
  clean_loss: "Clean loss",
  hold_draw: "Hold draw",
  even_draw: "Even draw",
};

function fmtNum(n: number | null | undefined, decimals = 0): string {
  if (n === null || n === undefined) {return "—";}
  return decimals === 0 ? String(Math.round(n)) : n.toFixed(decimals);
}

function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined) {return "—";}
  return `${Math.round(n)}%`;
}

function fmtSec(n: number | null | undefined): string {
  if (n === null || n === undefined) {return "—";}
  return `${n.toFixed(1)}s`;
}

function Label({ children }: { children: string }) {
  return (
    <span className="text-xs uppercase text-gray-500 dark:text-gray-400 tracking-wide">
      {children}
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-baseline gap-2">
      <Label>{label}</Label>
      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase text-gray-400 dark:text-gray-500 tracking-wide mb-1 border-b border-gray-100 dark:border-gray-700 pb-0.5">
        {title}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function criticalMoveClass(cls: string): string {
  if (cls === "blunder") {
    return "shrink-0 px-1 rounded text-[10px] font-semibold bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
  }
  if (cls === "mistake") {
    return "shrink-0 px-1 rounded text-[10px] font-semibold bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200";
  }
  return "shrink-0 px-1 rounded text-[10px] font-semibold bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300";
}

function CriticalMoveRow({ move }: { move: CriticalMove }) {
  const san = move.moveSan ?? "—";
  const wpBefore = Math.round(move.wpBefore);
  const wpAfter = Math.round(move.wpAfter);
  return (
    <div className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
      <span className="font-mono font-semibold w-10 shrink-0">{san}</span>
      <span className="text-gray-500 dark:text-gray-400 capitalize shrink-0">{move.phase}</span>
      <span className="text-gray-400 dark:text-gray-500 shrink-0">{wpBefore}%→{wpAfter}%</span>
      <span className={criticalMoveClass(move.moveClass)}>
        {move.moveClass}
      </span>
    </div>
  );
}

function MissedRow({ move }: { move: MissedConversion }) {
  const san = move.moveSan ?? "—";
  return (
    <div className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
      <span className="font-mono font-semibold w-10 shrink-0">{san}</span>
      <span className="text-gray-400 dark:text-gray-500">ply {move.plyIndex}</span>
      {move.thinkTimeS !== null && (
        <span className="text-gray-400 dark:text-gray-500">{move.thinkTimeS.toFixed(1)}s</span>
      )}
    </div>
  );
}

export const MetricsCard = memo(function MetricsCard({ gameId }: Props) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["metricDetail", gameId],
    queryFn: async () => fetchGameMetricDetail(gameId),
  });

  if (isPending) {return null;}
  if (isError) {return null;}

  // Alias to a non-optional local so nested helper functions below can use it
  // without TypeScript losing the narrowing across function-scope boundaries.
  const detail = data;

  const qualityLabel = QUALITY_LABELS[detail.resultQuality] ?? detail.resultQuality;

  function resultQualityColorClass(): string {
    if (detail.result === "win") {
      return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
    }
    if (detail.result === "loss") {
      return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
    }
    return "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200";
  }

  function eloDeltaColorClass(delta: number): string {
    if (delta > 0) {return "text-sm font-semibold text-green-600 dark:text-green-400";}
    if (delta < 0) {return "text-sm font-semibold text-red-600 dark:text-red-400";}
    return "text-sm font-semibold text-gray-500 dark:text-gray-400";
  }

  const qualityColorClass = resultQualityColorClass();

  const eloDeltaNode =
    detail.eloDelta !== null ? (
      <span className={eloDeltaColorClass(detail.eloDelta)}>
        {detail.eloDelta > 0 ? "+" : ""}
        {String(detail.eloDelta)}
      </span>
    ) : null;

  const phases = detail.phases;
  const hasPhaseTime =
    phases.timeOpeningS !== null ||
    phases.timeMiddlegameS !== null ||
    phases.timeEndgameS !== null;

  const topCritical = detail.criticalMoves.slice(0, 5);
  const topMissed = detail.missedConversions.slice(0, 3);

  function conversionChipClass(): string {
    if (detail.converted) {
      return "inline-block px-2 py-0.5 rounded text-xs font-semibold bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
    }
    return "inline-block px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200";
  }

  function savedChipClass(): string {
    if (detail.saved) {
      return "inline-block px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
    }
    return "inline-block px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
  }

  return (
    <div className="rounded border border-gray-200 dark:border-gray-700 p-3 bg-white dark:bg-gray-800 space-y-3 mt-4">
      {/* Header: quality badge + elo delta */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${qualityColorClass}`}>
          {qualityLabel}
        </span>
        {eloDeltaNode !== null && (
          <div className="flex items-center gap-1">
            <Label>Elo</Label>
            {eloDeltaNode}
          </div>
        )}
        {detail.timeTroubleFlag && (
          <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
            ⏱ time trouble
          </span>
        )}
      </div>

      {/* Phase accuracy */}
      <Section title="Phase Accuracy">
        <Row label="Opening" value={fmtPct(detail.accuracyOpening)} />
        <Row label="Middlegame" value={fmtPct(detail.accuracyMiddlegame)} />
        <Row label="Endgame" value={fmtPct(detail.accuracyEndgame)} />
        {hasPhaseTime && (
          <div className="pt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
            {phases.timeOpeningS !== null && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Opening {fmtSec(phases.timeOpeningS)}
              </span>
            )}
            {phases.timeMiddlegameS !== null && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Mid {fmtSec(phases.timeMiddlegameS)}
              </span>
            )}
            {phases.timeEndgameS !== null && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                End {fmtSec(phases.timeEndgameS)}
              </span>
            )}
          </div>
        )}
      </Section>

      {/* Critical / Quiet */}
      <Section title="Position Quality">
        <Row label="Critical acc" value={fmtPct(detail.accuracyCritical)} />
        <Row label="Quiet acc" value={fmtPct(detail.accuracyQuiet)} />
        <Row label="Critical positions" value={fmtNum(detail.criticalPositions)} />
        <Row label="Max blunder run" value={fmtNum(detail.maxBlunderRun)} />
        <Row label="Recovery acc" value={fmtPct(detail.recoveryAccuracy)} />
      </Section>

      {/* Time */}
      <Section title="Time">
        <Row label="Avg move time" value={fmtSec(detail.avgMoveTimeS)} />
        <Row label="Time-alloc eff" value={fmtNum(detail.timeAllocEfficiency, 2)} />
      </Section>

      {/* Conversion / Defense chips */}
      <Section title="Conversion / Defense">
        <div className="flex flex-wrap gap-1 mt-0.5">
          {detail.reachedWinning && (
            <span className={conversionChipClass()}>
              {detail.converted ? "Converted win" : "Missed conversion"}
            </span>
          )}
          {detail.reachedLosing && (
            <span className={savedChipClass()}>
              {detail.saved ? "Saved" : "Lost losing pos"}
            </span>
          )}
          {!detail.reachedWinning && !detail.reachedLosing && (
            <span className="text-xs text-gray-400 dark:text-gray-500">No decisive positions</span>
          )}
        </div>
      </Section>

      {/* Critical moves list */}
      {topCritical.length > 0 && (
        <Section title="Critical Moves">
          <div className="space-y-0.5 mt-0.5">
            {topCritical.map((m) => (
              <CriticalMoveRow key={m.plyIndex} move={m} />
            ))}
          </div>
        </Section>
      )}

      {/* Missed conversions list */}
      {topMissed.length > 0 && (
        <Section title="Missed Conversions">
          <div className="space-y-0.5 mt-0.5">
            {topMissed.map((m) => (
              <MissedRow key={m.plyIndex} move={m} />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
});
