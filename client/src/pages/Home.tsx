import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  fetchGames,
  fetchBulkMetrics,
  type GameRow,
  type GameMetrics,
  type PerSideMetrics,
} from "../api";
import { GameCard } from "../components/GameCard";
import { StatsPanel } from "../components/StatsPanel";

const USERNAME_STORAGE_KEY = "chess-analyzer-username";

const SORT_LABELS: Record<"recent" | "worst" | "best", string> = {
  recent: "Recent",
  worst: "Worst first",
  best: "Best first",
};

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
  const [searchParams, setSearchParams] = useSearchParams();
  const usernameParam = searchParams.get("username") ?? "";

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

  const games = data?.games ?? EMPTY_GAMES;
  const username = data?.username ?? null;

  const [filter, setFilter] = useState("");
  const [timeClassFilter, setTimeClassFilter] = useState("all");
  const [resultFilter, setResultFilter] = useState("all");
  const [sortMode, setSortMode] = useState<"recent" | "worst" | "best">("recent");

  useEffect(() => {
    document.title = "Chess Analyzer";
  }, []);

  useEffect(() => {
    if (usernameParam === "") {
      const cached = localStorage.getItem(USERNAME_STORAGE_KEY);
      if (cached !== null && cached !== "") {
        setSearchParams({ username: cached }, { replace: true });
      }
    } else {
      localStorage.setItem(USERNAME_STORAGE_KEY, usernameParam);
    }
  }, [usernameParam, setSearchParams]);

  const handleSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const rawValue = formData.get("username");
    const newUsername = typeof rawValue === "string" ? rawValue : "";
    if (newUsername !== "") {
      setSearchParams({ username: newUsername });
    }
  };

  const sortedFilteredGames = useMemo(() => {
    const filtered = games.filter((g) => {
      // Text search (opponent name)
      if (filter !== "") {
        const search = filter.toLowerCase();
        const matchesWhite = g.white.toLowerCase().includes(search);
        const matchesBlack = g.black.toLowerCase().includes(search);
        if (!matchesWhite && !matchesBlack) { return false; }
      }

      // Time class filter
      if (timeClassFilter !== "all" && g.time_class !== timeClassFilter) {
        return false;
      }

      // Result filter
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
      // Games without metrics sort to the end regardless of mode
      if (aAcc === null && bAcc === null) {return 0;}
      if (aAcc === null) {return 1;}
      if (bAcc === null) {return -1;}
      return sortMode === "worst" ? aAcc - bAcc : bAcc - aAcc;
    });
  }, [games, filter, timeClassFilter, resultFilter, sortMode, metricsMap, username]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">
            Chess Analyzer
          </h1>
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              key={usernameParam}
              type="text"
              name="username"
              placeholder="Chess.com username"
              defaultValue={usernameParam}
              className="px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
              disabled={isFetching}
            >
              {isFetching ? "Loading..." : "Load Games"}
            </button>
          </form>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        {username !== null && games.length > 0 && (
          <>
            <StatsPanel username={username} />
            <div className="flex flex-wrap gap-3 mb-6">
              <input
                type="text"
                placeholder="Search by opponent..."
                value={filter}
                onChange={(e) => { setFilter(e.target.value); }}
                className="px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <select
                value={timeClassFilter}
                onChange={(e) => { setTimeClassFilter(e.target.value); }}
                className="px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100"
              >
                <option value="all">All Time Controls</option>
                <option value="bullet">Bullet</option>
                <option value="blitz">Blitz</option>
                <option value="rapid">Rapid</option>
                <option value="daily">Daily</option>
              </select>
              <select
                value={resultFilter}
                onChange={(e) => { setResultFilter(e.target.value); }}
                className="px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100"
              >
                <option value="all">All Results</option>
                <option value="win">Wins</option>
                <option value="loss">Losses</option>
                <option value="draw">Draws</option>
              </select>
              <div className="flex gap-1 self-center">
                {(["recent", "worst", "best"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => { setSortMode(mode); }}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      sortMode === mode
                        ? "bg-blue-600 text-white"
                        : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600"
                    }`}
                  >
                    {SORT_LABELS[mode]}
                  </button>
                ))}
              </div>
              <span className="self-center text-sm text-gray-500 dark:text-gray-400">
                {sortedFilteredGames.length} game{sortedFilteredGames.length !== 1 ? "s" : ""}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {sortedFilteredGames.map((g) => {
                const m = metricsMap?.[g.id];
                const side = userSideOf(g, username);
                const acc =
                  m !== null && m !== undefined
                    ? pickSide(m, side).accuracy
                    : undefined;
                const blunders =
                  m !== null && m !== undefined
                    ? pickSide(m, side).blunders
                    : undefined;
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
                    accuracy={acc}
                    blunders={blunders}
                  />
                );
              })}
            </div>
          </>
        )}

        {username !== null && games.length === 0 && !isFetching && (
          <div className="text-center py-20 text-gray-500 dark:text-gray-400">
            <p className="text-lg">No games found for &ldquo;{username}&rdquo;</p>
            <p className="text-sm mt-1">
              Check the username and try again.
            </p>
          </div>
        )}

        {usernameParam === "" && (
          <div className="text-center py-20 text-gray-500 dark:text-gray-400">
            <p className="text-lg">Enter a Chess.com username to get started</p>
            <p className="text-sm mt-1">
              Recent games will be fetched and cached locally for analysis.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
