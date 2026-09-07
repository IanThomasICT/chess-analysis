# Handoff — Gallery & Analysis UI Improvements

Branch: `feat/game-metrics`. Scope: gallery lazy-loading, settings modal, 60-day
patterns window, Analysis critical-move surfacing + scrubber.

## Decisions

- **Settings contents:** username + default time-class only. Stats lookback left
  hardcoded at 60 days (not made configurable).
- **Stepper replacement:** scrubber slider with blunder/mistake tick marks (not a
  restyled-arrows variant).
- **Critical moves source:** server `criticalMoves` (top-3 user moves by
  criticality from `GET /api/metrics/game/:id`), reused rather than recomputed
  client-side. Navigated via `plyIndex` (= position index after the move).
- **Bounds buttons disabled** at first/last move (UX); two e2e "does not go beyond"
  tests changed to assert `isDisabled()` instead of clicking.
- **e2e not run live** — the user's existing `bun run dev` holds ports 5173/3001
  against `analysis.db`, so `dev:e2e` (needs them free for `test.db`) can't bind.
  Test code updated to new handles but unverified at runtime.

## Work done

### 1. Lazy gallery — `client/src/pages/Home.tsx`
All games fetched once; grid renders `PAGE_SIZE` (25), an `IntersectionObserver`
sentinel grows the window +25 as it nears the viewport. Window resets on
filter/sort/username change.

### 2. Settings modal (removed navbar input + search box)
- `client/src/context/Settings.tsx` (new) — localStorage prefs (`defaultTimeClass`),
  `useSettings()`.
- `client/src/components/SettingsModal.tsx` (new) — dialog: `input[name="username"]`
  (applied on **Save**) + default time-class. Closes on Esc / backdrop / button.
- `client/src/components/AppShell.tsx` — replaced the username form with a gear
  button opening the modal; wrapped tree in `SettingsProvider`.
- `Home.tsx` — removed opponent search input/filter; time-class filter defaults to
  the saved pref until the user overrides it in-session.

### 3. Patterns = last 60 days
- `server/routes/stats.ts` — added optional `from`/`to` epoch bounds to
  `computeLeakClosure`, `computeVsOpponent`, `computeByTimeOfDay` (+ their routes).
  `motifs` and rating-bucket `win-rate` already supported it.
- `client/src/api.ts` — added `dateRangeQuery()` helper; threaded `from`/`to` into
  `fetchMotifStats`, `fetchLeakClosure`, `fetchVsOpponent`, `fetchByTimeOfDay`.
- `client/src/pages/Stats.tsx` — `PatternsSection` computes a memoised
  `from = now − PATTERN_WINDOW_DAYS(60)d` and passes it to motifs/leak/vs-opponent/
  rating-bucket/time-of-day; added an explanatory note. Other sections unchanged.

### 4. Clickable badges → blunder, and 5. critical moves in base view
- `client/src/components/GameReviewSummary.tsx` (new) — always-visible digest above
  the rail tabs: result-quality chip, Elo delta, time-trouble, and top-3 critical
  moves as buttons that jump the board (`onSelectMove(plyIndex)`).
- `client/src/pages/Analysis.tsx` — always-visible accuracy strip (you/opp %); user
  blunder chip is a button jumping to next blunder via `goToNext("blunder")`.
  Removed the duplicate accuracy strip from the Moves tab. Added
  `invalidateQueries(["metricDetail", id])` on SSE `done` so the digest appears live.

### 6. Stepper → scrubber — `client/src/components/MoveScrubber.tsx` (new)
Draggable range slider; red/orange ticks at the user's blunders/mistakes (clickable);
icon prev/next/first/last/flip (aria-labelled, disabled at bounds); `N / M` counter.
Replaced the `« ‹ N/M › »` stepper in `Analysis.tsx`.

### e2e updates (handles only; not executed)
- `home.test.ts` — dropped search tests; username test now opens settings modal;
  count-badge test uses the time-class filter.
- `shell.test.ts` — username set via settings dialog (Open settings → fill → Save).
- `analysis.test.ts` — nav locators use aria-labels (`Next move`, etc.); SAN matched
  with `exact: true`; two boundary tests assert `isDisabled()`.

### Docs
Updated `docs/project/ui-ux.md`, `docs/project/gallery.md`, `docs/project/stats.md`, `docs/README.md`.

## Verification
- `bun run validate` ✓ (typecheck + lint + build)
- `bun run test` ✓ (466 pass)
- `bun run test:e2e` ✓ (66 pass) — run live against `test.db`.

## Post-handoff fixes

### Gallery "not loading" — root cause was server-side, not the lazy grid
`GET /api/games` awaited a 6-month Chess.com archive pull on **every** page load
(~11.8s for a real account; DB read itself is 13ms), so the gallery sat on
"Loading games…" each visit. Fixed in `server/routes/games.ts`: extracted
`syncFromChessCom()` and made the route **cache-first** — serve the DB cache
immediately and refresh in the background; only `await` the sync when nothing is
cached yet (first import). An `inFlightSync` set dedupes concurrent syncs.
Time-to-first-card: ~12.5s → ~instant. (See `docs/project/gallery.md`.)

### Accuracy strip now updates live (was the known limitation below)
The strip's `["metrics"]` query is `enabled` on `data.analyzed`. SSE `done` only
invalidated `["metrics"]`/`["metricDetail"]`, never `["game"]`, so `analyzed`
stayed false and the (disabled) query never ran until reload. SSE `done` now also
invalidates `["game", id]`, flipping `analyzed` true → query enables → strip shows
live, matching `GameReviewSummary`.

### e2e reconciled with the redesign
- `e2e/fixtures.ts` — seed `end_time`s anchored to `now − 1/2/3 days` (were fixed
  Jan-2025 epochs, ~510 days old) so the Stats **Patterns 60-day window** includes
  them. Fixed epochs fall out of the window as wall-clock advances.
- `home.test.ts` — player-name count scoped to gallery cards (navbar now also
  renders the active username).
- `metrics.test.ts` — "Clean win" matched with `.first()` (quality shows in both
  the always-visible digest and the Report card).

## Follow-ups / known limitations
- `defaultTimeClass` is the only persisted preference; extend `Settings` if more are
  wanted (board orientation, sort, lookback days were considered but not built).
- Background Chess.com refresh means brand-new games appear on the *next* gallery
  load, not the current one. Acceptable for a single-user tool; add a manual
  "refresh" affordance if desired.

## Simplification pass (post-review)

`/simplify` over PR #1 (reuse / simplification / efficiency / altitude agents). Applied:

- `server/routes/stats.ts` — `:username` validated once via `stats.use("/stats/:username/*")`;
  `parseDateRange(c)` + `dateRange(column, from, to)` replace 5 hand-rolled `from`/`to` blocks;
  `USER_WON` / `USER_LOST` SQL predicates replace 7 copy-pasted CASE fragments; dead
  `CASE … THEN x ELSE x` in vs-opponent removed; ACL rolling mean is O(n) (was O(n·window)).
  1379 → 1307 lines, same endpoints, tests unchanged.
- `MetricsCard.tsx` now exports `ReportHeader` + `CriticalMoveRow` (optional `onSelect`);
  `GameReviewSummary.tsx` reuses them (was a verbatim copy that had already drifted).
- `client/src/api.ts` — dropped never-called wrappers (`fetchSessionFatigue`, `fetchCounterplay`,
  `fetchEndgameConversion`, `metricsExportUrl`) and their client-side types; `fetchByTimeOfDay` /
  `fetchMotifStats` go through `fetchStat`. Server endpoints kept (R22/R31/R32, tested, URL-reachable).
- `Username` context merged into `Settings` — one `SettingsProvider`, one `useSettings()` returning
  `{ username, setUsername, settings, updateSettings }`.
- `GET /games/:id` checks `metricsAreFresh` before `computeAndStoreMetrics` (was re-deriving the full
  timeline on every game-detail fetch). `explorer.ts` uses `db.query()` (cached statements).

Considered, not done:
- Migrations #13/#14 (`players` table added then dropped) could collapse to one — but `analysis.db`
  is already at user_version 14; collapsing would break the live DB. Leave.
- `vs_bot IS NOT 1` at 4 read sites is belt-and-suspenders over the import-time skip. Harmless; left.
- `Stats.tsx` `Loading/Failed` branching per card — readable as is; a `QueryBoundary` wrapper would
  save ~4 lines × 13 cards. Not worth the indirection.
- L0→L1→L2 metrics split (`ply-timeline` → `game-metrics` → `metrics-store`): every module has
  multiple real callers (routes + backfill script); not over-abstraction.
- e2e not re-run: port 3001 is held by the live `bun run dev` against `analysis.db`.
- Follow-up: `bunx knip` over the branch removed the unused `minimatch` dep, two dead functions
  (`getGameAnalysisMultiPV`, `openings._resetForTests`), dead `NAVBAR_H` / `IMPULSE_*` constants, and
  un-exported ~15 internal-only symbols. Knip is now a dev dep, part of `bun run validate`.
