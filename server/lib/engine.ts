import { db } from "./db";

import { existsSync } from "node:fs";
import { cpus } from "node:os";

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

/**
 * Max time per position in ms. Higher values find shorter/more accurate mating
 * lines. Override with `SEARCH_MOVETIME_MS` env var.
 */
const SEARCH_MOVETIME: number = ((): number => {
  const override = process.env.SEARCH_MOVETIME_MS;
  if (override !== undefined && override !== "") {
    const n = parseInt(override, 10);
    if (!Number.isNaN(n) && n > 0) {
      return n;
    }
  }
  return 1000;
})();

/**
 * Movetime multiplier for MultiPV searches. Stockfish needs more time to find
 * N strong lines instead of one, but the marginal cost of ranks 2/3 is well
 * below the full N× of the rank 1 line — `1.5×` keeps eval quality high while
 * cutting wall time roughly in half compared to a naïve `N×` multiplier.
 */
const MULTIPV_MOVETIME_FACTOR = 1.5;

/**
 * Minimum depth to consider a cached row "good enough" — below this, the auto-
 * start will re-run. MultiPV=3 at 2250ms typically reaches depth 18–22 on most
 * positions but can fall to 13–15 on late-game tactical positions, so the
 * threshold lives below the worst observed depth.
 */
const MIN_CACHE_DEPTH = 12;

/** Timeout per position — abort if engine doesn't respond within this time. */
const POSITION_TIMEOUT_MS = 10_000;

/**
 * Engine thread count. Stockfish scales near-linearly up to physical core
 * count; using ~75% of logical CPUs leaves headroom for the rest of the app.
 * Override with `STOCKFISH_THREADS` env var.
 */
const STOCKFISH_THREADS: number = ((): number => {
  const override = process.env.STOCKFISH_THREADS;
  if (override !== undefined && override !== "") {
    const n = parseInt(override, 10);
    if (!Number.isNaN(n) && n > 0) {
      return n;
    }
  }
  const n = cpus().length;
  return Math.max(2, Math.floor(n * 0.75));
})();

/** Stockfish hash table size in MB. Bigger = fewer re-evaluations on long searches. */
const STOCKFISH_HASH_MB: number = ((): number => {
  const override = process.env.STOCKFISH_HASH_MB;
  if (override !== undefined && override !== "") {
    const n = parseInt(override, 10);
    if (!Number.isNaN(n) && n > 0) {
      return n;
    }
  }
  return 1024;
})();

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

interface AnalysisResult {
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
      sendCmd(`setoption name Threads value ${String(STOCKFISH_THREADS)}`);
      sendCmd(`setoption name Hash value ${String(STOCKFISH_HASH_MB)}`);
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
  baseMovetimeMs: number,
): Promise<AnalysisResult[]> {
  sf.sendCmd(`position fen ${fen}`);
  // MultiPV doesn't cost N× — ranks 2+ piggyback on the rank-1 search tree.
  // 1.5× empirically delivers ~depth-26 single-PV and ~depth-22 multi-PV on
  // modern CPUs, which is plenty for blunder classification.
  const multipvFactor = multipv > 1 ? MULTIPV_MOVETIME_FACTOR : 1;
  const movetime = Math.round(baseMovetimeMs * multipvFactor);
  sf.sendCmd(`go movetime ${String(movetime)}`);
  const results = await withTimeout(
    readUntilBestMove(sf.reader, multipv),
    Math.max(POSITION_TIMEOUT_MS, movetime * 4),
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

export interface AnalyzeGameOpts {
  /** MultiPV (number of lines per position). Default 1. */
  multipv?: number;
  /** Per-position movetime in ms (base; gets MULTIPV_MOVETIME_FACTOR if multipv>1). Default SEARCH_MOVETIME. */
  movetimeMs?: number;
  /** Persist results to the analysis table. Default true. Set false for the shallow pass. */
  persist?: boolean;
}

/**
 * Analyze all positions in a game.
 * Yields progress events for each completed (position, multipv rank) pair.
 * Writes results to the `analysis` table unless `persist: false`.
 */
export async function* analyzeGame(
  gameId: string,
  fens: string[],
  moves: string[],
  opts: AnalyzeGameOpts = {},
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
  const multipv = opts.multipv ?? 1;
  const movetimeMs = opts.movetimeMs ?? SEARCH_MOVETIME;
  const persist = opts.persist ?? true;
  // Full-game cache check: if every position has the requested rank coverage
  // at sufficient depth, yield from the DB and skip spawning the engine.
  const cachedCount = db
    .prepare(
      `SELECT COUNT(*) as count FROM analysis
        WHERE game_id = ? AND multipv_rank <= ? AND depth >= ?`,
    )
    .get(gameId, multipv, MIN_CACHE_DEPTH) as { count: number };

  if (cachedCount.count >= fens.length * multipv) {
    const rows = db
      .prepare(
        `SELECT move_index, multipv_rank, fen, score_cp, score_mate, best_move, pv, depth
           FROM analysis
          WHERE game_id = ? AND multipv_rank <= ?
          ORDER BY move_index, multipv_rank`,
      )
      .all(gameId, multipv) as Array<{
      move_index: number;
      multipv_rank: number;
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
        multipvRank: row.multipv_rank,
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

  const sf = spawnEngine();
  try {
    await sf.init(multipv);

    const upsert = db.prepare(`
      INSERT OR REPLACE INTO analysis
        (game_id, move_index, multipv_rank, fen, fen_key, move_san, score_cp, score_mate, best_move, pv, depth)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (let i = 0; i < fens.length; i++) {
      // Per-position cache check — skip Stockfish if every requested rank is
      // already cached at sufficient depth for this (game_id, move_index).
      const cachedRows = db
        .prepare(
          `SELECT multipv_rank, score_cp, score_mate, best_move, pv, depth
             FROM analysis
            WHERE game_id = ? AND move_index = ? AND multipv_rank <= ? AND depth >= ?
            ORDER BY multipv_rank`,
        )
        .all(gameId, i, multipv, MIN_CACHE_DEPTH) as Array<{
        multipv_rank: number;
        score_cp: number | null;
        score_mate: number | null;
        best_move: string;
        pv: string | null;
        depth: number;
      }>;

      if (cachedRows.length >= multipv) {
        for (const row of cachedRows) {
          yield {
            moveIndex: i,
            multipvRank: row.multipv_rank,
            fen: fens[i],
            scoreCp: row.score_cp,
            scoreMate: row.score_mate,
            bestMove: row.best_move,
            pv: row.pv ?? row.best_move,
            depth: row.depth,
            total: fens.length,
          };
        }
        continue;
      }

      const results = await analyzeSinglePosition(fens[i], sf, multipv, movetimeMs);
      const moveSan = i > 0 ? (moves[i - 1] ?? null) : null;

      for (const r of results) {
        if (persist) {
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
        }
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

export interface AnalysisRowMPV extends AnalysisRow {
  multipv_rank: number;
}
