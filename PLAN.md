# Implementation Plan — Game Metrics Tracking

## Progress Log

- [x] **0a** Config module `metrics-config.ts` — all D8–D29/D1 thresholds. ✅ validate green.
- [x] **0b** `multipv_rank = 1` fix in `computeAndCacheMetrics`. Corrupt-row flush subsumed by #12.
- [x] **0c** Migration #11 (`is_standard` + `game_metrics_ext` + indexes); `pgn.ts` parsers (`parseTimeControl`, `pgnPerPlyClocks`, `parseTermination`, `isForfeit`, `parseVariant`, `isStandard`, exported `clkToSeconds`); `classifyOpening` returns `depth`; `backfillIsStandard` wired into startup; `buildGameRow`/upsert set `is_standard`; e2e fixtures updated.
- [x] **0d** Phase divider `phases.ts` (`dividePhases`).
- [x] Phase-0 tests: `pgn-parsers.test.ts`, `phases.test.ts` (+ migration #11 / multipv regression pending append).
- [x] **Risk 1 resolved**: exact Lichess accuracy algorithm verified against lila `AccuracyPercent.scala` + scalalib `Maths.scala`. Window = `clamp(floor(plies/10),2,8)` over full interleaved win% seq; weight = clamp(popStdDev,0.5,12); per-color = (weightedMean + harmonicMean)/2.
- [x] **1a** Lichess accuracy migration: `moveAccuracy` (exact lila constants + ≥ guard), `plyAccuracies`/`combineAccuracy` (windowed std-dev weight + weighted/harmonic mean), `gameMetrics` rewired; deleted bucket model; migration #12 (`metrics_version` + clean cutover); `METRICS_VERSION=2`; glossary reworded. Tests: metrics aggregation, migration #11/#12 schema, multipv-rank regression. ✅ 363 pass.
- [x] **1b** `ply-timeline.ts` `buildTimeline` (synthetic mate win%, wpLoss/moveClass, cpLoss, thinkTime, clockS, phase, criticality+rank2, decided state machine) + `engine.ts` `getGameAnalysisMultiPV`/`AnalysisRowMPV`. Tests: `ply-timeline.test.ts` (12).
- [x] **1c** `game-metrics.ts` `buildGameMetrics` (per-phase accuracy/ACL, phase time, top-3 critical, missed conversions, tilt run+recovery, time-trouble, critical/quiet accuracy, peak/trough, out-of-book ECO fallback + post-book accuracy, opening-end eval, Spearman time-alloc, provenance). Tests: `game-metrics.test.ts` (7). ✅ 382 pass.
- [x] **2a** `metrics-store.ts`: `deriveMetrics` (raw → timeline → ext), `upsertGameMetrics` (writes both `game_metrics` + `game_metrics_ext` in one tx), `isMetricsStale`/`computeAnalysisSig` (D17), `autoFeedDrill` (R40/D23 ON CONFLICT DO NOTHING), `computeAndStoreMetrics` (derive + skip-if-current + upsert + feed).
- [x] **2b** `server/scripts/build-metrics.ts` + `bun run metrics` script: tiered MultiPV (D1), depth-gated reanalysis, SIGINT-safe per-game, `import.meta.main` guard. Pure helpers `tierMultipv`/`shouldReanalyze`/`parseArgs` tested.
- [x] **2c** Ongoing capture: R35 hook in `analyze.ts` (best-effort, after deep loop) + lazy rebuild in `GET /games/:gameId`. Tests: `metrics-store.test.ts` (5), `build-metrics.test.ts` (9). ✅ 396 pass.
- [x] **3** Read API: `server/routes/metrics.ts` (`GET /metrics/game/:gameId` with read-time derivations — elo_delta, result_quality, conversion flags, live critical/missed arrays; `GET /metrics/:username` list w/ per-time-class elo_delta; `GET /metrics/:username/export?format=csv|json`); 9 aggregate endpoints in `stats.ts` (consistency, session-fatigue, vs-opponent, acl-trend, leak-closure, tpr w/ FIDE dp table, repertoire, counterplay, endgame-conversion); registered in `index.ts`; client `api.ts` wrappers + interfaces. Tests: `metrics-route.test.ts` (4) + 34 new in `stats-route.test.ts`. ✅ 437 pass.
- [x] **4** Client surfacing (R41): `MetricsCard.tsx` (new) wired into `Analysis.tsx` (per-game phases/time/critical/conversion/result-quality + top critical moves & missed conversions); `GameCard.tsx` Swindle/Unlucky/time-trouble chips + `Home.tsx` `fetchUserMetrics` plumbing; 6 new `/stats` tabs (consistency, vs-opponent, acl-trend, tpr, leak-closure, repertoire); `EloTrendChart.tsx` running-peak overlay + net-gain/peak callout. Note: 4a left the existing client move-classification/keyboard-nav intact (already shares `classifySwing` thresholds with the server, so no drift); MetricsCard is additive.
- [x] **5** Docs: `docs/README.md` index row, `docs/metrics.md` (Lichess accuracy aggregation rewrite), `docs/game_metrics.md` implemented-status banner, `docs/roadmap.md` cross-link. ✅ `bun run validate` green, **437 unit tests pass**.
- [x] **e2e** verified: existing suite + new `e2e/metrics.test.ts` (MetricsCard sections/badge/phase rows on Analysis; 6 new /stats tabs render error-free). **64 e2e pass** (54 prior + 10 new). Batch runner smoke: `bun run metrics e2e_fakeplayer` → 3/3 ok; `game_metrics_ext` persisted; list + CSV export verified. ✅ `bun run validate` green, **437 unit + 64 e2e pass**.
- [ ] **Explorer (D29)** — deferred by design (Risk 3: multi-GB dump, multi-hour, manual run). D33 ECO fallback carries `out_of_book_ply` until built. Not blocking.

## Context

`docs/game_metrics.md` is a fully-specced but **unbuilt** design: per-game metric
tracking over the user's entire Chess.com history, powering the three core metrics
(win rate, accuracy/blunder rate, Elo). All requirements (R0–R41), decisions
(D0–D33), and open questions (Q1–Q17, all resolved) are locked. This plan turns the
doc's Phase 0–5 outline into a **correctly-sequenced, shippable build** grounded in
the actual code, where each increment leaves `bun run validate` + `bun run test`
green.

The architecture is four layers, each a pure function of the one below (drift
control, R33/R34):

```
L3 cross-game aggregates   read-time SQL over L2 — NEVER stored
L2 game_metrics_ext        versioned per-game scalar cache (metrics_version + analysis_sig)
L1 ply timeline            pure buildTimeline(pgn, analysisRows) — NOT stored, shared by batch + Analysis page
L0 raw                     games.pgn + analysis (source of truth)
```

Goal of this work: a backfilled game and a freshly-captured game are byte-for-byte
identical because both run the same `buildTimeline → buildGameMetrics` path.

---

## Divergences from the doc's assumptions (discovered in code) + resolutions

The design doc's schema notes assume a few columns/signatures that don't match the
actual code. Resolutions below are baked into the increments.

| # | Divergence | Resolution |
|---|---|---|
| 1 | `games` has **no `time_control` column** (doc says it's JOIN-able) | **Do not add a column.** Parse `[TimeControl]` from `games.pgn` at build time via a new `parseTimeControl(pgn)`. Always derivable from raw (R33); storing it would violate D17 non-duplication. |
| 2 | `games` has **no `opponent_elo` column** | Correct as-is. Computed at read time (`CASE WHEN lower(white)=? THEN black_elo ELSE white_elo END`), the pattern already in `computeWinRateSlice` (`stats.ts`). R23/R29/R31 follow it. |
| 3 | **No `is_standard` column** (R37/D20) | New migration: `ALTER TABLE games ADD COLUMN is_standard INTEGER` (nullable; NULL = unprocessed). Add `parseVariant`/`isStandard` to `pgn.ts`, set in `buildGameRow`, backfill via new `backfillIsStandard` in `backfill.ts` called from `server/index.ts`. |
| 4 | `games.termination` **already exists** (migration #10) but stores the **raw** string | Don't add a classified column. Add pure `parseTermination(raw)` + `isForfeit(raw)` (timeout\|abandoned, D19) to `pgn.ts`, classify at read time in aggregate WHERE clauses. |
| 5 | `computeAndCacheMetrics` SELECT **omits `multipv_rank = 1`** (latent bug — feeds 3 rows/position to `gameMetrics` on deep games) | Fix as a standalone increment (0b) before the accuracy migration; flush corrupt rows. |
| 6 | `classifyOpening` returns **no ply depth** (needed for D33 ECO fallback) | Backward-compatible extend: return `{ eco, name, depth }` where `depth = entry.tokens.length`. Existing callers ignore the new field. |
| 7 | `getGameAnalysis` returns **rank-1 only**; criticality (D9) needs rank-2 | Add `getGameAnalysisMultiPV(gameId, maxRank=3)` to `engine.ts` + `AnalysisRowMPV extends AnalysisRow { multipv_rank }`. Don't touch the stable rank-1 API. |
| 8 | Drill "new" queue already derives from `blunder_tags` (no `drill_attempts` row needed) | R40 auto-feed inserts `drill_attempts` rows with `ON CONFLICT DO NOTHING` + empty FSRS state (`stability/difficulty/state` null, `due = now`). The existing `NOT EXISTS` guard prevents double-surfacing; first attempt hydrates a fresh `createEmptyCard()`. |
| 9 | `moveAccuracy` (Lichess formula) **already exists in `metrics.ts` but is dead code** | R38 wires it into the new `aggregateAccuracyLichess`; the bucket model (`aggregateAccuracy`/`classAccuracyScore`) is deleted. |
| 10 | `clkToSeconds` is **not exported** from `pgn.ts` | Export it; add `pgnPerPlyClocks(pgn)` for per-ply think time (D4). |

---

## Build sequence (shippable increments)

Each increment is a self-contained PR that keeps validate + tests green.

### Phase 0 — Schema & primitives

**0a · Config module** — `server/lib/metrics-config.ts` (new)
- Export `METRICS_VERSION = 1` and every D8–D29 threshold: `ACL_SKIP_PLIES=8`,
  `DECIDED_WIN_PCT=95` (D22), `DECIDED_MATE_HOLD_K=3` (D28), `MATE_DISTANCE_EPSILON=0.01` (D27),
  `TIME_TROUBLE_MIN_S=30`/`TIME_TROUBLE_PCT=0.20` (D8), `CRITICALITY_GAP_PCT=15` (D9),
  `WINNING_WP=80`/`LOSING_WP=20` (D10), `SESSION_BREAK_MIN=60` (D11),
  `SWINDLE_ACC=65`/`UNLUCKY_ACC=80` (D12), `IMPULSE_PCT=0.10`/`IMPULSE_MIN_S=3` (D13),
  `OUT_OF_BOOK_FREQ_FLOOR=0.05`/`OUT_OF_BOOK_MAX_PLY=24` (D29), `TREND_WINDOW_GAMES=50` (D24),
  `RECENT_TIER_MONTHS=12`/`RECENT_TIER_GAMES=300` (D1).
- Pure constants; validate passes trivially. **No deps.**

**0b · Bug fix: `multipv_rank` in `computeAndCacheMetrics`** — `server/routes/games.ts`
- Add `AND multipv_rank = 1` to the SELECT (~line 334).
- Flush corrupt rows: `DELETE FROM game_metrics WHERE game_id IN (SELECT DISTINCT game_id FROM analysis WHERE multipv_rank > 1)`.
- Test: `tests/games-route.test.ts` — seed a game with 3 ranks/position, assert only rank-1 feeds `gameMetrics`. **No deps.**

**0c · Migrations + `pgn.ts`/`openings.ts` extensions**
- `server/lib/db.ts` **migration #11**: `ALTER TABLE games ADD COLUMN is_standard INTEGER`;
  `CREATE TABLE game_metrics_ext` (full schema from doc — `game_id` PK, `metrics_version`,
  `analysis_sig`, `multipv_max`, per-phase accuracy/acl, phase boundaries, time fields,
  criticality fields, tilt, time-trouble, peak/trough, `out_of_book_ply`,
  `out_of_book_eco_fallback`, `post_book_accuracy`, `eval_opening_end_wp`, `user_moves`,
  `clocks_available`, `engine_depth_min`, `computed_at`); indexes
  `idx_games_username_time_class ON games(username, time_class, end_time)` (D31) and
  `idx_gme_version ON game_metrics_ext(metrics_version)`.
- `server/lib/pgn.ts` (new exports): `parseTimeControl(pgn) → {baseSeconds, incrementSeconds}|null`
  ("600+5"→{600,5}, "180"→{180,0}, "-"→null); export `clkToSeconds`;
  `pgnPerPlyClocks(pgn) → (number|null)[]` (per-ply remaining seconds);
  `parseTermination(raw)`; `parseVariant(pgn)`; `isStandard(pgn, rules?)`.
- `server/lib/openings.ts`: extend `classifyOpening` return to `{ eco, name, depth }`.
- `server/lib/backfill.ts`: add `backfillIsStandard(db)`; call from `server/index.ts` startup.
- `server/routes/games.ts` `buildGameRow`: set `is_standard` via `isStandard(g.pgn, g.rules)`; add to upsert SQL.
- `e2e/fixtures.ts` + `e2e/seed.ts`: add `is_standard = 1` to seeded game inserts.
- Tests: `tests/pgn.test.ts` (new parsers), `tests/migrations.test.ts` (#11 schema). **Dep: 0a.**

**0d · Phase divider** — `server/lib/phases.ts` (new)
- `dividePhases(fens) → { middlegameStartPly: number|null, endgameStartPly: number|null }`
  per D0: `mm(fen)` minor+major count, back-rank sparseness (<4 own pieces),
  middlegame = first ply `mm≤10` or sparse, endgame = first ply `mm≤6`. Mixedness =
  `// TODO` (optional per D0).
- Test: `tests/phases.test.ts` — boundary positions, Scholar's Mate (opening only),
  middlegame-but-no-endgame, start pos (mm=14). **No deps** (parallel with 0c).

### Phase 1 — Accuracy migration + shared timeline + builder

**1a · Lichess accuracy migration (R38/D21/D26)** — highest blast radius, solo PR
- `server/lib/metrics.ts`: implement `aggregateAccuracyLichess(moves: {wpBefore,wpAfter}[])` =
  mean of (volatility-weighted mean, harmonic mean) of per-move `moveAccuracy`;
  **delete** `aggregateAccuracy`, `classAccuracyScore`, `CONSECUTIVE_BLUNDER_DAMPING`;
  rewire `gameMetrics` to call it.
- `server/lib/db.ts` **migration #12**: `ALTER TABLE game_metrics ADD COLUMN metrics_version INTEGER`;
  `DELETE FROM game_metrics` (clean cutover, D26). Bump `METRICS_VERSION → 2` in `metrics-config.ts`.
- Blast radius (verify each): `tests/metrics.test.ts` (rewrite accuracy expectations),
  `tests/stats-route.test.ts` (any hardcoded accuracy), `client/src/study/glossary.ts`
  (reword `accuracy` entry). **No change needed**: GameCard `accuracyColor` 90/70 thresholds,
  StatsPanel, `client/src/api.ts` interfaces, `accuracy-trend`/`by-side` SQL (values change,
  shapes don't), `game-metrics-invalidation.test.ts` (value-agnostic).
- ⚠ **Verify the exact Lichess formula against `lila`/scalachess source before coding** (Risk 1).
- **Dep: 0a, 0b.**

**1b · Layer 1 `buildTimeline`** — `server/lib/ply-timeline.ts` (new) + `engine.ts`
- `engine.ts`: add `AnalysisRowMPV extends AnalysisRow { multipv_rank }` +
  `getGameAnalysisMultiPV(gameId, maxRank=3)` (SELECT `multipv_rank <= ? ORDER BY move_index, multipv_rank`).
- `buildTimeline(pgn, analysisRows: AnalysisRowMPV[], userColor, phaseBoundaries) → EnrichedPly[]`:
  per ply → side, isUserMove, moveSan, winPctBefore/After (**synthetic mate win% `100 − N·ε`**, D27),
  wpLoss, moveClass (`classifySwing`), thinkTimeS (`pgnPerPlyClocks` + increment, D4),
  phase, criticality (rank1−rank2 win% gap, null if no rank-2), isDecided
  (D22/D28 state machine: non-mate ≥95 held, **or** mate held K plies).
- Group analysis rows by `move_index` once (O(n)). Pure function — no DB.
- Test: `tests/ply-timeline.test.ts` — cp fixtures (class/wpLoss), mate fixture (synthetic
  win%), clock fixture (thinkTime), decided fixture, rank-2 present/absent (criticality),
  Scholar's Mate, no-clocks (all thinkTime null). **Dep: 0a, 0c, 0d, 1a.**

**1c · Layer 2 `buildGameMetrics`** — `server/lib/game-metrics.ts` (new)
- `buildGameMetrics(timeline, gameRow) → ExtendedGameMetrics` folds (user moves only,
  excluding `isDecided`): per-phase accuracy/ACL (R13), phase time totals + avg (R4),
  top-3 critical + missed conversions with thinkTime (R5/R6/R16, **returned for drill-feed,
  not stored** per D3), tilt run + recovery accuracy (R14), time-trouble counts (R15/D8),
  critical/quiet accuracy + count (R17/R26/D9), peak/trough eval (R18), out-of-book ply
  (`classifyOpening().depth` ECO fallback per D33 until explorer exists; set
  `out_of_book_eco_fallback`) + post-book accuracy (R19), opening-end eval (R20),
  time-alloc efficiency = Spearman(thinkTime, criticality) (R25/D14), provenance
  (`metrics_version`, `analysis_sig = ${minDepth}:${rank1Count}`, depth, clocks, multipv_max).
- Test: `tests/game-metrics.test.ts` — no-clock, Scholar's Mate (phase edges), zero-blunder
  (maxRun=0/recovery=null), consecutive blunders, decided exclusion, one missed conversion.
  **Dep: 1a, 1b.**

### Phase 2 — Persistence: batch + ongoing capture

**2a · Shared upsert + invalidation helpers** — `server/lib/game-metrics.ts` / `games.ts`
- `upsertGameMetrics(db, gameId, timeline, ext)` writes **both** `game_metrics` (basic
  per-side, so existing stats keep working — Q3 reference-don't-duplicate) and
  `game_metrics_ext` (new folds) in one transaction with the same `metrics_version`.
- `isMetricsStale(row, version, sig)` for skip logic (D17). **Dep: 1c.**

**2b · Batch runner** — `server/scripts/build-metrics.ts` (new) + `package.json` (`"metrics"` script)
- `bun run metrics <username> [--reanalyze] [--min-depth N]`: load `games WHERE is_standard=1`,
  end_time DESC; skip if `game_metrics_ext` current (version + sig, R8); else ensure analysis
  (`analyzeGame(..., {multipv:3})` honoring `acquireAnalysisSlot`, R11; **tiered** per D1 —
  recent=deep, tail=fast mpv=1 → `multipv_max`); `getGameAnalysisMultiPV` → `buildTimeline` →
  `buildGameMetrics` → `upsertGameMetrics`; drill auto-feed (`autoFeedDrill`, R40/D23,
  `ON CONFLICT DO NOTHING`); one transaction/game (SIGINT-safe, R8); log `[done/total]`.
- Unit-test pure helpers (`shouldSkipGame`, `computeAnalysisSig`); no test for engine spawn.
- **Dep: 2a.**

**2c · Ongoing capture (R35)** — `server/routes/analyze.ts` + `server/routes/games.ts`
- In `analyze.ts`, **after the deep loop, before `{ done: true }`**, best-effort
  (try/catch, must not kill SSE; `done` in `finally`): rebuild timeline from stored rows →
  `upsertGameMetrics` + `autoFeedDrill`. Reuses the 2b helpers — no separate code path.
- `GET /games/:gameId`: lightweight stale-check (version/sig) → inline rebuild from existing
  `analysis` (no re-analysis).
- Test: `tests/analyze-route.test.ts` (new) — after SSE done, `game_metrics_ext` row exists.
  **Dep: 2a, 2b.**

### Phase 3 — Read API — `server/routes/metrics.ts` (new) + `stats.ts` + `api.ts`
- `GET /api/metrics/game/:gameId` — `game_metrics_ext ⋈ game_metrics ⋈ games` + **read-time
  derivations**: `elo_delta` (`LAG(user_elo) OVER (PARTITION BY time_class ORDER BY end_time)`, D5),
  `result_quality` (D12), `reached_winning/losing`/`converted`/`saved` (D10), `user_color`,
  `result_for_user`; plus live-built timeline → `critical_moves` + `missed_conversions` (D3/D16).
- `GET /api/metrics/:username` — list for sort/filter.
- New aggregate endpoints in `stats.ts` (pure SQL, rolling N-game per D24, forfeit/non-standard
  filtered per D19/D20): `consistency` (R21), `session-fatigue` (R22/D11), `vs-opponent` (R23),
  `acl-trend` (R27), `leak-closure` over `blunder_tags` (R28), `tpr` (R29), `repertoire` (R30),
  `counterplay` (R31), `endgame-conversion` (R32).
- `GET /api/metrics/:username/export?format=csv|json` (R41d).
- Register route in `server/index.ts`; add fetch wrappers + interfaces to `client/src/api.ts`.
- Test: extend `tests/stats-route.test.ts`. **Dep: 2a (table), 2c (data).**

### Phase 4 — Client surfacing (R41) — depends on Phase 3
- **4a** `Analysis.tsx`: delete client `moveClassifications` + `missedConversions` useMemos;
  consume a timeline endpoint (D16) so live view == batch.
- **4b** `client/src/components/MetricsCard.tsx` (new): per-game phases / time / critical /
  conversion / result-quality on Analysis (R41a).
- **4c** `GameCard.tsx`: add `resultQuality`/`phaseWeakness`/`timeTroubleFlag` chips + sorts (R41c).
- **4d** `Stats.tsx`: add tabs (consistency, ACL+accuracy trend, time-allocation, leak-closure,
  repertoire, TPR) — extend `Tab` union + `TAB_LABELS` + conditional render (R41b).
- **4e** `EloTrendChart.tsx`: running-peak overlay + net-gain/streak callouts (R12/D5).
- e2e: metrics card appears post-analysis; new Stats tabs render.

### Phase 5 — Verify & document
- `bun run validate` + `bun run test:all` green. Update `docs/README.md`; cross-link `roadmap.md`.

### Parallel track — Explorer (D29), non-blocking
- `server/scripts/build-explorer.ts` + `server/lib/explorer.ts` + `server/data/explorer/`:
  stream one monthly Lichess rated dump (`database.lichess.org`), zstd-decompress, filter band
  1100–2200 + first 24 plies, aggregate normalized-FEN-key → move → count.
  `positionFrequency(fenKey, move)` swaps in as the R19 primary; until then **D33 ECO fallback**
  (already wired in 1c) carries `out_of_book_ply`. Reuse `fenKey` from `engine.ts`.
- ⚠ Tens of GB download, multi-hour build, explicit manual run (Risk 3).

---

## Dependency graph

```
0a ─┬─ 0c ─┐
    └─ 1a ─┤        0b ─┐        0d ─┐
           └────────────┴───────────┴── 1b ── 1c ── 2a ─┬─ 2b ── 2c ── 3 ── 4 ── 5
0e (explorer) — parallel, needs only 0a/0c
```
- Parallelizable: 0a→{0c, 1a}, 0b, 0d, and 0e can proceed independently.
- **1a is a solo PR** (full accuracy-test rewrite, clean cutover).
- 3 and 4 can interleave per-endpoint after 2a.

---

## Risks

1. **Lichess accuracy formula not fully pinned (HIGH).** D21 says "mean of
   volatility-weighted mean and harmonic mean, weights = rolling std-dev of win%" but the
   window size / exact source isn't cited. **Verify against `lila`/scalachess before coding 1a.**
   One-function blast radius makes later correction cheap; relative ordering is preserved even
   if slightly off.
2. **Accuracy chips vanish between migration #12 and batch run (MEDIUM).** `DELETE FROM game_metrics`
   leaves analyzed-but-unreopened games with no accuracy until 2b runs. Expected per D26; run the
   batch immediately after deploy.
3. **Explorer dump size (MEDIUM, deferred).** Multi-GB / multi-hour. ECO fallback (D33) ships the
   feature without it.
4. **TS strictness on `buildTimeline`/`buildGameMetrics` (MEDIUM).** strict-boolean-expressions +
   zero-`any` + `import type`; grouping/Spearman need explicit `Map`/typed arrays.
5. **SSE capture must not break the stream (LOW).** 2c hook is best-effort try/catch; `done` in `finally`.
6. **Divider mixedness deferred (LOW).** Material + back-rank cover most games; TODO in `phases.ts`.
7. **e2e fixtures (LOW).** `fixtures.ts`/`seed.ts` must add `is_standard` after migration #11.

---

## Testing strategy

| Increment | Unit | e2e |
|---|---|---|
| 0b | `games-route.test.ts` multipv-rank regression | — |
| 0c | `pgn.test.ts` (parsers), `migrations.test.ts` (#11) | fixtures add `is_standard` |
| 0d | `phases.test.ts` (boundaries, short games) | — |
| 1a | rewrite `metrics.test.ts` accuracy (incl. single-blunder harmonic-mean drop) | accuracy chips render |
| 1b | `ply-timeline.test.ts` (cp/mate/clock/decided/criticality fixtures) | — |
| 1c | `game-metrics.test.ts` (no-clock, phase edges, tilt, decided, missed) | — |
| 2c | `analyze-route.test.ts` (ext row after done) | metrics card post-analysis |
| 3 | `stats-route.test.ts` (new endpoints) | new Stats tabs render |

Verification end-to-end: `bun run validate` && `bun run test:all`; then with dev servers up
(`bun run dev`), run `bun run metrics <username>` on a seeded user, open `/analysis/:id` (metrics
card), `/stats` (new tabs), confirm Elo trend running-peak.

---

## Critical files

New: `server/lib/{metrics-config,phases,ply-timeline,game-metrics,explorer}.ts`,
`server/scripts/{build-metrics,build-explorer}.ts`, `server/routes/metrics.ts`,
`client/src/components/MetricsCard.tsx`, `tests/{phases,ply-timeline,game-metrics,analyze-route}.test.ts`.

Modified: `server/lib/{db,pgn,openings,backfill,engine,metrics}.ts`,
`server/routes/{games,analyze,stats}.ts`, `server/index.ts`, `package.json`,
`client/src/api.ts`, `client/src/pages/{Analysis,Stats}.tsx`,
`client/src/components/{GameCard,EloTrendChart}.tsx`, `client/src/study/glossary.ts`,
`e2e/{fixtures,seed}.ts`, and the rewritten unit tests above.

---
---

# Appendix — Researched Ground Truth

Everything below was verified against the codebase. Line numbers are approximate
(they drift with edits) — grep the named symbol to relocate. This appendix exists so
an implementer can execute each increment without re-exploring.

## A1 · `server/lib/metrics.ts` — current state

All scores in the `analysis` table are stored **from White's perspective** (normalized
at write time in `engine.ts`). `metrics.ts` flips to the mover's perspective during
computation.

Exported functions:

```ts
// line 14 — Lichess win-probability sigmoid, returns [0,100]
export function cpToWinPct(cp: number): number {
  const c = Math.max(-1000, Math.min(1000, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
}

// line 20 — flat ±1000 surrogate, NO distance decay (the D27 problem)
export function mateToCp(mate: number): number {
  if (mate > 0) return 1000;
  if (mate < 0) return -1000;
  return 0;
}

// line 30 — the Lichess per-move accuracy formula. EXISTS BUT DEAD CODE (never called).
// R38 wires this into the new aggregateAccuracyLichess.
export function moveAccuracy(wpBefore: number, wpAfter: number): number {
  const wpDelta = Math.max(0, wpBefore - wpAfter);          // [0,100] scale
  const raw = 103.1668 * Math.exp(-0.04354 * wpDelta) - 3.1669 + 1;
  return Math.max(0, Math.min(100, raw));
}

// line 37 — converts [0,100] → [0,1] then delegates to classifySwing
export function classifyMove(wpBefore: number, wpAfter: number): MoveClass {
  const wpDelta01 = Math.max(0, (wpBefore - wpAfter) / 100);
  return classifySwing(wpDelta01);
}

// line 56 (unexported) — BUCKET model, DELETE in 1a
function classAccuracyScore(c: MoveClass): number  // best→100 good→90 inacc→70 mistake→40 blunder→10

// line 74 — BUCKET aggregate w/ consecutive-blunder damping 0.3, DELETE in 1a
export function aggregateAccuracy(classes: MoveClass[]): number

// line 42
export interface PerSideMetrics {
  accuracy: number; blunders: number; mistakes: number; inaccuracies: number; acl: number;
}

// line 119 — the main per-game fold; takes rank-1 ordered rows, returns both sides
export function gameMetrics(positions: AnalysisRow[]): { white: PerSideMetrics; black: PerSideMetrics }
```

`gameMetrics` internals to preserve when rewiring accuracy (1a):
- Loop transitions `i → i+1` for `i in 0..len-2`. `i % 2 === 0` → White moved, else Black.
- Internal `rowToCp(row)` = `row.score_mate !== null ? mateToCp(row.score_mate) : (row.score_cp ?? 0)`.
- Perspective flip: negate cp when `side === "b"`.
- `classifyMove` runs on **all** plies (including first 8) → blunder/mistake/inacc counts.
- ACL skips first 8 plies: `if (i >= 8) { cpLoss = clamp(cpBeforeMover - cpAfterMover, 0, 1000); ... }`.
- Returns `ZERO_METRICS` for both sides if `positions.length < 2`.

## A2 · `server/lib/db.ts` — schema + migration runner

Migration runner:
```ts
export interface Migration { id: number; up: (db: Database) => void; }
// runMigrations(db): reads meta.schema_version (0 if absent), filters migrations id > current,
// wraps ALL pending in ONE db.transaction(), runs each up(db), upserts schema_version = last id.
```
**Currently at migration #10.** Next free id = **#11**. Add new migrations by pushing
`{ id, up }` objects to the `migrations: Migration[]` array. They run atomically on boot,
idempotently after.

Existing tables / columns (post-#10):

```
games(id PK TEXT, username, pgn, white, black, result, time_class, end_time,
      created_at, white_elo, black_elo, user_elo, eco, opening,
      white_clock_final_s, black_clock_final_s, termination)
      -- NO time_control, NO opponent_elo, NO is_standard

analysis(game_id, move_index, multipv_rank DEFAULT 1, fen, fen_key, move_san,
         score_cp, score_mate, best_move, pv, depth)
         PK (game_id, move_index, multipv_rank)   -- ranks 1..3; rank 1 = best

game_metrics(game_id PK, accuracy_white, accuracy_black,
             blunders_white, mistakes_white, inaccuracies_white,
             blunders_black, mistakes_black, inaccuracies_black,
             acl_white, acl_black, computed_at)
             -- NO metrics_version yet (added in migration #12, increment 1a)

blunder_tags(game_id, move_index, tag)  PK all three;  INDEX idx_blunder_tags_tag(tag)
drill_attempts(id PK AUTOINC, username, game_id, move_index, fen, best_move,
               attempted_move, correct, attempted_at, stability, difficulty, due, state)
               UNIQUE(username, game_id, move_index);  INDEX idx_drill_due(username, due)
meta(key PK, value)
annotations(id PK AUTOINC, t, time_class, text)
```

**`game_metrics_ext` DDL (migration #11, increment 0c) — copy verbatim:**
```sql
CREATE TABLE IF NOT EXISTS game_metrics_ext (
  game_id TEXT PRIMARY KEY,
  metrics_version INTEGER NOT NULL,
  analysis_sig TEXT NOT NULL,
  multipv_max INTEGER NOT NULL,
  accuracy_opening REAL, accuracy_middlegame REAL, accuracy_endgame REAL,
  acl_opening REAL, acl_middlegame REAL, acl_endgame REAL,
  middlegame_start_ply INTEGER, endgame_start_ply INTEGER,
  time_opening_s REAL, time_middlegame_s REAL, time_endgame_s REAL, avg_move_time_s REAL,
  accuracy_critical REAL, accuracy_quiet REAL, critical_positions INTEGER,
  time_alloc_efficiency REAL,
  max_blunder_run INTEGER, recovery_accuracy REAL,
  time_trouble_moves INTEGER, time_trouble_errors INTEGER,
  peak_eval_wp REAL, trough_eval_wp REAL,
  out_of_book_ply INTEGER, out_of_book_eco_fallback INTEGER, post_book_accuracy REAL,
  eval_opening_end_wp REAL,
  user_moves INTEGER, clocks_available INTEGER, engine_depth_min INTEGER,
  computed_at INTEGER,
  FOREIGN KEY (game_id) REFERENCES games(id)
);
CREATE INDEX IF NOT EXISTS idx_games_username_time_class ON games(username, time_class, end_time);
CREATE INDEX IF NOT EXISTS idx_gme_version ON game_metrics_ext(metrics_version);
```
> SQLite `ALTER TABLE ... ADD COLUMN` cannot add a `NOT NULL` column without a constant
> default. Add `is_standard INTEGER` **nullable** (NULL = unprocessed) and let the backfill
> fill it. Same for `game_metrics.metrics_version INTEGER` in #12.

## A3 · `server/lib/engine.ts`

```ts
// line 388
export interface AnalyzeGameOpts { multipv?: number; movetimeMs?: number; persist?: boolean; }

// line 402 — async generator, yields per (moveIndex, multipvRank)
export async function* analyzeGame(
  gameId: string, fens: string[], moves: string[], opts?: AnalyzeGameOpts
): AsyncGenerator<{ moveIndex, multipvRank, fen, scoreCp, scoreMate, bestMove, pv, depth, total }>

// line 578 — note: NO multipv_rank field
export interface AnalysisRow {
  move_index: number; fen: string; fen_key: string | null; move_san: string | null;
  score_cp: number | null; score_mate: number | null; best_move: string;
  pv: string | null; depth: number;
}

// concurrency (module-level counter, no queue)
const MAX_CONCURRENT_ANALYSES = ENGINE_TYPE === "lc0" ? 1 : 2;
export function acquireAnalysisSlot(): boolean   // false if at cap (caller → HTTP 429)
export function releaseAnalysisSlot(): void

// line 567 — rank-1 ONLY (leave untouched; used by Analysis.tsx)
export function getGameAnalysis(gameId): AnalysisRow[]   // WHERE multipv_rank = 1 ORDER BY move_index
```

Score normalization (≈line 368): after engine returns, if `fen.split(" ")[1] === "b"`,
negate both `score.cp` and `score.mate` for every rank. So DB rows are White-perspective.

There is a `fenKey(fen)` helper (first 4 FEN fields) used for transposition lookups —
**reuse it for the explorer normalized-FEN key (D29)** and for `analysis_sig` if hashing.

**Add in 1b:**
```ts
export interface AnalysisRowMPV extends AnalysisRow { multipv_rank: number; }
export function getGameAnalysisMultiPV(gameId: string, maxRank = 3): AnalysisRowMPV[]
// SELECT move_index, multipv_rank, fen, fen_key, move_san, score_cp, score_mate, best_move, pv, depth
//   FROM analysis WHERE game_id = ? AND multipv_rank <= ? ORDER BY move_index, multipv_rank
```

## A4 · `server/lib/pgn.ts`

```ts
export interface MoveInfo { san: string; from: string; to: string; fen: string; }
export function pgnToFens(pgn: string): string[]      // FULL FENs w/ move counters; includes start pos at [0]
export function pgnToMoves(pgn: string): MoveInfo[]    // no start pos
export type PgnHeaders = Partial<Record<string, string>>;
export function pgnHeaders(pgn: string): PgnHeaders    // regex /^\[(\w+)\s+"([^"]*)"\]/gm — gets ANY header
export function getGameResult(pgn: string): string | null
export function pgnFinalClocks(pgn: string): { white: number | null; black: number | null }
function clkToSeconds(clk: string): number | null      // line 81 — NOT exported; regex /^(\d+):(\d+):(\d+(?:\.\d+)?)$/
```
`pgnHeaders` already returns `TimeControl`, `Termination`, `Variant`, `ECO`, `Opening`,
`WhiteElo`, `BlackElo` when present. `pgnFinalClocks` parses `[%clk H:MM:SS.S]` via
`/\[%clk\s+([\d:.]+)\]/g` tracking ply parity (even=white).

**Add in 0c (all exported):**
```ts
export { clkToSeconds }                                 // promote to export
export function parseTimeControl(pgn: string): { baseSeconds: number; incrementSeconds: number } | null
// "600+5" → {600,5}; "180" → {180,0}; "-" or "1/259200" (daily) → null
export function pgnPerPlyClocks(pgn: string): Array<number | null>
// index = ply-1 (ply 1 = White's first); value = remaining seconds AFTER that ply, or null
export function parseTermination(raw: string | null):
  "checkmate" | "resignation" | "timeout" | "abandoned" | "agreement" | "other" | null
// match Chess.com strings: "... won by checkmate"→checkmate, "won on time"→timeout,
// "won by resignation"→resignation, "drawn by agreement"→agreement, "abandoned"→abandoned
export function isForfeit(raw: string | null): boolean          // termination ∈ {timeout, abandoned} (D19)
export function parseVariant(pgn: string): string | null        // [Variant] header or null
export function isStandard(pgn: string, rules?: string): boolean
// false if Variant present & ≠ "Standard", or rules ∉ {undefined, "chess"}
```
Think-time per ply (D4): `think = clkPrevSameSide - clkThisPly + increment`; first ply of
each side uses `baseSeconds` as `clkPrev`; clamp negatives to 0; null if clock missing.

## A5 · `server/lib/openings.ts`

```ts
export interface OpeningEntry { eco: string; name: string; tokens: string[]; }  // tokens = bare SAN
export function tokenizePgnLine(pgn: string): string[]   // strips move numbers + result tokens
export function loadOpenings(): void                     // loads server/data/openings/{a..e}.tsv, sorts tokens.length DESC
export function classifyOpening(sanMoves: string[]): { eco: string; name: string } | null
// longest-prefix match over LOOKUP (longest first)
```
TSV format: `eco\tname\tpgn` (3 cols, header row). **Change in 0c:** return
`{ eco, name, depth: entry.tokens.length }`. `buildGameMetrics` uses `depth` as the D33
ECO-fallback `out_of_book_ply` (= matched prefix length; first off-book ply ≈ `depth + 1`).

## A6 · `shared/classify.ts` (client re-exports via `client/src/lib/classify.ts`)

```ts
export type MoveClass = "best" | "good" | "inaccuracy" | "mistake" | "blunder";
export const CLASSIFY_THRESHOLDS = { best: 0.02, inaccuracy: 0.10, mistake: 0.20, blunder: 0.30 } as const;
export function classifySwing(wpDelta: number): MoveClass   // input [0,1] mover-perspective, ≥0
// blunder ≥0.30, mistake ≥0.20, inaccuracy ≥0.10, best ≤0.02, else good
export function classToColor(c: MoveClass): string
```
opponent blunder (Definitions table) = opponent ply with `wpDelta ≥ 0.30`. **Do not change thresholds**
— they're already Lichess; only the aggregation changes in 1a.

## A7 · Game import + backfill

`server/lib/chesscom.ts`: `ChessComGame { url, pgn, time_control, time_class, end_time,
rated, rules, white:{username,rating,result}, black:{...} }`. `fetchRecentGames(username, months=3)`.
No DB logic here.

`server/routes/games.ts`:
- `buildGameRow(username, g) → GameRowData` (line 65): derives id from URL, result, elos
  (`pgnHeaders`), eco/opening (header → `classifyOpening` fallback), clocks (`pgnFinalClocks`),
  termination (`pgnHeaders().Termination`). **Add `is_standard` here (0c).**
- Upsert (≈line 154): `INSERT OR REPLACE INTO games (id, username, pgn, white, black, result,
  time_class, end_time, white_elo, black_elo, user_elo, eco, opening, white_clock_final_s,
  black_clock_final_s, termination) VALUES (...)`. **Add `is_standard` column + value.**
- `computeAndCacheMetrics(db, gameId)` (line 320): the **only** `game_metrics` writer. Reads
  rows, calls `gameMetrics`, `INSERT OR REPLACE`. **BUG (fix in 0b):** its SELECT (≈line 334)
  omits `AND multipv_rank = 1`.
- Call sites: `GET /games/:gameId/metrics`; `fetchBulkMetricsFor` → `GET /games/metrics?username=`
  (`BULK_COMPUTE_LIMIT = 20`).

`server/lib/backfill.ts` (idempotent, called at startup from `server/index.ts`):
- `backfillGameHeaders(db)`: `WHERE white_elo IS NULL` → fills elos/eco/opening.
- `backfillAnalysisFenKeys(db)`: `WHERE fen_key IS NULL` → `fenKey(fen)`.
- `backfillMotifs(db, limit=50)`: analyzed games w/ no `blunder_tags`, walks adjacent rows,
  `tagMoveIfBlunder`. **Pattern to copy for `backfillIsStandard(db)`.**

## A8 · Motifs (for R28 leak-closure)

`blunder_tags(game_id, move_index, tag)`. `Motif = hanging_piece|fork|pin|skewer|
back_rank_mate|missed_mate`. `tagMoveIfBlunder(db, gameId, moveIndex, before, after,
playedMoveUci)` classifies via `classifyMove`, only proceeds on mistake|blunder, runs
`detectMotifs`, `INSERT OR IGNORE INTO blunder_tags`. Mover color = `(moveIndex-1) % 2 === 0`
→ white. R28 aggregates `blunder_tags` frequency over time.

## A9 · `server/routes/stats.ts` — patterns to mirror

`USERNAME_PATTERN = /^[a-zA-Z0-9_-]{1,50}$/` (validate first, 400 on fail).
`TIME_CLASS_PATTERN = /^(bullet|blitz|rapid|daily)$/`. **No response envelope** — return bare
JSON via `c.json(...)`. Existing endpoints:

| Path | Returns |
|---|---|
| `/stats/:u/by-side` | `{ white: SideStats, black: SideStats }` |
| `/stats/:u/elo-trend?time_class=` | `{ t, elo }[]` (raw per-game, `end_time ASC`) |
| `/stats/:u/accuracy-trend?time_class=` | `{ t, accuracy }[]` (INNER JOIN game_metrics) |
| `/stats/:u/by-time-of-day` | `{ hour, day, games, wins, win_rate }[]` |
| `/stats/:u/win-rate?slice=color\|time_class\|opening\|rating_bucket&from=&to=` | `WinRateSliceRow[]` |
| `/stats/:u/motifs?from=&to=` | `{ tag, count, example_game_id, example_move_index }[]` |
| `/stats/:u/drill-progress` | `{ total_attempts, accuracy_pct, due_today, current_streak }` |

`opponent_elo` derivation (already used in `computeWinRateSlice`):
```sql
CASE WHEN lower(g.white) = lower(?) THEN g.black_elo ELSE g.white_elo END
```
**No SQL rolling windows exist yet.** New trend endpoints (R27) implement rolling N-game
(D24, `TREND_WINDOW_GAMES`) — SQLite has window functions (`AVG(...) OVER (... ROWS BETWEEN
N PRECEDING ...)`). `elo_delta` (D5) = `LAG(user_elo) OVER (PARTITION BY time_class ORDER BY
end_time)`. Forfeit/non-standard filter for accuracy aggregates:
`WHERE g.is_standard = 1 AND g.termination NOT LIKE '%on time%' AND g.termination NOT LIKE '%abandoned%'`
(or precompute the classified set in the server layer).

## A10 · `server/routes/analyze.ts` — SSE + the R35 hook

`GET /analyze/:gameId?multipv=1|3`. Two-phase: shallow (mpv=1, `SHALLOW_MOVETIME_MS≈50`),
deep (mpv=1|3, `SEARCH_MOVETIME≈1000`, `MULTIPV_MOVETIME_FACTOR=1.5`, `POSITION_TIMEOUT_MS=10_000`).
At request start: `DELETE FROM game_metrics WHERE game_id = ?` (line ~88).

Event shapes:
```ts
// per move: { phase:"shallow"|"deep", moveIndex, multipvRank, fen, scoreCp, scoreMate, bestMove, pv, depth, total }
// terminal: { done: true }   |   error: { error: "Analysis failed" }
```
Handler skeleton (the **R35 hook goes after the deep `for await` loop, before
`enqueue({done:true})`** — same place `tagMoveIfBlunder` already runs per move):
```ts
new ReadableStream({ async start(controller) {
  try {
    // phase 1 shallow (if not already analyzed)
    // phase 2 deep: for await (deep) { emit(...); tagMoveIfBlunder(...); }
    // ── R35 ONGOING CAPTURE HOOK (best-effort, must not throw out) ──
  } catch { emit error }
  finally { releaseAnalysisSlot(); controller.enqueue({done:true}); controller.close(); }
}})
```
Client (`Analysis.tsx`) opens `EventSource('/api/analyze/{id}?multipv=3')`, on `done` invalidates
`["metrics", id]` + `["alternatives", id]`.

## A11 · `server/routes/drill.ts` — auto-feed target (R40/D23)

FSRS via `ts-fsrs`. `drill_attempts` FSRS fields: `stability REAL, difficulty REAL,
due INTEGER (unix s), state INTEGER`. `rowToCard(row)` falls back to `createEmptyCard()`
when fields are null.

Queue has two paths:
- **due:** `SELECT ... FROM drill_attempts WHERE lower(username)=? AND due IS NOT NULL AND due<=? ORDER BY due ASC LIMIT ?`
- **new:** `SELECT DISTINCT bt.game_id, bt.move_index FROM blunder_tags bt JOIN games g ... WHERE
  <user is mover> AND NOT EXISTS (SELECT 1 FROM drill_attempts d WHERE ... same key) LIMIT ?`

So mistake/blunder positions **already** surface without `drill_attempts` rows. Auto-feed upsert
(reconciles cleanly — `NOT EXISTS` guard prevents double-surfacing):
```sql
INSERT INTO drill_attempts (username, game_id, move_index, fen, best_move,
  attempted_move, correct, attempted_at, stability, difficulty, due, state)
VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, unixepoch(), NULL)
ON CONFLICT (username, game_id, move_index) DO NOTHING
```
`fen` = BEFORE-position FEN (`analysis WHERE move_index = criticalPly - 1, multipv_rank = 1`),
`best_move` = that row's `best_move`. Seed both top-3 critical and missed conversions.

## A12 · Client surfaces

`client/src/api.ts` — bare `fetch` wrappers (no shared helper); each `throw` on `!r.ok`, cast
`r.json() as Promise<T>`. Interfaces: `GameRow`, `AnalysisRow` (mirror server, no multipv_rank),
`GameDetailResponse`, `PerSideMetrics`, `GameMetrics`, `EloTrendPoint {t,elo}`,
`AccuracyTrendPoint {t,accuracy}`. **Add** `ExtendedGameMetrics`, aggregate interfaces, and
fetchers for the new endpoints here.

`Analysis.tsx` (D16 target):
- `moveClassifications` useMemo (≈line 401): per-index `classifySwing(wpDelta)` using local
  `cpToWp` (≈line 46, duplicate of `cpToWinPct`). **Delete in 4a.**
- `missedConversions` useMemo (≈line 428): `isUserMove && prevWasOppBlunder && userNotBest`.
  **Delete in 4a** (D2 broadens "capitalized" to `best ∪ good` — server is now authoritative).
- Both feed `classificationsRef`/`missedConversionsRef` for keyboard nav (`b/B m/M x/X`). Repoint
  these refs at the timeline-endpoint data.

`GameCard.tsx`: `accuracyColor` ≥90 green / ≥70 amber / else red — **keep** (Lichess-compatible).
Accuracy chip from `GameMetrics` side field. Add chips: `resultQuality`, `phaseWeakness`, `timeTroubleFlag`.

`EloTrendChart.tsx` / `AccuracyTrendChart.tsx`: uPlot, **deferred init via ResizeObserver** (chart
created on first non-zero dimension, then `setSize`/`setData`); custom overlays via `draw` hook.
AccuracyTrend pins `scales:{ y:{ range:[0,100] }}`. Extend EloTrend with a running-peak series +
gain callout (R12/D5) computed client-side from `{t,elo}[]`.

`Stats.tsx`: `type Tab = "by-side"|"time-class"|...`; `TAB_LABELS: Record<Tab,string>`;
`ALL_TABS = Object.keys(TAB_LABELS)`; conditional render `{tab === "x" && <XTab username={u} />}`.
Each tab = a `useQuery(["stats", key, u, ...], fetchFn)`. **Add new tabs** by extending the union,
`TAB_LABELS`, and the render block (button auto-renders via `ALL_TABS.map`).

`study/glossary.ts`: `GlossaryEntry { id, term, aliases?, plain, detail, where, link?, metric }`;
`GLOSSARY: GlossaryEntry[]` (entries incl. `accuracy`, `acl`). Reword the `accuracy` entry in 1a.

## B · Formulas & algorithms (exact)

**Synthetic mate win% (D27, in `buildTimeline` only):**
```
syntheticWinPct(row, moverSide):
  if score_mate != null:
    sign = score_mate > 0 ? +1 : -1            // White-perspective mate
    wpWhite = sign > 0 ? (100 - |score_mate| * ε) : (|score_mate| * ε)   // ε = MATE_DISTANCE_EPSILON
  else:
    wpWhite = cpToWinPct(score_cp ?? 0)
  return moverSide == "w" ? wpWhite : 100 - wpWhite
```
Criticality (D9) and decided (D28) then operate on these synthetic values — mate-in-1 vs
mate-in-7 yields a real gap; a found mate reads ~99.x.

**Decided boundary state machine (D22 + D28):** scan plies in order; track the leading side
(win% ≥ `DECIDED_WIN_PCT=95`). Fire `decidedFrom = ply` only when EITHER a **non-mate** eval ≥95
holds for that side through the end of the game, OR a mate score has been held by that side for
`DECIDED_MATE_HOLD_K=3` consecutive plies. From `decidedFrom` on, plies where
`isUserMove && side === leadingSide` get `isDecided = true` and are **excluded from
accuracy/ACL** (the trailing side still counts).

**Lichess game accuracy (D21, increment 1a) — VERIFY against lila/scalachess first (Risk 1):**
```
per move i (user moves, !isDecided): a[i] = moveAccuracy(wpBefore_i, wpAfter_i)
volatility weight w[i] = stddev of the win% series in a window around i
  (Lichess uses a windowed std-dev of the mover-perspective win% sequence; pin the window)
volWeightedMean = Σ(a[i]·w[i]) / Σ(w[i])
harmonicMean    = n / Σ(1 / max(a[i], ε))        // guard divide-by-zero
gameAccuracy    = (volWeightedMean + harmonicMean) / 2
```
Test invariant: a single large blunder among otherwise-perfect moves must drop the harmonic
mean **more** than the weighted mean (this is the model's whole point).

**Time-allocation efficiency (R25/D14):** Spearman rank correlation between per-user-ply
`thinkTimeS` and `criticality`, over plies with non-null clocks AND non-null criticality:
```
rank each series; d[i] = rankThink[i] - rankCrit[i]
ρ = 1 - (6 · Σ d[i]²) / (n·(n²−1))     // null if n < 2 or no clocks
```

**Time trouble (D8):** ply is in time trouble when remaining clock <
`max(TIME_TROUBLE_MIN_S=30, TIME_TROUBLE_PCT=0.20 · baseSeconds)`. `time_trouble_moves` = count
of user plies in trouble; `time_trouble_errors` = those classified mistake|blunder. Null if no clocks.

**result_quality (D12, read-time):** `swindle_win` = win & (accuracy<65 OR reached-losing-then-won);
`clean_win` = other win; `unlucky_loss` = loss & accuracy≥80; `clean_loss` = other loss;
`hold_draw` = draw after reaching losing; `even_draw` = other draw.

**Conversion flags (D10, read-time from peak/trough):** winning = user-wp ≥ `WINNING_WP=80`,
losing = ≤ `LOSING_WP=20`. `converted` = reached winning & won; `saved` = reached losing &
result ∈ {win, draw}.

**analysis_sig (D17):** `${engineDepthMin}:${rank1RowCount}` (or a hash). Row recompute fires when
stored `metrics_version ≠ METRICS_VERSION` OR `analysis_sig` differs.

## C · New interfaces (target shapes)

```ts
// server/lib/phases.ts
export interface PhaseBoundaries { middlegameStartPly: number | null; endgameStartPly: number | null; }
export function dividePhases(fens: string[]): PhaseBoundaries

// server/lib/ply-timeline.ts
export interface EnrichedPly {
  plyIndex: number; moveIndex: number; side: "w" | "b"; isUserMove: boolean;
  moveSan: string | null; winPctBefore: number; winPctAfter: number; wpLoss: number;
  moveClass: MoveClass; thinkTimeS: number | null;
  phase: "opening" | "middlegame" | "endgame";
  criticality: number | null; rank2WinPct: number | null; isDecided: boolean;
}
export function buildTimeline(
  pgn: string, analysisRows: AnalysisRowMPV[], userColor: "w" | "b", phases: PhaseBoundaries
): EnrichedPly[]

// server/lib/game-metrics.ts  (fields map 1:1 to game_metrics_ext columns; see A2 DDL)
export interface CriticalMove { plyIndex: number; moveSan: string; wpBefore: number; wpAfter: number;
  moveClass: MoveClass; phase: string; thinkTimeS: number | null; beforeFen: string; bestMove: string; }
export interface MissedConversion { plyIndex: number; moveSan: string; thinkTimeS: number | null;
  beforeFen: string; bestMove: string; }
export interface ExtendedGameMetrics { /* all game_metrics_ext scalars */
  criticalMoves: CriticalMove[]; missedConversions: MissedConversion[]; /* returned for drill-feed, NOT stored */ }
export function buildGameMetrics(timeline: EnrichedPly[], gameRow): ExtendedGameMetrics
```

## D · Phase Divider reference (D0)

`mm(fen)` = count of `n N b B r R q Q` in the piece-placement field (minor+major, excl. kings &
pawns); start = 14. Back-rank sparse = a side has < 4 of its own pieces on its back rank (rank 1
White / rank 8 Black). `middlegameStartPly` = first ply where `mm ≤ 10` OR back-rank sparse.
`endgameStartPly` = first ply where `mm ≤ 6`. Either may be null (never reached). Mixedness
(region intermingling, scalachess `Divider.scala`) is **optional** — `// TODO`, material+back-rank
cover most games. Operate over `pgnToFens(pgn)` board states.

## E · Project conventions to honor (else lint/build fails)

- **Zero `any`**, zero `as any`, no `// eslint-disable` of type-safety rules. Use `unknown` + guards.
- **`import type`** on a separate line for type-only imports (`verbatimModuleSyntax: true`).
- **strict-boolean-expressions**: `if (x !== null && x !== "")`, never `if (x)` on string/number/object.
- Relative imports only (no `~/*`). CSS imports only in `client/src/main.tsx`.
- Hooks before any early `return`; exhaustive deps; module-level constants for stable fallbacks.
- Refs end in `Ref`; module constants SCREAMING_SNAKE_CASE; components PascalCase named exports.
- Files < 800 lines, functions < 50 lines — split builders if they grow.
- `void` to discard floating promises.
- Tests: `bun:test`, kebab-case `*.test.ts` in `tests/`; replicate pure logic (don't import React).
  e2e: Playwright-core via `bun:test`, shared-page-per-`describe`, `{ exact: true }` for ambiguous text.
- Run `bun run validate` after every increment; resolve all errors before moving on (per `AGENTS.md`).
- Commits: conventional, < 85 chars, author `Ian Thomas <agent@ianthomasict.com>`.
