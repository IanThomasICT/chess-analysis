const USER_AGENT = "chess-analyzer/1.0";

export interface ChessComGame {
  url: string;
  pgn: string;
  time_control: string;
  time_class: string;
  end_time: number;
  rated: boolean;
  rules: string;
  white: {
    username: string;
    rating: number;
    result: string;
  };
  black: {
    username: string;
    rating: number;
    result: string;
  };
}

export async function fetchArchives(username: string): Promise<string[]> {
  const r = await fetch(
    `https://api.chess.com/pub/player/${username}/games/archives`,
    { headers: { "User-Agent": USER_AGENT } }
  );
  if (!r.ok) {
    throw new Error(
      "Failed to fetch archives for " + username + ": " + String(r.status)
    );
  }
  const { archives } = (await r.json()) as { archives: string[] };
  return archives;
}

export async function fetchMonthGames(
  archiveUrl: string
): Promise<ChessComGame[]> {
  const r = await fetch(archiveUrl, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!r.ok) {
    throw new Error(
      "Failed to fetch games from " + archiveUrl + ": " + String(r.status)
    );
  }
  const { games } = (await r.json()) as { games: ChessComGame[] };
  return games;
}

/**
 * Fetch the last N months of archives for a given username.
 * Returns games sorted by end_time descending (most recent first).
 */
export async function fetchRecentGames(
  username: string,
  months = 3
): Promise<ChessComGame[]> {
  const archives = await fetchArchives(username);
  const recentArchives = archives.slice(-months);

  const allGames: ChessComGame[] = [];
  for (const url of recentArchives) {
    const games = await fetchMonthGames(url);
    allGames.push(...games);
  }

  // Sort most recent first
  allGames.sort((a, b) => b.end_time - a.end_time);
  return allGames;
}
