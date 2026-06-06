import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { migrations } from "../server/lib/db";
import { isBotStatus, resolveBots, backfillBotFlags } from "../server/lib/players";

function makeTestDb(): Database {
  const database = new Database(":memory:");
  database.run(
    `CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY, username TEXT NOT NULL, pgn TEXT NOT NULL, white TEXT, black TEXT, result TEXT, time_class TEXT, end_time INTEGER, created_at INTEGER DEFAULT (unixepoch()))`,
  );
  database.run(
    `CREATE TABLE IF NOT EXISTS analysis (game_id TEXT NOT NULL, move_index INTEGER NOT NULL, fen TEXT NOT NULL, move_san TEXT, score_cp INTEGER, score_mate INTEGER, best_move TEXT, depth INTEGER, PRIMARY KEY (game_id, move_index))`,
  );
  database.run(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);
  for (const m of migrations) {m.up(database);}
  return database;
}

const origFetch = globalThis.fetch;

/** Stub Chess.com profile API: name → status, or 404 when absent. */
function mockProfiles(byName: Record<string, string>): void {
  globalThis.fetch = (async (input: string | URL): Promise<Response> => {
    await Promise.resolve();
    const url = typeof input === "string" ? input : input.href;
    const name = (url.split("/").pop() ?? "").toLowerCase();
    const status = Object.hasOwn(byName, name) ? byName[name] : undefined;
    if (status === undefined) {
      return new Response("not found", { status: 404 });
    }
    return new Response(JSON.stringify({ username: name, status }), { status: 200 });
  }) as unknown as typeof fetch;
}

let db: Database;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(() => {
  globalThis.fetch = origFetch;
});

describe("isBotStatus", () => {
  it("only 'computer' is a bot", () => {
    expect(isBotStatus("computer")).toBe(true);
    expect(isBotStatus("basic")).toBe(false);
    expect(isBotStatus("premium")).toBe(false);
    expect(isBotStatus("")).toBe(false);
  });
});

describe("resolveBots", () => {
  it("classifies via the API, omits unresolved, and caches results", async () => {
    mockProfiles({ komodobot: "computer", realalice: "basic" });
    const map = await resolveBots(["KomodoBot", "RealAlice", "ghost"], db);

    expect(map.get("komodobot")).toBe(true);
    expect(map.get("realalice")).toBe(false);
    expect(map.has("ghost")).toBe(false); // 404 → unresolved, omitted

    // Cached now → a second call resolves with no network.
    globalThis.fetch = origFetch;
    const cached = await resolveBots(["KomodoBot", "RealAlice"], db);
    expect(cached.get("komodobot")).toBe(true);
    expect(cached.get("realalice")).toBe(false);

    const rows = db.prepare("SELECT username, is_bot FROM players ORDER BY username").all() as Array<{
      username: string;
      is_bot: number;
    }>;
    expect(rows).toEqual([
      { username: "komodobot", is_bot: 1 },
      { username: "realalice", is_bot: 0 },
    ]);
  });
});

describe("backfillBotFlags", () => {
  function seedGame(id: string, white: string, black: string): void {
    db.prepare(
      `INSERT INTO games (id, username, pgn, white, black, result, time_class, end_time)
       VALUES (?, 'alice', '1. e4 e5 1-0', ?, ?, '1-0', 'blitz', 1700000000)`,
    ).run(id, white, black);
  }

  it("sets vs_bot for resolvable opponents and leaves unresolved ones NULL", async () => {
    mockProfiles({ martinbot: "computer", bob: "basic" });
    seedGame("g_bot", "alice", "MartinBot"); // user is white, opp = bot
    seedGame("g_human", "Bob", "alice"); // user is black, opp = human
    seedGame("g_ghost", "alice", "ghost"); // opp 404 → unresolved

    const updated = await backfillBotFlags("alice", db);
    expect(updated).toBe(2);

    const rows = db.prepare("SELECT id, vs_bot FROM games ORDER BY id").all() as Array<{
      id: string;
      vs_bot: number | null;
    }>;
    expect(rows).toEqual([
      { id: "g_bot", vs_bot: 1 },
      { id: "g_ghost", vs_bot: null },
      { id: "g_human", vs_bot: 0 },
    ]);
  });

  it("is a no-op when no games are unresolved", async () => {
    expect(await backfillBotFlags("alice", db)).toBe(0);
  });
});
