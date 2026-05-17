# Stats

## Files

| File | Purpose |
|---|---|
| `server/routes/stats.ts` | `/api/stats/:username/{by-side,win-rate,elo-trend,by-time-of-day}` |
| `server/lib/openings.ts` | TSV loader + `classifyOpening(sanMoves)` longest-prefix match |
| `server/lib/backfill.ts` | Hybrid opening backfill on startup |
| `server/data/openings/{a..e}.tsv` | lichess-org/chess-openings (CC0, ~3700 lines) |
| `client/src/pages/Stats.tsx` | Tabbed dashboard page (`/stats?username=…`) |
| `client/src/components/EloTrendChart.tsx` | uPlot line chart |

## Endpoints

### `GET /api/stats/:username/by-side`
Returns `{ white: SideStats, black: SideStats }`. `SideStats = { games, wins, draws, losses, win_rate, avg_accuracy, blunders_per_game }`. Implemented as single GROUP-BY-side join over `games` LEFT JOIN `game_metrics`.

### `GET /api/stats/:username/win-rate?slice=color|time_class|rating_bucket|opening&from=&to=`
Returns `Array<{ key, games, wins, draws, losses, win_rate, avg_accuracy, opening? }>`.

| Slice | GROUP BY | Bucketing |
|---|---|---|
| `color` | white/black | from `lower(white) = lower(username)` |
| `time_class` | `g.time_class` (NULLs → `"unknown"`) | |
| `rating_bucket` | opponent_elo - user_elo | `<-200`, `-200..-100`, `±100`, `+100..+200`, `>+200` |
| `opening` | `g.eco` | surface `g.opening` as label |

`from` / `to` are unix-epoch second filters applied to `g.end_time`.

### `GET /api/stats/:username/elo-trend?time_class=blitz`
Returns `EloTrendPoint[] = [{ t, elo }]` ordered ASC by `end_time`. Filters rows where `user_elo IS NULL`.

### `GET /api/stats/:username/by-time-of-day`
Returns `TimeOfDayBucket[] = [{ hour, day, games, wins, win_rate }]`. Converts `end_time` to local timezone via `USER_TZ` env (default `America/Los_Angeles`); `USER_TZ` is read **lazily** on each call so tests can override.

## Opening classification (DESIGN D7)

Hybrid: PGN `[ECO]` / `[Opening]` headers first, fall back to `classifyOpening(pgnToMoves(pgn).map(m => m.san))`. The fallback uses CC0 TSV data from lichess-org/chess-openings, loaded once at startup, sorted longest-prefix-first for O(N) first-match lookup. Headers are never overridden when present.

## UI

`/stats?username=X` page has 6 tabs:

- **By Side** — 2-column card grid showing W-D-L, win rate, accuracy, blunders/game.
- **By Time Class / By Opening / By Rating** — HTML bar charts (CSS bars, no canvas).
- **Elo Trend** — uPlot line chart with time-class selector.
- **Time of Day** — 7×24 HTML table; cell opacity scales with game count, tooltip shows win rate.

Reached from Home via a "Stats →" link in the header (visible once a username is loaded).

## Migrations introduced in Phase 2

- Migration #5 — `annotations(id, t, time_class, text)` + `idx_annotations_time_class`. CRUD endpoints deferred — render-only.
