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
  fen_key: string | null;
  move_san: string | null;
  score_cp: number | null;
  score_mate: number | null;
  best_move: string;
  pv: string | null;
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

export interface EloTrendPoint {
  t: number;
  elo: number;
}

export interface AclTrendPoint {
  t: number;
  acl: number;
}

export async function fetchAclTrend(
  username: string,
  timeClass: "bullet" | "blitz" | "rapid" | "daily",
): Promise<AclTrendPoint[]> {
  const r = await fetch(
    `/api/stats/${encodeURIComponent(username)}/acl-trend?time_class=${timeClass}`,
  );
  if (!r.ok) {
    throw new Error("Failed to fetch ACL trend");
  }
  return r.json() as Promise<AclTrendPoint[]>;
}

export async function fetchEloTrend(
  username: string,
  timeClass: "bullet" | "blitz" | "rapid" | "daily",
): Promise<EloTrendPoint[]> {
  const r = await fetch(
    `/api/stats/${encodeURIComponent(username)}/elo-trend?time_class=${timeClass}`,
  );
  if (!r.ok) {
    throw new Error("Failed to fetch Elo trend");
  }
  return r.json() as Promise<EloTrendPoint[]>;
}

export interface TimeOfDayBucket {
  hour: number;
  day: number;
  games: number;
  wins: number;
  win_rate: number;
}

export async function fetchByTimeOfDay(username: string): Promise<TimeOfDayBucket[]> {
  const r = await fetch(`/api/stats/${encodeURIComponent(username)}/by-time-of-day`);
  if (!r.ok) {
    throw new Error("Failed to fetch time-of-day stats");
  }
  return r.json() as Promise<TimeOfDayBucket[]>;
}

export type WinRateSliceType = "color" | "time_class" | "rating_bucket" | "opening";

export interface WinRateSliceRow {
  key: string;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  win_rate: number;
  avg_accuracy: number | null;
  opening?: string;
}

export interface PositionHistoryEntry {
  game_id: string;
  move_index: number;
  end_time: number;
  white: string;
  black: string;
  result: string;
  was_blunder: boolean;
  played_move: string | null;
  best_move: string | null;
}

export async function fetchPositionHistory(
  fen: string,
  username: string,
): Promise<PositionHistoryEntry[]> {
  const params = new URLSearchParams({ fen, username });
  const r = await fetch(`/api/positions/history?${params.toString()}`);
  if (!r.ok) {
    throw new Error("Failed to fetch position history");
  }
  return r.json() as Promise<PositionHistoryEntry[]>;
}

export interface AlternativeRow {
  multipvRank: number;
  scoreCp: number | null;
  scoreMate: number | null;
  bestMove: string;
  pv: string | null;
  depth: number;
}

export interface AlternativesResponse {
  gameId: string;
  moveIndex: number;
  alternatives: AlternativeRow[];
}

export async function fetchAlternatives(
  gameId: string,
  moveIndex: number,
): Promise<AlternativesResponse> {
  const r = await fetch(
    `/api/games/${encodeURIComponent(gameId)}/alternatives/${String(moveIndex)}`,
  );
  if (!r.ok) {
    throw new Error("Failed to fetch alternatives");
  }
  return r.json() as Promise<AlternativesResponse>;
}

export async function fetchWinRateSlice(
  username: string,
  slice: WinRateSliceType,
  from?: number,
  to?: number,
): Promise<WinRateSliceRow[]> {
  const params = new URLSearchParams({ slice });
  if (from !== undefined) {params.set("from", String(from));}
  if (to !== undefined) {params.set("to", String(to));}
  const r = await fetch(`/api/stats/${encodeURIComponent(username)}/win-rate?${params.toString()}`);
  if (!r.ok) {
    throw new Error("Failed to fetch win-rate slice");
  }
  return r.json() as Promise<WinRateSliceRow[]>;
}
