import { useState } from "react";
import { useLoaderData, Form, useSearchParams, useNavigation } from "react-router";
import type { Route } from "./+types/home";
import { fetchRecentGames } from "../lib/chesscom.server";
import { db } from "../lib/db.server";
import { GameCard } from "../components/GameCard";

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "Chess Analyzer" },
    {
      name: "description",
      content: "Analyze your Chess.com games with Stockfish",
    },
  ];
}

interface GameRow {
  id: string;
  username: string;
  pgn: string;
  white: string;
  black: string;
  result: string;
  time_class: string;
  end_time: number;
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const username = url.searchParams.get("username");

  if (username === null || username === "") {
    return { games: [] as GameRow[], username: null };
  }

  // Fetch recent games from Chess.com and upsert into DB
  try {
    const chessComGames = await fetchRecentGames(username, 3);

    const upsert = db.prepare(`
      INSERT OR REPLACE INTO games (id, username, pgn, white, black, result, time_class, end_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const upsertMany = db.transaction((games: typeof chessComGames) => {
      for (const g of games) {
        // Use the game URL as a unique ID
        const gameId = g.url.split("/").pop() ?? g.url;
        const result =
          g.white.result === "win"
            ? "1-0"
            : g.black.result === "win"
            ? "0-1"
            : "1/2-1/2";

        upsert.run(
          gameId,
          username.toLowerCase(),
          g.pgn,
          g.white.username,
          g.black.username,
          result,
          g.time_class,
          g.end_time
        );
      }
    });

    upsertMany(chessComGames);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Failed to fetch from Chess.com:", message);
    // Fall through to load from DB cache
  }

  // Load from DB
  const games = db
    .prepare(
      `SELECT id, username, pgn, white, black, result, time_class, end_time
       FROM games
       WHERE username = ?
       ORDER BY end_time DESC`
    )
    .all(username.toLowerCase()) as GameRow[];

  return { games, username };
}

export default function Home() {
  const { games, username } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading";

  const [filter, setFilter] = useState("");
  const [timeClassFilter, setTimeClassFilter] = useState("all");
  const [resultFilter, setResultFilter] = useState("all");

  const filteredGames = games.filter((g) => {
    // Text search (opponent name)
    if (filter !== "") {
      const search = filter.toLowerCase();
      const matchesWhite = g.white.toLowerCase().includes(search);
      const matchesBlack = g.black.toLowerCase().includes(search);
      if (!matchesWhite && !matchesBlack) return false;
    }

    // Time class filter
    if (timeClassFilter !== "all" && g.time_class !== timeClassFilter) {
      return false;
    }

    // Result filter
    if (resultFilter !== "all") {
      if (username === null) return true;
      const isWhite = g.white.toLowerCase() === username.toLowerCase();
      const userWon =
        (isWhite && g.result === "1-0") || (!isWhite && g.result === "0-1");
      const userLost =
        (isWhite && g.result === "0-1") || (!isWhite && g.result === "1-0");
      const isDraw = g.result === "1/2-1/2";

      if (resultFilter === "win" && !userWon) return false;
      if (resultFilter === "loss" && !userLost) return false;
      if (resultFilter === "draw" && !isDraw) return false;
    }

    return true;
  });

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">
            Chess Analyzer
          </h1>
          <Form method="get" className="flex gap-2">
            <input
              type="text"
              name="username"
              placeholder="Chess.com username"
              defaultValue={searchParams.get("username") ?? ""}
              className="px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
              disabled={isLoading}
            >
              {isLoading ? "Loading..." : "Load Games"}
            </button>
          </Form>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        {username !== null && games.length > 0 && (
          <>
            <div className="flex flex-wrap gap-3 mb-6">
              <input
                type="text"
                placeholder="Search by opponent..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <select
                value={timeClassFilter}
                onChange={(e) => setTimeClassFilter(e.target.value)}
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
                onChange={(e) => setResultFilter(e.target.value)}
                className="px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100"
              >
                <option value="all">All Results</option>
                <option value="win">Wins</option>
                <option value="loss">Losses</option>
                <option value="draw">Draws</option>
              </select>
              <span className="self-center text-sm text-gray-500 dark:text-gray-400">
                {filteredGames.length} game{filteredGames.length !== 1 ? "s" : ""}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {filteredGames.map((g) => (
                <GameCard
                  key={g.id}
                  id={g.id}
                  white={g.white}
                  black={g.black}
                  result={g.result}
                  timeClass={g.time_class}
                  endTime={g.end_time}
                  username={username}
                />
              ))}
            </div>
          </>
        )}

        {username !== null && games.length === 0 && !isLoading && (
          <div className="text-center py-20 text-gray-500 dark:text-gray-400">
            <p className="text-lg">No games found for &ldquo;{username}&rdquo;</p>
            <p className="text-sm mt-1">
              Check the username and try again.
            </p>
          </div>
        )}

        {username === null && (
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
