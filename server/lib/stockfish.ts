import { db } from "./db";

import { existsSync } from "node:fs";

function resolveStockfishPath(): string {
  if (process.env.STOCKFISH_PATH !== undefined) {
    return process.env.STOCKFISH_PATH;
  }
  if (process.env.HOME !== undefined) {
    const candidates = [
      process.env.HOME + "/bin/stockfish-bin",
      process.env.HOME + "/.local/bin/stockfish",
    ];
    for (const p of candidates) {
      if (existsSync(p)) return p;
    }
  }
  // Fall back to bare name — relies on $PATH (works in Docker with apt-installed stockfish)
  return "stockfish";
}

const STOCKFISH_PATH: string = resolveStockfishPath();

/** Max time per position in ms. Bounds total analysis time predictably. */
const SEARCH_MOVETIME = 500;

/** Minimum depth to accept from cache. Movetime search typically reaches 14-22. */
const MIN_CACHE_DEPTH = 12;

interface Score {
  cp: number | null;
  mate: number | null;
}

interface AnalysisResult {
  score: Score;
  bestMove: string;
  depth: number;
}

/**
 * Read from the Stockfish stdout until we see a "bestmove" line.
 * Returns the final evaluation from the last "info" line and the best move.
 */
async function readUntilBestMove(
  reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<AnalysisResult> {
  const decoder = new TextDecoder();
  let buffer = "";
  let lastScore: Score = { cp: null, mate: null };
  let lastDepth = 0;
  let bestMove = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();

      // Parse info lines for score (skip aspiration window bounds like Lichess does)
      if (
        trimmed.startsWith("info") &&
        trimmed.includes("score") &&
        !trimmed.includes("lowerbound") &&
        !trimmed.includes("upperbound")
      ) {
        const depthMatch = /\bdepth\s+(\d+)/.exec(trimmed);
        const cpMatch = /\bscore\s+cp\s+(-?\d+)/.exec(trimmed);
        const mateMatch = /\bscore\s+mate\s+(-?\d+)/.exec(trimmed);

        if (depthMatch !== null) {
          lastDepth = parseInt(depthMatch[1], 10);
        }
        if (cpMatch !== null) {
          lastScore = { cp: parseInt(cpMatch[1], 10), mate: null };
        } else if (mateMatch !== null) {
          lastScore = { cp: null, mate: parseInt(mateMatch[1], 10) };
        }
      }

      // Parse bestmove line
      if (trimmed.startsWith("bestmove")) {
        const parts = trimmed.split(/\s+/);
        bestMove = parts[1] ?? "";
        return { score: lastScore, bestMove, depth: lastDepth };
      }
    }
  }

  return { score: lastScore, bestMove, depth: lastDepth };
}

/**
 * Read from stdout until we see a specific string.
 */
async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  target: string
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    if (buffer.includes(target)) break;
  }
}

interface StockfishHandle {
  sendCmd: (cmd: string) => void;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  init: () => Promise<void>;
  cleanup: () => void;
}

/**
 * Spawn a Stockfish process and return control handles.
 * Uses Bun.spawn with FileSink for stdin.
 */
export function spawnStockfish(): StockfishHandle {
  const proc = Bun.spawn([STOCKFISH_PATH], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });

  const stdin = proc.stdin;
  const stdout = proc.stdout as ReadableStream<Uint8Array>;
  const reader = stdout.getReader() as ReadableStreamDefaultReader<Uint8Array>;

  const sendCmd = (cmd: string): void => {
    void stdin.write(cmd + "\n");
    void stdin.flush();
  };

  const init = async (): Promise<void> => {
    sendCmd("uci");
    await readUntil(reader, "uciok");
    sendCmd("setoption name Threads value 4");
    sendCmd("setoption name Hash value 128");
    sendCmd("ucinewgame");
    sendCmd("isready");
    await readUntil(reader, "readyok");
  };

  const cleanup = (): void => {
    try {
      sendCmd("quit");
      void stdin.end();
    } catch {
      // ignore — process may already be dead
    }
    proc.kill();
  };

  return { sendCmd, reader, init, cleanup };
}

/**
 * Analyze a single position. Returns the evaluation result.
 */
async function analyzeSinglePosition(
  fen: string,
  sf: StockfishHandle,
): Promise<AnalysisResult> {
  sf.sendCmd("position fen " + fen);
  sf.sendCmd("go movetime " + String(SEARCH_MOVETIME));
  const result = await readUntilBestMove(sf.reader);

  // UCI scores are from the side-to-move's perspective.
  // Normalize to White's perspective (like Lichess does).
  const isBlackToMove = fen.split(" ")[1] === "b";
  if (isBlackToMove) {
    if (result.score.cp !== null) result.score.cp = -result.score.cp;
    if (result.score.mate !== null) result.score.mate = -result.score.mate;
  }

  return result;
}

/**
 * Analyze all positions in a game and store results in the DB.
 * Yields progress events for each completed position.
 */
export async function* analyzeGame(
  gameId: string,
  fens: string[],
  moves: string[],
): AsyncGenerator<{
  moveIndex: number;
  fen: string;
  scoreCp: number | null;
  scoreMate: number | null;
  bestMove: string;
  depth: number;
  total: number;
}> {
  // Check how many positions are already analyzed
  const existingCount = db
    .prepare(
      `SELECT COUNT(*) as count FROM analysis WHERE game_id = ? AND depth >= ?`
    )
    .get(gameId, MIN_CACHE_DEPTH) as { count: number };

  if (existingCount.count >= fens.length) {
    // Already fully analyzed, yield existing results
    const rows = db
      .prepare(
        `SELECT move_index, fen, score_cp, score_mate, best_move, depth
         FROM analysis WHERE game_id = ? ORDER BY move_index`
      )
      .all(gameId) as Array<{
      move_index: number;
      fen: string;
      score_cp: number | null;
      score_mate: number | null;
      best_move: string;
      depth: number;
    }>;

    for (const row of rows) {
      yield {
        moveIndex: row.move_index,
        fen: row.fen,
        scoreCp: row.score_cp,
        scoreMate: row.score_mate,
        bestMove: row.best_move,
        depth: row.depth,
        total: fens.length,
      };
    }
    return;
  }

  const sf = spawnStockfish();
  try {
    await sf.init();

    const upsert = db.prepare(`
      INSERT OR REPLACE INTO analysis
        (game_id, move_index, fen, move_san, score_cp, score_mate, best_move, depth)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (let i = 0; i < fens.length; i++) {
      // Check if this position is already analyzed
      const existing = db
        .prepare(
          `SELECT score_cp, score_mate, best_move, depth
           FROM analysis WHERE game_id = ? AND move_index = ? AND depth >= ?`
        )
        .get(gameId, i, MIN_CACHE_DEPTH) as {
        score_cp: number | null;
        score_mate: number | null;
        best_move: string;
        depth: number;
      } | null;

      if (existing !== null) {
        yield {
          moveIndex: i,
          fen: fens[i],
          scoreCp: existing.score_cp,
          scoreMate: existing.score_mate,
          bestMove: existing.best_move,
          depth: existing.depth,
          total: fens.length,
        };
        continue;
      }

      const result = await analyzeSinglePosition(fens[i], sf);

      const moveSan = i > 0 ? (moves[i - 1] ?? null) : null;

      upsert.run(
        gameId,
        i,
        fens[i],
        moveSan,
        result.score.cp,
        result.score.mate,
        result.bestMove,
        result.depth
      );

      yield {
        moveIndex: i,
        fen: fens[i],
        scoreCp: result.score.cp,
        scoreMate: result.score.mate,
        bestMove: result.bestMove,
        depth: result.depth,
        total: fens.length,
      };
    }
  } finally {
    sf.cleanup();
  }
}

/**
 * Check if a game has been fully analyzed.
 */
export function isGameAnalyzed(
  gameId: string,
  totalPositions: number,
): boolean {
  const result = db
    .prepare(
      `SELECT COUNT(*) as count FROM analysis WHERE game_id = ? AND depth >= ?`
    )
    .get(gameId, MIN_CACHE_DEPTH) as { count: number };
  return result.count >= totalPositions;
}

/**
 * Get cached analysis for a game.
 */
export function getGameAnalysis(gameId: string): AnalysisRow[] {
  return db
    .prepare(
      `SELECT move_index, fen, move_san, score_cp, score_mate, best_move, depth
       FROM analysis WHERE game_id = ? ORDER BY move_index`
    )
    .all(gameId) as AnalysisRow[];
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
