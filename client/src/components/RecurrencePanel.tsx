import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { fetchPositionHistory, type PositionHistoryEntry } from "../api";

interface RecurrencePanelProps {
  fen: string;
  username: string;
  /** Exclude the current game from the "prior" recurrence list. */
  currentGameId: string;
}

export function RecurrencePanel({ fen, username, currentGameId }: RecurrencePanelProps) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["position-history", fen, username],
    queryFn: async () => fetchPositionHistory(fen, username),
    enabled: fen !== "" && username !== "",
  });

  if (fen === "" || username === "") {return null;}
  if (isPending) {return null;} // Silent — don't flash "loading" on every move
  if (isError) {return null;}

  const filtered: PositionHistoryEntry[] = data.filter(
    (e) => e.game_id !== currentGameId,
  );
  if (filtered.length === 0) {return null;}

  const blunderCount = filtered.filter((e) => e.was_blunder).length;

  return (
    <div className="mt-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">
        Position recurrence
      </div>
      <div className="text-xs text-gray-600 dark:text-gray-400 mb-2">
        Seen in {filtered.length} prior game{filtered.length === 1 ? "" : "s"}
        {blunderCount > 0 ? ` — you blundered in ${blunderCount}` : ""}.
      </div>
      <div className="space-y-1 max-h-48 overflow-y-auto">
        {filtered.map((entry) => {
          const date = new Date(entry.end_time * 1000).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "2-digit",
          });
          const opponent =
            entry.white.toLowerCase() === username.toLowerCase()
              ? entry.black
              : entry.white;
          return (
            <Link
              key={`${entry.game_id}|${String(entry.move_index)}`}
              to={`/analysis/${entry.game_id}?move=${String(entry.move_index)}`}
              className="flex items-center gap-2 px-2 py-1 rounded text-xs hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              {entry.was_blunder ? (
                <span className="text-red-500" title="blundered">&#9679;</span>
              ) : (
                <span className="text-gray-400" title="no blunder">&#9675;</span>
              )}
              <span className="flex-1 truncate text-gray-700 dark:text-gray-300">
                vs {opponent}
                {entry.played_move !== null ? ` · ${entry.played_move}` : ""}
              </span>
              <span className="text-gray-400 dark:text-gray-500">{date}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
