import { db } from "./db";

import { existsSync } from "node:fs";

// ── Engine configuration (env-driven) ────────────────────────────────────────
const ENGINE_TYPE = (process.env.ENGINE_TYPE ?? "stockfish") as "stockfish" | "lc0";
const ENGINE_PATH_OVERRIDE = process.env.ENGINE_PATH;
const WEIGHTS_PATH = process.env.WEIGHTS_PATH;
const ENGINE_BACKEND = process.env.ENGINE_BACKEND ?? "cudnn-fp16";

function resolveEnginePath(): string {
  // Explicit override always wins
  if (ENGINE_PATH_OVERRIDE !== undefined && ENGINE_PATH_OVERRIDE !== "") {
    return ENGINE_PATH_OVERRIDE;
  }
  if (ENGINE_TYPE === "lc0") {
    // Default to bare "lc0" — relies on $PATH
    return "lc0";
  }
  // Stockfish: legacy STOCKFISH_PATH env var, then well-known locations, then bare name
  if (process.env.STOCKFISH_PATH !== undefined) {
    return process.env.STOCKFISH_PATH;
  }
  if (process.env.HOME !== undefined) {
    const candidates = [
      `${process.env.HOME}/bin/stockfish-bin`,
      `${process.env.HOME}/.local/bin/stockfish`,
    ];
    for (const p of candidates) {
      if (existsSync(p)) {return p;}
    }
  }
  // Fall back to bare name — relies on $PATH (works in Docker with apt-installed stockfish)
  return "stockfish";
}

const ENGINE_PATH: string = resolveEnginePath();

/** Max time per position in ms. Higher values find shorter/more accurate mating lines. */
const SEARCH_MOVETIME = 1500;

/** Minimum depth to accept from cache. Movetime search at 1500ms typically reaches 20-30+. */
const MIN_CACHE_DEPTH = 16;

/** Timeout per position — abort if engine doesn't respond within this time. */
const POSITION_TIMEOUT_MS = 10_000;

/** Maximum concurrent analysis processes. Lc0 GPU contention limits this to 1. */
const MAX_CONCURRENT_ANALYSES = ENGINE_TYPE === "lc0" ? 1 : 2;

let activeAnalyses = 0;

/**
 * Acquire an analysis slot. Returns true if a slot is available, false if at capacity.
 */
export function acquireAnalysisSlot(): boolean {
  if (activeAnalyses >= MAX_CONCURRENT_ANALYSES) {return false;}
  activeAnalyses++;
  return true;
}

/**
 * Release an analysis slot after analysis completes or fails.
 */
export function releaseAnalysisSlot(): void {
  if (activeAnalyses > 0) {activeAnalyses--;}
}

interface Score {
  cp: number | null;
  mate: number | null;
}

export interface AnalysisResult {
  multipvRank: number;
  score: Score;
  bestMove: string;
  pv: string;
  depth: number;
}

/**
 * Parse a single UCI info line. Returns parsed fields or null if the line should be ignored.
 * Exported for unit testing.
 */
export function parseInfoLine(
  line: string,
): { rank: number; depth: number; score: Score; pv: string } | null {
  const trimmed = line.trim();

  if (
    !trimmed.startsWith("info") ||
    !trimmed.includes("score") ||
    trimmed.includes("lowerbound") ||
    trimmed.includes("upperbound")
  ) {
    return null;
  }

  const depthMatch = /\bdepth\s+(\d+)/.exec(trimmed);
  const multipvMatch = /\bmultipv\s+(\d+)/.exec(trimmed);
  const cpMatch = /\bscore\s+cp\s+(-?\d+)/.exec(trimmed);
  const mateMatch = /\bscore\s+mate\s+(-?\d+)/.exec(trimmed);
  const pvMatch = /\bpv\s+(.+)$/.exec(trimmed);

  // Must have a score token to be useful
  if (cpMatch === null && mateMatch === null) {
    return null;
  }

  const rank = multipvMatch !== null ? parseInt(multipvMatch[1], 10) : 1;
  const depth = depthMatch !== null ? parseInt(depthMatch[1], 10) : 0;
  let score: Score;
  if (cpMatch !== null) {
    score = { cp: parseInt(cpMatch[1], 10), mate: null };
  } else if (mateMatch !== null) {
    score = { cp: null, mate: parseInt(mateMatch[1], 10) };
  } else {
    score = { cp: null, mate: null };
  }
  const pv = pvMatch !== null ? pvMatch[1] : "";

  return { rank, depth, score, pv };
}

/**
 * Read from the engine stdout until we see a "bestmove" line.
 * Returns one AnalysisResult per multipv rank (sorted by rank, rank 1 first).
 */
async function readUntilBestMove(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  multipv: number,
): Promise<AnalysisResult[]> {
  const decoder = new TextDecoder();
  let buffer = "";
  // rank → latest info
  const byRank = new Map<number, { depth: number; score: Score; pv: string }>();

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {break;}
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();

      const parsed = parseInfoLine(trimmed);
      if (parsed !== null && parsed.pv !== "") {
        byRank.set(parsed.rank, { depth: parsed.depth, score: parsed.score, pv: parsed.pv });
      }

      if (trimmed.startsWith("bestmove")) {
        return buildResults(byRank, multipv);
      }
    }
  }

  // EOF — return whatever we collected
  return buildResults(byRank, multipv);
}

function buildResults(
  byRank: Map<number, { depth: number; score: Score; pv: string }>,
  multipv: number,
): AnalysisResult[] {
  const results: AnalysisResult[] = [];
  for (let r = 1; r <= multipv; r++) {
    const entry = byRank.get(r);
    if (entry === undefined) {continue;}
    const firstMove = entry.pv.split(/\s+/)[0] ?? "";
    results.push({
      multipvRank: r,
      score: entry.score,
      bestMove: firstMove,
      pv: entry.pv,
      depth: entry.depth,
    });
  }
  return results;
}

/**
 * Read from stdout until we see a specific string.
 */
async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  target: string,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {break;}
    buffer += decoder.decode(value, { stream: true });
    if (buffer.includes(target)) {break;}
  }
}

/**
 * Race a promise against a timeout. Rejects with the given message if the timeout fires first.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(message));
        }, ms);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

interface EngineHandle {
  sendCmd: (cmd: string) => void;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  init: (multipv?: number) => Promise<void>;
  cleanup: () => void;
}

/**
 * Spawn the configured engine process (Stockfish or Lc0) and return control handles.
 * Uses Bun.spawn with FileSink for stdin.
 */
export function spawnEngine(): EngineHandle {
  const proc = Bun.spawn([ENGINE_PATH], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });

  const stdin = proc.stdin;
  const stdout = proc.stdout as ReadableStream<Uint8Array>;
  const reader = stdout.getReader() as ReadableStreamDefaultReader<Uint8Array>;

  const sendCmd = (cmd: string): void => {
    // Strip newlines to prevent UCI command injection
    const sanitized = cmd.replace(/[\r\n]/g, "");
    void stdin.write(`${sanitized}\n`);
    void stdin.flush();
  };

  const init = async (multipv = 1): Promise<void> => {
    sendCmd("uci");
    await readUntil(reader, "uciok");

    if (ENGINE_TYPE === "lc0") {
      if (WEIGHTS_PATH === undefined || WEIGHTS_PATH === "") {
        throw new Error("WEIGHTS_PATH env var required when ENGINE_TYPE=lc0");
      }
      sendCmd(`setoption name WeightsFile value ${WEIGHTS_PATH}`);
      sendCmd(`setoption name Backend value ${ENGINE_BACKEND}`);
    } else {
      sendCmd("setoption name Threads value 4");
      sendCmd("setoption name Hash value 128");
    }

    sendCmd(`setoption name MultiPV value ${String(multipv)}`);
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
 * Analyze a single position. Returns array of AnalysisResult (one per multipv rank).
 */
async function analyzeSinglePosition(
  fen: string,
  sf: EngineHandle,
  multipv: number,
): Promise<AnalysisResult[]> {
  sf.sendCmd(`position fen ${fen}`);
  const movetime = SEARCH_MOVETIME * Math.max(1, multipv);
  sf.sendCmd(`go movetime ${String(movetime)}`);
  const results = await withTimeout(
    readUntilBestMove(sf.reader, multipv),
    POSITION_TIMEOUT_MS * Math.max(1, multipv),
    "Engine timed out analyzing position",
  );

  // UCI scores are from the side-to-move's perspective.
  // Normalize to White's perspective (like Lichess does).
  const isBlackToMove = fen.split(" ")[1] === "b";
  if (isBlackToMove) {
    for (const r of results) {
      if (r.score.cp !== null) {r.score.cp = -r.score.cp;}
      if (r.score.mate !== null) {r.score.mate = -r.score.mate;}
    }
  }

  return results;
}

/**
 * Compute the transposition key for a FEN string.
 * Returns the first 4 space-separated fields (board, side-to-move, castling rights,
 * en-passant square), stripping the halfmove clock and fullmove counter.
 */
export function fenKey(fen: string): string {
  return fen.split(" ").slice(0, 4).join(" ");
}

/**
 * Analyze all positions in a game and store results in the DB.
 * Yields progress events for each completed (position, multipv rank) pair.
 * @param multipv 1 (default) or 3.
 */
export async function* analyzeGame(
  gameId: string,
  fens: string[],
  moves: string[],
  multipv = 1,
): AsyncGenerator<{
  moveIndex: number;
  multipvRank: number;
  fen: string;
  scoreCp: number | null;
  scoreMate: number | null;
  bestMove: string;
  pv: string;
  depth: number;
  total: number;
}> {
  // Cache check: only use full-game cache when single-PV is requested
  if (multipv === 1) {
    const existingCount = db
      .prepare(
        `SELECT COUNT(*) as count FROM analysis
          WHERE game_id = ? AND multipv_rank = 1 AND depth >= ?`,
      )
      .get(gameId, MIN_CACHE_DEPTH) as { count: number };

    if (existingCount.count >= fens.length) {
      const rows = db
        .prepare(
          `SELECT move_index, fen, score_cp, score_mate, best_move, pv, depth
             FROM analysis
            WHERE game_id = ? AND multipv_rank = 1
            ORDER BY move_index`,
        )
        .all(gameId) as Array<{
        move_index: number;
        fen: string;
        score_cp: number | null;
        score_mate: number | null;
        best_move: string;
        pv: string | null;
        depth: number;
      }>;

      for (const row of rows) {
        yield {
          moveIndex: row.move_index,
          multipvRank: 1,
          fen: row.fen,
          scoreCp: row.score_cp,
          scoreMate: row.score_mate,
          bestMove: row.best_move,
          pv: row.pv ?? row.best_move,
          depth: row.depth,
          total: fens.length,
        };
      }
      return;
    }
  }

  const sf = spawnEngine();
  try {
    await sf.init(multipv);

    const upsert = db.prepare(`
      INSERT OR REPLACE INTO analysis
        (game_id, move_index, multipv_rank, fen, fen_key, move_san, score_cp, score_mate, best_move, pv, depth)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (let i = 0; i < fens.length; i++) {
      // Per-position cache check (single-PV only)
      if (multipv === 1) {
        const existing = db
          .prepare(
            `SELECT score_cp, score_mate, best_move, pv, depth FROM analysis
              WHERE game_id = ? AND move_index = ? AND multipv_rank = 1 AND depth >= ?`,
          )
          .get(gameId, i, MIN_CACHE_DEPTH) as {
          score_cp: number | null;
          score_mate: number | null;
          best_move: string;
          pv: string | null;
          depth: number;
        } | null;

        if (existing !== null) {
          yield {
            moveIndex: i,
            multipvRank: 1,
            fen: fens[i],
            scoreCp: existing.score_cp,
            scoreMate: existing.score_mate,
            bestMove: existing.best_move,
            pv: existing.pv ?? existing.best_move,
            depth: existing.depth,
            total: fens.length,
          };
          continue;
        }
      }

      const results = await analyzeSinglePosition(fens[i], sf, multipv);
      const moveSan = i > 0 ? (moves[i - 1] ?? null) : null;

      for (const r of results) {
        upsert.run(
          gameId,
          i,
          r.multipvRank,
          fens[i],
          fenKey(fens[i]),
          r.multipvRank === 1 ? moveSan : null,
          r.score.cp,
          r.score.mate,
          r.bestMove,
          r.pv,
          r.depth,
        );
        yield {
          moveIndex: i,
          multipvRank: r.multipvRank,
          fen: fens[i],
          scoreCp: r.score.cp,
          scoreMate: r.score.mate,
          bestMove: r.bestMove,
          pv: r.pv,
          depth: r.depth,
          total: fens.length,
        };
      }
    }
  } finally {
    sf.cleanup();
  }
}

/**
 * Check if a game has been fully analyzed (single-PV / rank 1 rows only).
 */
export function isGameAnalyzed(
  gameId: string,
  totalPositions: number,
): boolean {
  const result = db
    .prepare(
      `SELECT COUNT(*) as count FROM analysis
        WHERE game_id = ? AND multipv_rank = 1 AND depth >= ?`,
    )
    .get(gameId, MIN_CACHE_DEPTH) as { count: number };
  return result.count >= totalPositions;
}

/**
 * Get cached analysis for a game (rank 1 only, backward compatible).
 */
export function getGameAnalysis(gameId: string): AnalysisRow[] {
  return db
    .prepare(
      `SELECT move_index, fen, fen_key, move_san, score_cp, score_mate, best_move, pv, depth
         FROM analysis
        WHERE game_id = ? AND multipv_rank = 1
        ORDER BY move_index`,
    )
    .all(gameId) as AnalysisRow[];
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
