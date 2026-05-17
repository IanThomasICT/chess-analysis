import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { migrations, type Migration } from "../server/lib/db";
import { computeBySide, computeEloTrend, computeByTimeOfDay, computeWinRateSlice, computeAclTrend } from "../server/routes/stats";

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
// Helper for ACL trend tests
// ---------------------------------------------------------------------------

function insertGameWithAcl(
  database: Database,
  id: string,
  username: string,
  white: string,
  black: string,
  timeClass: string,
  endTime: number,
  aclWhite: number,
  aclBlack: number,
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
       VALUES (?, 0, 0, 0, 0, 0, 0, 0, 0, ?, ?, 0)`,
    )
    .run(id, aclWhite, aclBlack);
}

// ---------------------------------------------------------------------------
// computeAclTrend
// ---------------------------------------------------------------------------

describe("computeAclTrend", () => {
  test("returns 3 blitz points with correct user-side ACL (2 white, 1 black)", () => {
    // g1: alice plays white → acl = acl_white = 30
    insertGameWithAcl(db, "g1", "alice", "alice", "bob", "blitz", 1000, 30, 50);
    // g2: alice plays black → acl = acl_black = 45
    insertGameWithAcl(db, "g2", "alice", "bob", "alice", "blitz", 2000, 20, 45);
    // g3: alice plays white → acl = acl_white = 10
    insertGameWithAcl(db, "g3", "alice", "alice", "bob", "blitz", 3000, 10, 60);

    const result = computeAclTrend(db, "alice", "blitz");

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ t: 1000, acl: 30 });
    expect(result[1]).toEqual({ t: 2000, acl: 45 });
    expect(result[2]).toEqual({ t: 3000, acl: 10 });
  });

  test("games without game_metrics are excluded (JOIN not LEFT JOIN)", () => {
    // game with metrics
    insertGameWithAcl(db, "g1", "alice", "alice", "bob", "blitz", 1000, 25, 35);
    // game without metrics
    db.prepare(
      `INSERT INTO games (id, username, pgn, white, black, result, time_class, end_time)
       VALUES (?, ?, '', ?, ?, '', ?, ?)`,
    ).run("g2", "alice", "alice", "bob", "blitz", 2000);

    const result = computeAclTrend(db, "alice", "blitz");

    expect(result).toHaveLength(1);
    expect(result[0].t).toBe(1000);
  });

  test("time_class filter excludes games of other time classes", () => {
    insertGameWithAcl(db, "g1", "alice", "alice", "bob", "blitz", 1000, 20, 30);
    insertGameWithAcl(db, "g2", "alice", "alice", "bob", "rapid", 2000, 15, 25);
    insertGameWithAcl(db, "g3", "alice", "alice", "bob", "blitz", 3000, 18, 28);

    const result = computeAclTrend(db, "alice", "blitz");

    expect(result).toHaveLength(2);
    expect(result[0].t).toBe(1000);
    expect(result[1].t).toBe(3000);
  });

  test("unknown user returns empty array", () => {
    insertGameWithAcl(db, "g1", "alice", "alice", "bob", "blitz", 1000, 20, 30);

    const result = computeAclTrend(db, "nobody", "blitz");

    expect(result).toEqual([]);
  });
});
