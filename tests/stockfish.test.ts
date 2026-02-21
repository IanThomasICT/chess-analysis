import { describe, it, expect } from "bun:test";

// =====================================================================
// UCI output parsing logic
// These tests validate the parsing rules used in readUntilBestMove()
// from stockfish.server.ts without spawning a real Stockfish process.
// =====================================================================

interface Score {
  cp: number | null;
  mate: number | null;
}

interface ParsedResult {
  score: Score;
  bestMove: string;
  depth: number;
}

/**
 * Replicates the line-by-line parsing logic from readUntilBestMove().
 * Given an array of Stockfish stdout lines, returns the final evaluation.
 */
function parseUciOutput(lines: string[]): ParsedResult {
  let lastScore: Score = { cp: null, mate: null };
  let lastDepth = 0;
  let bestMove = "";

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (trimmed.startsWith("info") && trimmed.includes("score")) {
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

    if (trimmed.startsWith("bestmove")) {
      const parts = trimmed.split(/\s+/);
      bestMove = parts[1] ?? "";
      break;
    }
  }

  return { score: lastScore, bestMove, depth: lastDepth };
}

describe("UCI output parsing", () => {
  it("parses a simple centipawn score", () => {
    const lines = [
      "info depth 20 score cp 35 nodes 1234 pv e2e4",
      "bestmove e2e4 ponder e7e5",
    ];
    const result = parseUciOutput(lines);
    expect(result.score.cp).toBe(35);
    expect(result.score.mate).toBeNull();
    expect(result.bestMove).toBe("e2e4");
    expect(result.depth).toBe(20);
  });

  it("parses a negative centipawn score", () => {
    const lines = [
      "info depth 15 score cp -120 nodes 5678 pv d7d5",
      "bestmove d7d5",
    ];
    const result = parseUciOutput(lines);
    expect(result.score.cp).toBe(-120);
    expect(result.score.mate).toBeNull();
    expect(result.depth).toBe(15);
  });

  it("parses a mate score (positive = White mates)", () => {
    const lines = [
      "info depth 30 score mate 3 nodes 9999 pv f7f8",
      "bestmove f7f8",
    ];
    const result = parseUciOutput(lines);
    expect(result.score.cp).toBeNull();
    expect(result.score.mate).toBe(3);
    expect(result.bestMove).toBe("f7f8");
  });

  it("parses a mate score (negative = Black mates)", () => {
    const lines = [
      "info depth 25 score mate -2 nodes 4321 pv h4h1",
      "bestmove h4h1",
    ];
    const result = parseUciOutput(lines);
    expect(result.score.cp).toBeNull();
    expect(result.score.mate).toBe(-2);
  });

  it("keeps only the LAST info line score before bestmove", () => {
    const lines = [
      "info depth 5 score cp 10 nodes 100 pv e2e4",
      "info depth 10 score cp 25 nodes 500 pv e2e4",
      "info depth 15 score cp 30 nodes 1500 pv d2d4",
      "info depth 20 score cp 42 nodes 5000 pv d2d4",
      "bestmove d2d4 ponder d7d5",
    ];
    const result = parseUciOutput(lines);
    expect(result.score.cp).toBe(42);
    expect(result.depth).toBe(20);
    expect(result.bestMove).toBe("d2d4");
  });

  it("handles transition from cp to mate in progressive depth", () => {
    const lines = [
      "info depth 10 score cp 500 nodes 100 pv f7f8",
      "info depth 20 score mate 1 nodes 500 pv f7f8",
      "bestmove f7f8",
    ];
    const result = parseUciOutput(lines);
    // Last score was mate, should override cp
    expect(result.score.cp).toBeNull();
    expect(result.score.mate).toBe(1);
  });

  it("handles bestmove without ponder", () => {
    const lines = [
      "info depth 20 score cp 0 nodes 1000 pv e2e4",
      "bestmove e2e4",
    ];
    const result = parseUciOutput(lines);
    expect(result.bestMove).toBe("e2e4");
  });

  it("ignores info lines without score keyword", () => {
    const lines = [
      "info depth 5 nodes 100 nps 50000",
      "info depth 10 score cp 15 nodes 500 pv e2e4",
      "bestmove e2e4",
    ];
    const result = parseUciOutput(lines);
    expect(result.score.cp).toBe(15);
    expect(result.depth).toBe(10);
  });

  it("handles extra whitespace in lines", () => {
    const lines = [
      "  info depth 20 score cp 22 nodes 1234 pv e2e4  ",
      "  bestmove e2e4  ",
    ];
    const result = parseUciOutput(lines);
    expect(result.score.cp).toBe(22);
    expect(result.bestMove).toBe("e2e4");
  });

  it("returns defaults when no info lines precede bestmove", () => {
    const lines = ["bestmove e2e4"];
    const result = parseUciOutput(lines);
    expect(result.score.cp).toBeNull();
    expect(result.score.mate).toBeNull();
    expect(result.depth).toBe(0);
    expect(result.bestMove).toBe("e2e4");
  });

  it("handles score cp 0 correctly (equal position)", () => {
    const lines = [
      "info depth 20 score cp 0 nodes 1000 pv e2e4",
      "bestmove e2e4",
    ];
    const result = parseUciOutput(lines);
    expect(result.score.cp).toBe(0);
    expect(result.score.mate).toBeNull();
  });
});

// =====================================================================
// Score convention validation
// All scores from White's perspective per docs/analysis-mode.md
// =====================================================================

describe("score convention (White's perspective)", () => {
  it("positive cp = White advantage", () => {
    const result = parseUciOutput([
      "info depth 20 score cp 150 nodes 1000 pv e2e4",
      "bestmove e2e4",
    ]);
    expect(result.score.cp).toBeGreaterThan(0);
  });

  it("negative cp = Black advantage", () => {
    const result = parseUciOutput([
      "info depth 20 score cp -200 nodes 1000 pv d7d5",
      "bestmove d7d5",
    ]);
    expect(result.score.cp).toBeLessThan(0);
  });

  it("positive mate = White has forced mate", () => {
    const result = parseUciOutput([
      "info depth 30 score mate 5 nodes 1000 pv f7f8",
      "bestmove f7f8",
    ]);
    expect(result.score.mate).toBeGreaterThan(0);
  });

  it("negative mate = Black has forced mate", () => {
    const result = parseUciOutput([
      "info depth 30 score mate -3 nodes 1000 pv h4h1",
      "bestmove h4h1",
    ]);
    expect(result.score.mate).toBeLessThan(0);
  });
});

// =====================================================================
// Stockfish path resolution logic
// =====================================================================

function resolveStockfishPath(
  envPath: string | undefined,
  homeDir: string | undefined
): string {
  if (envPath !== undefined) return envPath;
  if (homeDir !== undefined) return homeDir + "/.local/bin/stockfish";
  return "/usr/local/bin/stockfish";
}

describe("Stockfish path resolution", () => {
  it("uses STOCKFISH_PATH env var when set", () => {
    expect(resolveStockfishPath("/custom/stockfish", "/home/user")).toBe(
      "/custom/stockfish"
    );
  });

  it("falls back to $HOME/.local/bin/stockfish", () => {
    expect(resolveStockfishPath(undefined, "/home/user")).toBe(
      "/home/user/.local/bin/stockfish"
    );
  });

  it("falls back to /usr/local/bin/stockfish when no HOME", () => {
    expect(resolveStockfishPath(undefined, undefined)).toBe(
      "/usr/local/bin/stockfish"
    );
  });
});

// =====================================================================
// SSE message format validation
// From api.analyze.$gameId.ts
// =====================================================================

interface SseProgressEvent {
  moveIndex: number;
  fen: string;
  scoreCp: number | null;
  scoreMate: number | null;
  bestMove: string;
  depth: number;
  total: number;
}

interface SseDoneEvent {
  done: true;
}

interface SseErrorEvent {
  error: string;
}

type SseEvent = SseProgressEvent | SseDoneEvent | SseErrorEvent;

function parseSseLine(line: string): SseEvent | null {
  if (!line.startsWith("data: ")) return null;
  return JSON.parse(line.slice(6)) as SseEvent;
}

describe("SSE message format", () => {
  it("parses a progress event", () => {
    const raw =
      'data: {"moveIndex":0,"fen":"rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1","scoreCp":20,"scoreMate":null,"bestMove":"e7e5","depth":20,"total":85}';
    const event = parseSseLine(raw) as SseProgressEvent;
    expect(event.moveIndex).toBe(0);
    expect(event.scoreCp).toBe(20);
    expect(event.scoreMate).toBeNull();
    expect(event.bestMove).toBe("e7e5");
    expect(event.depth).toBe(20);
    expect(event.total).toBe(85);
  });

  it("parses a completion event", () => {
    const raw = 'data: {"done":true}';
    const event = parseSseLine(raw) as SseDoneEvent;
    expect(event.done).toBe(true);
  });

  it("parses an error event", () => {
    const raw = 'data: {"error":"Stockfish process failed"}';
    const event = parseSseLine(raw) as SseErrorEvent;
    expect(event.error).toBe("Stockfish process failed");
  });

  it("returns null for non-data lines", () => {
    expect(parseSseLine("")).toBeNull();
    expect(parseSseLine("event: message")).toBeNull();
    expect(parseSseLine(": comment")).toBeNull();
  });

  it("handles mate score in progress event", () => {
    const raw =
      'data: {"moveIndex":5,"fen":"some-fen","scoreCp":null,"scoreMate":3,"bestMove":"f7f8","depth":30,"total":40}';
    const event = parseSseLine(raw) as SseProgressEvent;
    expect(event.scoreCp).toBeNull();
    expect(event.scoreMate).toBe(3);
  });
});
