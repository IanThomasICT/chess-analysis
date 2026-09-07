# Game Metrics Tracking — Vision & Design

> **Status: implemented.** This document is the original design. The feature is
> built per the sequence in [`../plans/game-metrics-plan.md`](../plans/game-metrics-plan.md). Canonical code: `server/lib/{metrics-config,
> phases,ply-timeline,game-metrics,metrics-store}.ts`, `server/routes/metrics.ts`,
> aggregates in `server/routes/stats.ts`, batch runner `server/scripts/build-metrics.ts`
> (`bun run metrics <user>`), client `MetricsCard.tsx` + new `/stats` tabs. The L1→L2
> derivation (`buildTimeline → buildGameMetrics`) is the single shared path for both
> backfill and ongoing capture, so a backfilled and a freshly-captured game are identical.
>
> The Opening Explorer (D29) is also built: `server/lib/explorer.ts` +
> `server/scripts/build-explorer.ts` (`bun run explorer <dump.pgn.zst>`). It is an
> **optional, manual** offline build (Risk 3); until it runs, out-of-book ply degrades to
> the named-ECO fallback (D33) with no change in output. See "Building the explorer" below.

## Purpose

The vision for **how this tool tracks per-game metrics over the user's entire
Chess.com history, continuously**. Two ingestion paths, one derivation:

1. **Bulk backfill** — a one-time (idempotent, re-runnable) pass over **all**
   existing games, building a metrics cache for each.
2. **Ongoing capture** — every newly imported game is folded into the same cache
   automatically, so the dataset stays complete without re-running the backfill.

Both paths run the **same pure derivation** (Layer 1 timeline → Layer 2 folds, see
Architecture), so a backfilled game and a freshly captured game are byte-for-byte
identical. The result: every game's quality, time usage, opening, worst moments,
and rating movement are queryable from a single consistent dataset that powers the
dashboards (`/stats`, Elo trend, drill targets) and the three core metrics — win
rate, accuracy/blunder rate, elo.

Scope is the user's own moves only. Opponent moves are evaluated only as inputs
(e.g. to detect a gifted blunder the user failed to punish). Metric storage is a
**cache, not a source of truth** — fully regenerable from raw data at any time
(R33).

---

## Definitions

| Term | Definition |
|---|---|
| **ply** | A single move by one side. 1-based here: ply 1 = White's first move. |
| **move_index** | After-position index in the `analysis`/`fens` arrays. `move_index = 0` is the starting position; the move at ply `p` produces `move_index = p`. So the transition `fens[p-1] → fens[p]` is ply `p`. |
| **user move** | A ply played by the queried user. White plies (odd ply / even `move_index` transition) if `user_color = white`, else Black plies. |
| **Win% (wp)** | Lichess win-probability from centipawn, mover's perspective, `[0,100]`. `cpToWinPct` in `metrics.ts`. |
| **wpDelta / wp_loss** | `max(0, wpBefore - wpAfter)` in win% points, mover's perspective. The basis for classification. |
| **ACL** | Average Centipawn Loss — mean of clamped `[0,1000]` cp loss per user move, skipping the first 8 plies of the game (book noise). Already implemented per side in `metrics.ts`. |
| **Accuracy** | **Lichess accuracy** (D21): per-move `moveAccuracy` combined as the mean of the volatility-weighted mean and harmonic mean, `[0,100]`. Replaces the retired bucket `aggregateAccuracy`. |
| **decided position** | A ply from which the leading side's win% is ≥ 95 and never recovers below it; the leading side's moves after it are excluded from accuracy/ACL (D22). |
| **standard game** | A game with no `[Variant]` (or `Standard`) and Chess.com `rules = chess`; only standard games enter the dataset (D20). |
| **classification** | One of `best \| good \| inaccuracy \| mistake \| blunder` from `classifySwing(wpDelta01)` (`shared/classify.ts`). |
| **critical negative move** | A user move classified `mistake` or `blunder`. "Top 3 critical" = the 3 with the greatest `wp_loss`. |
| **opponent blunder** | An opponent ply classified `blunder` (their `wpDelta ≥ 0.30`). |
| **missed conversion** | A user move immediately following an opponent blunder where the user's own response is **not** `best` and **not** `good` (i.e. the user failed to capitalize — see D2). |
| **game phase** | One of `opening \| middlegame \| endgame`, assigned per ply by the Lichess material **Divider** (see D0). |
| **think time** | Seconds a player spent on a single ply, derived from consecutive `[%clk ...]` annotations plus the time-control increment. |
| **user_elo** | The user's Chess.com rating at this game's end. From `games.user_elo` (parsed from PGN `[WhiteElo]`/`[BlackElo]` for the user's side). Pools are **per time class** (bullet/blitz/rapid/daily are separate ratings). |
| **elo_delta** | Signed rating change attributable to this game: `user_elo(this) - user_elo(previous game in the same time_class, ordered by end_time)`. Null for the first game in a time_class. |

### Game-phase division (Lichess material Divider — D0)

Computed over the ordered board states (`fens`). Two boundary plies are found by
scanning forward from the start:

- Let `mm(board)` = count of **minor + major** pieces still on the board (knights,
  bishops, rooks, queens; both colors; excludes kings and pawns). Initial value = 14.
- **Middlegame start** = first ply where any of:
  - `mm ≤ 10`, OR
  - **back rank is sparse** — either side has fewer than 4 of its own pieces left
    on its back rank (rank 1 for White, rank 8 for Black), OR
  - **mixedness** score > 150 (a region-based measure of how intermingled the two
    armies are; port from scalachess `Divider`, see Related Files). *Optional
    refinement — material + back-rank triggers cover the large majority of games.*
- **Endgame start** = first ply where `mm ≤ 6`.
- Plies before middlegame start = `opening`; between the two boundaries =
  `middlegame`; from endgame start onward = `endgame`.
- A game may never reach middlegame or endgame (short games / heavy-piece
  endings); boundaries are then null and those phases are empty.

Source of truth: `lichess-org/scalachess` `Divider.scala`.

---

## Requirements

- **R0** — Capture metrics for **every** game belonging to the user in `games`, in
  one re-runnable bulk backfill, persisting one `game_metrics_ext` cache row per game.
- **R35** — **Ongoing capture:** a game is folded into `game_metrics_ext` the moment its
  analysis exists — i.e. on the analyze SSE `done` event and via a stale-check when
  the Analysis page / games list loads (Q2). No background auto-analysis and no
  manual backfill re-run; dataset completeness tracks reviewed games. Same
  `buildGameMetrics` path as the bulk backfill.
- **R36** — **Capture game termination** (`[Termination]` → a `termination` column
  on `games`, classified `checkmate`/`resignation`/`timeout`/`abandoned`/
  `agreement`/`other`). Time-forfeit and abandoned games are **excluded from
  accuracy & conversion aggregates** (they misrepresent play) but **retained for
  time-management metrics** — losing on time is a leak to surface, not hide (Q4,
  D19).
- **R37** — **Standard chess only.** Detect non-standard games (`[Variant]` header /
  Chess.com rules) and exclude them from the metrics dataset (store a flag; skip in
  backfill, ongoing capture, and aggregates). Divider + eval semantics assume
  standard chess (Q5, D20).
- **R38** — **Lichess accuracy is the headline metric; migrate the whole tool to it
  (Q6, D21).** Replace the Chess.com-style bucket `aggregateAccuracy` with the
  Lichess volatility-weighted accuracy across server metrics, `game_metrics`, all
  `/stats` surfaces, GameCard chips, and the Study glossary. One accuracy model
  everywhere. Existing `game_metrics` rows recompute under the new
  `metrics_version`.
- **R39** — **Exclude decided positions from accuracy/ACL.** The timeline marks a
  `decided` boundary; once the eval is decisively winning for one side and stays
  there (D22), that side's subsequent moves stop counting toward accuracy/ACL.
  Prevents one-sided blowouts from inflating skill numbers (Q7).
- **R40** — **Auto-feed the drill queue.** Each game's top-3 critical moves *and*
  missed conversions are upserted into the FSRS drill queue (`drill_attempts`),
  deduped against existing entries — closing the find-weakness → drill-it loop
  (Q8, D23).
- **R41** — **Surface the dataset** through four channels (Q12): (a) a per-game
  **metrics card** (`MetricsCard`) — now shown in the **Report** tab of the Analysis
  right-hand rail (no longer stacked below the board; see [ui-ux.md](ui-ux.md)); (b)
  dataset-wide stats (consistency/variance, ACL & accuracy trend, time-allocation,
  leak-closure, repertoire leaks, TPR) — now grouped into the **Stats dashboard
  sections** (Overview / Trends / Openings / Patterns) rather than flat tabs; (c)
  **Home gallery enrichment** (time-trouble flag, result-quality chips on GameCard);
  (d) a **CSV/JSON export** of `game_metrics_ext` ⋈ `games` + aggregates for backup /
  external analysis. *(The metric definitions below are unchanged — only the UI
  surfacing was reorganized in the redesign.)*
- **R1** — Compute and store **ACL** for the user's moves (mover-perspective,
  skip first 8 plies).
- **R2** — Compute and store **game accuracy** for the user's moves (`[0,100]`).
- **R3** — Capture the **opening** played in each game (`eco` + `opening` name).
- **R4** — Capture **time management** for the user: per-phase think-time totals
  (opening / middlegame / endgame), plus average think time per user move.
- **R5** — Capture the **top 3 critical negative moves** by the user — the
  `mistake`/`blunder` plies with the greatest `wp_loss`, with enough context to
  jump to them (ply, SAN, eval before/after, classification, phase).
- **R6** — Capture **all missed conversions** — every user move where the
  opponent's previous ply was a blunder and the user failed to capitalize
  (per D2).
- **R7** — All metrics are **user-perspective**: store `user_color` and the
  result from the user's point of view; opponent data is input only.
- **R8** — The batch is **idempotent and resumable**: re-running skips games whose
  metrics row is already current, and a crash mid-run loses at most the in-flight game.
- **R9** — Metrics rows record **provenance**: minimum engine depth used and whether
  clock data was available, so partial/low-confidence games are identifiable.
- **R10** — Games with **no clock data** (e.g. daily games, old imports) still get
  a metrics row; time fields are null and `clocks_available = 0` rather than failing.
- **R11** — The batch must respect existing **engine concurrency limits**
  (`MAX_CONCURRENT_ANALYSES`) and reuse the existing analysis cache — never
  re-analyze a position already cached at sufficient depth.
- **R12** — Capture **Chess.com Elo per game** for the user: the rating at game
  end (`user_elo`), the opponent's rating, and the **signed `elo_delta`** vs the
  user's previous game in the same time class. This is the data layer for an Elo
  progress plot; deltas must be computed within a time class ordered by
  `end_time` (D6).

### Consistency & deeper-accuracy metrics

Per-game diagnostic fields (stored on `game_metrics_ext`):

- **R13** — Capture **per-phase accuracy and ACL** for the user (opening /
  middlegame / endgame), segmented by the D0 phase boundaries — surfaces the
  weakest phase as a study target.
- **R14** — Capture **tilt indicators**: the longest consecutive user-blunder run
  in the game, and **recovery accuracy** (the user's accuracy over the plies
  immediately following a user blunder). Detects spiraling.
- **R15** — Capture **time-trouble errors**: count of user blunders+mistakes
  played while in time trouble (D8) and the count of user moves played in time
  trouble (the rate denominator). Null when `clocks_available = 0`.
- **R16** — Record **think time on each stored critical move and missed
  conversion** (`think_time_s` field in the JSON entries) so fast-impulse vs
  slow-calculation errors are separable (D13).
- **R17** — Capture **critical-position accuracy**: the user's accuracy on
  "only-move" positions where rank-1 is decisively better than rank-2 (D9, uses
  stored MultiPV=3), plus the count of such positions. Filters out forced/quiet
  moves that inflate raw accuracy.
- **R18** — Capture **conversion & defense**: peak and trough eval from the
  user's perspective, and flags for reached-winning / converted / reached-losing /
  saved (D10).
- **R19** — Capture **opening-book depth**: the first ply the game leaves book
  (`classifyOpening` longest-prefix) and the user's **post-book accuracy** from
  that ply onward.
- **R20** — Capture the **eval at the end of the opening phase** (user-perspective
  win%) — a result-independent measure of how the user emerges from the opening.
- **R24** — Derive a per-game **result-quality classification**
  (`swindle_win` / `clean_win` / `even_draw` / `hold_draw` / `clean_loss` /
  `unlucky_loss`) from result + accuracy + winning/losing flags (D12), to separate
  masked problems (lucky wins) from honest play (unlucky losses).
- **R25** — Capture **time-allocation efficiency**: how well the user's think time
  tracks position criticality (D14). The signature plateau metric — thinking on
  the moves that matter, not autopiloting through them.
- **R26** — Capture **quiet-move accuracy**: the user's accuracy on *non*-critical
  positions (complement of R17, D15) — isolates positional decision quality from
  tactical sharpness.

Cross-game aggregates (derived at read time, not stored — D7):

- **R21** — Provide **accuracy consistency aggregates**: std dev of per-game
  accuracy and a worst-game floor (10th-percentile game). The core consistency
  signal.
- **R22** — Provide a **session-fatigue aggregate**: accuracy by the game's
  position within a play session (D11).
- **R23** — Provide an **accuracy-vs-opponent-rating aggregate**, bucketed by
  `opponent_elo` — detects playing down to weaker opponents.
- **R27** — Provide an **ACL-trend aggregate**: ACL (and accuracy) slope over
  time. The headline improvement signal for the 1800–2000 push.
- **R28** — Provide a **leak-closure aggregate**: motif frequency (from
  `blunder_tags`) over time — is a given recurring mistake declining? Validates
  that drilling moves the needle.
- **R29** — Provide a **performance-rating (TPR) aggregate**: expected vs actual
  score given `opponent_elo` over a recent window, compared to current rating —
  a plateau/improvement detector.
- **R30** — Provide a **repertoire-leak aggregate**: per-opening score (and
  accuracy) vs the user's overall rate — concentrates prep where it pays.
- **R31** — Provide an **opponent-counterplay-allowed aggregate**: advantage
  conceded (user `wp_loss` summed) bucketed by opponent rating — quantifies
  letting weaker opponents back into games.
- **R32** — Provide an **endgame-conversion aggregate**: reuse the R18 winning/
  losing flags scoped to the endgame phase (D0) — winning-endgame → win rate and
  drawn-endgame hold rate.

### Architecture & data-drift requirements

- **R33** — **Single source of truth.** Every metric must be reproducible purely
  from the raw layer (`games.pgn` + `analysis`). No derived value is authoritative;
  all stored derived data is a cache and must be byte-for-byte regenerable from raw
  + the metrics config. No metric is hand-maintained or editable in place.
- **R34** — **Versioned, non-duplicating cache.** Stored derived rows carry a
  `metrics_version` and an analysis signature; a config/formula change or a
  re-analysis invalidates and recomputes them (D17). Derived rows must **not** copy
  columns that already live in `games` — they reference by FK and JOIN (D17).
  Thresholds live in one config module that owns `metrics_version` (D18).

---

## Decisions

0. **Game phases use the Lichess material Divider** (material + back-rank, optional
   mixedness), not fixed move numbers. Rationale: robust across game lengths;
   matches the definition Lichess Insights uses, so phase stats are comparable to
   a tool the user already trusts. Spec in Definitions › Game-phase division.

1. **Tiered backfill analysis** (Q1): recent games + any already-analyzed get the
   deep MultiPV=3 pass; the older long tail gets a fast MultiPV=1 pass. Ongoing
   games (R35) are deep (they're analyzed on-open at MultiPV=3). "Recent" default =
   last 12 months OR last 300 games, whichever is larger (tunable, lives in
   `metrics-config.ts`). Rationale: best accuracy-per-engine-hour — depth where
   study payoff is highest, coverage everywhere else.
   - *History (original):* uniform deep MultiPV=3 on every game.
   - *Amended (Q1):* tiered. **Consequence — MultiPV=1 tier has no rank-2 line**, so
     criticality (D9) is unavailable there; the metrics that depend on it
     (`accuracy_critical`/`accuracy_quiet` R17/R26, `critical_positions`,
     `time_alloc_efficiency` R25) are **null on fast-tier games**. Provenance must
     record `multipv_max` per game (R9); aggregates must treat those as null, not
     zero, and surface coverage (per "no silent caps"). A fast-tier game upgrades to
     deep — and gains the criticality metrics — when opened in Analysis.

2. **A missed conversion is *not* flagged when the user's response is `best` or
   `good`.** Only `inaccuracy`/`mistake`/`blunder` responses to an opponent
   blunder count as missed. Rationale: punishing a blunder rarely requires the
   single engine-top move; a near-best reply that holds the gifted advantage is a
   successful conversion. Less noisy than the current client-only "best-only"
   rule.
   - *History:* current client code (`Analysis.tsx` `missedConversions`) flags any
     non-`best` user reply. This decision **broadens** "capitalized" to
     `best ∪ good`; the persisted batch definition supersedes the client rule, and
     the client should be aligned to match (see Implementation Outline P4).

3. **Storage = one `game_metrics_ext` row per game, treated as a regenerable cache (not
   authoritative storage).** The row holds only cross-game-queryable scalar folds;
   variable-length lists (top-3 critical, missed conversions) and the per-ply
   timeline are **derived live** from the raw layer on demand, not persisted.
   - *History (original):* proposed storing the two lists as JSON columns on the
     row, with child tables as a deferred option.
   - *Amended (D17 drift review):* the JSON lists are **not stored** — they are a
     pure fold over the ply timeline (D16) and regenerated by the single-game
     endpoint, so there is no denormalized eval/SAN to drift from `analysis`.
     Cross-game "recurring mistake" queries use the existing `blunder_tags` table,
     not stored JSON. `game_metrics_ext` is now a *versioned cache* (D17), not a
     snapshot of independent truths.

4. **Think time per ply is derived from `[%clk]` deltas plus the increment.** For
   a side's ply: `think = clk_prev_same_side - clk_this_ply + increment`, where
   the first ply of each side uses `base_seconds` as `clk_prev`. Base and
   increment come from the PGN `[TimeControl]` header (`"600+5"` → base 600,
   inc 5; `"180"` → base 180, inc 0). Negative results clamp to 0; unparseable or
   missing clocks → null think time for that ply.

5. **Elo is tracked per game as `user_elo` + `opponent_elo` + signed `elo_delta`,
   computed within each time class.** `user_elo` is denormalized from
   `games.user_elo`; `elo_delta` is filled in a second pass after all per-game
   metrics rows exist, sorting the user's games by `(time_class, end_time)` and diffing
   consecutive `user_elo`. Rationale: Chess.com ratings are per-format pools, so a
   global chronological diff would mix bullet/blitz/rapid and produce nonsense
   deltas. Storing the raw `user_elo` + per-format delta lets the client derive
   running peak, net gain, and since-date change without re-querying.
   - *History (original):* `elo_delta` filled in a stored second pass over
     `game_metrics_ext`.
   - *Amended (D17 drift review):* `elo_delta` is **not stored** — it is a SQL
     window (`LAG(user_elo) OVER (PARTITION BY time_class ORDER BY end_time)`) over
     `games` at read time. Removes the second pass and the drift between a stored
     delta and the underlying ratings. `user_elo`/`opponent_elo` already live in
     `games`; nothing Elo-related needs storing in `game_metrics_ext`.
   - *Motivating plot (client concern, not stored):* the chart should emphasize
     progress, not noise — plot per-time-class series, overlay a **running-peak**
     line (rating never visually "loses" its high-water mark), annotate net gain
     over a selectable window, and color up-days/streaks. Reuse/extend the
     existing `EloTrendChart` + `/api/stats/:user/elo-trend`; `elo_delta` enables
     streak and biggest-gain callouts. No new stored fields required for this.

6. **The batch is a standalone Bun CLI script**, not an HTTP endpoint. Rationale:
   long-running, run from the terminal, no rate-limit/SSE concerns; can log
   progress and be re-run freely. Reuses `analyzeGame`, `gameMetrics`, the opening
   classifier, and the engine slot guard from `server/lib`.

7. **Per-game diagnostics are stored columns; cross-game aggregates (R21–R23) are
   computed at read time over `game_metrics_ext`, not stored.** Rationale: a population
   statistic (variance, percentile, by-bucket rollup) is the wrong thing to write
   onto each game row, and it shifts as games are added. The per-game inputs those
   aggregates need (`accuracy`, `opponent_elo`, `end_time`, `time_class`) are
   already columns, so the aggregate view is pure SQL. Intrinsic per-game fields
   (R13–R20, R25–R26) stay stored because recomputing them needs the engine evals.
   - *Amended (D17 drift review):* "stays stored" applies only to fields that are
     **engine-fold-derived AND queried across games**. Cheap derivations from those
     plus `games` — `result_quality` (R24), `converted`/`saved`/`reached_*` (R18),
     `result_for_user`, `user_color` — are **derived at read time**, not stored, so
     a threshold change can't strand a stale flag. Only `peak_eval_wp`/
     `trough_eval_wp` (the raw inputs to those flags) are stored.

8. **Time trouble = a ply with remaining clock below `max(30s, 20% of
   base_seconds)`** (R15). Rationale: 20% captures relative pressure across time
   controls; the 30s floor catches absolute scrambles in longer games. Only
   evaluated when clocks are available. *Default — tunable.*

9. **A position is "only-move"/critical when the win% gap between the engine's
   rank-1 and rank-2 lines (stored MultiPV=3) is ≥ 15 points** (R17); positions
   with no legal rank-2 (forced) are also critical. Rationale: isolates decisions
   that actually matter from positions where many moves hold. *Default — tunable.*

10. **Winning/losing thresholds: user-perspective win% ≥ 80 = "winning",
    ≤ 20 = "losing"** (~±2.2 pawns) (R18). `converted` = reached winning and won;
    `saved` = reached losing and result ∈ {win, draw}. Rationale: a clear,
    symmetric advantage that doesn't demand a forced mate. *Default — tunable.*

11. **A play session breaks when consecutive games (all time classes, ordered by
    `end_time`) are more than 60 minutes apart** (R22). The game-in-session index
    drives the fatigue aggregate. Rationale: matches a typical sitting.
    *Default — tunable.*

12. **`result_quality` classification rule** (R24): `swindle_win` = win with
    accuracy < 65 OR (reached-losing then won); `clean_win` = any other win;
    `unlucky_loss` = loss with accuracy ≥ 80; `clean_loss` = any other loss;
    `hold_draw` = draw after reaching losing; `even_draw` = any other draw.
    Rationale: surfaces results that mask or misrepresent play quality.
    *Default — tunable.*

13. **Impulse vs deep-think move thresholds** (R16): an "impulse" move has
    `think_time_s < max(3s, 10% of the game's average user think time)`; a
    "deep-but-wrong" move has `think_time_s ≥ 2× the average`. Computed from the
    timeline's per-ply `think_time_s` so the threshold can be retuned without
    re-analysis. *Default — tunable.*

14. **Time-allocation efficiency** (R25) = the rank correlation between per-user-ply
    `think_time_s` and position `criticality` (rank1−rank2 win% gap, D9), over plies
    with clocks. ≈ +1 → time spent on the moves that matter; ≤ 0 → autopilot on
    critical positions. Stored as a single `[-1,1]` scalar; null if no clocks.
    Rationale: a clock-aware, threshold-light measure of decision discipline — the
    1800–2000 signature skill. *Default metric — refinable.*

15. **Quiet vs critical move** (R26/R17): a user ply is "critical" when its position
    criticality ≥ D9's gap (or forced); otherwise "quiet". `accuracy_critical` and
    `accuracy_quiet` are accuracy folds over those two disjoint sets. Together they
    decompose overall accuracy into tactical (critical) vs positional (quiet) skill.

16. **One shared per-ply derivation — the "ply timeline".** A single pure function
    `buildTimeline(pgn, analysisRows) → EnrichedPly[]` produces, per ply: side,
    is_user, win% before/after, `wp_loss`, classification, `think_time_s`, phase,
    `criticality`. **Every** game-level fold (this doc) **and** the Analysis page's
    move colors / blunder-nav / missed-conversion markers derive from this one
    function. Rationale: kills the client/server drift flagged in D2 — the live
    view and the batch compute identical numbers because they run identical code.
    The timeline itself is **not stored** (pure, cheap, ~80 rows/game from data
    already in `analysis`); it is recomputed on demand and exposed by the
    single-game endpoint.
    - *Supersedes the D2 "align the client" action:* the client no longer
      reimplements classification/missed logic — it consumes the timeline endpoint.

17. **`game_metrics_ext` is a versioned, non-duplicating cache (drift control — R33/R34).**
    - Carries `metrics_version` (from the config module, D18) and an analysis
      signature (`engine_depth_min` + rank-1 row count, or a hash). A reader/builder
      recomputes the row when either differs from current — same invalidation
      pattern as the existing `game_metrics.computed_at`.
    - Stores **only** fields that are *both* engine-fold-derived *and* queried/sorted
      across games. It does **not** copy `eco`, `opening`, `time_control`,
      `time_class`, `user_elo`, `opponent_elo`, `result` — those live in `games` and
      are JOINed. Cheap derivations (`elo_delta`, `result_quality`, conversion
      flags, `user_color`) are computed at read time.
    - **`game_metrics` overlap — resolved (Q3): reference, don't duplicate.**
      `game_metrics` stays the single home for the shared per-side scalars
      (`accuracy`/`acl`/`blunders`/`mistakes`/`inaccuracies`, white & black);
      `game_metrics_ext` does **not** store them — it JOINs `game_metrics` and picks the
      user side via `user_color` at read time. `game_metrics_ext` stores only the *new*
      folds (per-phase, criticality, tilt, time, etc.). Both are produced from the
      same `gameMetrics`/timeline derivation in one pass with the same
      `metrics_version`, so they cannot disagree.

18. **All thresholds live in one `server/lib/metrics-config.ts` module that owns a
    `METRICS_VERSION` constant.** D8–D15's numbers are exported from here; bumping
    any of them bumps `METRICS_VERSION`, which invalidates every cached
    `game_metrics_ext` row (D17) so no stale threshold-dependent value survives.
    Rationale: a single, greppable place for every tunable, and an automatic,
    can't-forget cache-busting mechanism.

19. **Termination capture + forfeit segregation** (R36, Q4). Parse `[Termination]`
    into a `games.termination` column (raw metadata belongs in `games`, not the
    cache). A game is a **forfeit/non-played ending** when termination ∈
    {`timeout`, `abandoned`}. Such games are filtered out of accuracy- and
    conversion-based aggregates (R2/R18/R21/R24/R32) but included in time-management
    aggregates (R4/R15/R25). Rationale: a flagged-on-time win in a lost position
    would otherwise inflate accuracy and fake a "conversion"; but the time loss
    itself is exactly the 1800–2000 leak we want visible. *Forfeit set — tunable.*

20. **Standard chess only** (R37, Q5). A game is standard unless `[Variant]` is
    present/non-"Standard" or the Chess.com `rules` ≠ `chess`. Non-standard games
    get `is_standard = 0` on `games` and are skipped everywhere in this pipeline.
    Rationale: phase Divider, opening book, and eval all assume standard rules;
    including 960/odds would silently corrupt aggregates.

21. **Lichess accuracy everywhere; bucket model retired** (R38, Q6). Game accuracy =
    the Lichess method: per-move accuracy `103.1668·exp(−0.04354·wp_loss)−3.1669+1`
    (`moveAccuracy`, already in `metrics.ts`), combined per side as the mean of the
    **volatility-weighted mean** and the **harmonic mean** of per-move accuracies,
    where move weights = the rolling std-dev of win% (position volatility). This is
    a **tool-wide migration**: `aggregateAccuracy` (bucket + consecutive-blunder
    damping) is removed; server, `game_metrics`, `/stats`, GameCard, and Study all
    read the new number; `metrics_version` bump recomputes caches.
    - *History:* the project previously surfaced accuracy as the Chess.com-style
      bucket (`aggregateAccuracy` / `classAccuracyScore` in `metrics.ts`).
      **Amended (Q6):** migrate fully to Lichess accuracy + Insights framing;
      classification thresholds (`classifySwing`) were already Lichess, so only the
      aggregation changes.

22. **Decided-position cutoff** (R39, Q7). The timeline marks the first ply where the
    leading side's win% ≥ 95 *and* it never drops back below 95 afterward; from
    that ply on, the **leading** side's moves are excluded from accuracy/ACL (the
    trailing side still counts — they may still err meaningfully). Note this stacks
    with D21's volatility weighting (which already down-weights quiet decided
    positions); the cutoff is the harder stop. *Threshold — tunable.*

23. **Auto-feed drill from critical + missed** (R40, Q8). After building a game's metrics,
    upsert each top-3 critical move and missed conversion into `drill_attempts`
    (the BEFORE position FEN + engine best move), `INSERT … ON CONFLICT DO NOTHING`
    on `(username, game_id, move_index)` so existing FSRS state is never disturbed.
    Rationale: the batch is the natural producer of drillable weaknesses; reuses the
    existing queue/scheduler. *Which classes seed the queue — tunable.*

24. **Trends bucket by rolling N-game window** (Q9), primary axis, per time class;
    default N = 50 (in `metrics-config.ts`, tunable). Calendar-month (via `USER_TZ`)
    is a secondary axis for Elo/event annotations only. Rationale: equal-sample
    points make improvement signals (R27/R28) readable regardless of play volume.

25. **Re-analysis is manual/explicit** (Q10). `game_metrics_ext` recomputes
    automatically via `metrics_version`/`analysis_sig` (D17), but re-running the
    *engine* on already-analyzed games happens only via an explicit CLI flag
    (`build-metrics --reanalyze --min-depth N`). Rationale: no surprise multi-hour
    CPU; the quality floor is raised deliberately. Fast-tier games still upgrade to
    deep on-open (D1).

26. **Lichess-accuracy migration is a clean cutover** (Q11): bump `METRICS_VERSION`,
    recompute `game_metrics` for all games, and rewrite unit + e2e expected values
    (incl. the e2e seed fixtures) to the Lichess numbers in the same change. No
    dual-model shadow period — that would violate the single-source principle (R33).
    *Risk:* every shipped accuracy number changes at once; acceptable for a
    single-user tool with no external consumers.

27. **Mate-aware timeline via synthetic mate win%** (Q13). `mateToCp` saturation is
    fixed by mapping a mate score to `win% = 100 − N·ε` (decays with mate distance
    N; `ε` in `metrics-config.ts`), so the existing criticality gap (D9) and all
    win%/`wp_loss` logic work unchanged on the synthetic value. Consequence:
    criticality now picks up **mate-only-moves** (rank-1 mate vs rank-2 non-mate =
    large gap) and **mate-distance gaps** (mate-in-1 vs mate-in-7 = real gap), with
    no special-case branch in the fold code. Rationale: one formula reuses the whole
    D9 plumbing instead of a parallel mate code path.

28. **Decided-cutoff requires a held non-mate advantage** (Q13 × D22). Because the
    synthetic mate win% (D27) sits ~99 (≥95), a naive D22 would fire the instant any
    mate appears — including a long mate the user can still botch. So the decided
    boundary fires only when **either** win% ≥ 95 from a **non-mate** eval **or** a
    mate is **held for K consecutive plies** (`K` in `metrics-config.ts`). A mate
    that appears then vanishes (mis-stepped) keeps counting toward accuracy/ACL.
    Supersedes the plain ≥95 trigger in D22. *K — tunable.*

29. **Out-of-book ply via a self-built peer-band frequency table + relative-frequency
    floor** (Q14, R19). Replaces the named-ECO definition. The first out-of-book ply
    = the first ply where the **move actually played** has **< X%** relative
    frequency from that position in the peer-band table (`X` in `metrics-config.ts`).
    Rationale: catches "you played a sideline" even from a popular position, scaled
    to opponents you actually face.
    - **Source — bulk PGN, built offline (not the live API).** Lichess serves the
      explorer as a rate-limited API, so instead we **stream one recent monthly
      standard rated dump** from `database.lichess.org`, keep only games with **both
      players in ~1100–2200**, and aggregate move frequencies into a local table. One
      download, zstd-decompress on the fly, games discarded after counting. Fully
      self-contained, offline, regenerable — no live API dependency.
    - **Depth — first ~24 plies (12 moves).** Only the opening/early-middlegame is
      aggregated; the out-of-book scan stops at ply 24 (anything deeper is always
      "out of book"). Keeps the table small.
    - **Key — normalized FEN** (piece placement + side-to-move + castling +
      en-passant; **drop** halfmove/fullmove counters). Transpositions collapse to one
      row → correct frequency, no false novelty. Matches the existing `analysis`
      `fen_key`.
    - **Masters DB deferred.** The ideal-line/theory reference (originally part of
      D29) is **not in v1** — it's study-surfacing, not the cutoff. Add later (likely
      the small masters API, lazy-cached). Peer-band out-of-book ships alone.
    - *Scope note:* this is **reference data**, not a new *game* source — the
      Chess.com-only non-goal (game ingestion) is unaffected. The frequency table is
      static, regenerable from the dump; not part of the L0→L2 cache.

33. **Out-of-book fallback to named-ECO** (Q14 follow-up). When peer-band frequency
    data is unavailable for a position (table not built yet, or scan ran past the
    24-ply build depth on a line never sampled), `out_of_book_ply` **falls back to
    the named-ECO prefix end** (the original R19 definition) and provenance records
    an `eco_fallback` flag so a fallback value is never confused with a true
    frequency-based cut. Rationale: always produces a usable value; degrades
    gracefully before the table exists.

30. **Daily/correspondence = `clocks_available = 0`** (Q16). Daily games have no
    per-move `[%clk]`; treat them as no-clock. Time fields null; excluded from the
    time aggregates (R4/R15/R25), retained everywhere else. No separate day-budget
    time model. Rationale: daily is a negligible slice for a bullet/blitz/rapid
    improver; a parallel time path isn't worth it.

31. **Aggregate performance: indexes only, no aggregate cache** (Q15). Add indexes
    (`games(username, time_class, end_time)`, `game_metrics_ext` provenance) and ship
    the R21–R32 read-time SQL as-is. SQLite over single-user thousands-of-rows is
    fast; revisit (a thin materialized aggregate table) only if a load is *measured*
    slow. Rationale: avoid a second cache to version/invalidate before there's
    evidence it's needed.

32. **Username assumed fixed** (Q17). The Chess.com handle is treated as stable; it
    keys the dataset and the per-time-class Elo pools, with no alias map. If the
    handle ever changes, re-import under the new handle. Rationale: single-user tool,
    rename is rare; an alias map / canonical player-id keying is deferred until a
    real rename happens.

35. **Real-people games only — bot/coach games are not tracked.** Only games against
    human opponents enter the dataset. Detection is by the PGN `[Event]` header: bot
    practice games are platform-tagged `"Play vs …"` (e.g. `"Play vs Coach"` for
    Coach-Levy), whereas humans play `"Live Chess"`/`"Daily Chess"`/tournaments
    (`pgn.ts` `isBotGame`). The Chess.com profile API is **not** usable here — its bots
    report `status: "basic"`, not `"computer"`. Bot games are skipped at import (never
    stored), purged from existing data by a migration, and `games.vs_bot` (derived from
    the same header) is excluded everywhere as defense-in-depth. Rationale: bot games
    don't reflect performance vs people and would skew every aggregate.

34. **The bulk backfill is operationally robust** (R8 amplified). As the tool's only
    multi-hour job, it validates the engine before starting (fail fast, not on game 1),
    isolates per-game failure (one bad game is logged and skipped, never aborts the
    run), resumes cheaply (re-running after a partial run does work only for what's not
    already fresh — engine, fold, or both), reports progress and a final tally, and
    stops gracefully on interrupt. Rationale: an idempotent backfill is only useful if a
    transient failure or a Ctrl-C is recoverable without redoing finished work.

---

## Architecture: raw → derived (drift control)

Four layers, each a pure function of the one below. Nothing above the raw layer is
authoritative; everything is regenerable (R33).

```
 Layer 3  Cross-game aggregates        read-time SQL/folds over Layer 2 — NEVER stored
          (R21–R23, R27–R32)           variance, trends, TPR, repertoire, by-rating
            ▲
 Layer 2  game_metrics_ext (CACHE)          versioned fold of Layer 1 — stored for query speed only
          per-game scalar folds        metrics_version + analysis signature → auto-invalidate (D17)
            ▲
 Layer 1  ply timeline (EnrichedPly[]) pure fn buildTimeline(pgn, analysisRows) — NOT stored (D16)
          per-ply derived facts        shared by batch AND Analysis page (no client drift)
            ▲
 Layer 0  RAW — source of truth        games.pgn (headers/clocks/elo/opening) + analysis (evals/fens/ranks)
```

Drift is controlled by three rules:
1. **Derive, don't copy.** Layer 2 never duplicates a Layer-0 column (JOIN `games`
   instead). Cheap derivations are computed at read time, not stored (D17, D7).
2. **One derivation per fact.** Layer 1 is the *only* place per-ply
   classification/criticality/think-time is computed — client and server share it
   (D16), so the live Analysis view and the batch can't disagree.
3. **Version everything cached.** Layer 2 rows carry `metrics_version` (D18) +
   analysis signature; any formula/threshold change or re-analysis recomputes them.

## Related Files

| File | Role in this feature |
|---|---|
| `server/lib/db.ts` | Add `game_metrics_ext` table; add `games.termination` column (R36); migrations. |
| `server/lib/chesscom.ts`, `server/lib/backfill.ts` | Parse `[Termination]` on import + backfill existing rows (R36). |
| `server/lib/engine.ts` | `analyzeGame` (deep pass + cache), `acquire/releaseAnalysisSlot`, depth provenance. |
| `server/lib/metrics.ts` | `gameMetrics`, `cpToWinPct`, `moveAccuracy`, `classifyMove`; **migrate** accuracy to Lichess volatility-weighted + harmonic mean and **remove** `aggregateAccuracy`/`classAccuracyScore` (R38, D21); **extend** to ply ranges (R13/R19) and honor the decided-position cutoff (R39, D22). |
| `server/routes/drill.ts`, `server/lib/db.ts` (`drill_attempts`) | Auto-feed critical + missed positions into the FSRS queue (R40, D23). |
| `client/src/components/GameCard.tsx`, `client/src/components/StatsPanel.tsx`, `client/src/study/glossary.ts` | Surfaces showing the old bucket accuracy — update to the migrated Lichess number + glossary wording (R38). |
| `server/routes/stats.ts` | **Add** read-time aggregate endpoints over `game_metrics_ext` for R21–R23 (consistency, session fatigue, vs-opponent) — pure SQL (D7). |
| `shared/classify.ts` | `classifySwing` / `MoveClass` / thresholds — critical-move and missed-conversion classification. |
| `server/lib/pgn.ts` | `pgnToFens`, `pgnToMoves`, `pgnHeaders`, `clkToSeconds`; **add** per-ply clock extraction + `[TimeControl]` parse. |
| `server/lib/openings.ts` | `classifyOpening` fallback when `games.opening` is empty. Still used for `eco`/opening name (R3); out-of-book ply now comes from the explorer dump (D29), not the named-ECO prefix. |
| `server/lib/explorer.ts`, `server/scripts/build-explorer.ts`, `server/data/explorer/explorer.db` *(gitignored, built on demand)* | **Built (D29).** `build-explorer.ts` streams one monthly Lichess rated dump (local `.pgn.zst` or `--url`), zstd-decompresses on the fly, filters to the peer band (1100–2200) + standard-only + first 24 plies, aggregates move frequencies into a normalized-FEN-keyed SQLite table (`explorer_positions(fen_key, move, count)`), then flushes the per-game metric caches for a clean recompute. `explorer.ts` exposes `positionFrequency(fenKey, move)` (lazy read-only, `null` when the table is absent) for `game-metrics.ts` `scanOutOfBook`, with named-ECO fallback (D33). Masters reference deferred. Static, regenerable; not part of the L0→L2 cache. |
| `server/lib/phases.ts` *(new)* | Lichess Divider port — `dividePhases(fens) → { middlegameStartPly, endgameStartPly }`. |
| `server/lib/ply-timeline.ts` *(new)* | Layer 1 — pure `buildTimeline(pgn, analysisRows) → EnrichedPly[]` shared by batch + Analysis page (D16). |
| `server/lib/metrics-config.ts` *(new)* | Single home for all D8–D15 thresholds + `METRICS_VERSION` (D18). Adds, with shipping defaults: mate-win% decay `ε = 0.01` (D27), decided mate-hold `K = 3` plies (D28), out-of-book relative-frequency floor `X = 5%`, peer band `1100–2200`, build depth `24` plies (D29). All retunable; threshold bumps bump `METRICS_VERSION`. |
| `server/lib/game-metrics.ts` *(new)* | Layer 2 — pure `buildGameMetrics(timeline, gameRow) → GameMetrics` (folds over the timeline). |
| `server/scripts/build-metrics.ts` *(new)* | CLI batch runner (iterate user games, ensure analysis, build + upsert metrics rows). Operationally robust per D34 (preflight, per-game isolation, resume fast-path, progress, graceful interrupt). |
| `client/src/pages/Analysis.tsx` | Existing client-only `missedConversions` — align to D2. |
| `client/src/components/EloTrendChart.tsx`, `server/routes/stats.ts` (`elo-trend`) | Existing Elo trend chart + endpoint — extend for the motivating plot (running peak, net-gain, streaks) using `elo_delta` (R12, D5). |
| `lichess-org/scalachess` `Divider.scala` | Reference implementation for D0 phase division + mixedness. |

### Proposed `game_metrics_ext` schema (Layer 2 cache)

Stores **only** new engine-fold-derived scalars queried across games. The shared
per-side scalars (`accuracy`/`acl`/`blunders`/`mistakes`/`inaccuracies`) are **not
here** — they live in `game_metrics` and are JOINed, user side picked via
`user_color` (D17, Q3). Everything in `games` (eco, opening, time_class, user_elo,
opponent_elo, result, time_control, `termination`) is **JOINed, not copied**. Cheap
derivations (`elo_delta`, `result_quality`, `converted`/`saved`/`reached_*`,
`user_color`, `result_for_user`) are **computed at read time**.

| Column | Type | Notes |
|---|---|---|
| `game_id` | TEXT PK | FK → `games.id`. |
| `metrics_version` | INTEGER NOT NULL | D18 — config version this row was built under; mismatch ⇒ recompute. |
| `analysis_sig` | TEXT NOT NULL | D17 — analysis signature (depth/row-count/hash) for invalidation. |
| `multipv_max` | INTEGER NOT NULL | D1 — max MultiPV coverage (1 = fast tier; criticality fields null). |
| `accuracy_opening` / `accuracy_middlegame` / `accuracy_endgame` | REAL | R13 — per-phase; null if phase empty. |
| `acl_opening` / `acl_middlegame` / `acl_endgame` | REAL | R13 — per-phase; null if phase empty. |
| `middlegame_start_ply` / `endgame_start_ply` | INTEGER | D0 boundaries; null if not reached. |
| `time_opening_s` / `time_middlegame_s` / `time_endgame_s` | REAL | R4 — per-phase user think-time totals; null if no clocks. |
| `avg_move_time_s` | REAL | R4 — mean user think time; null if no clocks. |
| `accuracy_critical` / `accuracy_quiet` | REAL | R17/R26 — accuracy on critical vs quiet plies (D9/D15); null on fast tier (`multipv_max = 1`). |
| `critical_positions` | INTEGER | R17 — count of only-move positions; null on fast tier. |
| `time_alloc_efficiency` | REAL | R25 — null on fast tier or no clocks. |
| `max_blunder_run` | INTEGER | R14. |
| `recovery_accuracy` | REAL | R14 — null if no user blunder. |
| `time_trouble_moves` / `time_trouble_errors` | INTEGER | R15 — null if no clocks (D8). |
| `peak_eval_wp` / `trough_eval_wp` | REAL | R18 — raw inputs; `reached_*`/`converted`/`saved` derived at read time (D10/D17). |
| `out_of_book_ply` | INTEGER | R19 — null if never leaves book. |
| `post_book_accuracy` | REAL | R19. |
| `eval_opening_end_wp` | REAL | R20. |
| `user_moves` | INTEGER | Count of user plies. |
| `clocks_available` | INTEGER | R9/R10 — 0/1. |
| `engine_depth_min` | INTEGER | R9 — provenance. |
| `computed_at` | INTEGER | unix epoch seconds. |

**Derived live, never stored:** the per-ply timeline, `critical_moves` (top-3) and
`missed_conversions` lists (folds over the timeline — D16/D3), `elo_delta` (window
over `games` — D5), and the read-time classifications above.

---

## Open Questions

*Resolved interview topics:*
- Round 1 (Q1–Q4) → D1 / R35 / R36+D19 / D17.
- Round 2 (Q5–Q8) → R37+D20 / R38+D21 / R39+D22 / R40+D23.
- Round 3 (Q9–Q12) → D24 / D25 / D26 / R41.
- Round 4 (Q13–Q17) → D27+D28 / D29 / D31 / D30 / D32.
- Round 5 (D29 mechanics) → D29 (bulk-PGN peer table, 24-ply, normalized-FEN) + D33 (ECO fallback); defaults locked (ε=0.01, K=3, X=5%).

*All open questions resolved. Ready for implementation.* History of round 4:

- **Q13 — Mate-score saturation vs criticality/decided.** `mateToCp` collapsed all
  mates to ±1000, saturating win% (mate-only-moves invisible to D9; D22 fired on
  first mate). → **Resolved: D27** (synthetic mate win% `100 − N·ε`, reuses D9) +
  **D28** (decided needs a held non-mate advantage or a mate held K plies).
- **Q14 — Opening-book granularity for out-of-book ply (R19).** Named-ECO book was
  too shallow. → **Resolved: D29** — self-built peer-band (1100–2200) frequency table
  from one monthly Lichess rated dump, first 24 plies, normalized-FEN key,
  relative-frequency floor (X=5%); masters deferred. **D33** — named-ECO fallback
  when frequency data is absent.
- **Q15 — Read-time aggregate performance at scale.** → **Resolved: D31** — indexes
  only now; thin aggregate cache deferred until measured slow.
- **Q16 — Daily/correspondence clock semantics.** → **Resolved: D30** — daily =
  `clocks_available = 0`, excluded from time aggregates only.
- **Q17 — Username stability.** → **Resolved: D32** — assumed fixed; no alias map;
  re-import on rename.

---

## Implementation Outline

### Phase 0 — Schema & primitives
- `server/lib/metrics-config.ts`: all D8–D15/D22 thresholds + `METRICS_VERSION` (D18).
- `db.ts` migrations: add `game_metrics_ext` (incl. `metrics_version`, `analysis_sig`,
  `multipv_max`); add `games.termination` (R36) + `games.is_standard` (R37);
  backfill both idempotently from PGN on startup.
- `server/lib/phases.ts`: port Lichess Divider — `mm(fen)` piece count, back-rank
  sparseness, boundary scan. Mixedness optional (flag as TODO if deferred).
- Extend `pgn.ts`: `parseTimeControl`, `pgnPerPlyClocks`, `parseTermination`,
  `parseVariant`/`isStandard`.
- `server/scripts/build-explorer.ts` + `server/lib/explorer.ts` +
  `server/data/explorer/`: `build-explorer.ts` streams one monthly Lichess rated
  dump, band-filters (1100–2200) + first 24 plies, aggregates into a normalized-FEN
  freq table (D29); `explorer.ts` exposes `positionFrequency(fenKey, move)` with
  named-ECO fallback (D33). Masters deferred. Daily games skip clocks (D30) —
  `pgnPerPlyClocks` returns null and `clocks_available = 0`.

### Phase 1 — Shared timeline + metrics builder
- `server/lib/ply-timeline.ts`: pure `buildTimeline(pgn, analysisRows) →
  EnrichedPly[]` (per-ply side/is_user/win%/wp_loss/class/think_time/phase/
  criticality + the `decided` boundary, D22) — Layer 1, shared by batch + Analysis
  page (D16). Win% uses the **synthetic mate value** `100 − N·ε` (D27) so criticality
  catches mate-only-moves; the `decided` boundary requires a held non-mate advantage
  or a mate held K plies (D28).
- **Migrate `metrics.ts` accuracy to Lichess (R38, D21):** implement
  volatility-weighted + harmonic-mean game accuracy on `moveAccuracy`; delete
  `aggregateAccuracy`/`classAccuracyScore`; honor the decided-position cutoff
  (R39). Add the ply-range variant of `gameMetrics` (per-phase R13, post-book R19,
  critical/quiet R17/R26). Recompute `game_metrics` under the new `METRICS_VERSION`.
  Update `tests/metrics.test.ts` + `tests/eval-logic.test.ts` to the new model.
- `server/lib/game-metrics.ts`: `buildGameMetrics(timeline, gameRow)` combining
  - `gameMetrics` → pick user side for ACL/accuracy/counts (R1, R2, R7),
  - phase boundaries (P0) + per-ply think time → phase time totals + avg (R4),
  - per-user-move `wp_loss` ranking → top-3 `mistake`/`blunder` + `think_time_s`
    (R5, R16),
  - opp-blunder-then-user-not-(best|good) scan → missed conversions (R6, D2),
  - per-phase accuracy/ACL via the ply-range helper (R13),
  - tilt: longest blunder run + post-blunder recovery accuracy (R14),
  - time-trouble move/error counts via per-ply clocks + D8 (R15),
  - only-move detection from rank1−rank2 win% gap → critical-position accuracy
    (R17, D9),
  - eval peak/trough + winning/losing/converted/saved flags (R18, D10),
  - out-of-book ply from the explorer peer-band relative-frequency floor (D29) +
    post-book accuracy (R19),
  - eval at opening-end ply (R20),
  - time-allocation efficiency: think-time↔criticality correlation (R25, D14),
  - opening from header or `classifyOpening` (R3),
  - provenance fields: `metrics_version`, `analysis_sig`, depth, clocks (R9, R10, D17).
  - *(read-time, not in the builder: `elo_delta`, `result_quality`, conversion
    flags, the critical/missed lists — D17.)*
- Unit tests `tests/game-metrics.test.ts` (pure logic; fixtures with known evals +
  clocks; cover no-clock, short-game phase edges, no-blunder recovery=null,
  forced-move criticality).
- Unit tests `tests/phases.test.ts` (Divider boundaries vs known positions).

### Phase 2 — Batch runner
- `server/scripts/build-metrics.ts` (`bun run server/scripts/build-metrics.ts <username>`):
  - Load all `games` for username; for each, skip if `game_metrics_ext.computed_at` is
    newer than the game's latest analysis (R8).
  - Ensure deep analysis via `analyzeGame(..., { multipv: 3 })` honoring
    `acquire/releaseAnalysisSlot` (R1, R11, D1).
  - Build metrics (timeline → folds), upsert `game_metrics_ext` (`INSERT OR REPLACE`).
  - Skip rule uses `metrics_version` + `analysis_sig` (D17), not just existence.
  - Operationally robust per D34: engine preflight, per-game error isolation, resume
    fast-path (skip already-fresh work), progress + summary, graceful interrupt.
  - Resumable: one game per transaction; SIGINT-safe (R8).
  - *(No Elo second pass — `elo_delta` is a read-time window, D5.)*
- Add a `package.json` script alias (e.g. `bun run metrics`).

- **Drill auto-feed (R40, D23):** after each game's metrics, upsert its critical + missed
  positions into `drill_attempts` (`ON CONFLICT DO NOTHING`).
- Skip non-standard games (`is_standard = 0`, R37).

### Phase 2b — Ongoing capture (R35)
- Fold a game into `game_metrics_ext` as soon as its analysis exists: hook the analyze
  SSE `done` event and add a lightweight stale-check (`metrics_version`/
  `analysis_sig`) when the Analysis page / games list loads. Same `buildGameMetrics`
  path — no separate code. Drill auto-feed runs here too.

### Phase 3 — Read API (enables UI)
- `GET /api/metrics/:username` (list) + `GET /api/metrics/game/:gameId` (single).
  The single-game response derives the timeline live and includes the critical/
  missed lists + read-time fields (`elo_delta`, `result_quality`, conversion flags).
- Aggregate endpoints over `game_metrics_ext` ⋈ `games` (D7, pure SQL; rolling N-game
  buckets per D24; forfeit/non-standard filtered per D19/D20): consistency (R21),
  session fatigue (R22, D11), vs-opponent (R23), ACL/accuracy trend (R27),
  leak-closure over `blunder_tags` (R28), TPR (R29), repertoire leaks (R30),
  counterplay-by-rating (R31), endgame conversion (R32).
- **Export endpoint** (R41d): CSV/JSON dump of `game_metrics_ext` ⋈ `games` + aggregates.

### Phase 4 — Client surfacing (R41)
- Repoint `Analysis.tsx` move colors / blunder-nav / `missedConversions` to the
  shared timeline endpoint (D16) — delete the client-side reimplementation so the
  live view and batch are guaranteed identical (supersedes the old "align to D2").
- **Per-game metrics card** on Analysis (R41a): phases, time mgmt, critical moves,
  conversion, result-quality.
- **New /stats tabs** (R41b): consistency/variance, ACL+accuracy trend,
  time-allocation, leak-closure, repertoire leaks, TPR.
- **GameCard enrichment** (R41c): time-trouble flag, result-quality, phase-weakness
  chips + sorts; update accuracy chip to the migrated Lichess number (R38).
- Extend `EloTrendChart` for the motivating plot (R12, D5): per-time-class series,
  running-peak overlay, net-gain annotation, streak/biggest-gain callouts.

### Phase 5 — Verify & document
- `bun run validate` + `bun run test` green (per `AGENTS.md`).
- Update `docs/README.md` index (this doc) and cross-link from `roadmap.md`.

---

## Building the explorer (D29) — optional, manual

The peer-band frequency table is **not** built automatically (the dump is tens of GB and
the build is multi-hour, Risk 3). Out-of-book ply uses the named-ECO fallback (D33) until
you build it; building it changes nothing else.

1. **Download** one monthly **standard rated** dump from
   [`database.lichess.org`](https://database.lichess.org/) (e.g.
   `lichess_db_standard_rated_2024-12.pgn.zst`). Pick a recent month for a current peer band.
2. **Build** the table (keep it local; do not commit):
   ```bash
   bun run explorer /path/to/lichess_db_standard_rated_2024-12.pgn.zst
   # flags: --min-elo 1100 --max-elo 2200 --max-ply 24 --min-samples 5
   #        --out server/data/explorer/explorer.db   --url <href>   --max-games N (testing)
   ```
   It streams + zstd-decompresses on the fly, keeps games with both players in the band,
   aggregates the first 24 plies into `server/data/explorer/explorer.db`, prunes positions
   seen fewer than `--min-samples` times, then **flushes** `game_metrics_ext` + `game_metrics`.
3. **Recompute** per-game metrics so out-of-book ply switches to the frequency signal:
   ```bash
   bun run metrics <username>
   ```

`out_of_book_eco_fallback = 0` on a row means the frequency table drove the cut;
`= 1` means it fell back to the named-ECO prefix (table absent, or the line was never
sampled). The table is regenerable any time; delete `server/data/explorer/` to revert to
ECO-only. **Masters/theory reference is deferred** (study-surfacing, not the cutoff).
