const USER_AGENT = "chess-analyzer/1.0";
const CHESS_COM_API_PREFIX = "https://api.chess.com/";

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

export interface ChessComProfile {
  username: string;
  /** Account status; "computer" identifies a bot. Other values: basic/premium/staff/… */
  status: string;
}

/**
 * Fetch a player's public profile. Used to tell bots ("computer" status) from
 * real people. Returns null on any non-OK response or malformed handle so callers
 * can leave the opponent unresolved and retry later rather than misclassifying.
 */
export async function fetchPlayerProfile(
  username: string,
): Promise<ChessComProfile | null> {
  if (!/^[a-zA-Z0-9_-]{1,50}$/.test(username)) {
    return null;
  }
  const r = await fetch(`https://api.chess.com/pub/player/${username}`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!r.ok) {
    return null;
  }
  const data = (await r.json()) as { username?: string; status?: string };
  return { username: data.username ?? username, status: data.status ?? "" };
}

export async function fetchArchives(username: string): Promise<string[]> {
  const r = await fetch(
    `https://api.chess.com/pub/player/${username}/games/archives`,
    { headers: { "User-Agent": USER_AGENT } },
  );
  if (!r.ok) {
    throw new Error(
      `Failed to fetch archives for ${  username  }: ${  String(r.status)}`,
    );
  }
  const { archives } = (await r.json()) as { archives: string[] };
  return archives;
}

export async function fetchMonthGames(
  archiveUrl: string,
): Promise<ChessComGame[]> {
  // Validate the URL points to Chess.com API to prevent SSRF
  if (!archiveUrl.startsWith(CHESS_COM_API_PREFIX)) {
    throw new Error("Invalid archive URL: expected Chess.com API endpoint");
  }
  const r = await fetch(archiveUrl, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!r.ok) {
    throw new Error(
      `Failed to fetch games from ${  archiveUrl  }: ${  String(r.status)}`,
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
  months = 3,
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
