import { useQuery } from "@tanstack/react-query";
import { fetchBySide, type SideStats } from "../api";

interface StatsPanelProps {
  username: string;
}

function formatPct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function formatAccuracy(acc: number | null): string {
  if (acc === null) {return "—";}
  return `${Math.round(acc)}%`;
}

function formatBlunders(b: number | null): string {
  if (b === null) {return "—";}
  return b.toFixed(1);
}

function SidePanel({ label, stats }: { label: string; stats: SideStats }) {
  return (
    <div className="flex-1 min-w-0">
      <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
        {label}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span className="text-gray-900 dark:text-gray-100">
          <span className="font-semibold">{stats.wins}</span>-{stats.draws}-{stats.losses}
        </span>
        <span className="text-gray-700 dark:text-gray-300">
          {formatPct(stats.win_rate)} win
        </span>
        <span className="text-gray-700 dark:text-gray-300">
          {formatAccuracy(stats.avg_accuracy)} acc
        </span>
        <span className="text-gray-700 dark:text-gray-300">
          {formatBlunders(stats.blunders_per_game)} blunders/game
        </span>
      </div>
    </div>
  );
}

export function StatsPanel({ username }: StatsPanelProps) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["stats", "by-side", username],
    queryFn: async () => fetchBySide(username),
    enabled: username !== "",
  });

  if (username === "" || isPending || isError) {
    return null;
  }

  // No games? hide panel.
  if (data.white.games === 0 && data.black.games === 0) {
    return null;
  }

  return (
    <div className="mb-4 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex gap-6">
      <SidePanel label="As White" stats={data.white} />
      <div className="w-px bg-gray-200 dark:bg-gray-700" />
      <SidePanel label="As Black" stats={data.black} />
    </div>
  );
}
