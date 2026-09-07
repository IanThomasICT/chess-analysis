import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, ChevronRight } from "lucide-react";
import { fetchGameMetricDetail, type CriticalMove } from "../api";
import { Chip, type ChipTone } from "./ui/Chip";

interface Props {
  gameId: string;
  /** Jump the board to a position index (plyIndex = position after the move). */
  onSelectMove: (move: number) => void;
}

const QUALITY_LABELS: Record<string, string> = {
  swindle_win: "Swindle win",
  clean_win: "Clean win",
  unlucky_loss: "Unlucky loss",
  clean_loss: "Clean loss",
  hold_draw: "Hold draw",
  even_draw: "Even draw",
};

function resultTone(result: string): ChipTone {
  if (result === "win") {return "win";}
  if (result === "loss") {return "loss";}
  return "draw";
}

function moveClassTone(cls: string): ChipTone {
  if (cls === "blunder") {return "blunder";}
  if (cls === "mistake") {return "mistake";}
  return "inaccuracy";
}

function eloDeltaColor(delta: number): string {
  if (delta > 0) {return "text-win";}
  if (delta < 0) {return "text-loss";}
  return "text-muted";
}

function CriticalMoveButton({
  move,
  onSelect,
}: {
  move: CriticalMove;
  onSelect: (move: number) => void;
}) {
  const san = move.moveSan ?? "—";
  const wpBefore = Math.round(move.wpBefore);
  const wpAfter = Math.round(move.wpAfter);
  return (
    <button
      type="button"
      onClick={() => { onSelect(move.plyIndex); }}
      className="flex w-full items-center gap-2 rounded-md border border-line bg-canvas px-2 py-1.5 text-left text-xs transition-colors hover:border-accent hover:bg-raised"
      title={`Jump to ${san}`}
    >
      <span className="w-12 shrink-0 font-mono font-semibold text-fg">{san}</span>
      <span className="shrink-0 capitalize text-muted">{move.phase}</span>
      <span className="shrink-0 font-mono text-faint">
        {wpBefore}%&rarr;{wpAfter}%
      </span>
      <Chip tone={moveClassTone(move.moveClass)} className="ml-auto">
        {move.moveClass}
      </Chip>
      <ChevronRight size={14} className="shrink-0 text-muted" />
    </button>
  );
}

/**
 * Always-visible game digest for the Analysis rail: result quality, accuracy,
 * Elo swing, and the top critical moves to review (clickable → board jump).
 * Surfaces the headline of the per-game report without opening the Report tab.
 */
export const GameReviewSummary = memo(function GameReviewSummary({
  gameId,
  onSelectMove,
}: Props) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["metricDetail", gameId],
    queryFn: async () => fetchGameMetricDetail(gameId),
  });

  if (isPending) {
    return (
      <p className="border-b border-line p-2 text-xs text-muted">
        Building report…
      </p>
    );
  }
  if (isError) {
    return (
      <p className="border-b border-line p-2 text-xs text-muted">
        Report available once analysis finishes.
      </p>
    );
  }

  const qualityLabel = QUALITY_LABELS[data.resultQuality] ?? data.resultQuality;
  const topCritical = data.criticalMoves.slice(0, 3);

  return (
    <div className="space-y-2 border-b border-line p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip tone={resultTone(data.result)}>{qualityLabel}</Chip>
        {data.eloDelta !== null && (
          <span className="flex items-center gap-1 text-xs">
            <span className="uppercase tracking-wide text-muted">Elo</span>
            <span className={`font-mono font-semibold ${eloDeltaColor(data.eloDelta)}`}>
              {data.eloDelta > 0 ? "+" : ""}
              {String(data.eloDelta)}
            </span>
          </span>
        )}
        {data.timeTroubleFlag && (
          <Chip tone="mistake" icon={<Clock size={11} />}>time trouble</Chip>
        )}
      </div>

      {topCritical.length > 0 ? (
        <div className="space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">
            Review these moves
          </div>
          {topCritical.map((m) => (
            <CriticalMoveButton key={m.plyIndex} move={m} onSelect={onSelectMove} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted">No critical mistakes — clean game.</p>
      )}
    </div>
  );
});
