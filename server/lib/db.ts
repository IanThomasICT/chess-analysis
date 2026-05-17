import { Database, type Statement } from "bun:sqlite";

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

// Meta table — created before migrations so the runner can read/write schema_version
db.run(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);

// ---------------------------------------------------------------------------
// Migration runner
// ---------------------------------------------------------------------------

export interface Migration {
  id: number;
  up: (db: Database) => void;
}

interface MetaRow {
  value: string;
}

function isMetaRow(row: unknown): row is MetaRow {
  if (typeof row !== "object" || row === null || !("value" in row)) {
    return false;
  }
  const candidate = row as { value: unknown };
  return typeof candidate.value === "string";
}

export const migrations: Migration[] = [
  {
    // Migration #1 — seed / sanity-check that the runner works
    id: 1,
    up: (_db: Database) => {
      /* no-op */
    },
  },
  {
    // Migration #2 — add ELO / opening columns to games
    id: 2,
    up: (database: Database) => {
      database.run("ALTER TABLE games ADD COLUMN white_elo INTEGER");
      database.run("ALTER TABLE games ADD COLUMN black_elo INTEGER");
      database.run("ALTER TABLE games ADD COLUMN user_elo INTEGER");
      database.run("ALTER TABLE games ADD COLUMN eco TEXT");
      database.run("ALTER TABLE games ADD COLUMN opening TEXT");
    },
  },
  {
    // Migration #3 — index on analysis.fen for transposition lookups
    id: 3,
    up: (database: Database) => {
      database.run(
        "CREATE INDEX IF NOT EXISTS idx_analysis_fen ON analysis(fen)",
      );
    },
  },
  {
    // Migration #4 — game_metrics cache table
    id: 4,
    up: (database: Database) => {
      database.run(`
        CREATE TABLE IF NOT EXISTS game_metrics (
          game_id TEXT PRIMARY KEY,
          accuracy_white REAL NOT NULL,
          accuracy_black REAL NOT NULL,
          blunders_white INTEGER NOT NULL,
          mistakes_white INTEGER NOT NULL,
          inaccuracies_white INTEGER NOT NULL,
          blunders_black INTEGER NOT NULL,
          mistakes_black INTEGER NOT NULL,
          inaccuracies_black INTEGER NOT NULL,
          acl_white REAL NOT NULL,
          acl_black REAL NOT NULL,
          computed_at INTEGER NOT NULL,
          FOREIGN KEY (game_id) REFERENCES games(id)
        )
      `);
    },
  },
  {
    // Migration #5 — annotations table (render-only for now; CRUD endpoints deferred)
    id: 5,
    up: (database: Database) => {
      database.run(`
        CREATE TABLE IF NOT EXISTS annotations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          t INTEGER NOT NULL,
          time_class TEXT NOT NULL,
          text TEXT NOT NULL
        )
      `);
      database.run(`CREATE INDEX IF NOT EXISTS idx_annotations_time_class ON annotations(time_class, t)`);
    },
  },
  {
    // Migration #6 — fen_key column + index on analysis for transposition lookups (P3.2)
    id: 6,
    up: (database: Database) => {
      database.run("ALTER TABLE analysis ADD COLUMN fen_key TEXT");
      database.run(
        "CREATE INDEX IF NOT EXISTS idx_analysis_fen_key ON analysis(fen_key)",
      );
    },
  },
];

export function runMigrations(database: Database): void {
  const stmt: Statement<unknown, [string]> = database.prepare(
    "SELECT value FROM meta WHERE key = ?",
  );
  const row: unknown = stmt.get("schema_version");
  const current: number = isMetaRow(row) ? parseInt(row.value, 10) : 0;

  const pending = migrations.filter((m) => m.id > current);
  if (pending.length === 0) {
    return;
  }

  database.transaction(() => {
    for (const migration of pending) {
      migration.up(database);
    }
    const newVersion = pending[pending.length - 1].id;
    database
      .prepare(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run("schema_version", String(newVersion));
  })();
}

runMigrations(db);
