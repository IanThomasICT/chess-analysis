import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { unlinkSync } from "node:fs";

const TEST_DB_PATH = "test_analysis.db";

/**
 * Create a fresh test database with the same schema as the real app.
 * This avoids importing db.server.ts which would create/use the production DB.
 */
function createTestDb(): Database {
  // Remove any leftover test DB
  try {
    unlinkSync(TEST_DB_PATH);
  } catch {
    // file doesn't exist — fine
  }

  const db = new Database(TEST_DB_PATH, { create: true });
  db.run("PRAGMA journal_mode = WAL");

  db.run(`
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      pgn TEXT NOT NULL,
      white TEXT,
      black TEXT,
      result TEXT,
      time_class TEXT,
      end_time INTEGER,
      created_at INTEGER DEFAULT (unixepoch())
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS analysis (
      game_id TEXT NOT NULL,
      move_index INTEGER NOT NULL,
      fen TEXT NOT NULL,
      move_san TEXT,
      score_cp INTEGER,
      score_mate INTEGER,
      best_move TEXT,
      depth INTEGER,
      PRIMARY KEY (game_id, move_index),
      FOREIGN KEY (game_id) REFERENCES games(id)
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_games_username ON games(username)`);
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_analysis_game_id ON analysis(game_id)`
  );

  return db;
}

// ---------- typed result interfaces (match the real app) ----------

interface GameRow {
  id: string;
  username: string;
  pgn: string;
  white: string | null;
  black: string | null;
  result: string | null;
  time_class: string | null;
  end_time: number | null;
  created_at: number | null;
}

interface AnalysisRow {
  game_id: string;
  move_index: number;
  fen: string;
  move_san: string | null;
  score_cp: number | null;
  score_mate: number | null;
  best_move: string | null;
  depth: number | null;
}

interface CountResult {
  count: number;
}

// =====================================================================
// Tests
// =====================================================================

let db: Database;

beforeEach(() => {
  db = createTestDb();
});

afterAll(() => {
  try {
    db.close();
    unlinkSync(TEST_DB_PATH);
  } catch {
    // ignore
  }
});

describe("database schema", () => {
  it("creates the games table with correct columns", () => {
    const info = db.prepare("PRAGMA table_info(games)").all() as Array<{
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }>;

    const columns = info.map((col) => col.name);
    expect(columns).toContain("id");
    expect(columns).toContain("username");
    expect(columns).toContain("pgn");
    expect(columns).toContain("white");
    expect(columns).toContain("black");
    expect(columns).toContain("result");
    expect(columns).toContain("time_class");
    expect(columns).toContain("end_time");
    expect(columns).toContain("created_at");
  });

  it("creates the analysis table with correct columns", () => {
    const info = db.prepare("PRAGMA table_info(analysis)").all() as Array<{
      name: string;
      type: string;
    }>;

    const columns = info.map((col) => col.name);
    expect(columns).toContain("game_id");
    expect(columns).toContain("move_index");
    expect(columns).toContain("fen");
    expect(columns).toContain("move_san");
    expect(columns).toContain("score_cp");
    expect(columns).toContain("score_mate");
    expect(columns).toContain("best_move");
    expect(columns).toContain("depth");
  });

  it("id is the primary key of the games table", () => {
    const info = db.prepare("PRAGMA table_info(games)").all() as Array<{
      name: string;
      pk: number;
    }>;
    const pk = info.find((col) => col.pk === 1);
    expect(pk).toBeDefined();
    expect(pk?.name).toBe("id");
  });

  it("analysis has composite primary key on (game_id, move_index)", () => {
    const info = db.prepare("PRAGMA table_info(analysis)").all() as Array<{
      name: string;
      pk: number;
    }>;
    const pks = info.filter((col) => col.pk > 0).sort((a, b) => a.pk - b.pk);
    expect(pks).toHaveLength(2);
    expect(pks[0].name).toBe("game_id");
    expect(pks[1].name).toBe("move_index");
  });

  it("username column is NOT NULL in games table", () => {
    const info = db.prepare("PRAGMA table_info(games)").all() as Array<{
      name: string;
      notnull: number;
    }>;
    const usernameCol = info.find((col) => col.name === "username");
    expect(usernameCol?.notnull).toBe(1);
  });

  it("WAL journal mode is enabled", () => {
    const result = db.prepare("PRAGMA journal_mode").get() as {
      journal_mode: string;
    };
    expect(result.journal_mode).toBe("wal");
  });

  it("has idx_games_username index", () => {
    const indices = db
      .prepare("PRAGMA index_list(games)")
      .all() as Array<{ name: string }>;
    const names = indices.map((idx) => idx.name);
    expect(names).toContain("idx_games_username");
  });

  it("has idx_analysis_game_id index", () => {
    const indices = db
      .prepare("PRAGMA index_list(analysis)")
      .all() as Array<{ name: string }>;
    const names = indices.map((idx) => idx.name);
    expect(names).toContain("idx_analysis_game_id");
  });
});

describe("games table CRUD", () => {
  const sampleGame = {
    id: "123456",
    username: "testuser",
    pgn: "1. e4 e5 2. Nf3 Nc6 1-0",
    white: "testuser",
    black: "opponent",
    result: "1-0",
    time_class: "blitz",
    end_time: 1700000000,
  };

  it("inserts a game successfully", () => {
    db.prepare(
      `INSERT INTO games (id, username, pgn, white, black, result, time_class, end_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      sampleGame.id,
      sampleGame.username,
      sampleGame.pgn,
      sampleGame.white,
      sampleGame.black,
      sampleGame.result,
      sampleGame.time_class,
      sampleGame.end_time
    );

    const row = db
      .prepare("SELECT * FROM games WHERE id = ?")
      .get(sampleGame.id) as GameRow | null;
    expect(row).not.toBeNull();
    expect(row?.username).toBe("testuser");
    expect(row?.result).toBe("1-0");
  });

  it("INSERT OR REPLACE upserts correctly", () => {
    db.prepare(
      `INSERT INTO games (id, username, pgn, white, black, result, time_class, end_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("g1", "user1", "pgn1", "w", "b", "1-0", "rapid", 100);

    db.prepare(
      `INSERT OR REPLACE INTO games (id, username, pgn, white, black, result, time_class, end_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("g1", "user1", "pgn1_updated", "w", "b", "0-1", "rapid", 200);

    const row = db
      .prepare("SELECT * FROM games WHERE id = ?")
      .get("g1") as GameRow | null;
    expect(row?.pgn).toBe("pgn1_updated");
    expect(row?.result).toBe("0-1");
    expect(row?.end_time).toBe(200);
  });

  it("queries games by username with correct ordering", () => {
    const insert = db.prepare(
      `INSERT INTO games (id, username, pgn, white, black, result, time_class, end_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insert.run("g1", "alice", "pgn1", "alice", "bob", "1-0", "blitz", 100);
    insert.run("g2", "alice", "pgn2", "alice", "carol", "0-1", "rapid", 300);
    insert.run("g3", "alice", "pgn3", "dan", "alice", "1/2-1/2", "bullet", 200);
    insert.run("g4", "bob", "pgn4", "bob", "eve", "1-0", "blitz", 400);

    const aliceGames = db
      .prepare(
        `SELECT id FROM games WHERE username = ? ORDER BY end_time DESC`
      )
      .all("alice") as Array<{ id: string }>;

    expect(aliceGames).toHaveLength(3);
    // Most recent first
    expect(aliceGames[0].id).toBe("g2");
    expect(aliceGames[1].id).toBe("g3");
    expect(aliceGames[2].id).toBe("g1");
  });

  it("created_at defaults to current unix epoch", () => {
    db.prepare(
      `INSERT INTO games (id, username, pgn) VALUES (?, ?, ?)`
    ).run("g_time", "user", "pgn");

    const row = db
      .prepare("SELECT created_at FROM games WHERE id = ?")
      .get("g_time") as { created_at: number | null };

    expect(row.created_at).not.toBeNull();
    // Should be within a few seconds of now
    const now = Math.floor(Date.now() / 1000);
    expect(Math.abs((row.created_at ?? 0) - now)).toBeLessThan(5);
  });
});

describe("analysis table CRUD", () => {
  it("inserts analysis rows and queries by game_id", () => {
    // First insert a game (FK reference)
    db.prepare(
      `INSERT INTO games (id, username, pgn) VALUES (?, ?, ?)`
    ).run("game1", "user", "1. e4 e5");

    const insert = db.prepare(
      `INSERT INTO analysis (game_id, move_index, fen, move_san, score_cp, score_mate, best_move, depth)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    insert.run("game1", 0, "fen0", null, 20, null, "e2e4", 20);
    insert.run("game1", 1, "fen1", "e4", 15, null, "e7e5", 20);
    insert.run("game1", 2, "fen2", "e5", -5, null, "g1f3", 20);

    const rows = db
      .prepare(
        `SELECT * FROM analysis WHERE game_id = ? ORDER BY move_index`
      )
      .all("game1") as AnalysisRow[];

    expect(rows).toHaveLength(3);
    expect(rows[0].move_index).toBe(0);
    expect(rows[0].move_san).toBeNull();
    expect(rows[1].score_cp).toBe(15);
    expect(rows[2].fen).toBe("fen2");
  });

  it("enforces composite primary key (no duplicates)", () => {
    db.prepare(`INSERT INTO games (id, username, pgn) VALUES (?, ?, ?)`).run(
      "g_pk",
      "user",
      "pgn"
    );
    db.prepare(
      `INSERT INTO analysis (game_id, move_index, fen, score_cp, best_move, depth)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run("g_pk", 0, "fen", 20, "e2e4", 20);

    expect(() =>
      db
        .prepare(
          `INSERT INTO analysis (game_id, move_index, fen, score_cp, best_move, depth)
         VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run("g_pk", 0, "fen2", 30, "d2d4", 20)
    ).toThrow();
  });

  it("INSERT OR REPLACE updates existing analysis rows", () => {
    db.prepare(`INSERT INTO games (id, username, pgn) VALUES (?, ?, ?)`).run(
      "g_upsert",
      "user",
      "pgn"
    );
    db.prepare(
      `INSERT INTO analysis (game_id, move_index, fen, score_cp, best_move, depth)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run("g_upsert", 0, "fen", 20, "e2e4", 15);

    db.prepare(
      `INSERT OR REPLACE INTO analysis (game_id, move_index, fen, score_cp, best_move, depth)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run("g_upsert", 0, "fen", 25, "d2d4", 20);

    const row = db
      .prepare(
        `SELECT * FROM analysis WHERE game_id = ? AND move_index = ?`
      )
      .get("g_upsert", 0) as AnalysisRow | null;

    expect(row?.score_cp).toBe(25);
    expect(row?.depth).toBe(20);
    expect(row?.best_move).toBe("d2d4");
  });

  it("COUNT(*) accurately reports analyzed positions", () => {
    db.prepare(`INSERT INTO games (id, username, pgn) VALUES (?, ?, ?)`).run(
      "g_count",
      "user",
      "pgn"
    );

    const insert = db.prepare(
      `INSERT INTO analysis (game_id, move_index, fen, score_cp, best_move, depth)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    insert.run("g_count", 0, "f0", 10, "e2e4", 20);
    insert.run("g_count", 1, "f1", 15, "e7e5", 20);

    const result = db
      .prepare(
        `SELECT COUNT(*) as count FROM analysis WHERE game_id = ? AND depth >= ?`
      )
      .get("g_count", 20) as CountResult;

    expect(result.count).toBe(2);
  });

  it("COUNT(*) with depth filter excludes shallow analysis", () => {
    db.prepare(`INSERT INTO games (id, username, pgn) VALUES (?, ?, ?)`).run(
      "g_depth",
      "user",
      "pgn"
    );

    db.prepare(
      `INSERT INTO analysis (game_id, move_index, fen, score_cp, best_move, depth)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run("g_depth", 0, "f0", 10, "e2e4", 10); // shallow

    const result = db
      .prepare(
        `SELECT COUNT(*) as count FROM analysis WHERE game_id = ? AND depth >= ?`
      )
      .get("g_depth", 20) as CountResult;

    expect(result.count).toBe(0); // excluded because depth < 20
  });

  it("supports null score_cp when score_mate is set", () => {
    db.prepare(`INSERT INTO games (id, username, pgn) VALUES (?, ?, ?)`).run(
      "g_mate",
      "user",
      "pgn"
    );

    db.prepare(
      `INSERT INTO analysis (game_id, move_index, fen, score_cp, score_mate, best_move, depth)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("g_mate", 0, "fen", null, 3, "e2e4", 20);

    const row = db
      .prepare(
        `SELECT * FROM analysis WHERE game_id = ? AND move_index = ?`
      )
      .get("g_mate", 0) as AnalysisRow | null;

    expect(row?.score_cp).toBeNull();
    expect(row?.score_mate).toBe(3);
  });
});
