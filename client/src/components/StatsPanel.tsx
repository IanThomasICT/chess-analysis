import { useQuery } from "@tanstack/react-query";
import { fetchBySide, type SideStats } from "../api";
import { StatTile } from "./ui/StatTile";

interface StatsPanelProps {
  username: string;
}

function pct(n: number): string {
  return `${String(Math.round(n * 100))}%`;
}

function acc(value: number | null): string {
  return value === null ? "—" : `${String(Math.round(value))}%`;
}

/** Games-weighted mean of a per-side metric, skipping null sides. */
function weighted(white: SideStats, black: SideStats, pick: (s: SideStats) => number | null): string {
  let sum = 0;
  let n = 0;
  for (const s of [white, black]) {
    const v = pick(s);
    if (v !== null && s.games > 0) {
      sum += v * s.games;
      n += s.games;
    }
  }
  return n === 0 ? "—" : (sum / n).toFixed(1);
}

/** At-a-glance KPI band shown atop the Games page. */
export function StatsPanel({ username }: StatsPanelProps) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["stats", "by-side", username],
    queryFn: async () => fetchBySide(username),
    enabled: username !== "",
  });

  if (username === "" || isPending || isError) {
    return null;
  }

  const { white, black } = data;
  if (white.games === 0 && black.games === 0) {
    return null;
  }

  const games = white.games + black.games;
  const wins = white.wins + black.wins;
  const draws = white.draws + black.draws;
  const losses = white.losses + black.losses;
  const overallWin = games > 0 ? wins / games : 0;
  const accWeighted = weighted(white, black, (s) => s.avg_accuracy);
  const blundersWeighted = weighted(white, black, (s) => s.blunders_per_game);

  return (
    <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <StatTile label="Record" value={`${String(wins)}-${String(draws)}-${String(losses)}`} hint={`${String(games)} games`} />
      <StatTile label="Win rate" value={pct(overallWin)} tone="accent" />
      <StatTile label="Accuracy" value={accWeighted === "—" ? "—" : `${accWeighted}%`} />
      <StatTile label="Blunders / game" value={blundersWeighted} />
      <StatTile label="As White" value={pct(white.win_rate)} hint={`${acc(white.avg_accuracy)} acc`} />
      <StatTile label="As Black" value={pct(black.win_rate)} hint={`${acc(black.avg_accuracy)} acc`} />
    </div>
  );
}
