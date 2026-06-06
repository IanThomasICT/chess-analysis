import type { Database } from "bun:sqlite";
import { db } from "./db";
import { fetchPlayerProfile } from "./chesscom";

/** Chess.com profile status that identifies a non-human (bot) account. */
const BOT_STATUS = "computer";

/** Polite cap on concurrent profile lookups against the Chess.com API. */
const RESOLVE_CONCURRENCY = 5;

export function isBotStatus(status: string): boolean {
  return status === BOT_STATUS;
}

function readCache(database: Database, username: string): boolean | null {
  const row = database
    .prepare("SELECT is_bot FROM players WHERE username = ?")
    .get(username) as { is_bot: number } | null;
  return row === null ? null : row.is_bot === 1;
}

function writeCache(database: Database, username: string, status: string): void {
  database
    .prepare(
      `INSERT INTO players (username, status, is_bot, fetched_at)
         VALUES (?, ?, ?, unixepoch())
       ON CONFLICT(username) DO UPDATE SET
         status = excluded.status, is_bot = excluded.is_bot, fetched_at = excluded.fetched_at`,
    )
    .run(username, status, isBotStatus(status) ? 1 : 0);
}

/**
 * Resolve bot status for a set of usernames. Returns a map of lowercased username →
 * isBot for every account that could be resolved (from the `players` cache or the
 * Chess.com profile API). Unresolvable accounts (fetch failed / deleted) are omitted
 * so callers leave them unprocessed and retry later. Results persist in the cache, so
 * repeat calls only hit the network for new accounts.
 */
export async function resolveBots(
  usernames: string[],
  database: Database = db,
): Promise<Map<string, boolean>> {
  const resolved = new Map<string, boolean>();
  const toFetch: string[] = [];

  for (const raw of usernames) {
    const u = raw.toLowerCase();
    if (resolved.has(u) || toFetch.includes(u)) {continue;}
    const cached = readCache(database, u);
    if (cached !== null) {
      resolved.set(u, cached);
    } else {
      toFetch.push(u);
    }
  }

  for (let i = 0; i < toFetch.length; i += RESOLVE_CONCURRENCY) {
    const batch = toFetch.slice(i, i + RESOLVE_CONCURRENCY);
    const profiles = await Promise.all(batch.map(fetchPlayerProfile));
    batch.forEach((u, j) => {
      const p = profiles[j];
      if (p === null) {return;} // unresolved — leave for a later retry
      writeCache(database, u, p.status);
      resolved.set(u, isBotStatus(p.status));
    });
  }

  return resolved;
}

/**
 * Fill `games.vs_bot` for a user's games where it is still NULL (e.g. imported
 * before bot detection existed). Best-effort and network-bound: opponents whose
 * profile cannot be resolved keep vs_bot = NULL so a later run can retry. Returns
 * the number of game rows updated.
 */
export async function backfillBotFlags(
  username: string,
  database: Database = db,
): Promise<number> {
  const rows = database
    .prepare(
      `SELECT id, white, black FROM games
        WHERE lower(username) = lower(?) AND vs_bot IS NULL`,
    )
    .all(username) as Array<{ id: string; white: string; black: string }>;
  if (rows.length === 0) {return 0;}

  const opponentOf = (r: { white: string; black: string }): string =>
    r.white.toLowerCase() === username.toLowerCase() ? r.black : r.white;

  const botMap = await resolveBots(rows.map(opponentOf), database);

  const update = database.prepare("UPDATE games SET vs_bot = ? WHERE id = ?");
  let updated = 0;
  const tx = database.transaction(() => {
    for (const r of rows) {
      const isBot = botMap.get(opponentOf(r).toLowerCase());
      if (isBot === undefined) {continue;} // unresolved — keep NULL, retry later
      update.run(isBot ? 1 : 0, r.id);
      updated += 1;
    }
  });
  tx();
  return updated;
}
