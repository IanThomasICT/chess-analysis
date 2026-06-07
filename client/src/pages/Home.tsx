import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchGames,
  fetchBulkMetrics,
  fetchUserMetrics,
  type GameRow,
  type GameMetrics,
  type GameMetricSummary,
  type PerSideMetrics,
} from "../api";
import { GameCard } from "../components/GameCard";
import { StatsPanel } from "../components/StatsPanel";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { useUsername } from "../context/Username";

type SortMode = "recent" | "worst" | "best";

const SORT_OPTIONS: Array<{ value: SortMode; label: string }> = [
  { value: "recent", label: "Recent" },
  { value: "worst", label: "Worst" },
  { value: "best", label: "Best" },
];

const TIME_CLASS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "bullet", label: "Bullet" },
  { value: "blitz", label: "Blitz" },
  { value: "rapid", label: "Rapid" },
  { value: "daily", label: "Daily" },
];

const RESULT_OPTIONS = [
  { value: "all", label: "All" },
  { value: "win", label: "Wins" },
  { value: "loss", label: "Losses" },
  { value: "draw", label: "Draws" },
];

const EMPTY_GAMES: GameRow[] = [];

function pickSide(m: GameMetrics, side: "white" | "black"): PerSideMetrics {
  return side === "white" ? m.white : m.black;
}

function userSideOf(game: GameRow, username: string | null): "white" | "black" {
  return game.white.toLowerCase() === (username ?? "").toLowerCase()
    ? "white"
    : "black";
}

export function Home() {
  const { username: usernameParam } = useUsername();

  const { data, isFetching } = useQuery({
    queryKey: ["games", usernameParam],
    queryFn: async () => fetchGames(usernameParam),
    enabled: usernameParam !== "",
  });

  const { data: metricsMap } = useQuery({
    queryKey: ["metrics", "bulk", usernameParam],
    queryFn: async () => fetchBulkMetrics(usernameParam),
    enabled: usernameParam !== "",
  });

  const { data: userMetricsList } = useQuery({
    queryKey: ["userMetrics", usernameParam],
    queryFn: async () => fetchUserMetrics(usernameParam),
    enabled: usernameParam !== "",
  });

  const userMetricsById = useMemo((): Map<string, GameMetricSummary> => {
    if (userMetricsList === undefined) {return new Map();}
    return new Map(userMetricsList.map((m) => [m.gameId, m]));
  }, [userMetricsList]);

  const games = data?.games ?? EMPTY_GAMES;
  const username = data?.username ?? null;

  const [filter, setFilter] = useState("");
  const [timeClassFilter, setTimeClassFilter] = useState("all");
  const [resultFilter, setResultFilter] = useState("all");
  const [sortMode, setSortMode] = useState<SortMode>("recent");

  useEffect(() => {
    document.title = "Chess Analyzer";
  }, []);

  const sortedFilteredGames = useMemo(() => {
    const filtered = games.filter((g) => {
      if (filter !== "") {
        const search = filter.toLowerCase();
        const matchesWhite = g.white.toLowerCase().includes(search);
        const matchesBlack = g.black.toLowerCase().includes(search);
        if (!matchesWhite && !matchesBlack) { return false; }
      }

      if (timeClassFilter !== "all" && g.time_class !== timeClassFilter) {
        return false;
      }

      if (resultFilter !== "all") {
        if (username === null) { return true; }
        const isWhite = g.white.toLowerCase() === username.toLowerCase();
        const userWon =
          (isWhite && g.result === "1-0") || (!isWhite && g.result === "0-1");
        const userLost =
          (isWhite && g.result === "0-1") || (!isWhite && g.result === "1-0");
        const isDraw = g.result === "1/2-1/2";

        if (resultFilter === "win" && !userWon) { return false; }
        if (resultFilter === "loss" && !userLost) { return false; }
        if (resultFilter === "draw" && !isDraw) { return false; }
      }

      return true;
    });

    if (sortMode === "recent") {return filtered;}

    return [...filtered].sort((a, b) => {
      const ma = metricsMap?.[a.id];
      const mb = metricsMap?.[b.id];
      const aAcc =
        ma !== null && ma !== undefined
          ? pickSide(ma, userSideOf(a, username)).accuracy
          : null;
      const bAcc =
        mb !== null && mb !== undefined
          ? pickSide(mb, userSideOf(b, username)).accuracy
          : null;
      if (aAcc === null && bAcc === null) {return 0;}
      if (aAcc === null) {return 1;}
      if (bAcc === null) {return -1;}
      return sortMode === "worst" ? aAcc - bAcc : bAcc - aAcc;
    });
  }, [games, filter, timeClassFilter, resultFilter, sortMode, metricsMap, username]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      {username !== null && games.length > 0 && (
        <>
          <StatsPanel username={username} />

          <div className="mb-5 flex flex-wrap items-center gap-3">
            <input
              type="text"
              placeholder="Search by opponent..."
              value={filter}
              onChange={(e) => { setFilter(e.target.value); }}
              className="w-48 rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-fg placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <SegmentedControl
              label="Time class"
              options={TIME_CLASS_OPTIONS}
              value={timeClassFilter}
              onChange={setTimeClassFilter}
            />
            <SegmentedControl
              label="Result"
              options={RESULT_OPTIONS}
              value={resultFilter}
              onChange={setResultFilter}
            />
            <SegmentedControl
              label="Sort"
              options={SORT_OPTIONS}
              value={sortMode}
              onChange={setSortMode}
            />
            <span className="ml-auto text-sm text-muted">
              {sortedFilteredGames.length} game{sortedFilteredGames.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {sortedFilteredGames.map((g) => {
              const m = metricsMap?.[g.id];
              const side = userSideOf(g, username);
              const accuracy =
                m !== null && m !== undefined ? pickSide(m, side).accuracy : undefined;
              const blunders =
                m !== null && m !== undefined ? pickSide(m, side).blunders : undefined;
              const extMetric = userMetricsById.get(g.id);
              return (
                <GameCard
                  key={g.id}
                  id={g.id}
                  white={g.white}
                  black={g.black}
                  result={g.result}
                  timeClass={g.time_class}
                  endTime={g.end_time}
                  username={username}
                  accuracy={accuracy}
                  blunders={blunders}
                  whiteClockFinalS={g.white_clock_final_s}
                  blackClockFinalS={g.black_clock_final_s}
                  termination={g.termination}
                  resultQuality={extMetric?.resultQuality}
                  timeTroubleFlag={extMetric?.timeTroubleFlag}
                />
              );
            })}
          </div>
        </>
      )}

      {username !== null && games.length === 0 && !isFetching && (
        <div className="py-20 text-center text-muted">
          <p className="text-lg">No games found for &ldquo;{username}&rdquo;</p>
          <p className="mt-1 text-sm">Check the username and try again.</p>
        </div>
      )}

      {usernameParam === "" && (
        <div className="py-20 text-center text-muted">
          <p className="text-lg">Enter a Chess.com username to get started</p>
          <p className="mt-1 text-sm">
            Recent games will be fetched and cached locally for analysis.
          </p>
        </div>
      )}

      {usernameParam !== "" && isFetching && games.length === 0 && (
        <div className="py-20 text-center text-muted">
          <p className="text-lg">Loading games…</p>
        </div>
      )}
    </div>
  );
}
