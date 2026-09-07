import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchGameMetricDetail } from "../api";
import { CriticalMoveRow, ReportHeader } from "./MetricsCard";

interface Props {
  gameId: string;
  /** Jump the board to a position index (plyIndex = position after the move). */
  onSelectMove: (move: number) => void;
}

/**
 * Always-visible game digest for the Analysis rail: result quality, Elo swing,
 * and the top critical moves to review (clickable → board jump). Shares its
 * query key with MetricsCard, so the detail is fetched once per game.
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

  const topCritical = data.criticalMoves.slice(0, 3);

  return (
    <div className="space-y-2 border-b border-line p-2">
      <ReportHeader detail={data} />

      {topCritical.length > 0 ? (
        <div className="space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">
            Review these moves
          </div>
          {topCritical.map((m) => (
            <CriticalMoveRow key={m.plyIndex} move={m} onSelect={onSelectMove} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted">No critical mistakes — clean game.</p>
      )}
    </div>
  );
});
