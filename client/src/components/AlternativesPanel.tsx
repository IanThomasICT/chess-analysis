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
    <div className="mt-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">
        Top engine lines
      </div>
      <ol className="space-y-1 text-xs">
        {data.alternatives.map((alt: AlternativeRow) => (
          <li key={alt.multipvRank} className="flex items-center gap-2">
            <span className="w-4 text-gray-400">{alt.multipvRank}.</span>
            <span className="font-mono text-gray-900 dark:text-gray-100 w-16">
              {formatScore(alt.scoreCp, alt.scoreMate)}
            </span>
            <span
              className="font-mono text-gray-600 dark:text-gray-400 truncate flex-1"
              title={alt.pv ?? ""}
            >
              {alt.pv !== null && alt.pv !== "" ? alt.pv : alt.bestMove}
            </span>
            <span className="text-gray-400">d{alt.depth}</span>
          </li>
        ))}
      </ol>
      {playedMove !== undefined && playedMove !== "" && (
        <div className="mt-2 text-xs text-gray-500">
          Played: <span className="font-mono">{playedMove}</span>
        </div>
      )}
    </div>
  );
}
