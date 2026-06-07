# Stats

## Files

| File | Purpose |
|---|---|
| `server/routes/stats.ts` | `/api/stats/:user/{by-side,win-rate,elo-trend,accuracy-trend,by-time-of-day,motifs,drill-progress}` |
| `server/lib/openings.ts` | TSV loader + `classifyOpening(sanMoves)` longest-prefix match |
| `server/lib/backfill.ts` | Hybrid opening backfill on startup |
| `server/data/openings/{a..e}.tsv` | lichess-org/chess-openings (CC0, ~3700 lines) |
| `client/src/pages/Stats.tsx` | Sectioned dashboard page (`/stats?username=…`) — Overview / Trends / Openings / Patterns |
| `client/src/components/EloTrendChart.tsx` | uPlot line chart (rating series) |
| `client/src/components/AccuracyTrendChart.tsx` | uPlot line chart (per-game accuracy series, green, Y pinned 0–100) |

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

### `GET /api/stats/:username/accuracy-trend?time_class=blitz`
Returns `AccuracyTrendPoint[] = [{ t, accuracy }]` ordered ASC by `end_time`. Uses the user-side accuracy from `game_metrics` (white when `lower(games.white) = lower(username)`, else black). Inner-JOIN with `game_metrics` so games without computed metrics are excluded.

### `GET /api/stats/:username/by-time-of-day`
Returns `TimeOfDayBucket[] = [{ hour, day, games, wins, win_rate }]`. Converts `end_time` to local timezone via `USER_TZ` env (default `America/Los_Angeles`); `USER_TZ` is read **lazily** on each call so tests can override.

### `GET /api/stats/:username/motifs?from=&to=`
Returns `Array<{ tag, count, example_game_id, example_move_index }>` ordered by count DESC. Filtered to **user-side** blunders only via mover-parity: white iff `(move_index - 1) % 2 = 0`. See [motifs.md](motifs.md).

### `GET /api/stats/:username/drill-progress`
Returns `{ total_attempts, accuracy_pct, due_today, current_streak }`. Streak is consecutive server-local days ending today with at least one correct drill attempt.

## Opening classification (DESIGN D7)

Hybrid: PGN `[ECO]` / `[Opening]` headers first, fall back to `classifyOpening(pgnToMoves(pgn).map(m => m.san))`. The fallback uses CC0 TSV data from lichess-org/chess-openings, loaded once at startup, sorted longest-prefix-first for O(N) first-match lookup. Headers are never overridden when present.

## UI

`/stats?username=X` is a **sectioned dashboard** (a `Tabs` section-nav, not 15 flat tabs). Each section
shows several panels at once so multiple metrics read at a glance (see [ui-ux.md](ui-ux.md)). Panels are
`Card`s; KPIs are `StatTile`s; charts/heatmap use the shared `lib/theme-colors.ts` palette.

| Section | Panels |
|---|---|
| **Overview** (default) | By side · Performance/TPR (time-class `SegmentedControl`) · Consistency · Drill progress · Win rate by time class (CSS bars) |
| **Trends** | Elo / Accuracy charts + ACL-trend table, driven by one shared time-class `SegmentedControl` |
| **Openings** | Repertoire (white/black toggle) · By opening (CSS bars) |
| **Patterns** | Blundered motifs (deep-links `/analysis/:id?move=N`) · Leak closure · By opponent rating · Win rate by rating bucket · Time-of-day 7×24 heatmap |

Backend endpoints are unchanged — the consolidation is purely a client-side regrouping of the same
queries. Reached from the persistent top navbar's "Stats" link (carries `?username=`).

## Migrations introduced in Phase 2

- Migration #5 — `annotations(id, t, time_class, text)` + `idx_annotations_time_class`. CRUD endpoints deferred — render-only.
