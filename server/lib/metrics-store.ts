import type { Database } from "bun:sqlite";
import { pgnToFens, parseTimeControl } from "./pgn";
import { dividePhases } from "./phases";
import { buildTimeline, type EnrichedPly } from "./ply-timeline";
import { buildGameMetrics, type ExtendedGameMetrics } from "./game-metrics";
import { gameMetrics } from "./metrics";
import { METRICS_VERSION } from "./metrics-config";
import type { AnalysisRow, AnalysisRowMPV } from "./engine";

interface GameStoreRow {
  id: string;
  pgn: string;
  username: string;
  white: string;
  black: string;
}

export interface DerivedMetrics {
  game: GameStoreRow;
  rank1Rows: AnalysisRow[];
  timeline: EnrichedPly[];
  ext: ExtendedGameMetrics;
}

/** Deterministic provenance signature for a game's analysis (D17). */
export function computeAnalysisSig(engineDepthMin: number, rank1Count: number): string {
  return `${String(engineDepthMin)}:${String(rank1Count)}`;
}

/** Whether a cached ext row must be recomputed: version bump or signature change (D17). */
export function isMetricsStale(
  row: { metrics_version: number; analysis_sig: string } | null,
  sig: string,
): boolean {
  if (row === null) {return true;}
  return row.metrics_version !== METRICS_VERSION || row.analysis_sig !== sig;
}

function loadGame(database: Database, gameId: string): GameStoreRow | null {
  return database
    .prepare("SELECT id, pgn, username, white, black FROM games WHERE id = ?")
    .get(gameId) as GameStoreRow | null;
}

function getMultiPV(database: Database, gameId: string, maxRank = 3): AnalysisRowMPV[] {
  return database
    .prepare(
      `SELECT move_index, multipv_rank, fen, fen_key, move_san, score_cp, score_mate, best_move, pv, depth
         FROM analysis
        WHERE game_id = ? AND multipv_rank <= ?
        ORDER BY move_index, multipv_rank`,
    )
    .all(gameId, maxRank) as AnalysisRowMPV[];
}

function userColorOf(game: GameStoreRow): "w" | "b" {
  return game.username.toLowerCase() === game.white.toLowerCase() ? "w" : "b";
}

/**
 * Derive L1 timeline + L2 metrics for a game from stored raw rows.
 * Returns null when the game is missing, has too few analyzed positions, or has
 * an unparseable PGN. Pure read — no writes.
 */
export function deriveMetrics(database: Database, gameId: string): DerivedMetrics | null {
  const game = loadGame(database, gameId);
  if (game === null) {return null;}

  const rows = getMultiPV(database, gameId, 3);
  const rank1Rows = rows.filter((r) => r.multipv_rank === 1);
  if (rank1Rows.length < 2) {return null;}

  let fens: string[];
  try {
    fens = pgnToFens(game.pgn);
  } catch {
    return null;
  }

  const phases = dividePhases(fens);
  const userColor = userColorOf(game);
  const timeline = buildTimeline(game.pgn, rows, userColor, phases);

  const engineDepthMin = rank1Rows.reduce(
    (min, r) => Math.min(min, r.depth),
    rank1Rows[0].depth,
  );
  const multipvMax = rows.reduce((max, r) => Math.max(max, r.multipv_rank), 1);
  const baseSeconds = parseTimeControl(game.pgn)?.baseSeconds ?? null;

  const ext = buildGameMetrics(timeline, {
    pgn: game.pgn,
    userColor,
    phases,
    baseSeconds,
    engineDepthMin,
    rank1Count: rank1Rows.length,
    multipvMax,
  });

  return { game, rank1Rows, timeline, ext };
}

/**
 * Write both the basic per-side `game_metrics` and the extended `game_metrics_ext`
 * row in a single transaction, stamped with the current metrics version (Q3
 * reference-don't-duplicate: ext holds only the new folds, not per-side basics).
 */
export function upsertGameMetrics(database: Database, derived: DerivedMetrics): void {
  const { game, rank1Rows, ext } = derived;
  const computedAt = Math.floor(Date.now() / 1000);
  const basic = gameMetrics(rank1Rows);

  const tx = database.transaction(() => {
    database
      .prepare(
        `INSERT OR REPLACE INTO game_metrics (
           game_id, accuracy_white, accuracy_black,
           blunders_white, mistakes_white, inaccuracies_white,
           blunders_black, mistakes_black, inaccuracies_black,
           acl_white, acl_black, computed_at, metrics_version
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        game.id,
        basic.white.accuracy, basic.black.accuracy,
        basic.white.blunders, basic.white.mistakes, basic.white.inaccuracies,
        basic.black.blunders, basic.black.mistakes, basic.black.inaccuracies,
        basic.white.acl, basic.black.acl, computedAt, ext.metricsVersion,
      );

    database
      .prepare(
        `INSERT OR REPLACE INTO game_metrics_ext (
           game_id, metrics_version, analysis_sig, multipv_max,
           accuracy_opening, accuracy_middlegame, accuracy_endgame,
           acl_opening, acl_middlegame, acl_endgame,
           middlegame_start_ply, endgame_start_ply,
           time_opening_s, time_middlegame_s, time_endgame_s, avg_move_time_s,
           accuracy_critical, accuracy_quiet, critical_positions,
           time_alloc_efficiency,
           max_blunder_run, recovery_accuracy,
           time_trouble_moves, time_trouble_errors,
           peak_eval_wp, trough_eval_wp,
           out_of_book_ply, out_of_book_eco_fallback, post_book_accuracy,
           eval_opening_end_wp,
           user_moves, clocks_available, engine_depth_min, computed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        game.id, ext.metricsVersion, ext.analysisSig, ext.multipvMax,
        ext.accuracyOpening, ext.accuracyMiddlegame, ext.accuracyEndgame,
        ext.aclOpening, ext.aclMiddlegame, ext.aclEndgame,
        ext.middlegameStartPly, ext.endgameStartPly,
        ext.timeOpeningS, ext.timeMiddlegameS, ext.timeEndgameS, ext.avgMoveTimeS,
        ext.accuracyCritical, ext.accuracyQuiet, ext.criticalPositions,
        ext.timeAllocEfficiency,
        ext.maxBlunderRun, ext.recoveryAccuracy,
        ext.timeTroubleMoves, ext.timeTroubleErrors,
        ext.peakEvalWp, ext.troughEvalWp,
        ext.outOfBookPly, ext.outOfBookEcoFallback, ext.postBookAccuracy,
        ext.evalOpeningEndWp,
        ext.userMoves, ext.clocksAvailable, ext.engineDepthMin, computedAt,
      );
  });
  tx();
}

/**
 * Seed the drill queue from a game's critical moves + missed conversions (R40/D23).
 * Inserts a fresh FSRS card (due now, empty state) keyed by the after-move index;
 * ON CONFLICT DO NOTHING reconciles with the existing blunder-tag new-queue.
 * Returns the number of rows inserted-or-ignored (attempts).
 */
export function autoFeedDrill(
  database: Database,
  username: string,
  ext: ExtendedGameMetrics,
  gameId: string,
): number {
  const seeds: Array<{ moveIndex: number; fen: string; bestMove: string }> = [
    ...ext.criticalMoves.map((m) => ({ moveIndex: m.plyIndex, fen: m.beforeFen, bestMove: m.bestMove })),
    ...ext.missedConversions.map((m) => ({ moveIndex: m.plyIndex, fen: m.beforeFen, bestMove: m.bestMove })),
  ];

  const insert = database.prepare(
    `INSERT INTO drill_attempts
       (username, game_id, move_index, fen, best_move,
        attempted_move, correct, attempted_at, stability, difficulty, due, state)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, unixepoch(), NULL)
     ON CONFLICT (username, game_id, move_index) DO NOTHING`,
  );

  const tx = database.transaction(() => {
    for (const s of seeds) {
      insert.run(username.toLowerCase(), gameId, s.moveIndex, s.fen, s.bestMove);
    }
  });
  tx();
  return seeds.length;
}

/**
 * Cheap resume pre-check: is a game's cached `game_metrics_ext` already current,
 * without building the timeline/fold? Recomputes only the analysis signature from a
 * single aggregate query over the rank-1 rows (the same inputs `deriveMetrics` uses:
 * `MIN(depth)` and the row count) and compares it + `metrics_version` against the
 * stored row. Lets the batch runner skip the full L1→L2 derivation for games left
 * fresh by an earlier run. Returns false when no metrics exist or fewer than 2
 * positions are analyzed (nothing derivable yet).
 */
export function metricsAreFresh(database: Database, gameId: string): boolean {
  const existing = database
    .prepare("SELECT metrics_version, analysis_sig FROM game_metrics_ext WHERE game_id = ?")
    .get(gameId) as { metrics_version: number; analysis_sig: string } | null;
  if (existing === null) {return false;}

  const agg = database
    .prepare(
      `SELECT COUNT(*) AS count, MIN(depth) AS min_depth
         FROM analysis WHERE game_id = ? AND multipv_rank = 1`,
    )
    .get(gameId) as { count: number; min_depth: number | null };
  if (agg.count < 2 || agg.min_depth === null) {return false;}

  const sig = computeAnalysisSig(agg.min_depth, agg.count);
  return !isMetricsStale(existing, sig);
}

/**
 * Full ongoing-capture path: derive, skip if the cache is current, else upsert +
 * feed the drill queue. Returns the derived metrics (even when skipped) or null.
 */
export function computeAndStoreMetrics(
  database: Database,
  gameId: string,
): DerivedMetrics | null {
  const derived = deriveMetrics(database, gameId);
  if (derived === null) {return null;}

  const sig = derived.ext.analysisSig;
  const existing = database
    .prepare("SELECT metrics_version, analysis_sig FROM game_metrics_ext WHERE game_id = ?")
    .get(gameId) as { metrics_version: number; analysis_sig: string } | null;

  if (!isMetricsStale(existing, sig)) {return derived;}

  upsertGameMetrics(database, derived);
  autoFeedDrill(database, derived.game.username, derived.ext, gameId);
  return derived;
}
