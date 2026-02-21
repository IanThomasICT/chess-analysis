import { Database } from "bun:sqlite";

const SCHOLARS_MATE_PGN = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.01.15"]
[White "e2e_fakeplayer"]
[Black "opponent1"]
[Result "1-0"]
[TimeControl "180"]

1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0`;

const FOOLS_MATE_PGN = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.01.14"]
[White "opponent2"]
[Black "e2e_fakeplayer"]
[Result "0-1"]
[TimeControl "60"]

1. f3 e5 2. g4 Qh4# 0-1`;

const DRAW_PGN = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.01.13"]
[White "e2e_fakeplayer"]
[Black "opponent3"]
[Result "1/2-1/2"]
[TimeControl "600"]

1. d4 d5 2. c4 c6 3. Nf3 Nf6 1/2-1/2`;

/**
 * Seed the analysis.db with test games so e2e tests don't depend on Chess.com API.
 * Call this before running Playwright tests.
 */
export function seedTestDatabase(dbPath = "analysis.db"): void {
  const db = new Database(dbPath, { create: true });
  db.run("PRAGMA journal_mode = WAL");

  // Ensure tables exist (same schema as db.server.ts)
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

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO games (id, username, pgn, white, black, result, time_class, end_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  upsert.run(
    "e2e_game_1",
    "e2e_fakeplayer",
    SCHOLARS_MATE_PGN,
    "e2e_fakeplayer",
    "opponent1",
    "1-0",
    "blitz",
    1736899200
  );
  upsert.run(
    "e2e_game_2",
    "e2e_fakeplayer",
    FOOLS_MATE_PGN,
    "opponent2",
    "e2e_fakeplayer",
    "0-1",
    "bullet",
    1736812800
  );
  upsert.run(
    "e2e_game_3",
    "e2e_fakeplayer",
    DRAW_PGN,
    "e2e_fakeplayer",
    "opponent3",
    "1/2-1/2",
    "rapid",
    1736726400
  );

  db.close();
}

/**
 * Remove seeded test data from the database.
 */
export function cleanTestDatabase(dbPath = "analysis.db"): void {
  try {
    const db = new Database(dbPath, { create: false });
    db.run(`DELETE FROM analysis WHERE game_id LIKE 'e2e_game_%'`);
    db.run(`DELETE FROM games WHERE id LIKE 'e2e_game_%'`);
    db.close();
  } catch {
    // DB may not exist — nothing to clean
  }
}
