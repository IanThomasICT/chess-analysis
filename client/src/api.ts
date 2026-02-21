export interface GameRow {
  id: string;
  username: string;
  pgn: string;
  white: string;
  black: string;
  result: string;
  time_class: string;
  end_time: number;
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
  };
  fens: string[];
  moves: GameMove[];
  analysis: AnalysisRow[];
  analyzed: boolean;
}

export async function fetchGames(username: string): Promise<GamesResponse> {
  const r = await fetch("/api/games?username=" + encodeURIComponent(username));
  if (!r.ok) throw new Error("Failed to fetch games");
  return r.json() as Promise<GamesResponse>;
}

export async function fetchGame(gameId: string): Promise<GameDetailResponse> {
  const r = await fetch("/api/games/" + encodeURIComponent(gameId));
  if (!r.ok) throw new Error("Failed to fetch game");
  return r.json() as Promise<GameDetailResponse>;
}
