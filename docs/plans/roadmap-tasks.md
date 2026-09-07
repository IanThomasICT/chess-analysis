# PLAN.md — Implementation Tasks

Granular task list for executing `roadmap-design.md`. Each task is self-contained: files, steps, schema/code shape, tests, acceptance criteria, dependencies. Order within a phase reflects build order; phases ship independently after Phase 0.

## Conventions

- **Task ID**: `P{phase}.{n}` — e.g. `P0.3`. Used in commit messages and as dependency references.
- **Commit format**: `<type>(<scope>): <description>` — conventional commits. One task = one or more atomic commits. Scope examples: `db`, `engine`, `stats`, `home`, `analysis`, `drill`.
- **Test approach**: TDD where practical. Server pure functions (metrics, motifs, classify, openings, pgnHeaders) get unit tests in `tests/`. Routes get integration tests via `bun test` + fetch. Client gets one e2e per phase exit in `e2e/`.
- **Definition of Done (per task)**:
  1. Code + tests committed.
  2. `bun run lint` clean, `bun test` green, e2e relevant test green.
  3. Acceptance criteria verified manually in browser (UI tasks).
  4. Doc updates (`docs/core.md` schema, `docs/README.md` index) when surface changes.
- **Out of scope for any task**: unrelated refactors, comment cleanups, dependency bumps. Stay surgical.

## Glossary

- **wp_delta**: Win-percent delta (mover's perspective), `Win%_before − Win%_after`, clamped ≥ 0.
- **fen_key**: FEN with halfmove/fullmove counters stripped — first 4 space-separated fields. Used for transposition matching.
- **user_color**: From `games`: `"w"` if `games.username == lower(games.white)` else `"b"`.
- **opening book plies**: First 8 plies, skipped from ACL and not classified as blunders by default.

---

# Phase 0 — Foundation

Unblocks every later phase. No user-visible changes; existing UI keeps working.

## P0.1 — Migration runner + `meta` table

**Files**: `server/lib/db.ts`

**Steps**:
1. Add a `meta(key TEXT PRIMARY KEY, value TEXT)` table created at startup.
2. Define `migrations: Array<{ id: number; up: () => void }>` inline in `db.ts`.
3. Add `runMigrations()`: reads `meta.schema_version` (default 0), runs all migrations with `id > current` in a transaction, writes new version.
4. Call `runMigrations()` after schema bootstrap.
5. Migration #1 is empty (acts as seed) — sanity check that the runner works.

**Schema**:
```sql
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
```

**Tests** (`tests/migrations.test.ts`):
- Fresh DB → version moves to head.
- Re-run → no-op (idempotent).
- Migration list with sequential IDs.

**Acceptance**: `bun run dev` boots; `SELECT value FROM meta WHERE key = 'schema_version'` returns latest ID.

**Depends on**: none.

---

## P0.2 — `pgnHeaders()` helper

**Files**: `server/lib/pgn.ts`, `tests/pgn.test.ts`

**Steps**:
1. Add `export function pgnHeaders(pgn: string): Record<string, string>`. Regex `/^\[(\w+)\s+"([^"]*)"\]/gm`, return record.
2. Refactor `getGameResult()` to call `pgnHeaders(pgn).Result`. Keep its public signature.

**Tests**:
- Standard Chess.com PGN → expected `ECO`, `White`, `Black`, `Result`, `WhiteElo`, `BlackElo`, `TimeControl`.
- PGN with quotes/escapes inside header values → still parses correctly.
- Missing headers → empty record fields (not throw).

**Acceptance**: unit tests green.

**Depends on**: none.

---

## P0.3 — `games` schema extensions + backfill

**Files**: `server/lib/db.ts` (migration), `server/lib/backfill.ts` (new)

**Steps**:
1. Migration #2:
   ```sql
   ALTER TABLE games ADD COLUMN white_elo INTEGER;
   ALTER TABLE games ADD COLUMN black_elo INTEGER;
   ALTER TABLE games ADD COLUMN user_elo INTEGER;
   ALTER TABLE games ADD COLUMN eco TEXT;
   ALTER TABLE games ADD COLUMN opening TEXT;
   ```
2. Migration #3:
   ```sql
   CREATE INDEX IF NOT EXISTS idx_analysis_fen ON analysis(fen);
   ```
3. New `server/lib/backfill.ts`: `backfillGameHeaders()`. Selects rows where `white_elo IS NULL`. For each, parse `pgnHeaders()`, compute `user_elo` from `username` + side, update.
4. Call `backfillGameHeaders()` at server start, after migrations. Idempotent (WHERE clause filters already-backfilled rows).

**Tests** (`tests/backfill.test.ts`):
- Seed DB with 3 unbackfilled games → `backfillGameHeaders()` populates all 5 columns.
- Re-run → 0 updates.

**Acceptance**: `SELECT COUNT(*) FROM games WHERE white_elo IS NULL` returns 0 after first server start with existing data.

**Depends on**: P0.1, P0.2.

---

## P0.4 — Engine abstraction (`stockfish.ts` → `engine.ts`)

**Files**: rename `server/lib/stockfish.ts` → `server/lib/engine.ts`. Update imports in `server/routes/analyze.ts`, `server/routes/games.ts`.

**Steps**:
1. Rename file.
2. Add env-driven config block:
   ```ts
   const ENGINE_TYPE = (process.env.ENGINE_TYPE ?? "stockfish") as "stockfish" | "lc0";
   const ENGINE_PATH = process.env.ENGINE_PATH ?? ENGINE_TYPE;
   const WEIGHTS_PATH = process.env.WEIGHTS_PATH;
   const ENGINE_BACKEND = process.env.ENGINE_BACKEND ?? "cudnn-fp16";
   const MAX_CONCURRENT_ANALYSES = ENGINE_TYPE === "lc0" ? 1 : 2;
   ```
3. In `init()`/`spawnStockfish()` (rename to `spawnEngine()`):
   - Always send `uci`, wait for `uciok`.
   - If `ENGINE_TYPE === "lc0"`: send `setoption name WeightsFile value ${WEIGHTS_PATH}` and `setoption name Backend value ${ENGINE_BACKEND}`. Throw at startup if `WEIGHTS_PATH` unset.
   - If `ENGINE_TYPE === "stockfish"`: keep existing `Threads`/`Hash` options.
4. `readUntilBestMove` and `analyzeSinglePosition` unchanged (UCI protocol identical).
5. Update `.gitignore`: add `*.pb.gz` and `weights/`.

**Tests**: existing `tests/stockfish.test.ts` renamed → `tests/engine.test.ts`. No behavior change for default Stockfish path.

**Acceptance**:
- Default (`bun run dev`) behaves identically to today.
- `ENGINE_TYPE=lc0 WEIGHTS_PATH=/path/to/BT4.pb.gz bun run dev` boots without error (if Lc0 binary present).

**Depends on**: P0.1.

---

## P0.5 — Extract `classifySwing` to shared lib + return enum

**Files**: `client/src/lib/classify.ts` (new), `client/src/pages/Analysis.tsx`, `client/src/components/MoveList.tsx`

**Steps**:
1. New `client/src/lib/classify.ts`:
   ```ts
   export type MoveClass = "best" | "good" | "inaccuracy" | "mistake" | "blunder";
   export function classifySwing(wpDelta: number): MoveClass { ... }
   export function classToColor(c: MoveClass): string { ... } // CSS class
   ```
2. Implementation uses Lichess WP-delta thresholds (0.1 / 0.2 / 0.3) per `roadmap-design.md#D1`. Initial: take `cpBefore`/`cpAfter` or `wpDelta` directly — pick the lower-friction signature.
3. `Analysis.tsx`: remove inline `classifySwing`, import from lib. Replace `moveClasses: string[]` memo with `moveClassifications: MoveClass[]`. Derive CSS via `classToColor()` at render.
4. `MoveList.tsx`: prop changes from `moveClasses: string[]` to `classifications: MoveClass[]` + internal `classToColor()` call.

**Tests** (`tests/classify.test.ts` — server-runnable since lib is pure):
- Move with wpDelta 0 → `"best"`.
- wpDelta 0.05 → `"good"`.
- wpDelta 0.15 → `"inaccuracy"`.
- wpDelta 0.25 → `"mistake"`.
- wpDelta 0.35 → `"blunder"`.

**Acceptance**: Analysis page renders identical move colors as before refactor. Visual diff: none.

**Depends on**: none.

---

## P0.6 — Wire Phase 0 changes into import flow

**Files**: `server/routes/games.ts`

**Steps**:
1. In the upsert in `gamesRouter`, extend SQL to include `white_elo`, `black_elo`, `user_elo`, `eco`, `opening`:
   ```sql
   INSERT INTO games (id, username, pgn, white, black, result, time_class, end_time,
                      white_elo, black_elo, user_elo, eco, opening)
   VALUES (...) ON CONFLICT(id) DO UPDATE SET ...
   ```
2. Compute fields per game: `const h = pgnHeaders(g.pgn); const userColor = ... ; const userElo = userColor === "w" ? Number(h.WhiteElo) : Number(h.BlackElo);`
3. Update `GameRow` interface in `client/src/api.ts` with new optional fields.

**Tests** (`tests/games-route.test.ts`):
- Mock chess.com fetch → import 2 games → SELECT shows ECO + Elo populated.

**Acceptance**: importing a fresh username populates all new columns directly (no backfill needed for new rows).

**Depends on**: P0.2, P0.3.

---

**Phase 0 exit gate**: existing app behavior unchanged. New columns populated for old + new games. Engine abstraction in place. `classifySwing` extracted.

---

# Phase 1 — Metric Loop

User-visible: accuracy + blunder chips on game cards, side-of-board panel, "worst games first" sort.

## P1.1 — `metrics.ts` pure module

**Files**: `server/lib/metrics.ts` (new), `tests/metrics.test.ts`

**Steps**:
1. Pure functions, no DB access:
   ```ts
   export function cpToWinPct(cp: number): number;          // D1 sigmoid, cp clamped ±1000
   export function mateToCp(mate: number): number;          // sign(mate) * 1000
   export function moveAccuracy(wpBefore: number, wpAfter: number): number; // 0..100
   export function classifyMove(wpBefore: number, wpAfter: number): MoveClass;
   export interface PerSideMetrics { accuracy: number; blunders: number; mistakes: number; inaccuracies: number; acl: number; }
   export function gameMetrics(positions: AnalysisRow[], userColor: "w" | "b"): { white: PerSideMetrics; black: PerSideMetrics };
   ```
2. `gameMetrics`: iterate positions in order. For each position transition `i → i+1`, the moving side is `i % 2 === 0 ? "w" : "b"`. Compute wpBefore/wpAfter from that side's perspective. Update per-side accumulators. Skip first 8 plies for ACL only (still classify for blunder counts — per D1).
3. Game accuracy: arithmetic mean of per-move accuracy (v1, per D1).

**Tests**:
- Known position fixture (10 moves, hand-computed accuracy) → matches.
- Mate-only game → no NaN.
- Empty positions array → zeros.
- Mover identification matches expected (white=even index, black=odd).

**Acceptance**: 90%+ test coverage on `metrics.ts`.

**Depends on**: P0.5 (shares `MoveClass` enum — move classifyMove to `server/lib/metrics.ts` AND expose as the source for client `classify.ts` to import via shared TS path, OR duplicate constants — see note below).

**Note**: `classify.ts` (client) and `metrics.ts` (server) both need the same thresholds. Options: (a) create `shared/classify.ts` and reference from both `client/tsconfig.json` and `server/tsconfig.json` paths, or (b) duplicate the 4 threshold numbers. **Recommendation**: option (a) — single source of truth.

---

## P1.2 — `game_metrics` table + cache invalidation

**Files**: `server/lib/db.ts` (migration #4), `server/routes/analyze.ts`

**Steps**:
1. Migration #4:
   ```sql
   CREATE TABLE IF NOT EXISTS game_metrics (
     game_id TEXT PRIMARY KEY,
     accuracy_white REAL NOT NULL,
     accuracy_black REAL NOT NULL,
     blunders_white INTEGER NOT NULL,
     mistakes_white INTEGER NOT NULL,
     inaccuracies_white INTEGER NOT NULL,
     blunders_black INTEGER NOT NULL,
     mistakes_black INTEGER NOT NULL,
     inaccuracies_black INTEGER NOT NULL,
     acl_white REAL NOT NULL,
     acl_black REAL NOT NULL,
     computed_at INTEGER NOT NULL
   );
   ```
2. In `analyze.ts` SSE loop, on each `analysis` upsert: `DELETE FROM game_metrics WHERE game_id = ?`. Single statement, cheap.

**Tests**: covered by P1.3.

**Acceptance**: analyzing a game clears cached metrics for that game.

**Depends on**: P0.1.

---

## P1.3 — `GET /api/games/:gameId/metrics` endpoint

**Files**: `server/routes/games.ts`, `client/src/api.ts`, `tests/games-route.test.ts`

**Steps**:
1. New route `GET /api/games/:gameId/metrics`:
   - Try `SELECT * FROM game_metrics WHERE game_id = ?`. If hit, return.
   - Miss: `SELECT * FROM analysis WHERE game_id = ? ORDER BY move_index`. If empty → 404 "not analyzed". Else compute via `gameMetrics()`, upsert into `game_metrics`, return.
2. `client/src/api.ts`: `interface GameMetrics`, `fetchGameMetrics(gameId)`.

**Tests**:
- 404 on unanalyzed game.
- 200 hits cache on second call (verify `computed_at` unchanged).
- Cache invalidated after re-analysis → `computed_at` updates.

**Acceptance**: curl-able endpoint returns correct JSON.

**Depends on**: P1.1, P1.2.

---

## P1.4 — `GET /api/games/metrics?username=X` (bulk)

**Files**: `server/routes/games.ts`

**Steps**:
1. New route returning `{ [gameId]: GameMetrics | null }` for all games owned by `username`.
2. Single query joining `games` + `game_metrics`. Compute-on-the-fly for misses up to N=20 to avoid spike; cache misses beyond N return `null` and the client lazy-loads per card.

**Tests**: returns map keyed by game ID, missing entries are `null`.

**Acceptance**: home page can prefetch all metrics in one round-trip.

**Depends on**: P1.3.

---

## P1.5 — `GameCard` accuracy + blunder chips

**Files**: `client/src/components/GameCard.tsx`

**Steps**:
1. Add props: `accuracy?: number`, `blunders?: number`.
2. Render chips inline. Color:
   - Accuracy ≥ 90: green; 70–89: amber; <70: red.
   - Blunders ≥ 3: red badge; 1–2: amber; 0: hide.
3. If `accuracy === undefined`: render skeleton or omit.

**Tests** (`e2e/home.test.ts` extension): a game card with known metrics shows correct chip color.

**Acceptance**: visual check — chips render correctly on game gallery.

**Depends on**: P1.3.

---

## P1.6 — `Home.tsx` metric prefetch + worst-first sort

**Files**: `client/src/pages/Home.tsx`

**Steps**:
1. Add TanStack Query `useQuery(["metrics", username], () => fetchBulkMetrics(username))`.
2. Pass `accuracy` + `blunders` per card.
3. Add sort chip: `"Recent" | "Worst first" | "Best first"`. State + memoized sort.

**Tests** (e2e): clicking "Worst first" reorders cards ascending by accuracy (for cards with metrics).

**Acceptance**: sort works; cards without metrics sort to end of list.

**Depends on**: P1.4, P1.5.

---

## P1.7 — `Analysis.tsx` accuracy chip in header

**Files**: `client/src/pages/Analysis.tsx`

**Steps**:
1. `useQuery` fetch metrics for `gameId`.
2. Render `Accuracy: 87 (W) / 72 (B)` + `🔴 2 blunders, 🟠 3 mistakes` near game header.

**Tests**: visual check.

**Acceptance**: chip values match `gameMetrics()` on the same data.

**Depends on**: P1.3.

---

## P1.8 — `stats.ts` route file + `/by-side` endpoint

**Files**: `server/routes/stats.ts` (new), `server/index.ts`

**Steps**:
1. New Hono sub-router mounted at `/api/stats`.
2. `GET /:username/by-side`:
   ```sql
   SELECT
     SUM(CASE WHEN lower(white) = lower(?) THEN 1 ELSE 0 END) as white_games,
     SUM(CASE WHEN lower(white) = lower(?) AND result = '1-0' THEN 1 ELSE 0 END) as white_wins,
     -- ... black side ...
   FROM games WHERE lower(username) = lower(?)
   ```
3. Join `game_metrics` to compute per-side average accuracy + blunder rate.
4. Return `{ white: { games, wins, draws, losses, win_rate, avg_accuracy, blunders_per_game }, black: { ... } }`.

**Tests** (`tests/stats-route.test.ts`):
- Seed 3 white wins, 1 white loss, 2 black wins → response matches.
- Username case-insensitive.

**Acceptance**: curl returns valid JSON; numbers match hand-count.

**Depends on**: P1.2, P0.6.

---

## P1.9 — `StatsPanel` component on Home

**Files**: `client/src/components/StatsPanel.tsx` (new), `client/src/pages/Home.tsx`, `client/src/api.ts`

**Steps**:
1. Tiny client of `/by-side` endpoint.
2. Horizontal panel: `As White: 24-3-5 (75% win) | 84% acc | 1.2 blunders/game` and same for Black.
3. Slot above gallery, below filter bar.

**Tests**: e2e check — panel renders for seeded user.

**Acceptance**: visible on home, values match endpoint.

**Depends on**: P1.8.

---

**Phase 1 exit gate**: user opens home → sees per-side breakdown + accuracy chips on every analyzed game → sorts by accuracy → opens worst → sees accuracy + blunder count in header.

---

# Phase 2 — Aggregate Dashboards

User-visible: new `/stats` route with multiple slices.

## P2.1 — `openings.ts` library

**Files**: `server/data/openings/a.tsv` … `e.tsv` (new, bundled from lichess-org/chess-openings), `server/lib/openings.ts` (new)

**Steps**:
1. Copy 5 TSV files from `https://github.com/lichess-org/chess-openings` into `server/data/openings/`. License CC0 — note in a `LICENSE` file in that directory.
2. New `openings.ts`:
   ```ts
   export interface OpeningEntry { eco: string; name: string; tokens: string[]; }
   let LOOKUP: OpeningEntry[] = [];
   export function loadOpenings(): void; // called at server start
   export function classifyOpening(sanMoves: string[]): { eco: string; name: string } | null;
   ```
3. `loadOpenings`: read all TSV, strip move numbers from PGN col, tokenize, push.
4. `classifyOpening`: longest-prefix match against `sanMoves`. Sort `LOOKUP` once by `tokens.length DESC` so first match wins.

**Tests** (`tests/openings.test.ts`):
- `["e4", "c5"]` → Sicilian (B20 family).
- `["d4", "Nf6", "c4", "g6"]` → King's Indian setup.
- Empty / unrecognized moves → null.

**Acceptance**: 95%+ of seeded games classify to a non-null opening.

**Depends on**: none.

---

## P2.2 — Hybrid opening backfill

**Files**: `server/lib/backfill.ts`, `server/routes/games.ts`

**Steps**:
1. Extend `backfillGameHeaders()`: after extracting `ECO` from headers, if `ECO` is null/empty, fall back to `classifyOpening(pgnToMoves(pgn))`.
2. New-game import in `games.ts`: same hybrid logic.

**Tests**: seed a game without `[ECO]` header → backfill populates from TSV.

**Acceptance**: `SELECT COUNT(*) FROM games WHERE eco IS NULL` is ~0 after backfill.

**Depends on**: P2.1, P0.3.

---

## P2.3 — Win-rate slice endpoint

**Files**: `server/routes/stats.ts`

**Steps**:
1. `GET /:username/win-rate?slice=color|time_class|rating_bucket|opening&from=&to=`:
   - `slice=color`: group by user_color.
   - `slice=time_class`: `GROUP BY time_class`.
   - `slice=rating_bucket`: `GROUP BY` a CASE expression on `(opponent_elo - user_elo)`. Buckets: `<-200`, `-200..-100`, `±100`, `+100..+200`, `>+200`.
   - `slice=opening`: `GROUP BY eco`. Include `opening` name in output.
2. Return `Array<{ key: string; games: number; wins: number; draws: number; losses: number; win_rate: number; avg_accuracy: number | null }>`.

**Tests**: each slice returns correct grouping.

**Acceptance**: 4 slices each return data.

**Depends on**: P0.6, P1.2.

---

## P2.4 — Elo trend endpoint

**Files**: `server/routes/stats.ts`

**Steps**:
1. `GET /:username/elo-trend?time_class=blitz`:
   ```sql
   SELECT end_time, user_elo FROM games
   WHERE lower(username) = lower(?) AND time_class = ? AND user_elo IS NOT NULL
   ORDER BY end_time
   ```
2. Return `Array<{ t: number; elo: number }>`.
3. Optional table `annotations(id INTEGER PK AUTOINCREMENT, t INTEGER, time_class TEXT, text TEXT)`. Migration #5. CRUD endpoints deferred to a later phase — render-only for now.

**Tests**: ordered by `t` ascending.

**Acceptance**: curl returns time-series JSON for each time class.

**Depends on**: P0.3.

---

## P2.5 — Time-of-day endpoint

**Files**: `server/routes/stats.ts`

**Steps**:
1. `GET /:username/by-time-of-day`:
   - Convert `end_time` (unix UTC) to local TZ via `USER_TZ` env (default `America/Los_Angeles`).
   - Bucket by `hour_of_day` (0–23) × `day_of_week` (0=Sun..6=Sat).
2. Return `Array<{ hour: number; day: number; games: number; wins: number; win_rate: number }>`.

**Tests**: timezone offset applied correctly (use a fixed `end_time` known to land on Mon 10am local).

**Acceptance**: heatmap data renders correctly.

**Depends on**: P0.3.

---

## P2.6 — `/stats` page + nav link

**Files**: `client/src/pages/Stats.tsx` (new), `client/src/App.tsx`, `client/src/pages/Home.tsx`, `client/src/api.ts`

**Steps**:
1. New route `/stats` in `App.tsx`.
2. `Stats.tsx` with tabbed UI: By Side | By Time Class | By Opening | By Rating | Elo Trend | Time of Day.
3. Charts:
   - Win-rate slices: simple bar charts via uPlot.
   - Elo trend: uPlot line chart, one series per time class (selectable).
   - Time of day: HTML grid with bg-color scaling (`bg-green-${intensity}`).
4. Nav link from `Home.tsx` header.

**Tests** (e2e): nav from home to stats, each tab renders without error.

**Acceptance**: all tabs render with data for a seeded user.

**Depends on**: P2.3, P2.4, P2.5.

---

**Phase 2 exit gate**: user navigates to `/stats`, can answer "which openings lose for me as Black", "is my Elo trending up", "what time of day do I lose most".

---

# Phase 3 — Review Velocity

## P3.1 — Next/prev blunder keyboard nav

**Files**: `client/src/pages/Analysis.tsx`, `client/src/lib/classify.ts`

**Steps**:
1. Add to existing keyboard `useEffect`:
   - `B` → find next index `i > currentMove` where `moveClassifications[i] === "blunder"`. Set `currentMove`.
   - `Shift+B` → prev.
   - `M` / `Shift+M` → mistakes.
2. Add small button row under MoveList: `← Blunder | Mistake → | ...`.

**Tests** (e2e): seeded game with known blunder at move 12 → press B → currentMove becomes 12.

**Acceptance**: navigation works, board + eval graph + move list all reflect new position.

**Depends on**: P0.5.

---

## P3.2 — `fen_key` column + index

**Files**: `server/lib/db.ts` (migration #6), `server/lib/backfill.ts`

**Steps**:
1. Migration #6:
   ```sql
   ALTER TABLE analysis ADD COLUMN fen_key TEXT;
   CREATE INDEX IF NOT EXISTS idx_analysis_fen_key ON analysis(fen_key);
   ```
2. Backfill: populate `fen_key = ` first 4 space-separated fields of `fen`.
3. Update `analyze.ts` upsert to compute `fen_key` on write.

**Tests**: backfill is idempotent; new analysis rows have `fen_key` set.

**Acceptance**: every `analysis` row has `fen_key` populated.

**Depends on**: P0.1.

---

## P3.3 — Position recurrence endpoint

**Files**: `server/routes/games.ts` (or new `server/routes/positions.ts`)

**Steps**:
1. `GET /api/positions/history?fen=...&username=X`:
   - Compute `fen_key` from query `fen`.
   - `SELECT a.game_id, a.move_index, a.score_cp, a.score_mate, g.result, g.end_time, g.white, g.black FROM analysis a JOIN games g ON a.game_id = g.id WHERE a.fen_key = ? AND lower(g.username) = lower(?) ORDER BY g.end_time DESC LIMIT 50`.
2. Annotate each row with `was_blunder: boolean` (compare to next position's eval — needs adjacent row lookup; computed in JS for simplicity).

**Tests**: seed 3 games with same FEN at different ply → endpoint returns 3 rows.

**Acceptance**: endpoint returns list with blunder annotations.

**Depends on**: P3.2.

---

## P3.4 — `RecurrencePanel` component

**Files**: `client/src/components/RecurrencePanel.tsx` (new), `client/src/pages/Analysis.tsx`, `client/src/api.ts`

**Steps**:
1. Component queries `fetchPositionHistory(fen, username)`. Shows "Position seen in N games. You blundered in K of them."
2. List of games with links to `/analysis/:gameId?move=N`.
3. Slot in Analysis page right column below MoveList (or behind a toggle).

**Tests**: panel renders for a known-recurring position.

**Acceptance**: clicking a row navigates to that game at that move.

**Depends on**: P3.3.

---

# Phase 4 — Deep Analysis

## P4.1 — `analysis` table PK migration (MultiPV-ready)

**Files**: `server/lib/db.ts` (migration #7)

**Steps**:
1. Migration #7 — table rebuild, PK changes:
   ```sql
   ALTER TABLE analysis RENAME TO analysis_old;
   CREATE TABLE analysis (
     game_id TEXT NOT NULL,
     move_index INTEGER NOT NULL,
     multipv_rank INTEGER NOT NULL DEFAULT 1,
     fen TEXT NOT NULL,
     fen_key TEXT,
     move_san TEXT,
     score_cp INTEGER,
     score_mate INTEGER,
     best_move TEXT,
     pv TEXT,        -- space-separated UCI moves
     depth INTEGER,
     PRIMARY KEY (game_id, move_index, multipv_rank)
   );
   CREATE INDEX idx_analysis_game_id ON analysis(game_id);
   CREATE INDEX idx_analysis_fen ON analysis(fen);
   CREATE INDEX idx_analysis_fen_key ON analysis(fen_key);
   INSERT INTO analysis SELECT game_id, move_index, 1, fen, fen_key, move_san, score_cp, score_mate, best_move, NULL, depth FROM analysis_old;
   DROP TABLE analysis_old;
   ```

**Tests**: row count preserved; existing single-PV rows have `multipv_rank = 1`.

**Acceptance**: app works identically after migration (single-PV path unchanged).

**Depends on**: P0.1.

---

## P4.2 — `engine.ts` MultiPV parsing

**Files**: `server/lib/engine.ts`, `tests/engine.test.ts`

**Steps**:
1. Add `multipv?: number` parameter to analysis APIs (`analyzeSinglePosition`, `analyzeGame`). Default 1 (backward-compatible).
2. In `init()` send `setoption name MultiPV value ${multipv}`.
3. Refactor `readUntilBestMove`: collect a map `depth → multipvRank → InfoLine`. On `bestmove`, return only the final (deepest) ranked array of length N.
4. Return type widens to `AnalysisResult[]`. Single-PV callers take `result[0]`.
5. Scale `SEARCH_MOVETIME` proportionally: `movetime = baseMovetime * multipv` when `multipv > 1`. Or accept explicit override.

**Tests**: with MultiPV=3 on a fixed FEN, returns 3 results with ranks 1/2/3 and `score_cp[0] >= score_cp[1] >= score_cp[2]` (mover's perspective).

**Acceptance**: single-PV behavior unchanged; multi-PV returns 3 lines.

**Depends on**: P0.4.

---

## P4.3 — `?multipv=3` SSE param

**Files**: `server/routes/analyze.ts`

**Steps**:
1. Read `c.req.query("multipv")`, validate ∈ {1, 3}, default 1.
2. Pass to `analyzeGame()`.
3. Emit one SSE event per (move_index, multipv_rank) with `multipvRank` field.
4. Upsert each event into `analysis` with `multipv_rank` PK.

**Tests**: SSE consumer receives 3× events per position when `multipv=3`.

**Acceptance**: deep analysis re-runs and stores ranks 1/2/3.

**Depends on**: P4.1, P4.2.

---

## P4.4 — Top-3 arrows + alternatives panel

**Files**: `client/src/pages/Analysis.tsx`, `client/src/components/AlternativesPanel.tsx` (new), `client/src/api.ts`

**Steps**:
1. `fetchGame` returns analysis grouped by `(move_index, multipv_rank)`. Update `AnalysisRow` interface.
2. `bestMoveShapes` memo: array of up to 3 shapes with brushes `"blue"`, `"paleBlue"`, `"green"`.
3. New `AlternativesPanel`: shows top 3 PV lines with evals + delta vs played move.
4. UI toggle: "Deep analysis" button → fetches `?multipv=3` analysis SSE.

**Tests**: e2e — open game, toggle deep analysis, 3 arrows render on board.

**Acceptance**: deep analysis visible; arrows render; alternatives panel shows top 3 with evals.

**Depends on**: P4.3.

---

## P4.5 — ACL aggregation

**Files**: `server/lib/metrics.ts`, `server/routes/stats.ts`

**Steps**:
1. `gameMetrics()` already returns `acl` per side (added in P1.1; verify formula matches D1 — skip first 8 plies, only positive losses).
2. Add `GET /api/stats/:username/acl-trend?time_class=&from=&to=` → time-series of ACL per game ordered by `end_time`.
3. Render on `Stats.tsx` as a line chart alongside accuracy.

**Tests**: `acl` for a fixture matches hand-computed value.

**Acceptance**: ACL chart visible on stats page.

**Depends on**: P1.1, P2.6.

---

# Phase 5 — Motif Detection

## P5.1 — `motifs.ts` library

**Files**: `server/lib/motifs.ts` (new), `tests/motifs.test.ts`

**Steps**:
1. New library, uses `chess.js` for board introspection.
   ```ts
   export type Motif = "hanging_piece" | "fork" | "pin" | "skewer" | "back_rank_mate" | "missed_mate";
   export function detectMotifs(input: {
     fenBefore: string;
     playedMove: string;     // UCI
     bestMove: string;       // UCI
     scoreCpBefore: number | null;
     scoreCpAfter: number | null;
     scoreMateBefore: number | null;
     scoreMateAfter: number | null;
     bestPv?: string[];      // optional UCI sequence
   }): Motif[];
   ```
2. Heuristics per D9. Each motif a separate exported function for unit testing.
3. **hanging_piece**: after the played move, is a user piece on a square attacked by opponent with no defender of equal-or-greater value? Use `chess.attackers()`.
4. **fork**: after `bestMove`, count opponent pieces of value ≥ minor attacked by the moved piece. ≥ 2 = fork.
5. **pin/skewer**: ray-trace from moved piece (B/R/Q) along legal rays; check for two enemy pieces in line where lower-value first (pin) or higher first (skewer).
6. **back_rank_mate**: PV ends in mate; mating piece on rank 1 or 8; king has no escape on rank 2 or 7 (blocked by own pieces).
7. **missed_mate**: `scoreMateBefore !== null && scoreMateAfter === null` → missed mate.

**Tests**: fixture FENs for each motif → detection returns expected tag.

**Acceptance**: 90%+ coverage; each motif has at least 3 positive and 2 negative fixtures.

**Depends on**: none.

---

## P5.2 — `blunder_tags` table

**Files**: `server/lib/db.ts` (migration #8)

**Steps**:
1. Migration #8:
   ```sql
   CREATE TABLE IF NOT EXISTS blunder_tags (
     game_id TEXT NOT NULL,
     move_index INTEGER NOT NULL,
     tag TEXT NOT NULL,
     PRIMARY KEY (game_id, move_index, tag)
   );
   CREATE INDEX idx_blunder_tags_tag ON blunder_tags(tag);
   ```

**Tests**: migration applies cleanly.

**Acceptance**: table exists.

**Depends on**: P0.1.

---

## P5.3 — Motif tagging during analysis

**Files**: `server/routes/analyze.ts`, `server/lib/motifs.ts`

**Steps**:
1. After each `analysis` upsert, compare current eval to previous position's eval. If the swing classifies as a mistake or blunder (per `metrics.classifyMove`):
   - Call `detectMotifs({...})`.
   - Insert each detected tag into `blunder_tags`.

**Tests**: integration — run analysis on a fixture game with a known blunder → `SELECT * FROM blunder_tags WHERE game_id = ?` returns expected tag.

**Acceptance**: tags populated for blunders in newly analyzed games.

**Depends on**: P5.1, P5.2.

---

## P5.4 — Motif backfill

**Files**: `server/lib/backfill.ts`

**Steps**:
1. New function `backfillMotifs(limit: number = 50)`. Iterates analyzed games without entries in `blunder_tags`, runs detection on each blunder/mistake position.
2. Throttled (limit 50/run, batched), idempotent.

**Tests**: re-running is idempotent (no duplicate tags).

**Acceptance**: existing analyzed games get tagged on next server start.

**Depends on**: P5.3.

---

## P5.5 — Motif stats endpoint + UI

**Files**: `server/routes/stats.ts`, `client/src/pages/Stats.tsx`, `client/src/pages/Analysis.tsx`

**Steps**:
1. `GET /api/stats/:username/motifs?from=&to=` → `Array<{ tag: Motif; count: number; example_game_id: string; example_move_index: number }>`. Filter to blunders user committed (join `games`, check user side vs move_index parity).
2. `Stats.tsx`: new "Recurring mistakes" panel showing top 5 motifs with example links.
3. `Analysis.tsx`: render motif tag chips next to classified blunders in MoveList (extend `MoveList` props with `motifs?: Record<number, Motif[]>`).

**Tests**: e2e — open stats page, see motif list; click example link → opens analysis at that move.

**Acceptance**: top 5 recurring motifs visible with drill-down.

**Depends on**: P5.4.

---

# Phase 6 — Drill Mode + Spaced Repetition

## P6.1 — `chess.js` client dependency + `ChessBoard` interactivity

**Files**: `package.json` (or `client/package.json`), `client/src/components/ChessBoard.tsx`

**Steps**:
1. `bun add chess.js` in client workspace.
2. `ChessBoard.tsx`: add `interactive?: boolean` prop. When true, set `draggable.enabled: true`, `movable.color: turnColor`, `movable.dests: legalMovesMap`, `movable.events.after: onMove`.
3. Compute `legalMovesMap` from `chess.js` `chess.moves({ verbose: true })`.

**Tests**: e2e — board accepts drag-drop when `interactive=true`.

**Acceptance**: dragging a piece on an interactive board executes a legal move.

**Depends on**: none.

---

## P6.2 — `drill_attempts` table

**Files**: `server/lib/db.ts` (migration #9)

**Steps**:
1. Migration #9:
   ```sql
   CREATE TABLE IF NOT EXISTS drill_attempts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     username TEXT NOT NULL,
     game_id TEXT NOT NULL,
     move_index INTEGER NOT NULL,
     fen TEXT NOT NULL,
     best_move TEXT NOT NULL,
     attempted_move TEXT,
     correct INTEGER,
     attempted_at INTEGER,
     -- FSRS state
     stability REAL,
     difficulty REAL,
     due INTEGER,
     state INTEGER,         -- 0=new, 1=learning, 2=review, 3=relearning
     UNIQUE (username, game_id, move_index)
   );
   CREATE INDEX idx_drill_due ON drill_attempts(username, due);
   ```

**Acceptance**: table exists.

**Depends on**: P0.1.

---

## P6.3 — Drill queue endpoint

**Files**: `server/routes/drill.ts` (new), `server/index.ts`

**Steps**:
1. Mount `/api/drill`.
2. `GET /api/drill/queue?username=X&limit=20`:
   - Union of: (a) due cards (`due <= now`), (b) new positions from `blunder_tags` not yet in `drill_attempts`.
   - Limit total; prefer due over new.
   - Return positions with `fen`, `best_move`, `game_id`, `move_index`, `motifs`.

**Tests**: seed 5 due cards + 10 new positions → endpoint returns mix.

**Acceptance**: returns correct mix.

**Depends on**: P5.4, P6.2.

---

## P6.4 — FSRS integration + attempt endpoint

**Files**: `server/routes/drill.ts`, `package.json`

**Steps**:
1. `bun add ts-fsrs`.
2. `POST /api/drill/attempt`:
   ```json
   { "username": "X", "game_id": "...", "move_index": 12, "attempted_move": "Nf3" }
   ```
3. Server validates `attempted_move === best_move` (UCI compare). Rating: correct first try = `Good`, correct after thinking ≥ 30s = `Hard`, incorrect = `Again`.
4. Call FSRS: `const card = existingCard ?? createEmptyCard(); const { card: next } = fsrs.next(card, now, rating);`
5. Upsert into `drill_attempts` with new FSRS state.

**Tests**:
- Wrong → next due ~10 minutes out (or FSRS default).
- Right after wrong → progresses to learning state.

**Acceptance**: scheduled `due` increases for correct, decreases (or short-interval) for wrong.

**Depends on**: P6.3.

---

## P6.5 — `Drill.tsx` page

**Files**: `client/src/pages/Drill.tsx` (new), `client/src/App.tsx`, `client/src/api.ts`

**Steps**:
1. New route `/drill`.
2. Load queue, render first position. `ChessBoard interactive` enabled. User drags piece → resolve via `chess.js` → submit `attempted_move`.
3. Show feedback: ✅ "Best move!" or ❌ "Best was X". Reveal eval after answer.
4. Next button advances. Track session stats.
5. Header link from Home.

**Tests** (e2e): play through 3 drill positions → submit moves → see feedback → next.

**Acceptance**: full drill loop functional.

**Depends on**: P6.1, P6.4.

---

## P6.6 — Stats: drill progress

**Files**: `server/routes/stats.ts`, `client/src/pages/Stats.tsx`

**Steps**:
1. `GET /api/stats/:username/drill-progress` → `{ total_attempts, accuracy_pct, due_today, current_streak }`.
2. Add panel to Stats page.

**Tests**: returns correct counts.

**Acceptance**: drill stats visible.

**Depends on**: P6.4.

---

# Cross-phase tracking

| Migration ID | Phase | Description |
|---|---|---|
| 1 | P0.1 | Seed (empty) |
| 2 | P0.3 | `games` ADD COLUMN (white_elo, black_elo, user_elo, eco, opening) |
| 3 | P0.3 | `idx_analysis_fen` |
| 4 | P1.2 | `game_metrics` table |
| 5 | P2.4 | `annotations` table |
| 6 | P3.2 | `analysis.fen_key` column + index |
| 7 | P4.1 | `analysis` PK migration → composite with multipv_rank, add `pv` column |
| 8 | P5.2 | `blunder_tags` table |
| 9 | P6.2 | `drill_attempts` table |

## New env vars

| Var | Phase | Default | Required when |
|---|---|---|---|
| `ENGINE_TYPE` | P0.4 | `stockfish` | always |
| `ENGINE_PATH` | P0.4 | `${ENGINE_TYPE}` | binary not in PATH |
| `WEIGHTS_PATH` | P0.4 | (none) | `ENGINE_TYPE=lc0` |
| `ENGINE_BACKEND` | P0.4 | `cudnn-fp16` | Lc0 only |
| `USER_TZ` | P2.5 | `America/Los_Angeles` | optional |

## New dependencies

| Package | Phase | Workspace |
|---|---|---|
| `chess.js` | P6.1 | client |
| `ts-fsrs` | P6.4 | server |

## New files (canonical list)

- `server/lib/backfill.ts` (P0.3, P2.2, P5.4)
- `server/lib/openings.ts` (P2.1)
- `server/lib/metrics.ts` (P1.1)
- `server/lib/motifs.ts` (P5.1)
- `server/data/openings/{a..e}.tsv` (P2.1)
- `server/data/openings/LICENSE` (P2.1)
- `server/routes/stats.ts` (P1.8)
- `server/routes/drill.ts` (P6.3)
- `shared/classify.ts` (P0.5 / P1.1 — placement to be decided in P0.5)
- `client/src/lib/classify.ts` (P0.5 — or re-export from `shared/`)
- `client/src/pages/Stats.tsx` (P2.6)
- `client/src/pages/Drill.tsx` (P6.5)
- `client/src/components/StatsPanel.tsx` (P1.9)
- `client/src/components/RecurrencePanel.tsx` (P3.4)
- `client/src/components/AlternativesPanel.tsx` (P4.4)
- `tests/migrations.test.ts` (P0.1)
- `tests/pgn.test.ts` (P0.2) — may already exist; extend
- `tests/backfill.test.ts` (P0.3)
- `tests/classify.test.ts` (P0.5)
- `tests/metrics.test.ts` (P1.1)
- `tests/openings.test.ts` (P2.1)
- `tests/games-route.test.ts` (P0.6, P1.3, P1.4)
- `tests/stats-route.test.ts` (P1.8, P2.3, P2.4, P2.5)
- `tests/motifs.test.ts` (P5.1)

## Docs to update after each phase

- `docs/core.md` — schema section after every migration phase.
- `docs/README.md` — index after new specs added.
- `docs/analysis-mode.md` — Phase 4 (MultiPV).
- `docs/security.md` — if any new rate-limit rules added.
- New spec files (consider): `docs/stats.md`, `docs/drill.md`, `docs/metrics.md`, `docs/motifs.md`, `docs/engine.md`.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| `analysis` PK migration (P4.1) on large DB | Pre-flight rowcount; verify migration completes in <30s for current data; backup `analysis.db` before first run. |
| Lc0 weights file missing | P0.4 throws clear error at startup if `ENGINE_TYPE=lc0 && !WEIGHTS_PATH`. |
| Lichess accuracy formula yields surprising numbers | P1.1 tests against published fixtures (Lichess open-source has test vectors — pull a few). |
| Motif false-positives spam blunder_tags | P5.1 unit-test with negative fixtures; P5.3 caps tags per position at 3 by priority. |
| FSRS overkill for one user | P6.4 uses default parameters (no training); behavior should be reasonable on day 1. |
| TSV opening prefix matching slow at import scale | P2.1 sorts lookup once at startup; linear scan over ~3700 entries is cheap per game. |

## Estimated effort summary

| Phase | Tasks | Effort |
|---|---|---|
| 0 | P0.1–P0.6 | ~1 day |
| 1 | P1.1–P1.9 | ~2 days |
| 2 | P2.1–P2.6 | ~3 days |
| 3 | P3.1–P3.4 | ~1 day |
| 4 | P4.1–P4.5 | ~3 days |
| 5 | P5.1–P5.5 | ~3 days |
| 6 | P6.1–P6.6 | ~4 days |
| **Total** | 37 tasks | **~17 days** |

## Recommended ship cadence

- Ship after Phase 1 (MVP). Daily use for 1–2 weeks to validate the metric loop.
- Ship after Phase 2 (full stats).
- Phase 3 piggybacks any phase.
- Phase 4 + 5 ship together (motifs benefit from MultiPV signal).
- Phase 6 last; biggest skill-transfer payoff but largest scope.
