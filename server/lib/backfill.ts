import type { Database } from "bun:sqlite";
import { db } from "./db";
import { pgnHeaders, pgnToMoves } from "./pgn";
import { classifyOpening, loadOpenings } from "./openings";

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
