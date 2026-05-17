import type { Database } from "bun:sqlite";
import { db } from "./db";
import { pgnHeaders } from "./pgn";

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
      const eco = normalizeHeader(h.ECO);
      const opening = normalizeHeader(h.Opening);
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
