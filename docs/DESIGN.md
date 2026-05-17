# DESIGN.md — Roadmap Implementation Plan

## Purpose

Translate `docs/roadmap.md` into an executable sequence of phases, decisions, and file-level tasks. Each phase is independently shippable. Decisions are recorded with citations so the next implementer doesn't re-research.

This is a plan, not a commitment. Phases are ordered by ROI per unit of work, matching the roadmap's "smallest first step" guidance.

---

## Cross-cutting decisions

Decided up front to avoid re-litigation per feature.

### D1 — Accuracy / blunder formulas: Lichess

Adopt Lichess formulas verbatim. Public, calibrated on real games, simple.

- **Win% from cp** (cp clamped to ±1000):
  `Win% = 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)`
- **Move accuracy** (`wp_delta = Win%_before − Win%_after`, ≥ 0):
  `Accuracy = clamp(0, 100, 103.1668 * exp(-0.04354 * wp_delta) - 3.1669 + 1)`
- **Mate normalization:** `score_mate` non-null → `cp = sign(mate) * 1000`.
- **Move classification thresholds** on Win%-delta (`[0,1]` scale):
  - Inaccuracy ≥ 0.10, Mistake ≥ 0.20, Blunder ≥ 0.30
- **Game accuracy:** weighted average per side (Lichess uses harmonic mean of windowed accuracies — simplest viable v1 is arithmetic mean of per-move accuracies). Refine later.
- **ACL:** `mean(max(0, eval_before − eval_after))` over user's non-book moves (skip plies 1–8 by default; configurable).

Sources: `lichess-org/scalachess` `eval.scala`, `lila` `AccuracyPercent.scala`, `Advice.scala`.

### D2 — Stats endpoint shape

Sub-route namespace under `/api/stats/:username/*` in a new `server/routes/stats.ts`. Sub-routes compose cleanly; one big slice-param endpoint regrets itself in 3 features.

### D3 — Derived-metric cache

New `game_metrics` table. Compute lazily on first request, invalidate when `analysis` rows for that game change (delete row in `game_metrics` whenever an `analysis` row is upserted for the same `game_id` — single-statement trigger or explicit invalidation in the analyze SSE loop).

### D4 — Backfill strategy

Auto-run idempotent backfill on server start when a "migration version" row in a new `meta(key, value)` table is below the current head. Backfill steps: extract headers (ECO/Elo/Opening) from `games.pgn`, populate new columns. Each step a separate idempotent function.

### D5 — Migrations

No migration framework. Add a tiny inline runner in `server/lib/db.ts`:

```ts
const migrations: Array<{ id: number; sql: string }> = [
  { id: 1, sql: "ALTER TABLE games ADD COLUMN white_elo INTEGER; ..." },
  ...
];
runMigrations(); // reads meta.schema_version, applies pending
```

PK changes (analysis composite for MultiPV) require `CREATE TABLE analysis_new ... ; INSERT INTO analysis_new SELECT ... ; DROP TABLE analysis; ALTER RENAME` — record as one migration.

### D6 — Engine abstraction (GPU support)

Rename `server/lib/stockfish.ts` → `server/lib/engine.ts`. UCI protocol is identical between Stockfish and Lc0, so parser is unchanged. Switch via env:

| Env var | Values | Notes |
|---|---|---|
| `ENGINE_TYPE` | `stockfish` (default) \| `lc0` | Controls init options |
| `ENGINE_PATH` | path to binary | Falls back to PATH lookup |
| `WEIGHTS_PATH` | path to `.pb.gz` | Lc0 only; required when `ENGINE_TYPE=lc0` |
| `ENGINE_BACKEND` | `cudnn-fp16` (default) \| `cudnn` \| `trt` \| `blas` | Lc0 backend |

Concurrency: `MAX_CONCURRENT_ANALYSES = 1` when `ENGINE_TYPE=lc0` (single-GPU contention). Stays 2 for Stockfish.

**Recommended default for analysis quality:** Stockfish 17 NNUE CPU at 1.5–2s/position. Switch to Lc0 BT4 only for positional/strategic re-analysis passes; SF wins tactical sharpness needed for blunder detection. Document both as supported.

Source: Lc0 UCI options wiki (`lczero.org/dev/wiki/lc0-options/`), CCRL community consensus, Chessify NPS benchmarks. BT4 weights ~365 MB, needs 4 GB VRAM, ~4–15 kN/s on RTX 30/40-series. PCIe overhead rules out GPU Stockfish on consumer hardware.

### D7 — Opening classification: hybrid

Parse `[ECO]` / `[Opening]` headers first (cheap path), fall back to lichess-org/chess-openings TSV prefix-match (CC0). Ship the 5 TSV files (~375 KB) in-tree. New `server/lib/openings.ts`, ~80 LOC.

### D8 — MultiPV: opt-in re-analysis pass

Default analysis stays MultiPV=1 (cheap, fast, ground truth). Add a separate "deep analysis" SSE route (or query param `?multipv=3`) that re-analyzes positions with MultiPV=3 at 3–4s/position. Schema gains `multipv_rank` column in `analysis` (PK becomes composite).

### D9 — Motif detection: native TS

Build heuristics in TS using `chess.js` `attackers()` + custom ray-tracing. No Python sidecar. Target 6 motifs in v1: hanging piece, fork, pin, skewer, back-rank mate, missed mate-in-N. Source: `lichess-org/lila` `PuzzleTheme.scala` for the canonical taxonomy.

### D10 — Spaced repetition: FSRS

Use `ts-fsrs` (MIT, Node ≥ 20). Default parameters are well-calibrated; per-user optimization is optional and irrelevant at hundreds of cards.

---

## Phase 0 — Foundation (prerequisite for all phases)

Small, mechanical, unblocks everything downstream.

| Task | File | Effort |
|---|---|---|
| Add migration runner + `meta` table | `server/lib/db.ts` | S |
| Add `pgnHeaders(pgn) → Record<string,string>` | `server/lib/pgn.ts` | S |
| Add columns `white_elo`, `black_elo`, `user_elo`, `eco`, `opening` to `games` | migration | S |
| Add `idx_analysis_fen` index | migration | S |
| Add backfill: parse headers from existing PGNs, populate columns | `server/lib/db.ts` (called at startup) | S |
| Extend `games.ts` upsert to write new columns from `chesscom.ts` + `pgnHeaders` | `server/routes/games.ts` | S |
| Extract `classifySwing` → `client/src/lib/classify.ts`; return enum, not CSS strings | `client/src/lib/classify.ts` (new), `client/src/pages/Analysis.tsx`, `client/src/components/MoveList.tsx` | S |
| Engine abstraction rename + env-driven config | `server/lib/engine.ts` (renamed), `server/lib/stockfish.ts` removed | S |

**Exit criteria:** existing functionality unchanged; new columns populated; `ENGINE_TYPE=lc0 ENGINE_PATH=/usr/bin/lc0 WEIGHTS_PATH=/path/BT4.pb.gz bun start` works.

---

## Phase 1 — Metric loop (Tier 1.1, 1.2, 1.3, 2.3)

The smallest closed feedback loop: user sees accuracy, blunders, weak side, worst games.

### 1.1 Per-game accuracy + blunder counts

**Server**
- New `server/lib/metrics.ts`: `computeGameMetrics(gameId) → { accuracy_white, accuracy_black, blunders_white, mistakes_white, inaccuracies_white, ... }` using formulas from D1.
- New table `game_metrics(game_id PK, accuracy_white REAL, accuracy_black REAL, blunders_white INTEGER, mistakes_white INTEGER, inaccuracies_white INTEGER, blunders_black INTEGER, ..., computed_at INTEGER)`.
- New endpoint `GET /api/games/:gameId/metrics` — lazy compute + cache.
- Cache invalidation: on every `analysis` upsert in `server/routes/analyze.ts`, `DELETE FROM game_metrics WHERE game_id = ?`.

**Client**
- `client/src/api.ts`: `fetchGameMetrics(gameId)` + `GameMetrics` interface.
- `client/src/components/GameCard.tsx`: optional `accuracy?: number`, `blunders?: number` props. Color-coded chips (green ≥90, amber 70–89, red <70).
- `client/src/pages/Home.tsx`: include metrics in gallery — either prefetch per card (cheap if cached) or one bulk endpoint `GET /api/games/metrics?username=X` returning `{ [gameId]: GameMetrics }`. **Choice: bulk endpoint** to avoid N+1.
- `client/src/pages/Analysis.tsx`: render accuracy + blunder chip in header.

### 1.3 Side-of-board breakdown

**Server**
- New `server/routes/stats.ts`. `GET /api/stats/:username/by-side` → `{ white: { games, wins, accuracy, blunders }, black: { ... } }`.
- Mount in `server/index.ts`.

**Client**
- New `client/src/components/StatsPanel.tsx` — compact horizontal panel above the gallery.
- `client/src/pages/Home.tsx`: slot `<StatsPanel username={username} />` between filters and grid.

### 2.3 Worst-games queue

- `client/src/pages/Home.tsx`: add sort chip "Worst first" → `filteredGames.sort((a,b) => a.accuracy_user - b.accuracy_user)`. Reuses metrics from 1.1.

**Phase 1 exit:** user opens app → sees per-side stats + accuracy/blunder chips on every game → sorts by accuracy → opens worst game → reviews → returns.

---

## Phase 2 — Aggregate dashboards (Tier 1.4, 1.5, 1.6, 3.3)

Stats page with drill-down slices.

### 1.5 Opening identification

- `server/lib/openings.ts`: load lichess TSV files at startup, build longest-prefix lookup. Bundle TSV under `server/data/openings/` (a–e.tsv).
- During import in `server/routes/games.ts`: prefer `[ECO]`/`[Opening]` headers; fall back to `openings.classify(moves)`.
- Backfill existing rows where `eco IS NULL`.

### 1.4 Win-rate dashboard

- `server/routes/stats.ts`: `GET /api/stats/:username/win-rate?slice=color|time_class|rating_bucket|opening&from=&to=`.
- Rating bucket boundaries: `<−200, −200..−100, ±100, +100..+200, >+200` relative to `user_elo`.

### 1.6 Elo trend chart

- `server/routes/stats.ts`: `GET /api/stats/:username/elo-trend?time_class=blitz`. Reads `games.user_elo` ordered by `end_time`.
- Optional table `annotations(date INTEGER, time_class TEXT, text TEXT)` for manual notes.

### 3.3 Time-of-day analysis

- `server/routes/stats.ts`: `GET /api/stats/:username/by-time-of-day` → hour-of-day × day-of-week heatmap data. Timezone from env `USER_TZ` (default `America/Los_Angeles`).

### Client

- New `client/src/pages/Stats.tsx`. Tabs: By Side, By Time Class, By Opening, By Rating, Elo Trend, Time of Day.
- New route `/stats` in `client/src/App.tsx`. Nav link from `Home.tsx`.
- Reuse uPlot for line/bar charts. Heatmap = `<div>` grid with bg-color scaling.

**Phase 2 exit:** user can answer "which openings am I losing with as Black?" and "is my Elo trending up?" without leaving the app.

---

## Phase 3 — Review velocity (Tier 2.1, 2.4)

### 2.1 Next-blunder navigation

- `client/src/pages/Analysis.tsx`: in existing keyboard `useEffect`, add `B` (next blunder), `Shift+B` (prev blunder), optional `M` / `Shift+M` (next/prev mistake). Uses `classifySwing` enum from Phase 0 refactor.

### 2.4 Position recurrence

- `server/routes/games.ts` (or new `server/routes/positions.ts`): `GET /api/positions/history?fen=...&username=X`. Truncate FEN to `position + side` fields (drop halfmove/fullmove counters) for transposition matching.
- New column `analysis.fen_key TEXT` populated by trigger or in-app, indexed.
- `client/src/components/RecurrencePanel.tsx`: shows "5 prior games, blundered in 3" + game list. Slot into Analysis page right column.

---

## Phase 4 — Deep analysis (Tier 2.2, 3.2)

### 2.2 MultiPV

- Migration: rebuild `analysis` table with PK `(game_id, move_index, multipv_rank)`, default rank = 1 for existing rows.
- `server/lib/engine.ts`: refactor `readUntilBestMove` to collect one `AnalysisResult` per multipv rank per completed depth. Return `AnalysisResult[]`.
- `server/routes/analyze.ts`: accept `?multipv=3` query, emit one SSE event per (move_index, multipv_rank).
- `server/lib/engine.ts` init: `setoption name MultiPV value <n>`. Scale `SEARCH_MOVETIME` to 3000ms when n=3.
- `client/src/pages/Analysis.tsx`: `bestMoveShapes` memo → array of up to 3 `DrawShape` with graduated brush colors. New `<AlternativesPanel>` showing top 3 with eval deltas.

### 3.2 ACL

- `server/lib/metrics.ts`: add `computeACL(gameId, color, skipOpeningPlies)`. Default skip = 8.
- Surface in `Stats.tsx` and `GameCard.tsx` (optional small chip).

---

## Phase 5 — Pattern detection (Tier 3.1)

### 3.1 Tactical motif clustering

- New `server/lib/motifs.ts`: implements 6 heuristics (D9).
- New table `blunder_tags(game_id TEXT, move_index INTEGER, tag TEXT, PRIMARY KEY (game_id, move_index, tag))`.
- Runs after each position in `analyze.ts` when `score_cp` swing crosses blunder threshold OR `score_mate` flips.
- `server/routes/stats.ts`: `GET /api/stats/:username/motifs?from=&to=` → counts per tag.
- `client/src/pages/Stats.tsx`: new "Recurring mistakes" panel.
- Move list / Analysis sidebar: render motif tags next to blunders.

---

## Phase 6 — Drill mode (Tier 4.1, 4.2)

### 4.1 Drill

- New table `drill_attempts(id INTEGER PK, fen TEXT, attempted_move TEXT, correct INTEGER, attempted_at INTEGER, next_due INTEGER)`.
- New endpoint `GET /api/drill/queue?username=X&limit=20` — returns due/new blunder positions filtered by user color.
- New endpoint `POST /api/drill/attempt` — record outcome.
- New `client/src/pages/Drill.tsx`. Enable `draggable.enabled` + `movable.color` on `ChessBoard.tsx` (add `interactive?: boolean` prop).
- Add `chess.js` as a client dependency for move validation.
- Route `/drill` in `App.tsx`.

### 4.2 Spaced repetition

- Add `ts-fsrs` dependency.
- Extend `drill_attempts` with FSRS state (`stability`, `difficulty`, `due`, `state` columns).
- Schedule next_due via `fsrs.next(card, rating)` on each attempt.

---

## File-level change summary

| File | Phases touching it |
|---|---|
| `server/lib/db.ts` | 0 (runner), 1, 4, 5, 6 (schema) |
| `server/lib/pgn.ts` | 0 (`pgnHeaders`) |
| `server/lib/engine.ts` (renamed) | 0, 4 (MultiPV) |
| `server/lib/openings.ts` (new) | 2 |
| `server/lib/metrics.ts` (new) | 1, 4 |
| `server/lib/motifs.ts` (new) | 5 |
| `server/lib/chesscom.ts` | unchanged; caller passes ratings through |
| `server/routes/games.ts` | 0 (header storage), 1 (bulk metrics), 3 (positions) |
| `server/routes/analyze.ts` | 1 (cache invalidation), 4 (multipv), 5 (motif tagging hook) |
| `server/routes/stats.ts` (new) | 1, 2, 5 |
| `server/routes/positions.ts` (new, optional) | 3 |
| `server/routes/drill.ts` (new) | 6 |
| `server/index.ts` | route mounts per phase |
| `client/src/api.ts` | typed wrappers per endpoint |
| `client/src/App.tsx` | `/stats` (Phase 2), `/drill` (Phase 6) |
| `client/src/lib/classify.ts` (new) | 0 |
| `client/src/pages/Home.tsx` | 1 (panel + sort) |
| `client/src/pages/Analysis.tsx` | 1 (chips), 3 (nav, recurrence), 4 (multipv), 5 (motif tags) |
| `client/src/pages/Stats.tsx` (new) | 2, 5 |
| `client/src/pages/Drill.tsx` (new) | 6 |
| `client/src/components/GameCard.tsx` | 1 (chips) |
| `client/src/components/StatsPanel.tsx` (new) | 1 |
| `client/src/components/RecurrencePanel.tsx` (new) | 3 |
| `client/src/components/AlternativesPanel.tsx` (new) | 4 |
| `client/src/components/MoveList.tsx` | 0 (enum classification), 5 (motif tag rendering) |
| `client/src/components/ChessBoard.tsx` | 4 (multi-arrow already supported), 6 (interactive prop) |

---

## Sequence

```
Phase 0 (Foundation)         — ~1 day
   ↓
Phase 1 (Metric loop)        — ~2 days   ← MVP exit; ship here if time-boxed
   ↓
Phase 2 (Stats dashboards)   — ~3 days
   ↓
Phase 3 (Velocity)           — ~1 day
   ↓
Phase 4 (Deep analysis)      — ~3 days
   ↓
Phase 5 (Motifs)             — ~3 days
   ↓
Phase 6 (Drill + SRS)        — ~4 days
```

Phases 3 and 4 are reorderable. Phase 5 is reorderable but benefits from Phase 4's MultiPV data (better motif accuracy with alternatives known).

---

## Open questions deferred to implementation

- **Game-accuracy aggregation:** arithmetic mean vs Lichess's harmonic-with-rolling-window. Start arithmetic; revisit if numbers diverge wildly from Chess.com.
- **Bulk metrics endpoint vs per-card prefetch:** start bulk.
- **Recurrence FEN key granularity:** position+side only, or include castling rights? Start position+side+castling (drop only halfmove/fullmove).
- **Engine choice surface in UI:** none in v1 — env-driven only.
- **Stats route auth/rate limit:** stats endpoints can be expensive; add a separate rate-limit bucket (30/min) once observed.

---

## Sources

- Lichess accuracy: `lichess-org/scalachess/.../eval.scala`, `lila/.../AccuracyPercent.scala`, `lila/.../Advice.scala`
- ECO data: `github.com/lichess-org/chess-openings` (CC0, ~3700 lines, TSV)
- Lc0: `lczero.org/play/networks/bestnets/`, `lczero.org/dev/wiki/lc0-options/`
- FSRS: `github.com/open-spaced-repetition/ts-fsrs` (MIT)
- Chess.js attackers API: `github.com/jhlywa/chess.js`
- Motif taxonomy: `lichess-org/lila/.../PuzzleTheme.scala`
