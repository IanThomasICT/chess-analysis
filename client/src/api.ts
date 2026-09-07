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
  white_clock_final_s: number | null;
  black_clock_final_s: number | null;
  termination: string | null;
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

export type Motif =
  | "hanging_piece"
  | "fork"
  | "pin"
  | "skewer"
  | "back_rank_mate"
  | "missed_mate";

export interface MotifStat {
  tag: Motif;
  count: number;
  example_game_id: string;
  example_move_index: number;
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
    whiteClockFinalS: number | null;
    blackClockFinalS: number | null;
    termination: string | null;
  };
  fens: string[];
  moves: GameMove[];
  analysis: AnalysisRow[];
  analyzed: boolean;
  motifs: Record<string, string[]>;
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

export interface AccuracyTrendPoint {
  t: number;
  accuracy: number;
}

export async function fetchAccuracyTrend(
  username: string,
  timeClass: "bullet" | "blitz" | "rapid" | "daily",
): Promise<AccuracyTrendPoint[]> {
  const r = await fetch(
    `/api/stats/${encodeURIComponent(username)}/accuracy-trend?time_class=${timeClass}`,
  );
  if (!r.ok) {
    throw new Error("Failed to fetch accuracy trend");
  }
  return r.json() as Promise<AccuracyTrendPoint[]>;
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

/** Build a `?from=&to=` query string from optional epoch-second bounds. */
function dateRangeQuery(from?: number, to?: number): string {
  const params = new URLSearchParams();
  if (from !== undefined) {params.set("from", String(from));}
  if (to !== undefined) {params.set("to", String(to));}
  const s = params.toString();
  return s === "" ? "" : `?${s}`;
}

export async function fetchByTimeOfDay(
  username: string,
  from?: number,
  to?: number,
): Promise<TimeOfDayBucket[]> {
  const r = await fetch(
    `/api/stats/${encodeURIComponent(username)}/by-time-of-day${dateRangeQuery(from, to)}`,
  );
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

export async function fetchMotifStats(
  username: string,
  from?: number,
  to?: number,
): Promise<MotifStat[]> {
  const r = await fetch(
    `/api/stats/${encodeURIComponent(username)}/motifs${dateRangeQuery(from, to)}`,
  );
  if (!r.ok) {
    throw new Error("Failed to fetch motif stats");
  }
  return r.json() as Promise<MotifStat[]>;
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

export interface DrillCard {
  game_id: string;
  move_index: number;
  fen: string;
  best_move: string;
  motifs: string[];
  source: "due" | "new";
}

export async function fetchDrillQueue(
  username: string,
  limit = 20,
): Promise<DrillCard[]> {
  const r = await fetch(
    `/api/drill/queue?username=${encodeURIComponent(username)}&limit=${String(limit)}`,
  );
  if (!r.ok) {
    throw new Error("Failed to fetch drill queue");
  }
  return r.json() as Promise<DrillCard[]>;
}

export interface AttemptRequest {
  username: string;
  game_id: string;
  move_index: number;
  attempted_move: string;
  elapsed_ms?: number;
}

export interface AttemptResponse {
  correct: boolean;
  best_move: string;
  next_due: number;
  state: number;
  motifs: string[];
}

export async function submitDrillAttempt(
  req: AttemptRequest,
): Promise<AttemptResponse> {
  const r = await fetch("/api/drill/attempt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!r.ok) {
    throw new Error("Failed to submit drill attempt");
  }
  return r.json() as Promise<AttemptResponse>;
}

export interface DrillProgress {
  total_attempts: number;
  accuracy_pct: number;
  due_today: number;
  current_streak: number;
}

export async function fetchDrillProgress(username: string): Promise<DrillProgress> {
  const r = await fetch(`/api/stats/${encodeURIComponent(username)}/drill-progress`);
  if (!r.ok) {
    throw new Error("Failed to fetch drill progress");
  }
  return r.json() as Promise<DrillProgress>;
}

// ---------------------------------------------------------------------------
// Extended per-game metrics (game_metrics_ext) + aggregates
// ---------------------------------------------------------------------------

export type ResultForUser = "win" | "loss" | "draw";
export type ResultQuality =
  | "swindle_win" | "clean_win"
  | "unlucky_loss" | "clean_loss"
  | "hold_draw" | "even_draw";

export interface GameMetricSummary {
  gameId: string;
  endTime: number;
  timeClass: string;
  userColor: "w" | "b";
  result: ResultForUser;
  accuracy: number | null;
  acl: number | null;
  accuracyOpening: number | null;
  accuracyMiddlegame: number | null;
  accuracyEndgame: number | null;
  eloDelta: number | null;
  resultQuality: ResultQuality;
  reachedWinning: boolean;
  reachedLosing: boolean;
  converted: boolean;
  saved: boolean;
  timeTroubleFlag: boolean;
  criticalPositions: number | null;
  maxBlunderRun: number | null;
}

export interface CriticalMove {
  plyIndex: number;
  moveSan: string | null;
  wpBefore: number;
  wpAfter: number;
  moveClass: string;
  phase: string;
  thinkTimeS: number | null;
  beforeFen: string;
  bestMove: string;
}

export interface MissedConversion {
  plyIndex: number;
  moveSan: string | null;
  thinkTimeS: number | null;
  beforeFen: string;
  bestMove: string;
}

export interface GameMetricDetail extends GameMetricSummary {
  phases: {
    middlegameStartPly: number | null;
    endgameStartPly: number | null;
    timeOpeningS: number | null;
    timeMiddlegameS: number | null;
    timeEndgameS: number | null;
  };
  accuracyCritical: number | null;
  accuracyQuiet: number | null;
  timeAllocEfficiency: number | null;
  avgMoveTimeS: number | null;
  recoveryAccuracy: number | null;
  timeTroubleErrors: number | null;
  outOfBookPly: number | null;
  outOfBookEcoFallback: number;
  postBookAccuracy: number | null;
  evalOpeningEndWp: number | null;
  peakEvalWp: number | null;
  troughEvalWp: number | null;
  clocksAvailable: number;
  engineDepthMin: number;
  criticalMoves: CriticalMove[];
  missedConversions: MissedConversion[];
}

export async function fetchGameMetricDetail(gameId: string): Promise<GameMetricDetail> {
  const r = await fetch(`/api/metrics/game/${encodeURIComponent(gameId)}`);
  if (!r.ok) {throw new Error("Failed to fetch game metric detail");}
  return r.json() as Promise<GameMetricDetail>;
}

export async function fetchUserMetrics(username: string): Promise<GameMetricSummary[]> {
  const r = await fetch(`/api/metrics/${encodeURIComponent(username)}`);
  if (!r.ok) {throw new Error("Failed to fetch user metrics");}
  return r.json() as Promise<GameMetricSummary[]>;
}

/** URL for the CSV/JSON metrics export (use as an anchor href). */
export function metricsExportUrl(username: string, format: "csv" | "json"): string {
  return `/api/metrics/${encodeURIComponent(username)}/export?format=${format}`;
}

export interface ConsistencyResponse {
  accuracy_stddev: number | null;
  accuracy_mean: number | null;
  games: number;
}

export interface SessionFatigueBucket {
  game_in_session: number;
  games: number;
  wins: number;
  win_rate: number;
  avg_accuracy: number | null;
}

export interface VsOpponentBucket {
  bucket: string;
  games: number;
  win_rate: number;
  avg_accuracy: number | null;
  avg_acl_middlegame: number | null;
}

export interface AclTrendPoint {
  t: number;
  acl: number;
  rolling: number;
}

export interface LeakClosureRow {
  tag: string;
  first_half: number;
  second_half: number;
  delta: number;
}

export interface TprResponse {
  tpr: number | null;
  games: number;
  score: number;
  avg_opponent_elo: number | null;
}

export interface RepertoireRow {
  eco: string;
  opening: string | null;
  games: number;
  win_rate: number;
  avg_accuracy: number | null;
  avg_out_of_book_ply: number | null;
}

export interface CounterplayResponse {
  games_reached_losing: number;
  saves: number;
  save_rate: number | null;
}

export interface EndgameConversionResponse {
  games_reached_winning: number;
  conversions: number;
  conversion_rate: number | null;
  avg_endgame_accuracy: number | null;
}

type TimeClass = "bullet" | "blitz" | "rapid" | "daily";

async function fetchStat<T>(username: string, path: string, query = ""): Promise<T> {
  const r = await fetch(`/api/stats/${encodeURIComponent(username)}/${path}${query}`);
  if (!r.ok) {throw new Error(`Failed to fetch ${path}`);}
  return r.json() as Promise<T>;
}

export async function fetchConsistency(username: string): Promise<ConsistencyResponse> {
  return fetchStat<ConsistencyResponse>(username, "consistency");
}

export async function fetchSessionFatigue(username: string): Promise<SessionFatigueBucket[]> {
  return fetchStat<SessionFatigueBucket[]>(username, "session-fatigue");
}

export async function fetchVsOpponent(
  username: string,
  from?: number,
  to?: number,
): Promise<VsOpponentBucket[]> {
  return fetchStat<VsOpponentBucket[]>(username, "vs-opponent", dateRangeQuery(from, to));
}

export async function fetchAclTrend(username: string, timeClass: TimeClass): Promise<AclTrendPoint[]> {
  return fetchStat<AclTrendPoint[]>(username, "acl-trend", `?time_class=${timeClass}`);
}

export async function fetchLeakClosure(
  username: string,
  from?: number,
  to?: number,
): Promise<LeakClosureRow[]> {
  return fetchStat<LeakClosureRow[]>(username, "leak-closure", dateRangeQuery(from, to));
}

export async function fetchTpr(username: string, timeClass: TimeClass): Promise<TprResponse> {
  return fetchStat<TprResponse>(username, "tpr", `?time_class=${timeClass}`);
}

export async function fetchRepertoire(username: string, color: "white" | "black"): Promise<RepertoireRow[]> {
  return fetchStat<RepertoireRow[]>(username, "repertoire", `?color=${color}`);
}

export async function fetchCounterplay(username: string): Promise<CounterplayResponse> {
  return fetchStat<CounterplayResponse>(username, "counterplay");
}

export async function fetchEndgameConversion(username: string): Promise<EndgameConversionResponse> {
  return fetchStat<EndgameConversionResponse>(username, "endgame-conversion");
}
