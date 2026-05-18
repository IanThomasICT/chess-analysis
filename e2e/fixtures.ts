import { Database } from "bun:sqlite";
import { Chess } from "chess.js";

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

interface GameSeed {
  id: string;
  pgn: string;
  white: string;
  black: string;
  result: string;
  time_class: string;
  end_time: number;
}

const GAMES: readonly GameSeed[] = [
  {
    id: "e2e_game_1",
    pgn: SCHOLARS_MATE_PGN,
    white: "e2e_fakeplayer",
    black: "opponent1",
    result: "1-0",
    time_class: "blitz",
    end_time: 1736899200,
  },
  {
    id: "e2e_game_2",
    pgn: FOOLS_MATE_PGN,
    white: "opponent2",
    black: "e2e_fakeplayer",
    result: "0-1",
    time_class: "bullet",
    end_time: 1736812800,
  },
  {
    id: "e2e_game_3",
    pgn: DRAW_PGN,
    white: "e2e_fakeplayer",
    black: "opponent3",
    result: "1/2-1/2",
    time_class: "rapid",
    end_time: 1736726400,
  },
];

function fenKey(fen: string): string {
  return fen.split(" ").slice(0, 4).join(" ");
}

/**
 * Build synthetic analysis rows for a PGN — one rank-1 row per position.
 * Marks games as already-analyzed so the e2e auto-start SSE doesn't fire
 * (which would otherwise hammer Stockfish for every test page navigation).
 *
 * cp values are dummy but plausible: slight oscillation so the eval graph
 * isn't flat, and the final position uses a mate score for mate-in-1 PGNs.
 */
function syntheticAnalysisRows(pgn: string): Array<{
  move_index: number;
  fen: string;
  fen_key: string;
  move_san: string | null;
  score_cp: number | null;
  score_mate: number | null;
  best_move: string;
}> {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const history = chess.history({ verbose: true });

  const replay = new Chess();
  const fens: string[] = [replay.fen()];
  const sans: string[] = [];
  for (const m of history) {
    replay.move(m.san);
    fens.push(replay.fen());
    sans.push(m.san);
  }

  return fens.map((fen, i) => {
    const isFinal = i === fens.length - 1;
    let scoreCp: number | null = 20 - i * 5;
    let scoreMate: number | null = null;
    if (isFinal) {
      scoreCp = null;
      scoreMate = i % 2 === 0 ? -1 : 1;
    }
    return {
      move_index: i,
      fen,
      fen_key: fenKey(fen),
      move_san: i > 0 ? sans[i - 1] : null,
      score_cp: scoreCp,
      score_mate: scoreMate,
      best_move: "e2e4",
    };
  });
}

/**
 * Seed the analysis.db with test games so e2e tests don't depend on Chess.com API.
 * Call this before running Playwright tests.
 */
export function seedTestDatabase(dbPath = "analysis.db"): void {
  const db = new Database(dbPath, { create: true });
  db.run("PRAGMA journal_mode = WAL");

  // Schema is created/migrated by the server on startup — these CREATE IF NOT
  // EXISTS calls are a fallback when the seed script runs before the server.
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
  db.run(`CREATE INDEX IF NOT EXISTS idx_games_username ON games(username)`);
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_analysis_game_id ON analysis(game_id)`,
  );
  db.run(`CREATE INDEX IF NOT EXISTS idx_analysis_fen ON analysis(fen)`);
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_analysis_fen_key ON analysis(fen_key)`,
  );

  const upsertGame = db.prepare(`
    INSERT OR REPLACE INTO games (id, username, pgn, white, black, result, time_class, end_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const upsertAnalysis = db.prepare(`
    INSERT OR REPLACE INTO analysis
      (game_id, move_index, multipv_rank, fen, fen_key, move_san, score_cp, score_mate, best_move, pv, depth)
    VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, NULL, 20)
  `);

  for (const g of GAMES) {
    upsertGame.run(
      g.id,
      "e2e_fakeplayer",
      g.pgn,
      g.white,
      g.black,
      g.result,
      g.time_class,
      g.end_time,
    );
    for (const row of syntheticAnalysisRows(g.pgn)) {
      upsertAnalysis.run(
        g.id,
        row.move_index,
        row.fen,
        row.fen_key,
        row.move_san,
        row.score_cp,
        row.score_mate,
        row.best_move,
      );
    }
  }

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
