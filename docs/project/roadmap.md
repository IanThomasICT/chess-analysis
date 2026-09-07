# Roadmap: Feature Gaps vs. Vision

## Purpose

`core.md` defines the project vision: a personal tool for Ian to improve his Chess.com game, optimized for three metrics — **win rate**, **accuracy / blunder rate**, **elo**. This doc catalogs features that move those metrics but are not yet built. It's a research input for future implementation plans, not a commitment. Each entry includes enough detail (data sources, schema impact, technical sketch, open questions) to scope an implementation plan in one sitting.

> **Update:** Tier-1 aggregation/metrics and a large slice of the deeper analytics
> are now built — see [`game_metrics.md`](game_metrics.md) (design) and [`../plans/game-metrics-plan.md`](../plans/game-metrics-plan.md)
> (build sequence). Per-game accuracy (now the exact Lichess formula), blunder
> counts, by-side breakdown, per-phase accuracy/ACL, time management, critical/quiet
> accuracy, tilt/recovery, conversion/defense, result-quality, Elo delta, and the
> cross-game aggregates (consistency, session-fatigue, vs-opponent, ACL trend,
> leak-closure, TPR, repertoire, counterplay, endgame-conversion) all shipped.
> Entries below that overlap are kept for historical context.

**How to use this doc:**
- Read the "Quick reference" table to triage.
- Each feature entry below is self-contained: data, sketch, complexity, risks.
- "Smallest first step" at the bottom proposes the highest-ROI starting point.
- Add new ideas as new entries; update existing ones with research findings.

**Complexity scale (rough):**
- **S** — < 1 day, no new infra, no new deps. Pure SQL + UI.
- **M** — 1–3 days, may add a DB column or small lib, modest UI work.
- **L** — > 3 days, schema migration, new background job, or new analysis primitive.

---

## Quick reference

| Tier | Feature | Metric served | Complexity | Key data source |
|---|---|---|---|---|
| 1 | Per-game accuracy score | Accuracy | S | `analysis` table |
| 1 | Blunder/mistake/inaccuracy counts per game + over time | Blunder rate | S | `analysis` table |
| 1 | Side-of-board breakdown (White vs Black accuracy / win rate) | Win rate, Accuracy | S | `games` + `analysis` |
| 1 | Win-rate dashboard (by color / time class / opponent rating) | Win rate | M | `games` (+ rating field) |
| 1 | Opening identification (ECO codes) | Win rate (by opening) | M | PGN headers, ECO lookup |
| 1 | Elo trend chart | Elo (lagging) | M | Chess.com stats API or PGN ratings |
| 2 | "Next blunder" jump button on Analysis page | Review velocity | S | `moveClasses` already computed |
| 2 | Multi-PV (top 3 engine moves, not just best) | Accuracy | M | Stockfish `MultiPV` option |
| 2 | Worst-games queue (sort by accuracy ascending) | Review velocity | S | Per-game accuracy (Tier 1) |
| 2 | Position recurrence ("this FEN appeared in N prior games") | Blunder rate | M | New index on `analysis.fen` |
| 3 | Tactical motif clustering (hanging piece, fork, pin, etc.) | Blunder rate | L | Engine + piece-square analysis |
| 3 | Centipawn-loss (ACL) metric | Accuracy | S | `best_move` vs played move |
| 3 | Time-of-day / day-of-week win-rate analysis | Win rate (behavioral) | S | `games.end_time` |
| 4 | Drill mode: replay own blunder positions as puzzles | Blunder rate, skill transfer | L | Per-position blunder tagging |
| 4 | Spaced-repetition queue for missed tactics | Blunder rate | L | Drill mode + scheduling |

---

## Tier 1 — Aggregation / metrics (highest ROI)

These features turn the existing per-game analysis cache into the metric loop the vision demands. Without these, the user reviews games one by one with no idea whether they're improving.

### 1.1 Per-game accuracy score

**Metric:** Accuracy.
**What:** Single 0–100 number per game, à la Chess.com. Display on `GameCard` and on the Analysis page header.
**Why:** Without a scalar accuracy number per game, there's no signal to track over time. Chess.com gives you a number but only for analyzed games; this lets us compute our own from cached Stockfish data, including games Chess.com didn't analyze.
**Data:** Already in `analysis` table — `score_cp` and `score_mate` per move. Compute from centipawn loss vs `best_move` (see ACL below) or use Lichess-style accuracy formula on win-percent deltas.
**Sketch:**
- Add a derived value (computed on demand, cached if expensive): for each move played, centipawn-loss = engine eval before move − engine eval after move (signed against the mover).
- Accuracy formula: Lichess uses `103.1668 * exp(-0.04354 * wp_delta) - 3.1669`, clamped 0–100, where `wp_delta` is win-percentage delta. Research which formula to adopt.
- Render as a chip on `GameCard`. Color-code (green ≥ 90, amber 70–89, red < 70).
**Schema:** Optional new table `game_metrics(game_id PK, accuracy_white REAL, accuracy_black REAL, computed_at)` to cache. Or compute lazily and cache in a separate file. Start lazy.
**Complexity:** S.
**Open questions:** Which accuracy formula (Chess.com is closed, Lichess is open and reasonable)? Per-side or per-user-side only?
**Related code:** `client/src/components/GameCard.tsx`, `client/src/pages/Analysis.tsx`, `server/lib/stockfish.ts` (existing eval data), potentially `server/lib/db.ts` (new table).

### 1.2 Blunder / mistake / inaccuracy counts per game + time series

**Metric:** Blunder rate.
**What:** Each game shows counts: "2 blunders, 3 mistakes, 4 inaccuracies". A dashboard shows the trend across the last N games.
**Why:** Reducing blunders is the single highest-leverage skill improvement at sub-1800 elo. Need to see the count drop over time.
**Data:** Already classifiable from `analysis.score_cp` swings (see `evalCp` + `classifySwing` helpers in `Analysis.tsx`). Move those helpers server-side or replicate them in SQL.
**Sketch:**
- Server: extend `getGameAnalysis()` to return aggregates, or add a `/api/games/:id/metrics` route.
- Client: chip on `GameCard` ("🔴 2 / 🟠 3 / 🟡 4"). New dashboard route `/stats` with chart of blunders-per-game over time, segmented by side.
- Chart: another uPlot chart (already in deps).
**Schema:** None required initially. Consider `game_metrics` cache if recompute becomes slow.
**Complexity:** S (count) + S (chart).
**Open questions:** Filter by user side only (only blunders *Ian* made) — yes, that's the point. Drop opponent blunders from the count.
**Related code:** `client/src/pages/Home.tsx`, `client/src/components/GameCard.tsx`, new `client/src/pages/Stats.tsx`, `server/routes/games.ts`.

### 1.3 Side-of-board breakdown

**Metric:** Win rate, Accuracy.
**What:** Top of the home page (or stats page): "As White: 58% win rate, 84% accuracy. As Black: 41% win rate, 76% accuracy."
**Why:** Tells the user which color needs the most work. Often the answer is unintuitive (e.g. low Black win rate but high accuracy means the openings need fixing).
**Data:** `games.white`, `games.black`, `games.result`, `games.username` → derive side. Combine with per-game accuracy.
**Sketch:** Pure SQL aggregation. New endpoint `/api/stats/:username/by-side`.
**Complexity:** S.
**Open questions:** Time window (last 30 games? all-time? selectable?).
**Related code:** `server/routes/games.ts` (new endpoint or new file `server/routes/stats.ts`), `client/src/pages/Home.tsx` or new stats page.

### 1.4 Win-rate dashboard

**Metric:** Win rate.
**What:** Drill-down view: win rate sliced by color, time class, opponent rating bucket (e.g. ±100 of own rating, +200, -200), opening (depends on 1.5), and date range.
**Why:** Surfaces where the easy wins are being missed and where the user is over-matched.
**Data:** Existing `games` table covers color and time class. Opponent rating requires capturing it from PGN headers (`[WhiteElo]`, `[BlackElo]`) — currently parsed but not stored. Add columns.
**Sketch:**
- Schema migration: `ALTER TABLE games ADD COLUMN white_elo INTEGER, ADD COLUMN black_elo INTEGER, ADD COLUMN user_elo INTEGER` (denormalized for quick filtering).
- Backfill from existing PGNs (one-shot script).
- Endpoint: `/api/stats/:username/win-rate?slice=color|time_class|rating_bucket|opening&from=DATE&to=DATE`.
- Client: faceted view with multi-axis selection.
**Complexity:** M (migration + backfill + UI).
**Open questions:** Rating bucket boundaries? "Daily" games — meaningful or filter out?
**Related code:** `server/lib/db.ts` (schema), `server/lib/pgn.ts` (header extraction), new `server/routes/stats.ts`, new `client/src/pages/Stats.tsx`.

### 1.5 Opening identification (ECO)

**Metric:** Win rate (by opening), accuracy (by opening).
**What:** Every game tagged with its ECO code (A00–E99) and opening name. Stats page slice: "Caro-Kann Defense: 12 games, 33% win rate, 78% accuracy." Combined with 1.4.
**Why:** Openings are the most concentrated, learnable thing the user controls. If win rate is 30% in one opening and 60% in another, switch reps to the bad opening.
**Data:** Chess.com PGNs include `[ECO]` and `[ECOUrl]` headers. Sometimes also `[Opening]`. Currently parsed but not stored. Alternative: build/import an ECO lookup table keyed by opening move sequence (~3000 entries) and tag games locally.
**Sketch:**
- Cheap path: store `eco` from PGN headers. Add `games.eco TEXT, games.opening TEXT`.
- Robust path: import ECO TSV (e.g. `lichess-org/chess-openings` repo on GitHub), tag each game by matching its first ~12 moves' SAN sequence. Slower to build but handles games without ECO headers.
- Backfill existing games.
**Schema:** `ALTER TABLE games ADD COLUMN eco TEXT, opening TEXT;` + optional `opening_book(eco, name, moves)` table.
**Complexity:** M (PGN-header path) or M+ (ECO-book path).
**Open questions:** Does Chess.com always include `[ECO]`? Spot-check seeded games. If consistent, cheap path is enough.
**Related code:** `server/lib/pgn.ts`, `server/lib/db.ts`, `server/routes/games.ts`, `server/lib/chesscom.ts`.

### 1.6 Elo trend chart

**Metric:** Elo (lagging indicator).
**What:** Line chart of Chess.com rating over time, per time class. Annotate behavioral changes ("started daily review on date X").
**Why:** Elo is the final scoreboard. Without a trend chart the user can't tell whether anything they're doing is working over weeks/months.
**Data:** Two sources:
- **PGN headers** of every game: `[WhiteElo]`, `[BlackElo]`. Combined with `games.username` → user's elo at game end. Already in PGN, not yet stored.
- **Chess.com stats API**: `GET /pub/player/{user}/stats` — current rating, best rating per time class. Less granular but more reliable. Could also pull rating history per game from `/pub/player/{user}/games/{YYYY}/{MM}` PGNs (already done by import).
**Sketch:**
- Reuse Tier 1.4 schema (`games.user_elo`) — populate during import.
- New endpoint `/api/stats/:username/elo-trend?time_class=blitz`.
- uPlot line chart per time class, with manual annotation support (separate table or just inline notes).
**Schema:** Covered by 1.4. Optional `annotations(date, time_class, text)` table.
**Complexity:** M.
**Open questions:** How far back can the data go? Chess.com API caps historical games per month, but `/games/{YYYY}/{MM}` archives go back to account creation. Worth pulling all-time once.
**Related code:** `server/lib/chesscom.ts`, `server/lib/db.ts`, new `server/routes/stats.ts`, new `client/src/pages/Stats.tsx`.

---

## Tier 2 — Review velocity

The tool's job is to make the user review more games per week. These features cut time-to-insight per game.

### 2.1 "Next blunder" / "next critical moment" navigation

**Metric:** Review velocity.
**What:** Buttons on the Analysis page: "Next blunder", "Prev blunder", "Next mistake". Or keyboard shortcuts (`B` / `Shift+B`).
**Why:** Today: scroll move list, eyeball for red moves. Faster: one keypress jumps the board + graph + move list to the next swing > 300 cp.
**Data:** `moveClasses` array already computed in `Analysis.tsx`. Or recompute from `analysis` directly.
**Sketch:** Add keyboard handler in the existing keyboard `useEffect`. Find next/prev index where `moveClasses[i]` contains `"red"` (or extract a structured classification array instead of CSS strings — cleaner refactor).
**Complexity:** S.
**Open questions:** Should "critical moment" include all swings > N cp regardless of who blundered (e.g. opponent blunder → did the user capitalize)? Probably yes — both have lessons.
**Related code:** `client/src/pages/Analysis.tsx` (keyboard effect, classification helpers).

### 2.2 Multi-PV (top 3 engine moves)

**Metric:** Accuracy (understanding, not just measurement).
**What:** Stockfish returns top 3 candidate moves with evals for each position. Show top 3 arrows on the board, color-graded (best=blue, 2nd=lighter, 3rd=faint). On the move list / sidebar, show "You played Nf3 (-0.4). Best: Bxh7+ (+2.1). 2nd: Qd2 (+0.5)."
**Why:** "Best move only" tells the user *what* they should have played. Multi-PV tells them *why* — by showing the alternatives, the user learns to evaluate moves, not just memorize.
**Data:** Stockfish UCI: `setoption name MultiPV value 3`. Each `info` line then includes a `multipv N` field. Parse all 3 lines per position.
**Sketch:**
- Schema: rework `analysis` to either store one row per (game, move_index, multipv_rank) or denormalize as JSON column. Probably first option — composite PK becomes `(game_id, move_index, multipv_rank)`.
- `server/lib/stockfish.ts`: parse multi-pv lines, yield array of 3 per position.
- Client: render top-3 arrows with `autoShapes` (already supports multiple shapes).
- Migration concern: existing cached analysis is single-PV. Either re-analyze games on demand or keep MultiPV optional (only run on user request).
**Complexity:** M (schema + parser + UI).
**Open questions:** Does triple search time significantly slow analysis (90s → 270s for a 60-move game)? Stockfish MultiPV with same total time gives weaker per-line evals — research the trade-off. May want depth-bounded instead of time-bounded for multi-PV.
**Related code:** `server/lib/stockfish.ts`, `server/lib/db.ts`, `server/routes/analyze.ts`, `client/src/pages/Analysis.tsx`.

### 2.3 Worst-games queue

**Metric:** Review velocity.
**What:** Home page button: "Review my worst recent games" — sorts games by accuracy ascending (or by blunder count descending), shows top 10.
**Why:** Auto-prioritization. The user reviews the games that have the most to teach, not whatever happened last.
**Data:** Per-game accuracy (Tier 1.1) and/or blunder count (1.2).
**Sketch:** SQL `ORDER BY accuracy ASC LIMIT 10`. Filter chip on existing gallery.
**Complexity:** S (after Tier 1.1).
**Open questions:** Should it exclude games already reviewed (need a "reviewed" flag)? Maybe.
**Related code:** `client/src/pages/Home.tsx`, `server/routes/games.ts`.

### 2.4 Position recurrence

**Metric:** Blunder rate.
**What:** On the Analysis page, when viewing a position: "This position (or near-identical) appeared in 5 of your prior games. You blundered in 3 of them." Click → list of those games.
**Why:** Reveals patterns — "I always lose the thread on move 12 of this opening." Personalized weakness detection without ML.
**Data:** `analysis.fen` already stored. Add an index. Lookup by FEN (or by FEN-minus-clocks for fuzzier matching).
**Sketch:**
- Schema: `CREATE INDEX idx_analysis_fen ON analysis(fen);`. FEN is exact — consider truncating to just the position+side fields (drop halfmove/fullmove counters) for better recurrence detection.
- Endpoint: `/api/positions/:fenHash/history?username=X` returns games containing that FEN.
- UI: Analysis page sidebar shows "X prior games" badge with link.
**Schema:** Index only. Maybe `analysis.fen_key` (truncated FEN) as a separate column.
**Complexity:** M.
**Open questions:** Strict FEN match or position-only? Transposition handling (same position, different move order) — strict FEN match handles this naturally if comparing position fields only.
**Related code:** `server/lib/db.ts`, `server/routes/games.ts`, `client/src/pages/Analysis.tsx`.

---

## Tier 3 — Pattern detection (higher impact, more work)

These features turn raw eval data into actionable lessons. Higher leverage on blunder rate but require new analysis primitives.

### 3.1 Tactical motif clustering

**Metric:** Blunder rate (largest single lever).
**What:** Each blunder tagged with motif type: hanging piece, missed fork, missed pin/skewer, back-rank weakness, missed mate-in-N, allowed fork, etc. Stats page: "Top 5 recurring motifs: 1) Hanging piece (12x in last 30 games)."
**Why:** Generic "you blundered" is useless training feedback. "You hung a knight to a fork 4 times this week" is a drill target.
**Data:** Engine eval (already have) + piece-position deltas before/after the blunder move + best-move analysis. Heuristic rules can identify most motifs without ML.
**Sketch:**
- For each blunder position: diff piece locations before/after the played move and the engine's best move. Apply heuristics:
  - "Hanging piece": user's piece on a square attacked by opponent with no defender after the move.
  - "Missed fork": best move attacks two pieces of value ≥ minor.
  - "Back-rank mate": engine line ends in mate on rank 1/8.
  - "Missed mate-in-N": `score_mate` was ≤ ±N before move, > ±N after.
- Store tags in new `blunder_tags(game_id, move_index, tag)` table.
- Heuristics can start simple (hanging piece, missed mate) and expand.
**Schema:** `blunder_tags(game_id, move_index, tag TEXT)` — many-to-one with `analysis`.
**Complexity:** L (heuristics development is open-ended).
**Open questions:** Build heuristics in TS or shell out to a Python tactical analyzer? Bun + chess.js can introspect piece-square attack patterns natively — probably no Python needed. Research how Lichess/Chess.com classify; their algorithms may be open-source.
**Related code:** New `server/lib/motifs.ts`, integration into `analyze.ts` (run after each position).

### 3.2 Average centipawn loss (ACL)

**Metric:** Accuracy.
**What:** Aggregate centipawn-loss metric per game and over time. Industry-standard accuracy measure.
**Why:** Single objective number that's directly comparable across games and to engine analysis from other tools.
**Data:** Compute per move: `engine_eval_before_user_move - engine_eval_after_user_move` (signed for the user's side). Average over all user moves.
**Sketch:** SQL aggregation over `analysis` table, filtered to moves where it was the user's turn. May need to track who played each move (derivable from `move_index` parity + user's color in that game).
**Complexity:** S.
**Open questions:** Filter opening book moves out (ACL on the first 8 moves is noisy)? Cap per-move loss at N centipawns (some sites do this to avoid outlier mate-in-1 misses dominating the average)?
**Related code:** New `server/lib/metrics.ts`, integrated into stats endpoints.

### 3.3 Time-of-day / day-of-week analysis

**Metric:** Win rate (behavioral).
**What:** Chart of win rate by hour-of-day and day-of-week. Reveals patterns like "I lose 70% of games after 11 PM" or "Sunday morning is my best blitz".
**Why:** Often the highest-ROI fix isn't chess at all — it's "don't play after 11 PM". Behavioral metrics surface this.
**Data:** `games.end_time` (unix timestamp) → bucket by hour-of-day and day-of-week.
**Sketch:** SQL aggregation only. Render as heatmap or two simple bar charts.
**Complexity:** S.
**Open questions:** Timezone. `end_time` is unix; need local-timezone conversion. Hardcode `America/Los_Angeles` (or wherever the user plays) or pull from system.
**Related code:** New stats route, new chart in stats page.

---

## Tier 4 — Drill / active feedback (largest skill transfer, biggest scope)

### 4.1 Drill mode: replay own blunders as puzzles

**Metric:** Blunder rate (via direct skill transfer).
**What:** A puzzle mode that presents the user's own blunder positions. User has to find the engine's best move. Get it right → mark as solved. Get it wrong → flag for re-drill.
**Why:** Reading "you blundered Nxf6" doesn't transfer skill. Solving the position cold (no answer visible) trains the actual pattern-recognition that prevents the next blunder.
**Data:** Set of `(fen, best_move)` from blunder positions. Already have everything in `analysis`.
**Sketch:**
- New route `/drill`. Load N blunder positions. For each: render board, hide eval/best move. User clicks a move. Reveal whether it was best, second-best (Multi-PV would help here), or worse. Track outcome.
- Schema: `drill_attempts(fen, attempted_move, correct BOOLEAN, attempted_at)`.
**Complexity:** L (interactive puzzle UI, move input handling — need to enable chess.js move validation client-side).
**Open questions:** How does the user input a move? Drag-and-drop on the board (chessground supports it — re-enable `draggable.enabled`). Filter blunders by motif (Tier 3.1) to drill weak motif specifically.
**Related code:** New `client/src/pages/Drill.tsx`, schema additions, new routes.

### 4.2 Spaced-repetition queue

**Metric:** Blunder rate.
**What:** Wrong-answered drill positions resurface on a spaced schedule (next day, 3 days, 1 week, etc.) — Anki-style.
**Why:** Spaced repetition is the proven way to convert one-time exposure into long-term retention. Without it, drill positions get forgotten and the same blunder recurs.
**Data:** `drill_attempts` (4.1) extended with `next_due` timestamp.
**Sketch:** Standard SM-2 or FSRS algorithm. Daily queue on `/drill` shows due positions first.
**Complexity:** L (depends on 4.1).
**Open questions:** Use FSRS (modern, open-source library) or roll SM-2? FSRS likely overkill for one user.
**Related code:** Extends 4.1.

---

## Data already on disk, not surfaced

Existing tables already contain signal the UI ignores. These are S-complexity wins.

- **`analysis.score_mate`** — never visualized in aggregate. "You missed N forced mates this month" is a high-impact stat.
- **`analysis.best_move`** — used only for the on-board arrow. Comparing it to the actual move played enables ACL (3.2), accuracy (1.1), and motif detection (3.1).
- **`analysis.depth`** — never displayed. Could surface "this game analyzed at depth 28 avg" as a confidence indicator.
- **`games.pgn`** — full PGN string stored, but `[WhiteElo]`, `[BlackElo]`, `[ECO]`, `[TimeControl]` headers are never parsed and stored as columns. Unlocks 1.4, 1.5, 1.6.
- **`games.end_time`** — only used for sort order. Powers 3.3 (time-of-day analysis).

---

## Smallest first step (recommended starting point)

**Build the per-game metric loop end-to-end before going wide.** The smallest set of features that creates a working feedback loop:

1. **Per-game accuracy + blunder counts** (1.1 + 1.2) — surfaced as chips on `GameCard` and in the Analysis page header. _One backend endpoint, one display change._
2. **Worst-games queue** (2.3) — sort the gallery by accuracy ascending. _One filter chip._
3. **Side-of-board breakdown** (1.3) — small stats panel at the top of `Home.tsx`. _One SQL query, one panel._

That's a complete loop: user opens app → sees their weak side and worst games → clicks the worst → reviews → comes back tomorrow and sees the trend.

Everything else (openings, multi-PV, motifs, drill) is additive on top of that foundation. None of them are valuable if the user isn't already routinely reviewing their worst games with a quantified accuracy score.

---

## Open architectural questions

These cut across multiple features and are worth deciding before deep implementation:

1. **Cache layer for derived metrics.** Recomputing accuracy / blunder counts on every gallery render is wasteful. Add a `game_metrics` table populated when analysis completes, or lazily on first request? Lazy with cache is probably right — invalidate when `analysis` rows for a game change.
2. **Stats endpoint shape.** One `/api/stats/:username/*` namespace with sub-routes, or one big endpoint that takes a `slice` parameter? Sub-routes are simpler initially; one endpoint composes better later. Start sub-routes.
3. **Backfill strategy.** Most Tier 1 features need backfill (PGN header extraction, accuracy compute) for existing games. One-shot script (`server/scripts/backfill.ts`) run manually, or auto-run on server start if missing? Auto-run if missing keeps the dev experience clean.
4. **Where do dashboards live in the IA?** A new `/stats` route, or expand `Home.tsx` to include a stats panel above the gallery? Probably a dedicated route to avoid bloating Home; link from Home prominently.
5. **PGN parsing scope.** Currently `pgnToFens` and `pgnToMoves` ignore headers. Extend with a `pgnHeaders(pgn) → Record<string, string>` function and store the canonical fields as columns.
