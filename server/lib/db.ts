import { Database } from "bun:sqlite";

export const db = new Database("analysis.db", { create: true });

// Enable WAL mode for better concurrent read/write performance
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
db.run(`CREATE INDEX IF NOT EXISTS idx_analysis_game_id ON analysis(game_id)`);
