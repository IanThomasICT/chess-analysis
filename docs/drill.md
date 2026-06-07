# Drill mode

## Files

| File | Purpose |
|---|---|
| `server/routes/drill.ts` | `GET /api/drill/queue`, `POST /api/drill/attempt` |
| `server/lib/db.ts` migration #9 | `drill_attempts` table + FSRS state columns |
| `server/routes/stats.ts` | `computeDrillProgress` + `GET /api/stats/:user/drill-progress` |
| `client/src/pages/Drill.tsx` | `/drill?username=…` interactive page |
| `client/src/components/ChessBoard.tsx` | `interactive` prop + `onMove` callback |

## Queue (`GET /api/drill/queue?username=&limit=20`)

Returns up to `limit` `DrillCard`s mixing:

1. **Due cards**: `drill_attempts` rows where `due <= now`, ordered `due ASC`.
2. **New positions**: user-side `blunder_tags` not yet in `drill_attempts`. Mover-parity filter (white iff `(move_index - 1) % 2 = 0`). The drill shows the **BEFORE-position** (`analysis WHERE move_index = bt.move_index - 1`), i.e. the position where the user blundered FROM.

Each card: `{ game_id, move_index, fen, best_move, motifs[], source: "due" | "new" }`.

## Attempt (`POST /api/drill/attempt`)

Body: `{ username, game_id, move_index, attempted_move, elapsed_ms? }`.
Response: `{ correct, best_move, next_due, state, motifs }`.

FSRS rating mapping (DESIGN D10 / `ts-fsrs` defaults):

| Outcome | Rating |
|---|---|
| Correct, `elapsed_ms < 30000` | `Good` |
| Correct, `elapsed_ms ≥ 30000` | `Hard` |
| Incorrect | `Again` |

`processDrillAttempt(db, body, now)` is the pure helper exported for testing. It hydrates `Card` state from the DB row (or `createEmptyCard()` for new positions), runs `fsrs.next(card, now, rating)`, and upserts the new state via `ON CONFLICT(username, game_id, move_index) DO UPDATE`.

## Drill progress stat (`GET /api/stats/:user/drill-progress`)

```ts
{ total_attempts, accuracy_pct, due_today, current_streak }
```

`current_streak` walks backward day-by-day from today (server-local) and counts consecutive days with at least one correct attempt.

## UI

`/drill?username=…` shows one card at a time. Username comes from `useUsername()`; navigation lives in the
shared top navbar. The `ChessBoard` is `interactive` while no feedback is shown. On legal move drop,
`onMove(orig, dest)` builds UCI and submits via `useMutation(submitDrillAttempt)`. Feedback banner
(tone-colored win/loss) shows correct/incorrect + engine's best move; "Next →" advances. Session stats
(correct / attempted, card N of M) render in a compact page strip. Board orientation follows `fen`
side-to-move so the user always sees pieces "from their side".

## Dependency

`ts-fsrs` (MIT) — Node ≥ 20. Default `generatorParameters()` used; no per-user tuning. Bun-compatible.
