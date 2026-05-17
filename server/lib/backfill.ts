import type { Database } from "bun:sqlite";
import { db } from "./db";
import { pgnHeaders, pgnToMoves } from "./pgn";
import { classifyOpening, loadOpenings } from "./openings";
import { fenKey } from "./engine";
import { tagMoveIfBlunder } from "./motif-tagging";

interface GameToBackfill {
  id: string;
  username: string;
  pgn: string;
  white: string;
  black: string;
}

/**
 * Idempotent backfill: for every game where white_elo IS NULL, parse PGN headers
 * and populate white_elo / black_elo / user_elo / eco / opening.
 * Safe to run on every server start — the WHERE clause limits to unprocessed rows.
 */
export function backfillGameHeaders(database: Database = db): number {
  loadOpenings(); // idempotent — no-op if already loaded

  const rows = database
    .prepare(
      `SELECT id, username, pgn, white, black FROM games WHERE white_elo IS NULL`,
    )
    .all() as GameToBackfill[];

  if (rows.length === 0) {
    return 0;
  }

  const update = database.prepare(`
    UPDATE games
       SET white_elo = ?, black_elo = ?, user_elo = ?, eco = ?, opening = ?
     WHERE id = ?
  `);

  const tx = database.transaction((games: GameToBackfill[]) => {
    for (const g of games) {
      const h = pgnHeaders(g.pgn);
      const whiteElo = parseEloHeader(h.WhiteElo);
      const blackElo = parseEloHeader(h.BlackElo);
      const userColor =
        g.username.toLowerCase() === g.white.toLowerCase() ? "w" : "b";
      const userElo = userColor === "w" ? whiteElo : blackElo;
      let eco = normalizeHeader(h.ECO);
      let opening = normalizeHeader(h.Opening);

      if (eco === null || opening === null) {
        // Hybrid fallback — classify from move sequence
        try {
          const moves = pgnToMoves(g.pgn).map((m) => m.san);
          const classified = classifyOpening(moves);
          if (classified !== null) {
            eco ??= classified.eco;
            opening ??= classified.name;
          }
        } catch {
          // PGN parse failure — leave eco/opening as-is (likely both null)
        }
      }

      update.run(whiteElo, blackElo, userElo, eco, opening, g.id);
    }
  });

  tx(rows);
  return rows.length;
}

/**
 * Idempotent backfill: for every analysis row where fen_key IS NULL, compute and
 * populate fen_key (first 4 FEN fields). Safe to run on every server start.
 */
export function backfillAnalysisFenKeys(database: Database = db): number {
  const rows = database
    .prepare(
      `SELECT game_id, move_index, fen FROM analysis WHERE fen_key IS NULL`,
    )
    .all() as Array<{ game_id: string; move_index: number; fen: string }>;

  if (rows.length === 0) {
    return 0;
  }

  const update = database.prepare(
    `UPDATE analysis SET fen_key = ? WHERE game_id = ? AND move_index = ?`,
  );

  const tx = database.transaction(
    (items: Array<{ game_id: string; move_index: number; fen: string }>) => {
      for (const r of items) {
        update.run(fenKey(r.fen), r.game_id, r.move_index);
      }
    },
  );

  tx(rows);
  return rows.length;
}

interface AnalysisSnapshotRow {
  game_id: string;
  move_index: number;
  fen: string;
  score_cp: number | null;
  score_mate: number | null;
  best_move: string;
  pv: string | null;
}

interface GameWithPgn {
  game_id: string;
  pgn: string;
}

/**
 * For each analyzed game that has no entries in `blunder_tags`, detect motifs
 * on every mistake/blunder position and persist them. Throttled to `limit`
 * games per run; idempotent.
 *
 * Returns the number of games processed.
 */
export function backfillMotifs(
  database: Database = db,
  limit = 50,
): number {
  const candidates = database
    .prepare(
      `
      SELECT DISTINCT a.game_id, g.pgn
        FROM analysis a
        JOIN games g ON a.game_id = g.id
       WHERE a.multipv_rank = 1
         AND NOT EXISTS (SELECT 1 FROM blunder_tags bt WHERE bt.game_id = a.game_id)
       LIMIT ?
    `,
    )
    .all(limit) as GameWithPgn[];

  let processed = 0;
  for (const { game_id, pgn } of candidates) {
    try {
      const rows = database
        .prepare(
          `
          SELECT game_id, move_index, fen, score_cp, score_mate, best_move, pv
            FROM analysis
           WHERE game_id = ? AND multipv_rank = 1
           ORDER BY move_index ASC
        `,
        )
        .all(game_id) as AnalysisSnapshotRow[];

      let moves: Array<{ san: string; from: string; to: string }>;
      try {
        moves = pgnToMoves(pgn).map((m) => ({
          san: m.san,
          from: m.from,
          to: m.to,
        }));
      } catch {
        continue; // bad PGN — skip
      }

      for (let i = 1; i < rows.length; i++) {
        const before = rows[i - 1];
        const after = rows[i];
        const move = moves[i - 1];
        const uci = `${move.from}${move.to}`;
        try {
          tagMoveIfBlunder(
            database,
            game_id,
            i,
            {
              fen: before.fen,
              score_cp: before.score_cp,
              score_mate: before.score_mate,
              best_move: before.best_move,
              pv: before.pv,
              move_san: null,
            },
            {
              fen: after.fen,
              score_cp: after.score_cp,
              score_mate: after.score_mate,
              best_move: after.best_move,
              pv: after.pv,
              move_san: move.san,
            },
            uci,
          );
        } catch {
          // skip this position on detection error
        }
      }
      processed += 1;
    } catch {
      // skip this game on any error
    }
  }
  return processed;
}

export function parseEloHeader(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") {
    return null;
  }
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? null : n;
}

function normalizeHeader(raw: string | undefined): string | null {
  if (raw === undefined || raw.trim() === "") {
    return null;
  }
  return raw;
}
