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
  spawnEngine,
} from "../lib/engine";
import { computeAndStoreMetrics, metricsAreFresh } from "../lib/metrics-store";
import { RECENT_TIER_GAMES, RECENT_TIER_MONTHS } from "../lib/metrics-config";

const DEFAULT_MIN_DEPTH = 12;
const MONTH_SECONDS = 30 * 24 * 60 * 60;
const PREFLIGHT_TIMEOUT_MS = 15_000;

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

/**
 * Verify the configured engine is launchable and speaks UCI before committing to a
 * multi-hour run. Spawns once, handshakes (uci → uciok → isready → readyok), tears
 * down. Returns null on success or a human-readable reason on failure.
 */
export async function preflightEngine(): Promise<string | null> {
  let engine: ReturnType<typeof spawnEngine>;
  try {
    engine = spawnEngine();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `engine binary could not be launched (${msg})`;
  }
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      engine.init(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => { reject(new Error("no UCI handshake response")); },
          PREFLIGHT_TIMEOUT_MS,
        );
      }),
    ]).finally(() => { if (timer !== undefined) {clearTimeout(timer);} });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `engine did not complete UCI handshake (${msg})`;
  } finally {
    engine.cleanup();
  }
  return null;
}

interface AnalyzeOutcome {
  ok: boolean;
  /** Reason when ok === false, for logging. */
  reason?: string;
}

async function ensureAnalyzed(
  game: GameRow,
  multipv: number,
  onProgress: (moveIndex: number, total: number, depth: number) => void,
): Promise<AnalyzeOutcome> {
  let fens: string[];
  let sans: string[];
  try {
    fens = pgnToFens(game.pgn);
    sans = pgnToMoves(game.pgn).map((m) => m.san);
  } catch {
    return { ok: false, reason: "bad PGN" };
  }
  if (!acquireAnalysisSlot()) {return { ok: false, reason: "no engine slot" };}
  try {
    for await (const ev of analyzeGame(game.id, fens, sans, { multipv })) {
      if (ev.multipvRank === 1) {onProgress(ev.moveIndex, ev.total, ev.depth);}
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `analysis error: ${msg}` };
  } finally {
    releaseAnalysisSlot();
  }
  return { ok: true };
}

interface RunSummary {
  total: number;
  ok: number;
  skipped: number;
  noData: number;
  badPgn: number;
  failed: number;
}

/** elapsed seconds formatted as `Mm Ss` (or `Ss` under a minute). */
function fmtElapsed(startMs: number): string {
  const s = Math.round((Date.now() - startMs) / 1000);
  if (s < 60) {return `${String(s)}s`;}
  return `${String(Math.floor(s / 60))}m ${String(s % 60)}s`;
}

let interrupted = false;

async function run(args: CliArgs): Promise<RunSummary> {
  // Newest-first (latest → oldest); the recency tier (D1) keys off this order.
  // Bot/coach games are purged at startup (migration) and skipped at import, so
  // vs_bot IS NOT 1 is belt-and-suspenders against any that slip through.
  const games = db
    .prepare(
      `SELECT id, pgn, end_time FROM games
        WHERE lower(username) = lower(?) AND is_standard = 1 AND vs_bot IS NOT 1
        ORDER BY end_time DESC`,
    )
    .all(args.username) as GameRow[];

  const total = games.length;
  const nowSec = Math.floor(Date.now() / 1000);
  const startMs = Date.now();
  const summary: RunSummary = { total, ok: 0, skipped: 0, noData: 0, badPgn: 0, failed: 0 };

  if (total === 0) {
    console.warn(
      `No standard games found for "${args.username}". ` +
        `Check the handle (case-insensitive) and that games are imported.`,
    );
    return summary;
  }
  console.log(`Building metrics for ${String(total)} standard games of ${args.username}`);

  const log = (i: number, id: string, status: string): void => {
    // \r clears any in-progress heartbeat line before the final per-game status.
    process.stdout.write(`\r\x1b[K[${String(i + 1)}/${String(total)}] ${id} — ${status}\n`);
  };

  for (let i = 0; i < total && !interrupted; i++) {
    const game = games[i];
    try {
      let positions: number;
      try {
        positions = pgnToFens(game.pgn).length;
      } catch {
        summary.badPgn++;
        log(i, game.id, "bad PGN, skipped");
        continue;
      }

      const minDepth = rank1Coverage(game.id, positions);
      if (shouldReanalyze(minDepth, args.minDepth, args.reanalyze)) {
        const multipv = tierMultipv(i, game.end_time, nowSec);
        const tier = multipv === 3 ? "deep" : "fast";
        const outcome = await ensureAnalyzed(game, multipv, (pos, t, depth) => {
          process.stdout.write(
            `\r\x1b[K[${String(i + 1)}/${String(total)}] ${game.id} — ${tier} analyzing ${String(pos)}/${String(t - 1)} d${String(depth)}`,
          );
        });
        if (!outcome.ok) {
          summary.failed++;
          log(i, game.id, `${outcome.reason ?? "analysis unavailable"}, skipped`);
          continue;
        }
      }

      // Cheap resume check — skip the L1→L2 fold for games a prior run left fresh.
      if (metricsAreFresh(db, game.id)) {
        summary.skipped++;
        log(i, game.id, "skipped (fresh)");
        continue;
      }

      const derived = computeAndStoreMetrics(db, game.id);
      if (derived !== null) {
        summary.ok++;
        log(i, game.id, "ok");
      } else {
        summary.noData++;
        log(i, game.id, "no-data");
      }
    } catch (err) {
      summary.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      log(i, game.id, `failed (${msg})`);
    }
  }

  const done =
    summary.ok + summary.skipped + summary.noData + summary.badPgn + summary.failed;
  console.log(
    `\n${interrupted ? "Interrupted" : "Done"} in ${fmtElapsed(startMs)} — ` +
      `${String(done)}/${String(total)} processed: ${String(summary.ok)} ok, ` +
      `${String(summary.skipped)} skipped (fresh), ${String(summary.noData)} no-data, ` +
      `${String(summary.badPgn)} bad-PGN, ${String(summary.failed)} failed.`,
  );
  if (interrupted) {
    console.log("Re-run the same command to resume — completed games are skipped.");
  }
  return summary;
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) {
    console.error("Usage: bun run metrics <username> [--reanalyze] [--min-depth N]");
    process.exit(1);
  }

  process.on("SIGINT", () => {
    if (interrupted) {process.exit(130);} // second Ctrl-C — force quit
    interrupted = true;
    console.log("\nStopping after the current game… (Ctrl-C again to force quit)");
  });

  const engineError = await preflightEngine();
  if (engineError !== null) {
    console.error(
      `Engine preflight failed: ${engineError}.\n` +
        `Set STOCKFISH_PATH (or ENGINE_PATH) to a valid binary, or install Stockfish on $PATH. ` +
        `See README "Prerequisites".`,
    );
    process.exit(1);
  }

  await run(args);
}
