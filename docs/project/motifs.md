# Motifs

## Files

| File | Purpose |
|---|---|
| `server/lib/motifs.ts` | Pure detectors for 6 tactical motifs (chess.js + ray-tracing) |
| `server/lib/motif-tagging.ts` | `tagMoveIfBlunder` — classifies a move, runs detectors on mistake/blunder, writes `blunder_tags` |
| `server/lib/backfill.ts` | `backfillMotifs(limit=50)` — retrofits tags for previously-analyzed games at startup |
| `server/routes/analyze.ts` | Live tagging inside the SSE loop (best-effort, swallows detector errors) |
| `server/routes/stats.ts` | `GET /api/stats/:username/motifs` — counts per tag, filtered to user-side blunders |
| `server/routes/games.ts` | `GET /api/games/:id` response includes `motifs: Record<moveIndex, Motif[]>` |
| `client/src/components/MoveList.tsx` | Optional `motifs` prop — abbreviated chip next to tagged moves |
| `client/src/pages/Stats.tsx` | "Motifs" tab with recurring-mistake counts + example deep-links |

## The six motifs (DESIGN D9)

| Tag | Heuristic |
|---|---|
| `missed_mate` | `scoreMateBefore !== null && scoreMateBefore !== 0 && scoreMateAfter === null` |
| `back_rank_mate` | Replay `bestPv`; final move is `isCheckmate()` AND mating piece lands on rank 1 or 8 |
| `fork` | After `bestMove`, the moved piece attacks ≥ 2 enemy pieces of value ≥ 3 |
| `pin` | Sliding piece ray hits an enemy piece with a *more* valuable enemy piece behind it on the same ray |
| `skewer` | Sliding piece ray hits an enemy piece with a *less* valuable enemy piece behind it on the same ray |
| `hanging_piece` | After `playedMove`, a mover's piece is attacked with no equal-or-greater defender |

## Priority + cap

`detectMotifs` returns up to **3 tags per position**, ordered:
`missed_mate > back_rank_mate > fork > pin > skewer > hanging_piece`

This caps DB rows per position at 3 to prevent motif-spam from over-eager heuristics.

## Mover-side filtering

`blunder_tags.move_index` is the AFTER-position index. The mover for a transition is white iff `(move_index - 1) % 2 === 0`. `computeMotifStats` filters to the user's moves only:

```
(user is white AND (move_index - 1) % 2 = 0)
 OR
(user is black AND (move_index - 1) % 2 = 1)
```

## Endpoints

`GET /api/stats/:username/motifs?from=&to=` → `Array<{ tag, count, example_game_id, example_move_index }>` ordered by count DESC.

## Backfill behavior

`backfillMotifs(database, limit=50)` runs at server startup. Selects games with `multipv_rank=1` analysis rows but no `blunder_tags` entries (NOT EXISTS guard) — idempotent. Capped at 50 games per call. Per-game errors are swallowed.
