import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { migrations, type Migration } from "../server/lib/db";
import {
  computeBySide,
  computeEloTrend,
  computeByTimeOfDay,
  computeWinRateSlice,
  computeAccuracyTrend,
  computeMotifStats,
  computeDrillProgress,
  computeConsistency,
  computeSessionFatigue,
  computeVsOpponent,
  computeAclTrend,
  computeLeakClosure,
  computeTpr,
  dpFromScore,
  computeRepertoire,
  computeCounterplay,
  computeEndgameConversion,
} from "../server/routes/stats";

// ---------------------------------------------------------------------------
// Schema helpers — apply migrations 1-4 to an in-memory DB
// ---------------------------------------------------------------------------

function makeDb(): Database {
  const database = new Database(":memory:");

  database.run(`
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

  database.run(`
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

  database.run(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);

  // Apply all migrations
  const migrationsToApply = migrations.filter(
    (m: Migration) => m.id >= 1,
  );
  for (const migration of migrationsToApply) {
    migration.up(database);
  }

  return database;
}

function insertGame(
  database: Database,
  id: string,
  username: string,
  white: string,
  black: string,
  result: string,
): void {
  database
    .prepare(
      `INSERT INTO games (id, username, pgn, white, black, result)
       VALUES (?, ?, '', ?, ?, ?)`,
    )
    .run(id, username, white, black, result);
}

function insertGameWithTime(
  database: Database,
  id: string,
  username: string,
  white: string,
  black: string,
  result: string,
  endTime: number,
): void {
  database
    .prepare(
      `INSERT INTO games (id, username, pgn, white, black, result, end_time)
       VALUES (?, ?, '', ?, ?, ?, ?)`,
    )
    .run(id, username, white, black, result, endTime);
}

function insertGameWithElo(
  database: Database,
  id: string,
  username: string,
  timeClass: string,
  endTime: number,
  userElo: number | null,
): void {
  database
    .prepare(
      `INSERT INTO games (id, username, pgn, white, black, result, time_class, end_time, user_elo)
       VALUES (?, ?, '', '', '', '', ?, ?, ?)`,
    )
    .run(id, username, timeClass, endTime, userElo);
}

function insertMetrics(
  database: Database,
  gameId: string,
  accuracyWhite: number,
  accuracyBlack: number,
  blundersWhite: number,
  blundersBlack: number,
): void {
  database
    .prepare(
      `INSERT INTO game_metrics
         (game_id, accuracy_white, accuracy_black,
          blunders_white, mistakes_white, inaccuracies_white,
          blunders_black, mistakes_black, inaccuracies_black,
          acl_white, acl_black, computed_at)
       VALUES (?, ?, ?, ?, 0, 0, ?, 0, 0, 0, 0, 0)`,
    )
    .run(gameId, accuracyWhite, accuracyBlack, blundersWhite, blundersBlack);
}

function insertFullGame(
  database: Database,
  id: string,
  username: string,
  white: string,
  black: string,
  result: string,
  opts: {
    timeClass?: string;
    endTime?: number;
    whiteElo?: number | null;
    blackElo?: number | null;
    userElo?: number | null;
    eco?: string | null;
    opening?: string | null;
  } = {},
): void {
  database
    .prepare(
      `INSERT INTO games
         (id, username, pgn, white, black, result, time_class, end_time,
          white_elo, black_elo, user_elo, eco, opening)
       VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      username,
      white,
      black,
      result,
      opts.timeClass ?? null,
      opts.endTime ?? null,
      opts.whiteElo ?? null,
      opts.blackElo ?? null,
      opts.userElo ?? null,
      opts.eco ?? null,
      opts.opening ?? null,
    );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let db: Database;

beforeEach(() => {
  db = makeDb();
});

describe("computeBySide", () => {
  test("counts wins/draws/losses correctly for white and black", () => {
    // 3 wins as white, 1 loss as white
    insertGame(db, "g1", "alice", "Alice", "Bob", "1-0"); // alice white win
    insertGame(db, "g2", "alice", "Alice", "Bob", "1-0"); // alice white win
    insertGame(db, "g3", "alice", "Alice", "Bob", "1-0"); // alice white win
    insertGame(db, "g4", "alice", "Alice", "Bob", "0-1"); // alice white loss
    // 2 wins as black
    insertGame(db, "g5", "alice", "Bob", "Alice", "0-1"); // alice black win
    insertGame(db, "g6", "alice", "Bob", "Alice", "0-1"); // alice black win

    const result = computeBySide(db, "alice");

    expect(result.white.games).toBe(4);
    expect(result.white.wins).toBe(3);
    expect(result.white.losses).toBe(1);
    expect(result.white.draws).toBe(0);

    expect(result.black.games).toBe(2);
    expect(result.black.wins).toBe(2);
    expect(result.black.losses).toBe(0);
    expect(result.black.draws).toBe(0);
  });

  test("username comparison is case-insensitive", () => {
    insertGame(db, "g1", "Alice", "Alice", "Bob", "1-0");
    insertGame(db, "g2", "alice", "Alice", "Bob", "1-0");
    insertGame(db, "g3", "ALICE", "Alice", "Bob", "0-1");

    // Query with different case — should match all three rows
    const result = computeBySide(db, "ALICE");

    expect(result.white.games).toBe(3);
    expect(result.white.wins).toBe(2);
    expect(result.white.losses).toBe(1);
  });

  test("user with 0 games returns zero-valued stats on both sides", () => {
    const result = computeBySide(db, "nobody");

    expect(result.white.games).toBe(0);
    expect(result.white.wins).toBe(0);
    expect(result.white.draws).toBe(0);
    expect(result.white.losses).toBe(0);
    expect(result.white.win_rate).toBe(0);
    expect(result.white.avg_accuracy).toBeNull();
    expect(result.white.blunders_per_game).toBeNull();

    expect(result.black.games).toBe(0);
    expect(result.black.wins).toBe(0);
    expect(result.black.avg_accuracy).toBeNull();
    expect(result.black.blunders_per_game).toBeNull();
  });

  test("avg_accuracy is null when no game_metrics rows exist", () => {
    insertGame(db, "g1", "alice", "Alice", "Bob", "1-0");
    insertGame(db, "g2", "alice", "Bob", "Alice", "0-1");

    const result = computeBySide(db, "alice");

    expect(result.white.avg_accuracy).toBeNull();
    expect(result.black.avg_accuracy).toBeNull();
    expect(result.white.blunders_per_game).toBeNull();
    expect(result.black.blunders_per_game).toBeNull();
  });

  test("avg_accuracy is the average only over games that have metrics", () => {
    insertGame(db, "g1", "alice", "Alice", "Bob", "1-0");
    insertGame(db, "g2", "alice", "Alice", "Bob", "1-0");
    insertGame(db, "g3", "alice", "Alice", "Bob", "1-0"); // no metrics

    insertMetrics(db, "g1", 80.0, 70.0, 1, 2);
    insertMetrics(db, "g2", 90.0, 60.0, 3, 1);
    // g3 intentionally has no metrics row

    const result = computeBySide(db, "alice");

    // AVG of 80 and 90 = 85; g3 contributes NULL which SQLite AVG ignores
    expect(result.white.avg_accuracy).toBeCloseTo(85.0, 5);
    expect(result.white.blunders_per_game).toBeCloseTo(2.0, 5); // (1+3)/2
  });

  test("win_rate computed correctly: 3 wins out of 5 games = 0.6", () => {
    insertGame(db, "g1", "alice", "Alice", "Bob", "1-0");
    insertGame(db, "g2", "alice", "Alice", "Bob", "1-0");
    insertGame(db, "g3", "alice", "Alice", "Bob", "1-0");
    insertGame(db, "g4", "alice", "Alice", "Bob", "0-1");
    insertGame(db, "g5", "alice", "Alice", "Bob", "1/2-1/2");

    const result = computeBySide(db, "alice");

    expect(result.white.games).toBe(5);
    expect(result.white.wins).toBe(3);
    expect(result.white.draws).toBe(1);
    expect(result.white.losses).toBe(1);
    expect(result.white.win_rate).toBeCloseTo(0.6, 10);
  });
});

describe("computeEloTrend", () => {
  test("returns 3 blitz points in ascending time order with correct elos", () => {
    insertGameWithElo(db, "g1", "alice", "blitz", 1000, 1500);
    insertGameWithElo(db, "g2", "alice", "blitz", 2000, 1520);
    insertGameWithElo(db, "g3", "alice", "blitz", 3000, 1510);

    const result = computeEloTrend(db, "alice", "blitz");

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ t: 1000, elo: 1500 });
    expect(result[1]).toEqual({ t: 2000, elo: 1520 });
    expect(result[2]).toEqual({ t: 3000, elo: 1510 });
  });

  test("filters by time_class — bullet games excluded when querying blitz", () => {
    insertGameWithElo(db, "g1", "alice", "blitz", 1000, 1500);
    insertGameWithElo(db, "g2", "alice", "blitz", 2000, 1520);
    insertGameWithElo(db, "g3", "alice", "bullet", 1500, 1200);

    const result = computeEloTrend(db, "alice", "blitz");

    expect(result).toHaveLength(2);
    expect(result.every((p) => p.elo >= 1500)).toBe(true);
  });

  test("rows with user_elo IS NULL are excluded", () => {
    insertGameWithElo(db, "g1", "alice", "blitz", 1000, 1500);
    insertGameWithElo(db, "g2", "alice", "blitz", 2000, null);
    insertGameWithElo(db, "g3", "alice", "blitz", 3000, 1510);

    const result = computeEloTrend(db, "alice", "blitz");

    expect(result).toHaveLength(2);
    expect(result[0].t).toBe(1000);
    expect(result[1].t).toBe(3000);
  });

  test("unknown user returns empty array", () => {
    const result = computeEloTrend(db, "nobody", "blitz");
    expect(result).toEqual([]);
  });

  test("username matching is case-insensitive", () => {
    insertGameWithElo(db, "g1", "Alice", "blitz", 1000, 1500);
    insertGameWithElo(db, "g2", "ALICE", "blitz", 2000, 1520);
    insertGameWithElo(db, "g3", "alice", "blitz", 3000, 1510);

    const result = computeEloTrend(db, "aLiCe", "blitz");

    expect(result).toHaveLength(3);
  });
});

describe("computeByTimeOfDay", () => {
  // Ensure USER_TZ is set to LA for all tests so timezone math is predictable.
  const TEST_TZ = "America/Los_Angeles";

  test("empty user returns empty array", () => {
    process.env.USER_TZ = TEST_TZ;
    const result = computeByTimeOfDay(db, "nobody");
    expect(result).toEqual([]);
  });

  test("single win game creates one bucket with games=1 wins=1", () => {
    process.env.USER_TZ = TEST_TZ;
    // Jan 8 2024 18:00 UTC = Jan 8 2024 10:00 PST (UTC-8, Monday)
    const endTime = Date.UTC(2024, 0, 8, 18, 0, 0) / 1000;
    insertGameWithTime(db, "g1", "alice", "Alice", "Bob", "1-0", endTime);

    const result = computeByTimeOfDay(db, "alice");

    expect(result).toHaveLength(1);
    expect(result[0].games).toBe(1);
    expect(result[0].wins).toBe(1);
    expect(result[0].win_rate).toBe(1);
    // Monday = day 1, 10:00 PST = hour 10
    expect(result[0].day).toBe(1);
    expect(result[0].hour).toBe(10);
  });

  test("timezone offset applied: UTC 18:00 → PST 10:00 on Monday", () => {
    process.env.USER_TZ = TEST_TZ;
    // Jan 8 2024 18:00:00 UTC → Jan 8 2024 10:00:00 PST (UTC-8, Monday)
    const endTime = Date.UTC(2024, 0, 8, 18, 0, 0) / 1000;
    insertGameWithTime(db, "g1", "alice", "Alice", "Bob", "1-0", endTime);

    const result = computeByTimeOfDay(db, "alice");

    expect(result[0].day).toBe(1);  // Monday
    expect(result[0].hour).toBe(10); // 10:00 PST
  });

  test("two games in same bucket accumulate correctly", () => {
    process.env.USER_TZ = TEST_TZ;
    // Both land at the same PST hour (Jan 8 2024 10:xx PST)
    const endTime1 = Date.UTC(2024, 0, 8, 18, 0, 0) / 1000;
    const endTime2 = Date.UTC(2024, 0, 8, 18, 30, 0) / 1000;
    insertGameWithTime(db, "g1", "alice", "Alice", "Bob", "1-0", endTime1); // win
    insertGameWithTime(db, "g2", "alice", "Alice", "Bob", "0-1", endTime2); // loss

    const result = computeByTimeOfDay(db, "alice");

    expect(result).toHaveLength(1);
    expect(result[0].games).toBe(2);
    expect(result[0].wins).toBe(1);
    expect(result[0].win_rate).toBeCloseTo(0.5, 10);
  });

  test("case-insensitive username matching", () => {
    process.env.USER_TZ = TEST_TZ;
    const endTime = Date.UTC(2024, 0, 8, 18, 0, 0) / 1000;
    insertGameWithTime(db, "g1", "Alice", "Alice", "Bob", "1-0", endTime);
    insertGameWithTime(db, "g2", "ALICE", "Alice", "Bob", "1-0", endTime + 3600);

    const result = computeByTimeOfDay(db, "alice");

    const total = result.reduce((sum, b) => sum + b.games, 0);
    expect(total).toBe(2);
  });

  test("games with null end_time are excluded", () => {
    process.env.USER_TZ = TEST_TZ;
    // Insert a game with no end_time (uses insertGame which omits end_time)
    insertGame(db, "g1", "alice", "Alice", "Bob", "1-0");

    const result = computeByTimeOfDay(db, "alice");

    expect(result).toEqual([]);
  });

  test("multiple different buckets produce separate entries", () => {
    process.env.USER_TZ = TEST_TZ;
    // Monday 10:00 PST
    const mon10 = Date.UTC(2024, 0, 8, 18, 0, 0) / 1000;
    // Tuesday 15:00 PST (Jan 9 2024 23:00 UTC)
    const tue15 = Date.UTC(2024, 0, 9, 23, 0, 0) / 1000;
    insertGameWithTime(db, "g1", "alice", "Alice", "Bob", "1-0", mon10);
    insertGameWithTime(db, "g2", "alice", "Alice", "Bob", "0-1", tue15);

    const result = computeByTimeOfDay(db, "alice");

    expect(result).toHaveLength(2);
    const days = result.map((b) => b.day).sort();
    expect(days).toContain(1); // Monday
    expect(days).toContain(2); // Tuesday
  });
});

// ---------------------------------------------------------------------------
// computeWinRateSlice
// ---------------------------------------------------------------------------

describe("computeWinRateSlice — color", () => {
  test("4 white games (3W 1L) + 2 black wins → correct counts per side", () => {
    insertFullGame(db, "g1", "alice", "Alice", "Bob", "1-0"); // white win
    insertFullGame(db, "g2", "alice", "Alice", "Bob", "1-0"); // white win
    insertFullGame(db, "g3", "alice", "Alice", "Bob", "1-0"); // white win
    insertFullGame(db, "g4", "alice", "Alice", "Bob", "0-1"); // white loss
    insertFullGame(db, "g5", "alice", "Bob", "Alice", "0-1"); // black win
    insertFullGame(db, "g6", "alice", "Bob", "Alice", "0-1"); // black win

    const rows = computeWinRateSlice(db, "alice", "color");

    expect(rows).toHaveLength(2);
    const white = rows.find((r) => r.key === "white");
    const black = rows.find((r) => r.key === "black");

    expect(white).toBeDefined();
    expect(white!.games).toBe(4);
    expect(white!.wins).toBe(3);
    expect(white!.losses).toBe(1);
    expect(white!.draws).toBe(0);
    expect(white!.win_rate).toBeCloseTo(0.75, 10);

    expect(black).toBeDefined();
    expect(black!.games).toBe(2);
    expect(black!.wins).toBe(2);
    expect(black!.losses).toBe(0);
    expect(black!.win_rate).toBe(1);
  });
});

describe("computeWinRateSlice — time_class", () => {
  test("3 blitz + 2 rapid → 2 rows keyed blitz/rapid", () => {
    insertFullGame(db, "g1", "alice", "Alice", "Bob", "1-0", { timeClass: "blitz" });
    insertFullGame(db, "g2", "alice", "Alice", "Bob", "0-1", { timeClass: "blitz" });
    insertFullGame(db, "g3", "alice", "Alice", "Bob", "1/2-1/2", { timeClass: "blitz" });
    insertFullGame(db, "g4", "alice", "Alice", "Bob", "1-0", { timeClass: "rapid" });
    insertFullGame(db, "g5", "alice", "Alice", "Bob", "0-1", { timeClass: "rapid" });

    const rows = computeWinRateSlice(db, "alice", "time_class");

    expect(rows).toHaveLength(2);
    const blitz = rows.find((r) => r.key === "blitz");
    const rapid = rows.find((r) => r.key === "rapid");

    expect(blitz).toBeDefined();
    expect(blitz!.games).toBe(3);
    expect(blitz!.wins).toBe(1);
    expect(blitz!.draws).toBe(1);
    expect(blitz!.losses).toBe(1);

    expect(rapid).toBeDefined();
    expect(rapid!.games).toBe(2);
  });
});

describe("computeWinRateSlice — rating_bucket", () => {
  test("games with user_elo=1500 and varying opponent ratings → correct buckets", () => {
    // opponent 1200: diff = -300 → '<-200'
    insertFullGame(db, "g1", "alice", "Alice", "Bob", "1-0", {
      userElo: 1500, whiteElo: 1500, blackElo: 1200,
    });
    // opponent 1350: diff = -150 → '-200..-100'
    insertFullGame(db, "g2", "alice", "Alice", "Bob", "1-0", {
      userElo: 1500, whiteElo: 1500, blackElo: 1350,
    });
    // opponent 1500: diff = 0 → '±100'
    insertFullGame(db, "g3", "alice", "Alice", "Bob", "1-0", {
      userElo: 1500, whiteElo: 1500, blackElo: 1500,
    });
    // opponent 1650: diff = +150 → '+100..+200'
    insertFullGame(db, "g4", "alice", "Alice", "Bob", "0-1", {
      userElo: 1500, whiteElo: 1500, blackElo: 1650,
    });
    // opponent 1800: diff = +300 → '>+200'
    insertFullGame(db, "g5", "alice", "Alice", "Bob", "0-1", {
      userElo: 1500, whiteElo: 1500, blackElo: 1800,
    });

    const rows = computeWinRateSlice(db, "alice", "rating_bucket");
    const keys = rows.map((r) => r.key);

    expect(keys).toContain("<-200");
    expect(keys).toContain("-200..-100");
    expect(keys).toContain("±100");
    expect(keys).toContain("+100..+200");
    expect(keys).toContain(">+200");

    const bucket = (k: string) => rows.find((r) => r.key === k)!;
    expect(bucket("<-200").wins).toBe(1);
    expect(bucket(">+200").losses).toBe(1);
  });

  test("null user_elo or opponent elo → 'unrated' bucket", () => {
    insertFullGame(db, "g1", "alice", "Alice", "Bob", "1-0", {
      userElo: null, whiteElo: null, blackElo: null,
    });

    const rows = computeWinRateSlice(db, "alice", "rating_bucket");
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe("unrated");
  });
});

describe("computeWinRateSlice — opening", () => {
  test("2 B20 games + 1 C50 game → 2 rows with opening label", () => {
    insertFullGame(db, "g1", "alice", "Alice", "Bob", "1-0", {
      eco: "B20", opening: "Sicilian Defense",
    });
    insertFullGame(db, "g2", "alice", "Alice", "Bob", "0-1", {
      eco: "B20", opening: "Sicilian Defense",
    });
    insertFullGame(db, "g3", "alice", "Alice", "Bob", "1-0", {
      eco: "C50", opening: "Italian Game",
    });

    const rows = computeWinRateSlice(db, "alice", "opening");

    expect(rows).toHaveLength(2);
    const b20 = rows.find((r) => r.key === "B20");
    const c50 = rows.find((r) => r.key === "C50");

    expect(b20).toBeDefined();
    expect(b20!.games).toBe(2);
    expect(b20!.opening).toBe("Sicilian Defense");

    expect(c50).toBeDefined();
    expect(c50!.games).toBe(1);
    expect(c50!.opening).toBe("Italian Game");
  });
});

describe("computeWinRateSlice — date filter", () => {
  test("from/to filter excludes games outside the range", () => {
    insertFullGame(db, "g1", "alice", "Alice", "Bob", "1-0", { endTime: 1000 });
    insertFullGame(db, "g2", "alice", "Alice", "Bob", "1-0", { endTime: 2000 });
    insertFullGame(db, "g3", "alice", "Alice", "Bob", "1-0", { endTime: 3000 });

    // Only g2 (endTime=2000) falls within [1500, 2500]
    const rows = computeWinRateSlice(db, "alice", "color", 1500, 2500);

    const total = rows.reduce((sum, r) => sum + r.games, 0);
    expect(total).toBe(1);
  });
});

describe("computeWinRateSlice — avg_accuracy", () => {
  test("avg_accuracy is null when game has no metrics", () => {
    insertFullGame(db, "g1", "alice", "Alice", "Bob", "1-0");

    const rows = computeWinRateSlice(db, "alice", "color");

    expect(rows).toHaveLength(1);
    expect(rows[0].avg_accuracy).toBeNull();
  });

  test("avg_accuracy is computed when metrics exist", () => {
    insertFullGame(db, "g1", "alice", "Alice", "Bob", "1-0");
    insertFullGame(db, "g2", "alice", "Alice", "Bob", "1-0");
    insertMetrics(db, "g1", 80.0, 70.0, 0, 0);
    insertMetrics(db, "g2", 90.0, 60.0, 0, 0);

    const rows = computeWinRateSlice(db, "alice", "color");
    const white = rows.find((r) => r.key === "white");

    expect(white).toBeDefined();
    // AVG of white accuracy: (80 + 90) / 2 = 85
    expect(white!.avg_accuracy).toBeCloseTo(85.0, 5);
  });
});

// ---------------------------------------------------------------------------
// Helper for accuracy trend tests
// ---------------------------------------------------------------------------

function insertGameWithAccuracy(
  database: Database,
  id: string,
  username: string,
  white: string,
  black: string,
  timeClass: string,
  endTime: number,
  accuracyWhite: number,
  accuracyBlack: number,
): void {
  database
    .prepare(
      `INSERT INTO games (id, username, pgn, white, black, result, time_class, end_time)
       VALUES (?, ?, '', ?, ?, '', ?, ?)`,
    )
    .run(id, username, white, black, timeClass, endTime);
  database
    .prepare(
      `INSERT INTO game_metrics
         (game_id, accuracy_white, accuracy_black,
          blunders_white, mistakes_white, inaccuracies_white,
          blunders_black, mistakes_black, inaccuracies_black,
          acl_white, acl_black, computed_at)
       VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0)`,
    )
    .run(id, accuracyWhite, accuracyBlack);
}

// ---------------------------------------------------------------------------
// computeAccuracyTrend
// ---------------------------------------------------------------------------

describe("computeAccuracyTrend", () => {
  test("returns 3 blitz points with correct user-side accuracy (2 white, 1 black)", () => {
    // g1: alice plays white → accuracy_white = 85
    insertGameWithAccuracy(db, "g1", "alice", "alice", "bob", "blitz", 1000, 85, 60);
    // g2: alice plays black → accuracy_black = 75
    insertGameWithAccuracy(db, "g2", "alice", "bob", "alice", "blitz", 2000, 70, 75);
    // g3: alice plays white → accuracy_white = 92
    insertGameWithAccuracy(db, "g3", "alice", "alice", "bob", "blitz", 3000, 92, 50);

    const result = computeAccuracyTrend(db, "alice", "blitz");

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ t: 1000, accuracy: 85 });
    expect(result[1]).toEqual({ t: 2000, accuracy: 75 });
    expect(result[2]).toEqual({ t: 3000, accuracy: 92 });
  });

  test("games without game_metrics are excluded (JOIN not LEFT JOIN)", () => {
    insertGameWithAccuracy(db, "g1", "alice", "alice", "bob", "blitz", 1000, 80, 65);
    db.prepare(
      `INSERT INTO games (id, username, pgn, white, black, result, time_class, end_time)
       VALUES (?, ?, '', ?, ?, '', ?, ?)`,
    ).run("g2", "alice", "alice", "bob", "blitz", 2000);

    const result = computeAccuracyTrend(db, "alice", "blitz");

    expect(result).toHaveLength(1);
    expect(result[0].t).toBe(1000);
  });

  test("time_class filter excludes games of other time classes", () => {
    insertGameWithAccuracy(db, "g1", "alice", "alice", "bob", "blitz", 1000, 80, 70);
    insertGameWithAccuracy(db, "g2", "alice", "alice", "bob", "rapid", 2000, 88, 75);
    insertGameWithAccuracy(db, "g3", "alice", "alice", "bob", "blitz", 3000, 82, 72);

    const result = computeAccuracyTrend(db, "alice", "blitz");

    expect(result).toHaveLength(2);
    expect(result[0].t).toBe(1000);
    expect(result[1].t).toBe(3000);
  });

  test("unknown user returns empty array", () => {
    insertGameWithAccuracy(db, "g1", "alice", "alice", "bob", "blitz", 1000, 80, 70);

    const result = computeAccuracyTrend(db, "nobody", "blitz");

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// computeMotifStats
// ---------------------------------------------------------------------------

function insertBlunderTag(
  database: Database,
  gameId: string,
  moveIndex: number,
  tag: string,
): void {
  database
    .prepare(`INSERT INTO blunder_tags (game_id, move_index, tag) VALUES (?, ?, ?)`)
    .run(gameId, moveIndex, tag);
}

describe("computeMotifStats", () => {
  test("white user blunder on move_index=2 (black mover) is NOT counted", () => {
    // User alice played white. move_index=2 → (2-1)%2=1 → black mover. NOT user's move.
    insertFullGame(db, "g1", "alice", "Alice", "Bob", "1-0");
    insertBlunderTag(db, "g1", 2, "fork");

    const result = computeMotifStats(db, "alice");
    expect(result).toHaveLength(0);
  });

  test("white user blunder on move_index=3 (white mover) IS counted", () => {
    // User alice played white. move_index=3 → (3-1)%2=0 → white mover. IS user's move.
    insertFullGame(db, "g1", "alice", "Alice", "Bob", "0-1");
    insertBlunderTag(db, "g1", 3, "fork");

    const result = computeMotifStats(db, "alice");
    expect(result).toHaveLength(1);
    expect(result[0].tag).toBe("fork");
    expect(result[0].count).toBe(1);
  });

  test("multiple games and tags aggregate correctly, ordered DESC by count", () => {
    // alice plays white in both games
    insertFullGame(db, "g1", "alice", "Alice", "Bob", "0-1");
    insertFullGame(db, "g2", "alice", "Alice", "Bob", "0-1");
    // move_index=3 → white mover (user), move_index=1 → white mover (user)
    insertBlunderTag(db, "g1", 3, "fork");
    insertBlunderTag(db, "g1", 1, "pin");
    insertBlunderTag(db, "g2", 3, "fork");
    // fork appears twice, pin once → fork first
    const result = computeMotifStats(db, "alice");
    expect(result).toHaveLength(2);
    expect(result[0].tag).toBe("fork");
    expect(result[0].count).toBe(2);
    expect(result[1].tag).toBe("pin");
    expect(result[1].count).toBe(1);
  });

  test("unknown user returns empty array", () => {
    insertFullGame(db, "g1", "alice", "Alice", "Bob", "1-0");
    insertBlunderTag(db, "g1", 1, "fork");

    const result = computeMotifStats(db, "nobody");
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// computeDrillProgress
// ---------------------------------------------------------------------------

function insertDrillAttempt(
  database: Database,
  username: string,
  gameId: string,
  moveIndex: number,
  correct: number | null,
  attemptedAt: number | null,
  due: number | null = null,
): void {
  database
    .prepare(
      `INSERT INTO drill_attempts
         (username, game_id, move_index, fen, best_move, correct, attempted_at, due)
       VALUES (?, ?, ?, '', 'e2e4', ?, ?, ?)`,
    )
    .run(username, gameId, moveIndex, correct, attemptedAt, due);
}

describe("computeDrillProgress", () => {
  test("no attempts → all zeros", () => {
    const result = computeDrillProgress(db, "alice");

    expect(result.total_attempts).toBe(0);
    expect(result.accuracy_pct).toBe(0);
    expect(result.due_today).toBe(0);
    expect(result.current_streak).toBe(0);
  });

  test("5 attempts, 3 correct → total=5, accuracy_pct=60", () => {
    const now = Math.floor(Date.now() / 1000);
    insertDrillAttempt(db, "alice", "g1", 1, 1, now);
    insertDrillAttempt(db, "alice", "g1", 2, 1, now);
    insertDrillAttempt(db, "alice", "g1", 3, 1, now);
    insertDrillAttempt(db, "alice", "g1", 4, 0, now);
    insertDrillAttempt(db, "alice", "g1", 5, 0, now);

    const result = computeDrillProgress(db, "alice");

    expect(result.total_attempts).toBe(5);
    expect(result.accuracy_pct).toBeCloseTo(60, 5);
  });

  test("future due timestamp is not counted in due_today", () => {
    const farFuture = Math.floor(Date.now() / 1000) + 86400 * 365; // 1 year ahead
    const now = Math.floor(Date.now() / 1000);
    // one card due in the past (should count), one in the future (should not)
    insertDrillAttempt(db, "alice", "g1", 1, 1, now, now - 3600);
    insertDrillAttempt(db, "alice", "g1", 2, 1, now, farFuture);

    const result = computeDrillProgress(db, "alice");

    expect(result.due_today).toBe(1);
  });

  test("streak: 3 consecutive days with >= 1 correct attempt → streak=3", () => {
    // Build timestamps for 3 consecutive days ending today (local time, noon each day)
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const t0 = Math.floor(today.getTime() / 1000);
    const t1 = t0 - 86400;
    const t2 = t0 - 86400 * 2;

    insertDrillAttempt(db, "alice", "g1", 1, 1, t0);
    insertDrillAttempt(db, "alice", "g1", 2, 1, t1);
    insertDrillAttempt(db, "alice", "g1", 3, 1, t2);

    const result = computeDrillProgress(db, "alice");

    expect(result.current_streak).toBe(3);
  });

  test("gap in streak → streak resets to only consecutive days from today", () => {
    // today and 2 days ago correct, but yesterday (1 day ago) has no correct attempt → gap
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const t0 = Math.floor(today.getTime() / 1000);
    const t2 = t0 - 86400 * 2; // two days ago

    insertDrillAttempt(db, "alice", "g1", 1, 1, t0);
    insertDrillAttempt(db, "alice", "g1", 2, 1, t2);

    const result = computeDrillProgress(db, "alice");

    // Streak should only be 1 (today), not 2, because yesterday is missing
    expect(result.current_streak).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Helpers for new endpoint tests
// ---------------------------------------------------------------------------

function insertGameFull(
  database: Database,
  id: string,
  username: string,
  white: string,
  black: string,
  result: string,
  opts: {
    timeClass?: string;
    endTime?: number;
    whiteElo?: number | null;
    blackElo?: number | null;
    userElo?: number | null;
    eco?: string | null;
    opening?: string | null;
  } = {},
): void {
  database
    .prepare(
      `INSERT INTO games
         (id, username, pgn, white, black, result, time_class, end_time,
          white_elo, black_elo, user_elo, eco, opening)
       VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      username,
      white,
      black,
      result,
      opts.timeClass ?? null,
      opts.endTime ?? null,
      opts.whiteElo ?? null,
      opts.blackElo ?? null,
      opts.userElo ?? null,
      opts.eco ?? null,
      opts.opening ?? null,
    );
}

function insertMetricsFull(
  database: Database,
  gameId: string,
  opts: {
    accuracyWhite?: number;
    accuracyBlack?: number;
    blundersWhite?: number;
    blundersBlack?: number;
    aclWhite?: number;
    aclBlack?: number;
  } = {},
): void {
  database
    .prepare(
      `INSERT INTO game_metrics
         (game_id, accuracy_white, accuracy_black,
          blunders_white, mistakes_white, inaccuracies_white,
          blunders_black, mistakes_black, inaccuracies_black,
          acl_white, acl_black, computed_at)
       VALUES (?, ?, ?, ?, 0, 0, ?, 0, 0, ?, ?, 0)`,
    )
    .run(
      gameId,
      opts.accuracyWhite ?? 80,
      opts.accuracyBlack ?? 80,
      opts.blundersWhite ?? 0,
      opts.blundersBlack ?? 0,
      opts.aclWhite ?? 0,
      opts.aclBlack ?? 0,
    );
}

function insertGameMetricsExt(
  database: Database,
  gameId: string,
  opts: {
    aclMiddlegame?: number | null;
    accuracyEndgame?: number | null;
    peakEvalWp?: number | null;
    troughEvalWp?: number | null;
    outOfBookPly?: number | null;
  } = {},
): void {
  database
    .prepare(
      `INSERT INTO game_metrics_ext
         (game_id, metrics_version, analysis_sig, multipv_max,
          accuracy_opening, accuracy_middlegame, accuracy_endgame,
          acl_opening, acl_middlegame, acl_endgame,
          middlegame_start_ply, endgame_start_ply,
          time_opening_s, time_middlegame_s, time_endgame_s, avg_move_time_s,
          accuracy_critical, accuracy_quiet, critical_positions,
          time_alloc_efficiency,
          max_blunder_run, recovery_accuracy,
          time_trouble_moves, time_trouble_errors,
          peak_eval_wp, trough_eval_wp,
          out_of_book_ply, out_of_book_eco_fallback, post_book_accuracy,
          eval_opening_end_wp,
          user_moves, clocks_available, engine_depth_min, computed_at)
       VALUES (?, 1, '', 1,
               NULL, NULL, ?,
               NULL, ?, NULL,
               NULL, NULL,
               NULL, NULL, NULL, NULL,
               NULL, NULL, NULL,
               NULL,
               NULL, NULL,
               NULL, NULL,
               ?, ?,
               ?, 0, NULL,
               NULL,
               0, 0, 0, 0)`,
    )
    .run(
      gameId,
      opts.accuracyEndgame ?? null,
      opts.aclMiddlegame ?? null,
      opts.peakEvalWp ?? null,
      opts.troughEvalWp ?? null,
      opts.outOfBookPly ?? null,
    );
}

function insertBlunderTagNew(
  database: Database,
  gameId: string,
  moveIndex: number,
  tag: string,
): void {
  database
    .prepare(`INSERT INTO blunder_tags (game_id, move_index, tag) VALUES (?, ?, ?)`)
    .run(gameId, moveIndex, tag);
}

// ---------------------------------------------------------------------------
// computeConsistency (R21)
// ---------------------------------------------------------------------------

describe("computeConsistency", () => {
  test("no games → all nulls, games=0", () => {
    const result = computeConsistency(db, "alice");
    expect(result.games).toBe(0);
    expect(result.accuracy_mean).toBeNull();
    expect(result.accuracy_stddev).toBeNull();
  });

  test("single game → stddev=0, mean=accuracy", () => {
    insertGameFull(db, "g1", "alice", "alice", "bob", "1-0");
    insertMetricsFull(db, "g1", { accuracyWhite: 80 });

    const result = computeConsistency(db, "alice");
    expect(result.games).toBe(1);
    expect(result.accuracy_mean).toBeCloseTo(80, 5);
    expect(result.accuracy_stddev).toBeCloseTo(0, 5);
  });

  test("two games with different accuracies → correct mean and stddev", () => {
    // white: 70 and 90 → mean=80, variance=(100+100)/2=100, stddev=10
    insertGameFull(db, "g1", "alice", "alice", "bob", "1-0");
    insertGameFull(db, "g2", "alice", "alice", "bob", "1-0");
    insertMetricsFull(db, "g1", { accuracyWhite: 70 });
    insertMetricsFull(db, "g2", { accuracyWhite: 90 });

    const result = computeConsistency(db, "alice");
    expect(result.games).toBe(2);
    expect(result.accuracy_mean).toBeCloseTo(80, 5);
    expect(result.accuracy_stddev).toBeCloseTo(10, 5);
  });

  test("games without metrics are excluded", () => {
    insertGameFull(db, "g1", "alice", "alice", "bob", "1-0");
    insertGameFull(db, "g2", "alice", "alice", "bob", "1-0");
    insertMetricsFull(db, "g1", { accuracyWhite: 80 });
    // g2 has no metrics

    const result = computeConsistency(db, "alice");
    expect(result.games).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// computeSessionFatigue (R22)
// ---------------------------------------------------------------------------

describe("computeSessionFatigue", () => {
  test("no games → empty array", () => {
    const result = computeSessionFatigue(db, "alice");
    expect(result).toEqual([]);
  });

  test("3 consecutive games in same session → all get different game_in_session indexes", () => {
    const t0 = 1_000_000;
    insertGameFull(db, "g1", "alice", "alice", "bob", "1-0", { endTime: t0 });
    insertGameFull(db, "g2", "alice", "alice", "bob", "0-1", { endTime: t0 + 1800 }); // +30 min
    insertGameFull(db, "g3", "alice", "alice", "bob", "1-0", { endTime: t0 + 3000 }); // +50 min

    const result = computeSessionFatigue(db, "alice");
    const indexes = result.map((b) => b.game_in_session).sort((a, b) => a - b);
    expect(indexes).toEqual([1, 2, 3]);
  });

  test("gap ≥ 60 min starts new session — game_in_session resets to 1", () => {
    const t0 = 1_000_000;
    const SESSION_GAP = 61 * 60; // 61 minutes
    insertGameFull(db, "g1", "alice", "alice", "bob", "1-0", { endTime: t0 });
    insertGameFull(db, "g2", "alice", "alice", "bob", "1-0", { endTime: t0 + SESSION_GAP });

    const result = computeSessionFatigue(db, "alice");
    // Both are game_in_session=1 (two separate sessions)
    const bucket1 = result.find((b) => b.game_in_session === 1);
    expect(bucket1).toBeDefined();
    expect(bucket1!.games).toBe(2); // both sessions contribute to index 1 bucket
  });

  test("win_rate calculation: 2 wins out of 3 games at index 1", () => {
    const t0 = 1_000_000;
    const GAP = 61 * 60;
    // 3 separate sessions, each first game
    insertGameFull(db, "g1", "alice", "alice", "bob", "1-0", { endTime: t0 });
    insertGameFull(db, "g2", "alice", "alice", "bob", "1-0", { endTime: t0 + GAP });
    insertGameFull(db, "g3", "alice", "alice", "bob", "0-1", { endTime: t0 + 2 * GAP });

    const result = computeSessionFatigue(db, "alice");
    const bucket1 = result.find((b) => b.game_in_session === 1);
    expect(bucket1).toBeDefined();
    expect(bucket1!.games).toBe(3);
    expect(bucket1!.wins).toBe(2);
    expect(bucket1!.win_rate).toBeCloseTo(2 / 3, 5);
  });
});

// ---------------------------------------------------------------------------
// computeVsOpponent (R23)
// ---------------------------------------------------------------------------

describe("computeVsOpponent", () => {
  test("no games → empty array", () => {
    const result = computeVsOpponent(db, "alice");
    expect(result).toEqual([]);
  });

  test("correct rating buckets assigned", () => {
    // diff < -200 → '<-200'
    insertGameFull(db, "g1", "alice", "alice", "bob", "1-0", {
      userElo: 1500, whiteElo: 1500, blackElo: 1200,
    });
    // diff +250 → '>+200'
    insertGameFull(db, "g2", "alice", "alice", "bob", "0-1", {
      userElo: 1500, whiteElo: 1500, blackElo: 1750,
    });
    // null elo → 'unrated'
    insertGameFull(db, "g3", "alice", "alice", "bob", "1/2-1/2", {
      userElo: null, whiteElo: null, blackElo: null,
    });

    const result = computeVsOpponent(db, "alice");
    const buckets = result.map((r) => r.bucket);
    expect(buckets).toContain("<-200");
    expect(buckets).toContain(">+200");
    expect(buckets).toContain("unrated");
  });

  test("win_rate computed correctly within a bucket", () => {
    // Two games in ±100 bucket: 1 win, 1 loss
    insertGameFull(db, "g1", "alice", "alice", "bob", "1-0", {
      userElo: 1500, whiteElo: 1500, blackElo: 1530,
    });
    insertGameFull(db, "g2", "alice", "alice", "bob", "0-1", {
      userElo: 1500, whiteElo: 1500, blackElo: 1470,
    });

    const result = computeVsOpponent(db, "alice");
    const bucket = result.find((r) => r.bucket === "±100");
    expect(bucket).toBeDefined();
    expect(bucket!.games).toBe(2);
    expect(bucket!.win_rate).toBeCloseTo(0.5, 5);
  });
});

// ---------------------------------------------------------------------------
// computeAclTrend (R27)
// ---------------------------------------------------------------------------

describe("computeAclTrend", () => {
  test("no games → empty array", () => {
    const result = computeAclTrend(db, "alice", "blitz");
    expect(result).toEqual([]);
  });

  test("single game → rolling equals acl", () => {
    insertGameFull(db, "g1", "alice", "alice", "bob", "1-0", { timeClass: "blitz", endTime: 1000 });
    insertMetricsFull(db, "g1", { aclWhite: 15 });

    const result = computeAclTrend(db, "alice", "blitz");
    expect(result).toHaveLength(1);
    expect(result[0].t).toBe(1000);
    expect(result[0].acl).toBeCloseTo(15, 5);
    expect(result[0].rolling).toBeCloseTo(15, 5);
  });

  test("rolling mean is trailing average over last N games", () => {
    // 3 games with ACL 10, 20, 30 → rolling at pos 3 = (10+20+30)/3 = 20
    insertGameFull(db, "g1", "alice", "alice", "bob", "1-0", { timeClass: "blitz", endTime: 1000 });
    insertGameFull(db, "g2", "alice", "alice", "bob", "1-0", { timeClass: "blitz", endTime: 2000 });
    insertGameFull(db, "g3", "alice", "alice", "bob", "1-0", { timeClass: "blitz", endTime: 3000 });
    insertMetricsFull(db, "g1", { aclWhite: 10 });
    insertMetricsFull(db, "g2", { aclWhite: 20 });
    insertMetricsFull(db, "g3", { aclWhite: 30 });

    const result = computeAclTrend(db, "alice", "blitz");
    expect(result).toHaveLength(3);
    expect(result[0].rolling).toBeCloseTo(10, 5); // window=[10]
    expect(result[1].rolling).toBeCloseTo(15, 5); // window=[10,20]
    expect(result[2].rolling).toBeCloseTo(20, 5); // window=[10,20,30]
  });

  test("time_class filter works", () => {
    insertGameFull(db, "g1", "alice", "alice", "bob", "1-0", { timeClass: "blitz", endTime: 1000 });
    insertGameFull(db, "g2", "alice", "alice", "bob", "1-0", { timeClass: "rapid", endTime: 2000 });
    insertMetricsFull(db, "g1", { aclWhite: 5 });
    insertMetricsFull(db, "g2", { aclWhite: 8 });

    const result = computeAclTrend(db, "alice", "blitz");
    expect(result).toHaveLength(1);
    expect(result[0].acl).toBeCloseTo(5, 5);
  });
});

// ---------------------------------------------------------------------------
// computeLeakClosure (R28)
// ---------------------------------------------------------------------------

describe("computeLeakClosure", () => {
  test("no games → empty array", () => {
    const result = computeLeakClosure(db, "alice");
    expect(result).toEqual([]);
  });

  test("tag appearing only in first half → negative or zero delta", () => {
    // 4 games: 2 old, 2 new; median end_time between old and new
    const t1 = 1000, t2 = 2000, t3 = 3000, t4 = 4000;
    insertGameFull(db, "g1", "alice", "alice", "bob", "0-1", { endTime: t1 });
    insertGameFull(db, "g2", "alice", "alice", "bob", "0-1", { endTime: t2 });
    insertGameFull(db, "g3", "alice", "alice", "bob", "0-1", { endTime: t3 });
    insertGameFull(db, "g4", "alice", "alice", "bob", "0-1", { endTime: t4 });
    // fork blunder on move_index=1 (white mover, alice plays white)
    insertBlunderTagNew(db, "g1", 1, "fork");
    insertBlunderTagNew(db, "g2", 1, "fork");
    // no fork in second half

    const result = computeLeakClosure(db, "alice");
    const forkRow = result.find((r) => r.tag === "fork");
    expect(forkRow).toBeDefined();
    expect(forkRow!.first_half).toBeGreaterThan(0);
    expect(forkRow!.delta).toBeLessThanOrEqual(0); // improving (fewer in second half)
  });

  test("tag in both halves → delta reflects difference", () => {
    const t1 = 1000, t2 = 2000, t3 = 3000, t4 = 4000;
    insertGameFull(db, "g1", "alice", "alice", "bob", "0-1", { endTime: t1 });
    insertGameFull(db, "g2", "alice", "alice", "bob", "0-1", { endTime: t2 });
    insertGameFull(db, "g3", "alice", "alice", "bob", "0-1", { endTime: t3 });
    insertGameFull(db, "g4", "alice", "alice", "bob", "0-1", { endTime: t4 });
    insertBlunderTagNew(db, "g1", 1, "pin");
    insertBlunderTagNew(db, "g3", 1, "pin");
    insertBlunderTagNew(db, "g4", 1, "pin");

    const result = computeLeakClosure(db, "alice");
    const pinRow = result.find((r) => r.tag === "pin");
    expect(pinRow).toBeDefined();
    expect(pinRow!.delta).toBe(pinRow!.second_half - pinRow!.first_half);
  });
});

// ---------------------------------------------------------------------------
// dpFromScore + computeTpr (R29)
// ---------------------------------------------------------------------------

describe("dpFromScore", () => {
  test("p=0.5 → 0 (symmetric draw)", () => {
    expect(dpFromScore(0.5)).toBeCloseTo(0, 5);
  });

  test("p=0.99 → 677 (clamp high)", () => {
    expect(dpFromScore(0.99)).toBeCloseTo(677, 2);
  });

  test("p=0.01 → -677 (clamp low)", () => {
    expect(dpFromScore(0.01)).toBeCloseTo(-677, 2);
  });

  test("symmetry: dp(1-p) = -dp(p)", () => {
    const p = 0.75;
    expect(dpFromScore(p)).toBeCloseTo(-dpFromScore(1 - p), 5);
  });
});

describe("computeTpr", () => {
  test("no games → tpr=null, games=0", () => {
    const result = computeTpr(db, "alice", "blitz");
    expect(result.tpr).toBeNull();
    expect(result.games).toBe(0);
  });

  test("all wins → tpr > avg_opponent_elo", () => {
    insertGameFull(db, "g1", "alice", "alice", "bob", "1-0", {
      timeClass: "blitz", userElo: 1500, whiteElo: 1500, blackElo: 1600,
    });
    insertGameFull(db, "g2", "alice", "alice", "bob", "1-0", {
      timeClass: "blitz", userElo: 1500, whiteElo: 1500, blackElo: 1600,
    });

    const result = computeTpr(db, "alice", "blitz");
    expect(result.tpr).not.toBeNull();
    expect(result.tpr!).toBeGreaterThan(1600);
    expect(result.avg_opponent_elo).toBeCloseTo(1600, 5);
  });

  test("50% score → tpr ≈ avg_opponent_elo", () => {
    insertGameFull(db, "g1", "alice", "alice", "bob", "1-0", {
      timeClass: "blitz", userElo: 1500, whiteElo: 1500, blackElo: 1600,
    });
    insertGameFull(db, "g2", "alice", "alice", "bob", "0-1", {
      timeClass: "blitz", userElo: 1500, whiteElo: 1500, blackElo: 1600,
    });

    const result = computeTpr(db, "alice", "blitz");
    expect(result.score).toBeCloseTo(1, 5);
    expect(result.tpr).toBeCloseTo(1600, 1); // dp(0.5)=0 → tpr=avg_opp_elo
  });
});

// ---------------------------------------------------------------------------
// computeRepertoire (R30)
// ---------------------------------------------------------------------------

describe("computeRepertoire", () => {
  test("no games → empty array", () => {
    const result = computeRepertoire(db, "alice", "white");
    expect(result).toEqual([]);
  });

  test("groups by ECO for user playing white", () => {
    insertGameFull(db, "g1", "alice", "alice", "bob", "1-0", { eco: "B20", opening: "Sicilian" });
    insertGameFull(db, "g2", "alice", "alice", "bob", "0-1", { eco: "B20", opening: "Sicilian" });
    insertGameFull(db, "g3", "alice", "alice", "bob", "1-0", { eco: "C50", opening: "Italian" });

    const result = computeRepertoire(db, "alice", "white");
    const b20 = result.find((r) => r.eco === "B20");
    const c50 = result.find((r) => r.eco === "C50");

    expect(b20).toBeDefined();
    expect(b20!.games).toBe(2);
    expect(b20!.win_rate).toBeCloseTo(0.5, 5);
    expect(c50).toBeDefined();
    expect(c50!.games).toBe(1);
    expect(c50!.win_rate).toBe(1);
  });

  test("color=black only includes games where user played black", () => {
    insertGameFull(db, "g1", "alice", "alice", "bob", "1-0", { eco: "A00" }); // alice white
    insertGameFull(db, "g2", "alice", "bob", "alice", "0-1", { eco: "D10" }); // alice black

    const result = computeRepertoire(db, "alice", "black");
    expect(result.some((r) => r.eco === "A00")).toBe(false);
    expect(result.some((r) => r.eco === "D10")).toBe(true);
  });

  test("includes avg_out_of_book_ply from game_metrics_ext", () => {
    insertGameFull(db, "g1", "alice", "alice", "bob", "1-0", { eco: "E60" });
    insertGameMetricsExt(db, "g1", { outOfBookPly: 12 });

    const result = computeRepertoire(db, "alice", "white");
    const e60 = result.find((r) => r.eco === "E60");
    expect(e60).toBeDefined();
    expect(e60!.avg_out_of_book_ply).toBeCloseTo(12, 5);
  });
});

// ---------------------------------------------------------------------------
// computeCounterplay (R31)
// ---------------------------------------------------------------------------

describe("computeCounterplay", () => {
  test("no ext rows → games_reached_losing=0, save_rate=null", () => {
    const result = computeCounterplay(db, "alice");
    expect(result.games_reached_losing).toBe(0);
    expect(result.saves).toBe(0);
    expect(result.save_rate).toBeNull();
  });

  test("trough_eval_wp=15 (<=20) → reaches losing; win counted as save", () => {
    insertGameFull(db, "g1", "alice", "alice", "bob", "1-0");
    insertGameMetricsExt(db, "g1", { troughEvalWp: 15 });

    const result = computeCounterplay(db, "alice");
    expect(result.games_reached_losing).toBe(1);
    expect(result.saves).toBe(1);
    expect(result.save_rate).toBeCloseTo(1, 5);
  });

  test("trough_eval_wp=50 (>20) → does NOT reach losing", () => {
    insertGameFull(db, "g1", "alice", "alice", "bob", "1-0");
    insertGameMetricsExt(db, "g1", { troughEvalWp: 50 });

    const result = computeCounterplay(db, "alice");
    expect(result.games_reached_losing).toBe(0);
  });

  test("reached losing but user lost → not a save", () => {
    insertGameFull(db, "g1", "alice", "alice", "bob", "0-1");
    insertGameMetricsExt(db, "g1", { troughEvalWp: 10 });

    const result = computeCounterplay(db, "alice");
    expect(result.games_reached_losing).toBe(1);
    expect(result.saves).toBe(0);
    expect(result.save_rate).toBeCloseTo(0, 5);
  });
});

// ---------------------------------------------------------------------------
// computeEndgameConversion (R32)
// ---------------------------------------------------------------------------

describe("computeEndgameConversion", () => {
  test("no ext rows → all zeros, conversion_rate=null", () => {
    const result = computeEndgameConversion(db, "alice");
    expect(result.games_reached_winning).toBe(0);
    expect(result.conversions).toBe(0);
    expect(result.conversion_rate).toBeNull();
    expect(result.avg_endgame_accuracy).toBeNull();
  });

  test("peak_eval_wp=85 (>=80) → reaches winning; win counted as conversion", () => {
    insertGameFull(db, "g1", "alice", "alice", "bob", "1-0");
    insertGameMetricsExt(db, "g1", { peakEvalWp: 85, accuracyEndgame: 90 });

    const result = computeEndgameConversion(db, "alice");
    expect(result.games_reached_winning).toBe(1);
    expect(result.conversions).toBe(1);
    expect(result.conversion_rate).toBeCloseTo(1, 5);
    expect(result.avg_endgame_accuracy).toBeCloseTo(90, 5);
  });

  test("peak_eval_wp=70 (<80) → does NOT reach winning", () => {
    insertGameFull(db, "g1", "alice", "alice", "bob", "1-0");
    insertGameMetricsExt(db, "g1", { peakEvalWp: 70 });

    const result = computeEndgameConversion(db, "alice");
    expect(result.games_reached_winning).toBe(0);
  });

  test("reached winning but user drew → not a conversion", () => {
    insertGameFull(db, "g1", "alice", "alice", "bob", "1/2-1/2");
    insertGameMetricsExt(db, "g1", { peakEvalWp: 85, accuracyEndgame: 75 });

    const result = computeEndgameConversion(db, "alice");
    expect(result.games_reached_winning).toBe(1);
    expect(result.conversions).toBe(0);
    expect(result.conversion_rate).toBeCloseTo(0, 5);
    expect(result.avg_endgame_accuracy).toBeCloseTo(75, 5);
  });
});
