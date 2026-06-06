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
moveAccuracy= after >= before ? 100
            : clamp(0, 100, 103.1668100711649 * exp(-0.04354415386753951 * wp_delta) - 3.166924740191411 + 1)
mateToCp    = sign(mate) * 1000                                       // mate normalisation
```

`wp_delta` is in **percentage points** (Win% in 0..100) — Lichess constants assume that scale. The
`moveAccuracy` constants are verbatim from lila `AccuracyPercent.fromWinPercents`; the trailing `+1`
is the "uncertainty bonus".

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

- **Accuracy**: the exact Lichess game-accuracy aggregation (lila `AccuracyPercent`). Built from the full White-perspective Win% sequence via two helpers in `metrics.ts`:
  - `plyAccuracies(winPctWhite)` → per-ply `{ accuracy, weight }`. Window size = `clamp(floor(plies/10), 2, 8)`; the windows list is `(windowSize−2)` copies of the leading window followed by a sliding window over the sequence (1:1 with plies). `weight = clamp(populationStdDev(window), 0.5, 12)` (volatility weighting). Per-ply accuracy is from the mover's perspective.
  - `combineAccuracy(entries)` → `(weightedMean + harmonicMean) / 2`. The harmonic mean floors each accuracy at 1 to avoid div-by-zero; it is what makes a single big blunder hurt more than a plain average would.
  - `gameMetrics` slices the per-ply entries by index parity (even = White) to get each side's accuracy.

  > This is bit-for-bit the lila formula (verified against `AccuracyPercent.scala` + scalalib `Maths.scala`), replacing the previous bucket model. The cutover is migration #12 (`DELETE FROM game_metrics`, `METRICS_VERSION = 2`).

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
