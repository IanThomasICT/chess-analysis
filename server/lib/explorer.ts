import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Opening Explorer (D29) — peer-band move-frequency lookup.
 *
 * A self-built, offline frequency table (normalized-FEN key → move → count),
 * aggregated by `server/scripts/build-explorer.ts` from one monthly Lichess rated
 * dump (band 1100–2200, first 24 plies). `positionFrequency` is the primary
 * out-of-book signal (R19); `game-metrics.ts` falls back to the named-ECO prefix
 * (D33) whenever this returns `null` (table not built, or a line never sampled).
 *
 * Static reference data — NOT part of the L0→L2 cache, regenerable from the dump.
 */

/** Table name + DDL — shared with the builder so both agree on the schema. */
export const EXPLORER_TABLE = "explorer_positions";
export const EXPLORER_SCHEMA = `CREATE TABLE IF NOT EXISTS ${EXPLORER_TABLE} (
  fen_key TEXT NOT NULL,
  move TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (fen_key, move)
)`;

const DEFAULT_DB_PATH = join(import.meta.dir, "..", "data", "explorer", "explorer.db");

let dbPath = DEFAULT_DB_PATH;
let conn: Database | null = null;
let resolved = false;
const totalsCache = new Map<string, number>();

interface SumRow {
  total: number | null;
}
interface CountRow {
  count: number;
}
interface TableRow {
  name: string;
}

/**
 * Lazily open the explorer DB (read-only). Returns null — leaving every lookup to
 * fall back to ECO (D33) — when the file or table is absent. The open is attempted
 * once; the result (incl. failure) is cached until `setExplorerDbPath` resets it.
 */
function ensureConn(): Database | null {
  if (resolved) {return conn;}
  resolved = true;
  conn = null;
  totalsCache.clear();
  if (!existsSync(dbPath)) {return null;}
  try {
    const opened = new Database(dbPath, { readonly: true, create: false });
    const table = opened
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
      )
      .get(EXPLORER_TABLE) as TableRow | null;
    if (table === null) {
      opened.close();
      return null;
    }
    conn = opened;
    return conn;
  } catch {
    conn = null;
    return null;
  }
}

/** Strip trailing SAN annotations (`+ # ! ?`) so dump and lookup SAN agree. */
export function normalizeSan(san: string): string {
  return san.replace(/[+#!?]+$/, "");
}

/**
 * Relative frequency of `move` from `fenKey` in the peer-band table, in [0, 1].
 * Returns `null` when the position was never sampled (→ ECO fallback). A position
 * that WAS sampled but where `move` is unseen returns 0 (a genuine novelty, not a
 * fallback).
 */
export function positionFrequency(fenKey: string, move: string): number | null {
  const database = ensureConn();
  if (database === null) {return null;}

  let total = totalsCache.get(fenKey);
  if (total === undefined) {
    const sum = database
      .prepare(`SELECT SUM(count) AS total FROM ${EXPLORER_TABLE} WHERE fen_key = ?`)
      .get(fenKey) as SumRow | null;
    total = sum?.total ?? 0;
    totalsCache.set(fenKey, total);
  }
  if (total <= 0) {return null;}

  const mv = normalizeSan(move);
  const row = database
    .prepare(
      `SELECT count FROM ${EXPLORER_TABLE} WHERE fen_key = ? AND move = ?`,
    )
    .get(fenKey, mv) as CountRow | null;
  return (row?.count ?? 0) / total;
}

/**
 * Test seam: point the lookup at a specific DB file (or `null` for the default)
 * and drop the cached connection so the next call re-resolves.
 */
export function setExplorerDbPath(path: string | null): void {
  if (conn !== null) {
    try {
      conn.close();
    } catch {
      // already closed — ignore
    }
  }
  conn = null;
  resolved = false;
  totalsCache.clear();
  dbPath = path ?? DEFAULT_DB_PATH;
}
