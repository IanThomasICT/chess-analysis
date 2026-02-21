import { db } from "./db.server";

const STOCKFISH_PATH =
  process.env.STOCKFISH_PATH || `${process.env.HOME}/.local/bin/stockfish`;

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

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();

      // Parse info lines for score
      if (trimmed.startsWith("info") && trimmed.includes("score")) {
        const depthMatch = trimmed.match(/\bdepth\s+(\d+)/);
        const cpMatch = trimmed.match(/\bscore\s+cp\s+(-?\d+)/);
        const mateMatch = trimmed.match(/\bscore\s+mate\s+(-?\d+)/);

        if (depthMatch) {
          lastDepth = parseInt(depthMatch[1], 10);
        }
        if (cpMatch) {
          lastScore = { cp: parseInt(cpMatch[1], 10), mate: null };
        } else if (mateMatch) {
          lastScore = { cp: null, mate: parseInt(mateMatch[1], 10) };
        }
      }

      // Parse bestmove line
      if (trimmed.startsWith("bestmove")) {
        const parts = trimmed.split(/\s+/);
        bestMove = parts[1] || "";
        return { score: lastScore, bestMove, depth: lastDepth };
      }
    }
  }

  return { score: lastScore, bestMove, depth: lastDepth };
}

/**
 * Analyze a single position. Returns the evaluation result.
 */
export async function analyzePosition(
  fen: string,
  proc: { stdin: WritableStream; stdout: ReadableStream },
  writer: WritableStreamDefaultWriter,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  depth = 20
): Promise<AnalysisResult> {
  const encode = (s: string) => new TextEncoder().encode(s + "\n");

  await writer.write(encode(`position fen ${fen}`));
  await writer.write(encode(`go depth ${depth}`));

  return await readUntilBestMove(reader);
}

/**
 * Spawn a Stockfish process and return writer/reader handles.
 */
export function spawnStockfish(): {
  proc: ReturnType<typeof Bun.spawn>;
  writer: WritableStreamDefaultWriter;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  init: () => Promise<void>;
  cleanup: () => void;
} {
  const proc = Bun.spawn([STOCKFISH_PATH], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  const writer = proc.stdin.getWriter();
  const reader = proc.stdout.getReader();

  const encode = (s: string) => new TextEncoder().encode(s + "\n");

  const init = async () => {
    await writer.write(encode("uci"));
    await writer.write(encode("setoption name Threads value 4"));
    await writer.write(encode("setoption name Hash value 128"));
    await writer.write(encode("isready"));

    // Read until "readyok"
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.includes("readyok")) break;
    }
  };

  const cleanup = () => {
    try {
      writer.close();
    } catch {
      // ignore
    }
    proc.kill();
  };

  return { proc, writer, reader, init, cleanup };
}

/**
 * Analyze all positions in a game and store results in the DB.
 * Yields progress events for each completed position.
 */
export async function* analyzeGame(
  gameId: string,
  fens: string[],
  moves: string[],
  depth = 20
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
    .get(gameId, depth) as { count: number };

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
        .get(gameId, i, depth) as {
        score_cp: number | null;
        score_mate: number | null;
        best_move: string;
        depth: number;
      } | null;

      if (existing) {
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

      const result = await analyzePosition(
        fens[i],
        sf.proc as any,
        sf.writer,
        sf.reader,
        depth
      );

      const moveSan = i > 0 ? (moves[i - 1] || null) : null;

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
  depth = 20
): boolean {
  const result = db
    .prepare(
      `SELECT COUNT(*) as count FROM analysis WHERE game_id = ? AND depth >= ?`
    )
    .get(gameId, depth) as { count: number };
  return result.count >= totalPositions;
}

/**
 * Get cached analysis for a game.
 */
export function getGameAnalysis(gameId: string) {
  return db
    .prepare(
      `SELECT move_index, fen, move_san, score_cp, score_mate, best_move, depth
       FROM analysis WHERE game_id = ? ORDER BY move_index`
    )
    .all(gameId) as Array<{
    move_index: number;
    fen: string;
    move_san: string | null;
    score_cp: number | null;
    score_mate: number | null;
    best_move: string;
    depth: number;
  }>;
}
