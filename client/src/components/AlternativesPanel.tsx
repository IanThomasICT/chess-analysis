import { useQuery } from "@tanstack/react-query";
import { fetchAlternatives, type AlternativeRow } from "../api";

interface Props {
  gameId: string;
  moveIndex: number;
  /** SAN of the move actually played at this position. */
  playedMove?: string;
}

function formatScore(cp: number | null, mate: number | null): string {
  if (mate !== null) {
    return mate > 0 ? `+M${String(mate)}` : `-M${String(Math.abs(mate))}`;
  }
  if (cp === null) {
    return "—";
  }
  const pawns = cp / 100;
  return `${pawns > 0 ? "+" : ""}${pawns.toFixed(2)}`;
}

export function AlternativesPanel({ gameId, moveIndex, playedMove }: Props) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["alternatives", gameId, moveIndex],
    queryFn: async () => fetchAlternatives(gameId, moveIndex),
    enabled: gameId !== "" && moveIndex >= 0,
  });

  if (isPending || isError) { return null; }
  if (data.alternatives.length === 0) { return null; }

  return (
    <div>
      <div className="mb-2 text-sm font-semibold text-fg">Top engine lines</div>
      <ol className="space-y-1 text-xs">
        {data.alternatives.map((alt: AlternativeRow) => (
          <li key={alt.multipvRank} className="flex items-center gap-2">
            <span className="w-4 text-faint">{alt.multipvRank}.</span>
            <span className="w-16 font-mono text-fg">
              {formatScore(alt.scoreCp, alt.scoreMate)}
            </span>
            <span
              className="flex-1 truncate font-mono text-muted"
              title={alt.pv ?? ""}
            >
              {alt.pv !== null && alt.pv !== "" ? alt.pv : alt.bestMove}
            </span>
            <span className="text-faint">d{alt.depth}</span>
          </li>
        ))}
      </ol>
      {playedMove !== undefined && playedMove !== "" && (
        <div className="mt-2 text-xs text-muted">
          Played: <span className="font-mono">{playedMove}</span>
        </div>
      )}
    </div>
  );
}
