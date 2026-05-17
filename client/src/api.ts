export interface GameRow {
  id: string;
  username: string;
  pgn: string;
  white: string;
  black: string;
  result: string;
  time_class: string;
  end_time: number;
  white_elo: number | null;
  black_elo: number | null;
  user_elo: number | null;
  eco: string | null;
  opening: string | null;
}

export interface GamesResponse {
  games: GameRow[];
  username: string | null;
}

export interface AnalysisRow {
  move_index: number;
  fen: string;
  move_san: string | null;
  score_cp: number | null;
  score_mate: number | null;
  best_move: string;
  depth: number;
}

export interface GameMove {
  san: string;
  from: string;
  to: string;
}

export interface GameDetailResponse {
  game: {
    id: string;
    white: string;
    black: string;
    result: string;
    timeClass: string;
    endTime: number;
    username: string;
    whiteElo: number | null;
    blackElo: number | null;
    userElo: number | null;
    eco: string | null;
    opening: string | null;
  };
  fens: string[];
  moves: GameMove[];
  analysis: AnalysisRow[];
  analyzed: boolean;
}

export async function fetchGames(username: string): Promise<GamesResponse> {
  const r = await fetch(`/api/games?username=${  encodeURIComponent(username)}`);
  if (!r.ok) {throw new Error("Failed to fetch games");}
  return r.json() as Promise<GamesResponse>;
}

export async function fetchGame(gameId: string): Promise<GameDetailResponse> {
  const r = await fetch(`/api/games/${  encodeURIComponent(gameId)}`);
  if (!r.ok) {throw new Error("Failed to fetch game");}
  return r.json() as Promise<GameDetailResponse>;
}

export interface PerSideMetrics {
  accuracy: number;
  blunders: number;
  mistakes: number;
  inaccuracies: number;
  acl: number;
}

export interface GameMetrics {
  gameId: string;
  white: PerSideMetrics;
  black: PerSideMetrics;
  computedAt: number;
}

export async function fetchGameMetrics(gameId: string): Promise<GameMetrics> {
  const r = await fetch(`/api/games/${encodeURIComponent(gameId)}/metrics`);
  if (!r.ok) {
    throw new Error("Failed to fetch game metrics");
  }
  return r.json() as Promise<GameMetrics>;
}

export type BulkGameMetrics = Record<string, GameMetrics | null>;

export interface SideStats {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  win_rate: number;
  avg_accuracy: number | null;
  blunders_per_game: number | null;
}

export interface BySideStats {
  white: SideStats;
  black: SideStats;
}

export async function fetchBulkMetrics(
  username: string,
): Promise<BulkGameMetrics> {
  const r = await fetch(
    `/api/games/metrics?username=${encodeURIComponent(username)}`,
  );
  if (!r.ok) {
    throw new Error("Failed to fetch bulk metrics");
  }
  return r.json() as Promise<BulkGameMetrics>;
}

export async function fetchBySide(username: string): Promise<BySideStats> {
  const r = await fetch(`/api/stats/${encodeURIComponent(username)}/by-side`);
  if (!r.ok) {
    throw new Error("Failed to fetch by-side stats");
  }
  return r.json() as Promise<BySideStats>;
}
