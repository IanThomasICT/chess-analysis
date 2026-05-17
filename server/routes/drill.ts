import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { fsrs, generatorParameters, createEmptyCard, Rating, type Card, type Grade, type State } from "ts-fsrs";
import { db } from "../lib/db";

const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{1,50}$/;

// ---------------------------------------------------------------------------
// FSRS setup
// ---------------------------------------------------------------------------

const fsrsInstance = fsrs(generatorParameters());

// ---------------------------------------------------------------------------
// Types for attempt endpoint
// ---------------------------------------------------------------------------

export interface AttemptRequest {
  username: string;
  game_id: string;
  move_index: number;
  attempted_move: string;
  elapsed_ms?: number;
}

export interface AttemptResponse {
  correct: boolean;
  best_move: string;
  next_due: number;
  state: number;
  motifs: string[];
}

interface AttemptRow {
  username: string;
  game_id: string;
  move_index: number;
  fen: string;
  best_move: string;
  stability: number | null;
  difficulty: number | null;
  due: number | null;
  state: number | null;
}

function rowToCard(row: AttemptRow): Card {
  if (
    row.stability === null ||
    row.difficulty === null ||
    row.due === null ||
    row.state === null
  ) {
    return createEmptyCard();
  }
  return {
    due: new Date(row.due * 1000),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: 0,
    reps: 0,
    lapses: 0,
    state: row.state as State,
    last_review: undefined,
  };
}

function ratingFor(correct: boolean, elapsedMs?: number): Grade {
  if (!correct) {return Rating.Again;}
  if (elapsedMs !== undefined && elapsedMs >= 30_000) {return Rating.Hard;}
  return Rating.Good;
}

/**
 * Pure helper — separated for unit testing without booting Hono.
 *
 * Returns an AttemptResponse on success or { error, status } on failure.
 */
export function processDrillAttempt(
  database: Database,
  body: AttemptRequest,
  now: Date,
): AttemptResponse | { error: string; status: number } {
  const existing = database
    .prepare(
      `
      SELECT username, game_id, move_index, fen, best_move, stability, difficulty, due, state
        FROM drill_attempts
       WHERE lower(username) = lower(?) AND game_id = ? AND move_index = ?
    `,
    )
    .get(body.username, body.game_id, body.move_index) as AttemptRow | null;

  let fen: string;
  let bestMove: string;
  if (existing !== null) {
    fen = existing.fen;
    bestMove = existing.best_move;
  } else {
    const analysisRow = database
      .prepare(
        `
        SELECT fen, best_move FROM analysis
         WHERE game_id = ? AND move_index = ? AND multipv_rank = 1
      `,
      )
      .get(body.game_id, body.move_index - 1) as
      | { fen: string; best_move: string }
      | null;
    if (analysisRow === null) {
      return { error: "Position not analyzed", status: 404 };
    }
    fen = analysisRow.fen;
    bestMove = analysisRow.best_move;
  }

  const correct = body.attempted_move === bestMove;
  const rating = ratingFor(correct, body.elapsed_ms);
  const card =
    existing !== null
      ? rowToCard({ ...existing, fen, best_move: bestMove })
      : createEmptyCard();
  const scheduling = fsrsInstance.next(card, now, rating);
  const next = scheduling.card;

  const nowSec = Math.floor(now.getTime() / 1000);
  const due = Math.floor(next.due.getTime() / 1000);

  database
    .prepare(
      `
    INSERT INTO drill_attempts (
      username, game_id, move_index, fen, best_move,
      attempted_move, correct, attempted_at,
      stability, difficulty, due, state
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (username, game_id, move_index) DO UPDATE SET
      attempted_move = excluded.attempted_move,
      correct = excluded.correct,
      attempted_at = excluded.attempted_at,
      stability = excluded.stability,
      difficulty = excluded.difficulty,
      due = excluded.due,
      state = excluded.state
  `,
    )
    .run(
      body.username.toLowerCase(),
      body.game_id,
      body.move_index,
      fen,
      bestMove,
      body.attempted_move,
      correct ? 1 : 0,
      nowSec,
      next.stability,
      next.difficulty,
      due,
      next.state,
    );

  const motifs = (
    database
      .prepare(
        `SELECT tag FROM blunder_tags WHERE game_id = ? AND move_index = ?`,
      )
      .all(body.game_id, body.move_index) as Array<{ tag: string }>
  ).map((row) => row.tag);

  return {
    correct,
    best_move: bestMove,
    next_due: due,
    state: next.state,
    motifs,
  };
}

export interface DrillCard {
  game_id: string;
  move_index: number;
  fen: string;
  best_move: string;
  motifs: string[];
  source: "due" | "new";
}

interface DueRow {
  game_id: string;
  move_index: number;
  fen: string;
  best_move: string;
}

interface NewRow {
  game_id: string;
  move_index: number;
}

/**
 * Compute the drill queue for a user.
 *
 * Returns up to `limit` cards, preferring due cards (FSRS-scheduled, overdue)
 * before new positions (user-side blunders not yet in drill_attempts).
 *
 * For new positions the drill presents the BEFORE-position (move_index - 1) so
 * the user must find the best reply — fen + best_move come from the analysis row
 * at (game_id, move_index - 1, multipv_rank = 1).
 */
export function computeDrillQueue(
  database: Database,
  username: string,
  limit = 20,
): DrillCard[] {
  const lower = username.toLowerCase();
  const now = Math.floor(Date.now() / 1000);

  // 1. Due cards from drill_attempts
  const dueRows = database
    .prepare(
      `
      SELECT game_id, move_index, fen, best_move
        FROM drill_attempts
       WHERE lower(username) = ? AND due IS NOT NULL AND due <= ?
       ORDER BY due ASC
       LIMIT ?
    `,
    )
    .all(lower, now, limit) as DueRow[];

  const cards: DrillCard[] = [];
  for (const r of dueRows) {
    const motifs = (
      database
        .prepare(
          `SELECT tag FROM blunder_tags WHERE game_id = ? AND move_index = ?`,
        )
        .all(r.game_id, r.move_index) as Array<{ tag: string }>
    ).map((row) => row.tag);
    cards.push({
      game_id: r.game_id,
      move_index: r.move_index,
      fen: r.fen,
      best_move: r.best_move,
      motifs,
      source: "due",
    });
  }

  if (cards.length >= limit) {return cards;}
  const remaining = limit - cards.length;

  // 2. New positions: user-side blunder_tags not yet in drill_attempts.
  //
  // Mover-parity filter:
  //   - move_index is 1-based (move 1 = White's first move).
  //   - ((move_index - 1) % 2) === 0  → White moved (odd move_index values: 1, 3, 5, …)
  //   - ((move_index - 1) % 2) === 1  → Black moved (even move_index values: 2, 4, 6, …)
  //
  // We want blunders where the USER was the mover.
  const newRows = database
    .prepare(
      `
      SELECT DISTINCT bt.game_id, bt.move_index
        FROM blunder_tags bt
        JOIN games g ON bt.game_id = g.id
       WHERE lower(g.username) = ?
         AND (
              (lower(g.white) = lower(g.username) AND ((bt.move_index - 1) % 2) = 0)
           OR (lower(g.black) = lower(g.username) AND ((bt.move_index - 1) % 2) = 1)
         )
         AND NOT EXISTS (
              SELECT 1 FROM drill_attempts d
               WHERE lower(d.username) = lower(g.username)
                 AND d.game_id = bt.game_id
                 AND d.move_index = bt.move_index
         )
       LIMIT ?
    `,
    )
    .all(lower, remaining) as NewRow[];

  for (const r of newRows) {
    // The drill challenge: find the best move from the BEFORE position.
    // analysis row at (game_id, move_index - 1, multipv_rank = 1) holds fen + best_move.
    const before = database
      .prepare(
        `
        SELECT fen, best_move FROM analysis
         WHERE game_id = ? AND move_index = ? AND multipv_rank = 1
      `,
      )
      .get(r.game_id, r.move_index - 1) as
      | { fen: string; best_move: string }
      | null;
    if (before === null) {continue;}

    const motifs = (
      database
        .prepare(
          `SELECT tag FROM blunder_tags WHERE game_id = ? AND move_index = ?`,
        )
        .all(r.game_id, r.move_index) as Array<{ tag: string }>
    ).map((row) => row.tag);

    cards.push({
      game_id: r.game_id,
      move_index: r.move_index,
      fen: before.fen,
      best_move: before.best_move,
      motifs,
      source: "new",
    });
    if (cards.length >= limit) {break;}
  }

  return cards;
}

const drill = new Hono();

drill.get("/drill/queue", (c) => {
  const username = c.req.query("username");
  if (username === undefined || !USERNAME_PATTERN.test(username)) {
    return c.json({ error: "Invalid username format" }, 400);
  }
  const limitStr = c.req.query("limit");
  const limit =
    limitStr !== undefined ? parseInt(limitStr, 10) : 20;
  const safeLimit =
    Number.isNaN(limit) || limit < 1 || limit > 100 ? 20 : limit;
  return c.json(computeDrillQueue(db, username, safeLimit));
});

drill.post("/drill/attempt", async (c) => {
  let body: AttemptRequest;
  try {
    body = (await c.req.json());
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!USERNAME_PATTERN.test(body.username)) {
    return c.json({ error: "Invalid username" }, 400);
  }
  if (
    typeof body.attempted_move !== "string" ||
    body.attempted_move.length < 4 ||
    body.attempted_move.length > 5
  ) {
    return c.json({ error: "Invalid attempted_move" }, 400);
  }

  const result = processDrillAttempt(db, body, new Date());
  if ("status" in result) {
    return c.json({ error: result.error }, result.status as 400 | 404 | 500);
  }
  return c.json(result satisfies AttemptResponse);
});

export default drill;
