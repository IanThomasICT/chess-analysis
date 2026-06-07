import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import {
  fetchGameMetricDetail,
  type CriticalMove,
  type MissedConversion,
} from "../api";
import { Chip, type ChipTone } from "./ui/Chip";

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
  return `${String(Math.round(n))}%`;
}

function fmtSec(n: number | null | undefined): string {
  if (n === null || n === undefined) {return "—";}
  return `${n.toFixed(1)}s`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      <span className="font-mono text-sm font-medium text-fg">{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 border-b border-line pb-0.5 text-xs font-semibold uppercase tracking-wide text-faint">
        {title}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function moveClassTone(cls: string): ChipTone {
  if (cls === "blunder") {return "blunder";}
  if (cls === "mistake") {return "mistake";}
  return "neutral";
}

function resultTone(result: string): ChipTone {
  if (result === "win") {return "win";}
  if (result === "loss") {return "loss";}
  return "draw";
}

function eloDeltaColor(delta: number): string {
  if (delta > 0) {return "text-win";}
  if (delta < 0) {return "text-loss";}
  return "text-muted";
}

function CriticalMoveRow({ move }: { move: CriticalMove }) {
  const san = move.moveSan ?? "—";
  const wpBefore = Math.round(move.wpBefore);
  const wpAfter = Math.round(move.wpAfter);
  return (
    <div className="flex items-center gap-2 text-xs text-fg">
      <span className="w-10 shrink-0 font-mono font-semibold">{san}</span>
      <span className="shrink-0 capitalize text-muted">{move.phase}</span>
      <span className="shrink-0 font-mono text-faint">{wpBefore}%&rarr;{wpAfter}%</span>
      <Chip tone={moveClassTone(move.moveClass)} className="ml-auto">{move.moveClass}</Chip>
    </div>
  );
}

function MissedRow({ move }: { move: MissedConversion }) {
  const san = move.moveSan ?? "—";
  return (
    <div className="flex items-center gap-2 text-xs text-fg">
      <span className="w-10 shrink-0 font-mono font-semibold">{san}</span>
      <span className="text-faint">ply {move.plyIndex}</span>
      {move.thinkTimeS !== null && (
        <span className="font-mono text-faint">{move.thinkTimeS.toFixed(1)}s</span>
      )}
    </div>
  );
}

export const MetricsCard = memo(function MetricsCard({ gameId }: Props) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["metricDetail", gameId],
    queryFn: async () => fetchGameMetricDetail(gameId),
  });

  if (isPending) {return <p className="text-sm text-muted">Loading report…</p>;}
  if (isError) {return <p className="text-sm text-muted">No report available.</p>;}

  const detail = data;
  const qualityLabel = QUALITY_LABELS[detail.resultQuality] ?? detail.resultQuality;

  const qualityTone = resultTone(detail.result);

  const eloDeltaNode =
    detail.eloDelta !== null ? (
      <span className={`font-mono text-sm font-semibold ${eloDeltaColor(detail.eloDelta)}`}>
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

  return (
    <div className="space-y-3">
      {/* Header: quality + elo delta */}
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={qualityTone}>{qualityLabel}</Chip>
        {eloDeltaNode !== null && (
          <div className="flex items-center gap-1">
            <span className="text-xs uppercase tracking-wide text-muted">Elo</span>
            {eloDeltaNode}
          </div>
        )}
        {detail.timeTroubleFlag && (
          <Chip tone="mistake" icon={<Clock size={11} />}>time trouble</Chip>
        )}
      </div>

      <Section title="Phase Accuracy">
        <Row label="Opening" value={fmtPct(detail.accuracyOpening)} />
        <Row label="Middlegame" value={fmtPct(detail.accuracyMiddlegame)} />
        <Row label="Endgame" value={fmtPct(detail.accuracyEndgame)} />
        {hasPhaseTime && (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 pt-0.5 text-xs text-muted">
            {phases.timeOpeningS !== null && <span>Opening {fmtSec(phases.timeOpeningS)}</span>}
            {phases.timeMiddlegameS !== null && <span>Mid {fmtSec(phases.timeMiddlegameS)}</span>}
            {phases.timeEndgameS !== null && <span>End {fmtSec(phases.timeEndgameS)}</span>}
          </div>
        )}
      </Section>

      <Section title="Position Quality">
        <Row label="Critical acc" value={fmtPct(detail.accuracyCritical)} />
        <Row label="Quiet acc" value={fmtPct(detail.accuracyQuiet)} />
        <Row label="Critical positions" value={fmtNum(detail.criticalPositions)} />
        <Row label="Max blunder run" value={fmtNum(detail.maxBlunderRun)} />
        <Row label="Recovery acc" value={fmtPct(detail.recoveryAccuracy)} />
      </Section>

      <Section title="Time">
        <Row label="Avg move time" value={fmtSec(detail.avgMoveTimeS)} />
        <Row label="Time-alloc eff" value={fmtNum(detail.timeAllocEfficiency, 2)} />
      </Section>

      <Section title="Conversion / Defense">
        <div className="mt-0.5 flex flex-wrap gap-1">
          {detail.reachedWinning && (
            <Chip tone={detail.converted ? "good" : "mistake"}>
              {detail.converted ? "Converted win" : "Missed conversion"}
            </Chip>
          )}
          {detail.reachedLosing && (
            <Chip tone={detail.saved ? "info" : "loss"}>
              {detail.saved ? "Saved" : "Lost losing pos"}
            </Chip>
          )}
          {!detail.reachedWinning && !detail.reachedLosing && (
            <span className="text-xs text-faint">No decisive positions</span>
          )}
        </div>
      </Section>

      {topCritical.length > 0 && (
        <Section title="Critical Moves">
          <div className="mt-0.5 space-y-1">
            {topCritical.map((m) => (
              <CriticalMoveRow key={m.plyIndex} move={m} />
            ))}
          </div>
        </Section>
      )}

      {topMissed.length > 0 && (
        <Section title="Missed Conversions">
          <div className="mt-0.5 space-y-1">
            {topMissed.map((m) => (
              <MissedRow key={m.plyIndex} move={m} />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
});
