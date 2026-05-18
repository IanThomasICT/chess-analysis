# Metrics

## Files

| File | Purpose |
|---|---|
| `server/lib/metrics.ts` | Pure Lichess D1 formulas + `gameMetrics()` per-side aggregator |
| `server/routes/games.ts` | `GET /api/games/:gameId/metrics`, `GET /api/games/metrics?username=…` |
| `server/routes/stats.ts` | `GET /api/stats/:username/by-side` |
| `server/routes/analyze.ts` | Invalidates `game_metrics` cache on SSE start |
| `shared/classify.ts` | `MoveClass` enum + thresholds (used by both client + server) |
| `client/src/components/GameCard.tsx` | Renders accuracy + blunder chips |
| `client/src/components/StatsPanel.tsx` | Renders Home page by-side panel |

## Formulas (DESIGN D1)

`cp` clamped ±1000.

```
Win%        = 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)         // [0, 100]
moveAccuracy= clamp(0, 100, 103.1668 * exp(-0.04354 * wp_delta) - 3.1669 + 1)
mateToCp    = sign(mate) * 1000                                       // mate normalisation
```

`wp_delta` is in **percentage points** (Win% in 0..100) — Lichess constants assume that scale.

## Classification thresholds (wp_delta on [0, 1])

| Class | Lower bound |
|---|---|
| best | (wp_delta ≤ 0.02) |
| good | — |
| inaccuracy | ≥ 0.10 |
| mistake | ≥ 0.20 |
| blunder | ≥ 0.30 |

`classifySwing` takes wp_delta on [0, 1] scale. `classifyMove(wpBefore, wpAfter)` in metrics.ts converts and delegates.

## Per-side aggregation

`gameMetrics(positions: AnalysisRow[]): { white, black }` walks position transitions `i → i+1`. The mover for transition `i` is `i % 2 === 0 ? "w" : "b"`.

- **Accuracy**: bucket-based Chess.com-style score, computed by `aggregateAccuracy(classes)`. Each move gets a bucket score from its classification:

  | Class | Score |
  |---|---|
  | best | 100 |
  | good | 90 |
  | inaccuracy | 70 |
  | mistake | 40 |
  | blunder | 10 |

  Consecutive blunders past the first in a run are weighted at `CONSECUTIVE_BLUNDER_DAMPING = 0.3` so one bad streak doesn't tank the whole game's number. Final value = weighted mean of bucket scores.

  > Chess.com's CAPS2 is proprietary. This shape matches their published behaviour (category-based, with multi-blunder dampening) and produces numbers in the same range, but is not a bit-exact replica.

- **Blunders / mistakes / inaccuracies**: counts per side from `classifyMove`. All plies count (opening book included for visibility).
- **ACL**: `mean(max(0, cpBefore - cpAfter))` per side, skipping the first 8 plies. Per-move loss capped at 1000.

Empty `positions` → all zeros (no NaN).

## Cache

`game_metrics` table holds the per-game result. `computeAndCacheMetrics(db, gameId)` is the canonical helper; the per-game endpoint and bulk endpoint both go through it. The bulk endpoint caps compute-on-the-fly to 20 misses per request (`BULK_COMPUTE_LIMIT`); beyond that, returns `null` per gameId and the client lazy-loads as cards come into view.

The cache is invalidated by deleting the row when an analyze SSE stream opens for that gameId.

## Endpoints

| Endpoint | Returns |
|---|---|
| `GET /api/games/:id/metrics` | `{ gameId, white: PerSideMetrics, black: PerSideMetrics, computedAt }` (404 if unanalyzed) |
| `GET /api/games/metrics?username=X` | `Record<gameId, GameMetrics \| null>` for the user's games |
| `GET /api/stats/:username/by-side` | `{ white: SideStats, black: SideStats }` (wins, draws, losses, win_rate, avg_accuracy, blunders_per_game) |

> **Note**: `GET /api/games/metrics` is registered **before** `GET /api/games/:gameId` in `server/routes/games.ts`. Hono matches routes in declaration order; without the hoist, the literal string `"metrics"` gets captured as a `:gameId` and the route returns 404.
