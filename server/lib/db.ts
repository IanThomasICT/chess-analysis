import { Database, type Statement } from "bun:sqlite";
import { pgnFinalClocks, pgnHeaders } from "./pgn";

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
  {
    // Migration #7 — rebuild analysis with composite PK (game_id, move_index, multipv_rank)
    // and add pv column for principal variation (MultiPV-ready, P4.1)
    id: 7,
    up: (database: Database) => {
      database.run("ALTER TABLE analysis RENAME TO analysis_old");
      database.run(`
        CREATE TABLE analysis (
          game_id TEXT NOT NULL,
          move_index INTEGER NOT NULL,
          multipv_rank INTEGER NOT NULL DEFAULT 1,
          fen TEXT NOT NULL,
          fen_key TEXT,
          move_san TEXT,
          score_cp INTEGER,
          score_mate INTEGER,
          best_move TEXT,
          pv TEXT,
          depth INTEGER,
          PRIMARY KEY (game_id, move_index, multipv_rank)
        )
      `);
      database.run(`
        INSERT INTO analysis (game_id, move_index, multipv_rank, fen, fen_key, move_san, score_cp, score_mate, best_move, pv, depth)
        SELECT game_id, move_index, 1, fen, fen_key, move_san, score_cp, score_mate, best_move, NULL, depth FROM analysis_old
      `);
      database.run("DROP TABLE analysis_old");
      database.run("CREATE INDEX IF NOT EXISTS idx_analysis_game_id ON analysis(game_id)");
      database.run("CREATE INDEX IF NOT EXISTS idx_analysis_fen ON analysis(fen)");
      database.run("CREATE INDEX IF NOT EXISTS idx_analysis_fen_key ON analysis(fen_key)");
    },
  },
  {
    // Migration #8 — blunder_tags table for per-position blunder classification (P5.2)
    id: 8,
    up: (database: Database) => {
      database.run(`
        CREATE TABLE IF NOT EXISTS blunder_tags (
          game_id TEXT NOT NULL,
          move_index INTEGER NOT NULL,
          tag TEXT NOT NULL,
          PRIMARY KEY (game_id, move_index, tag)
        )
      `);
      database.run("CREATE INDEX IF NOT EXISTS idx_blunder_tags_tag ON blunder_tags(tag)");
    },
  },
  {
    // Migration #9 — drill_attempts table for spaced-repetition drilling (P6.2)
    id: 9,
    up: (database: Database) => {
      database.run(`
        CREATE TABLE IF NOT EXISTS drill_attempts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL,
          game_id TEXT NOT NULL,
          move_index INTEGER NOT NULL,
          fen TEXT NOT NULL,
          best_move TEXT NOT NULL,
          attempted_move TEXT,
          correct INTEGER,
          attempted_at INTEGER,
          stability REAL,
          difficulty REAL,
          due INTEGER,
          state INTEGER,
          UNIQUE (username, game_id, move_index)
        )
      `);
      database.run("CREATE INDEX IF NOT EXISTS idx_drill_due ON drill_attempts(username, due)");
    },
  },
  {
    // Migration #10 — final-clock + termination columns on games.
    // Backfill from existing PGNs in the same transaction so the new columns
    // are populated immediately, not only for new ingests.
    id: 10,
    up: (database: Database) => {
      database.run("ALTER TABLE games ADD COLUMN white_clock_final_s REAL");
      database.run("ALTER TABLE games ADD COLUMN black_clock_final_s REAL");
      database.run("ALTER TABLE games ADD COLUMN termination TEXT");

      const rows = database
        .prepare("SELECT id, pgn FROM games")
        .all() as Array<{ id: string; pgn: string }>;
      const update = database.prepare(
        "UPDATE games SET white_clock_final_s = ?, black_clock_final_s = ?, termination = ? WHERE id = ?",
      );
      for (const row of rows) {
        try {
          const clocks = pgnFinalClocks(row.pgn);
          const termination = pgnHeaders(row.pgn).Termination ?? null;
          update.run(clocks.white, clocks.black, termination, row.id);
        } catch {
          // skip games with unparseable PGN
        }
      }
    },
  },
  {
    // Migration #11 — standard-chess flag on games + versioned per-game extended
    // metrics cache (L2). `is_standard` is nullable (NULL = unprocessed) because
    // SQLite cannot ADD a NOT NULL column without a constant default; the
    // backfillIsStandard pass fills it on startup.
    id: 11,
    up: (database: Database) => {
      database.run("ALTER TABLE games ADD COLUMN is_standard INTEGER");
      database.run(`
        CREATE TABLE IF NOT EXISTS game_metrics_ext (
          game_id TEXT PRIMARY KEY,
          metrics_version INTEGER NOT NULL,
          analysis_sig TEXT NOT NULL,
          multipv_max INTEGER NOT NULL,
          accuracy_opening REAL, accuracy_middlegame REAL, accuracy_endgame REAL,
          acl_opening REAL, acl_middlegame REAL, acl_endgame REAL,
          middlegame_start_ply INTEGER, endgame_start_ply INTEGER,
          time_opening_s REAL, time_middlegame_s REAL, time_endgame_s REAL, avg_move_time_s REAL,
          accuracy_critical REAL, accuracy_quiet REAL, critical_positions INTEGER,
          time_alloc_efficiency REAL,
          max_blunder_run INTEGER, recovery_accuracy REAL,
          time_trouble_moves INTEGER, time_trouble_errors INTEGER,
          peak_eval_wp REAL, trough_eval_wp REAL,
          out_of_book_ply INTEGER, out_of_book_eco_fallback INTEGER, post_book_accuracy REAL,
          eval_opening_end_wp REAL,
          user_moves INTEGER, clocks_available INTEGER, engine_depth_min INTEGER,
          computed_at INTEGER,
          FOREIGN KEY (game_id) REFERENCES games(id)
        )
      `);
      database.run(
        "CREATE INDEX IF NOT EXISTS idx_games_username_time_class ON games(username, time_class, end_time)",
      );
      database.run(
        "CREATE INDEX IF NOT EXISTS idx_gme_version ON game_metrics_ext(metrics_version)",
      );
    },
  },
  {
    // Migration #12 — version stamp on game_metrics + clean accuracy cutover.
    // The accuracy aggregation changed from a bucket model to the Lichess
    // weighted+harmonic mean (D21/D26), so every cached row is invalidated.
    // Rows recompute lazily on next access (computeAndCacheMetrics) / batch run.
    id: 12,
    up: (database: Database) => {
      database.run("ALTER TABLE game_metrics ADD COLUMN metrics_version INTEGER");
      database.run("DELETE FROM game_metrics");
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
