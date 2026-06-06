/**
 * Batch metrics builder (Phase 2b).
 *
 *   bun run metrics <username> [--reanalyze] [--min-depth N]
 *
 * Loads the user's standard games newest-first, ensures each has engine analysis
 * (tiered depth per D1 — recent games get MultiPV=3, the tail gets MultiPV=1),
 * then runs the shared derive → upsert → drill-feed path. One transaction per
 * game keeps it SIGINT-safe (R8); already-current games are skipped (R8/D17).
 */
import { db } from "../lib/db";
import { pgnToFens, pgnToMoves } from "../lib/pgn";
import {
  analyzeGame,
  acquireAnalysisSlot,
  releaseAnalysisSlot,
} from "../lib/engine";
import { computeAndStoreMetrics } from "../lib/metrics-store";
import { RECENT_TIER_GAMES, RECENT_TIER_MONTHS } from "../lib/metrics-config";

const DEFAULT_MIN_DEPTH = 12;
const MONTH_SECONDS = 30 * 24 * 60 * 60;

/** Tiered MultiPV: recent games (by index OR recency) get 3 lines, the tail gets 1. */
export function tierMultipv(gameIndex: number, endTime: number, nowSec: number): 1 | 3 {
  if (gameIndex < RECENT_TIER_GAMES) {return 3;}
  if (endTime >= nowSec - RECENT_TIER_MONTHS * MONTH_SECONDS) {return 3;}
  return 1;
}

/** Re-run analysis when forced, never analyzed, or below the minimum depth floor. */
export function shouldReanalyze(
  rank1MinDepth: number | null,
  minDepth: number,
  reanalyze: boolean,
): boolean {
  if (reanalyze) {return true;}
  if (rank1MinDepth === null) {return true;}
  return rank1MinDepth < minDepth;
}

interface GameRow {
  id: string;
  pgn: string;
  end_time: number;
}

interface DepthRow {
  count: number;
  min_depth: number | null;
}

function rank1Coverage(gameId: string, positions: number): number | null {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count, MIN(depth) AS min_depth
         FROM analysis WHERE game_id = ? AND multipv_rank = 1`,
    )
    .get(gameId) as DepthRow;
  if (row.count < positions) {return null;}
  return row.min_depth;
}

interface CliArgs {
  username: string;
  reanalyze: boolean;
  minDepth: number;
}

export function parseArgs(argv: string[]): CliArgs | null {
  const positional: string[] = [];
  let reanalyze = false;
  let minDepth = DEFAULT_MIN_DEPTH;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--reanalyze") {
      reanalyze = true;
    } else if (a === "--min-depth") {
      const n = parseInt(argv[i + 1] ?? "", 10);
      if (!Number.isNaN(n) && n > 0) {minDepth = n;}
      i++;
    } else {
      positional.push(a);
    }
  }
  if (positional.length === 0) {return null;}
  return { username: positional[0], reanalyze, minDepth };
}

async function ensureAnalyzed(game: GameRow, multipv: number): Promise<boolean> {
  let fens: string[];
  let sans: string[];
  try {
    fens = pgnToFens(game.pgn);
    sans = pgnToMoves(game.pgn).map((m) => m.san);
  } catch {
    return false;
  }
  if (!acquireAnalysisSlot()) {return false;}
  try {
    for await (const _ of analyzeGame(game.id, fens, sans, { multipv })) {
      // drain the generator — analyzeGame persists internally
    }
  } finally {
    releaseAnalysisSlot();
  }
  return true;
}

async function run(args: CliArgs): Promise<void> {
  const games = db
    .prepare(
      `SELECT id, pgn, end_time FROM games
        WHERE lower(username) = lower(?) AND is_standard = 1
        ORDER BY end_time DESC`,
    )
    .all(args.username) as GameRow[];

  const total = games.length;
  const nowSec = Math.floor(Date.now() / 1000);
  console.log(`Building metrics for ${String(total)} standard games of ${args.username}`);

  for (let i = 0; i < total; i++) {
    const game = games[i];
    let positions: number;
    try {
      positions = pgnToFens(game.pgn).length;
    } catch {
      console.log(`[${String(i + 1)}/${String(total)}] ${game.id} — bad PGN, skipped`);
      continue;
    }

    const minDepth = rank1Coverage(game.id, positions);
    if (shouldReanalyze(minDepth, args.minDepth, args.reanalyze)) {
      const multipv = tierMultipv(i, game.end_time, nowSec);
      const ok = await ensureAnalyzed(game, multipv);
      if (!ok) {
        console.log(`[${String(i + 1)}/${String(total)}] ${game.id} — analysis unavailable, skipped`);
        continue;
      }
    }

    const derived = computeAndStoreMetrics(db, game.id);
    const status = derived !== null ? "ok" : "no-data";
    console.log(`[${String(i + 1)}/${String(total)}] ${game.id} — ${status}`);
  }
  console.log("Done.");
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) {
    console.error("Usage: bun run metrics <username> [--reanalyze] [--min-depth N]");
    process.exit(1);
  }
  await run(args);
}
