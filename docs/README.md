# Documentation Index

Layout: `core.md` (vision + architecture) · `HANDOFF.md` (state of the current branch) ·
`project/` (canonical specs per module/feature) · `references/` (external libraries + data sources) ·
`plans/` (completed planning docs, kept for provenance — not authoritative).

## Top level

| Doc | Related Files | Description |
|---|---|---|
| [core.md](core.md) | `server/lib/db.ts`, `client/vite.config.ts`, `tsconfig.json`, `package.json` | Project vision (single-user tool, target metrics: win rate / accuracy-blunder rate / elo), design principles, feature-to-metric alignment, non-goals. Followed by architecture: split-stack, data flow, SQLite schema, file structure |
| [HANDOFF.md](HANDOFF.md) | branch `feat/game-metrics` | Session handoff: decisions, work done, verification status, follow-ups for the in-flight UI polish (settings modal, lazy gallery, scrubber, review digest, 60-day Patterns, cache-first games route) |

## Project specs (`project/`)

| Spec | Related Files | Description |
|---|---|---|
| [board.md](project/board.md) | `client/src/components/ChessBoard.tsx`, `server/lib/pgn.ts`, `client/vite.config.ts` | Chessground v10 integration, CSS setup, Vite config, PGN-to-FEN parsing with chess.js, move indexing conventions |
| [analysis-mode.md](project/analysis-mode.md) | `server/lib/engine.ts`, `server/routes/analyze.ts`, `client/src/pages/Analysis.tsx` | Stockfish UCI subprocess lifecycle, score normalization (White's perspective), movetime-based search, analysis caching, SSE streaming protocol + `done` query invalidation, auto-start analysis, precomputed eval data |
| [gallery.md](project/gallery.md) | `server/lib/chesscom.ts`, `server/lib/pgn.ts`, `server/routes/games.ts`, `client/src/pages/Home.tsx`, `client/src/components/GameCard.tsx` | Chess.com PubAPI client, cache-first `GET /api/games` (background sync, deduped), bot/coach exclusion via PGN `[Event "Play vs …"]`, home page with TanStack Query, client-side filtering (time class/result/sort, no text search), lazy-rendered (25 + IntersectionObserver) GameCard grid |
| [ui-components.md](project/ui-components.md) | `client/src/components/{AppShell,SettingsModal,MoveScrubber,GameReviewSummary,EvalBar,EvalGraph,MoveList,GameCard,StatsPanel,RecurrencePanel,AlternativesPanel,MetricsCard,EloTrendChart,AccuracyTrendChart}.tsx`, `client/src/context/Settings.tsx` | Component contracts: AppShell + `ui/` primitives, SettingsModal (username + prefs), MoveScrubber (range slider + blunder ticks), GameReviewSummary (metricDetail digest), EvalBar score mapping, EvalGraph with uPlot, MoveList with MoveClass + motif tooltips, cards and trend charts |
| [routing.md](project/routing.md) | `client/src/App.tsx`, `client/src/pages/{Home,Analysis,Stats,Drill,Study}.tsx`, `server/routes/{games,analyze,stats,positions,drill,metrics}.ts` | Client routes (`/`, `/analysis/:id`, `/stats`, `/drill`, `/study`), full API route table incl. `from`/`to` bounds and `/api/metrics/*`, TanStack Query loading, dev proxy, production same-origin serve |
| [ui-ux.md](project/ui-ux.md) | `client/src/app.css`, `client/src/main.tsx`, `client/src/lib/theme-colors.ts`, `client/src/components/{AppShell,SettingsModal,MoveScrubber,GameReviewSummary}.tsx`, `client/src/context/Settings.tsx`, `client/src/components/ui/*`, `client/src/pages/*` | UI/UX vision + design system: at-a-glance / no-scroll philosophy, single warm-dark theme tokens, color semantics, typography, lucide iconography, app shell + settings modal, `components/ui/` primitive vocabulary, per-surface intent (Games KPI band + lazy gallery, Analysis scrubber + always-visible review digest, 4-section Stats with 60-day Patterns window), e2e test handles, conventions for new UI |
| [linting.md](project/linting.md) | `eslint.config.ts`, `tsconfig.json`, `client/tsconfig.json`, `server/tsconfig.json` | ESLint strict type-checked config, zero-any policy, type import style (`separate-type-imports` + `verbatimModuleSyntax`), React hooks + `@eslint-react` rules, Bun type workarounds, check commands |
| [security.md](project/security.md) | `server/index.ts`, `server/lib/rate-limit.ts`, `server/lib/engine.ts`, `server/lib/chesscom.ts` | Security middleware stack (headers, CORS, rate limiting), input validation, SSRF protection, Stockfish concurrency/timeout, error handling |
| [metrics.md](project/metrics.md) | `server/lib/metrics.ts`, `server/routes/stats.ts`, `shared/classify.ts`, `client/src/components/GameCard.tsx`, `client/src/components/StatsPanel.tsx` | Lichess D1 formulas (Win%, accuracy, ACL — surfaced in UI as "Accuracy"), classification thresholds, `game_metrics` cache, per-game / bulk / by-side endpoints |
| [game_metrics.md](project/game_metrics.md) | `server/lib/{metrics-config,phases,ply-timeline,game-metrics,metrics-store,metrics,backfill,db,pgn,openings,explorer}.ts`, `server/scripts/{build-metrics,build-explorer}.ts`, `server/routes/{metrics,stats,analyze,games}.ts`, `client/src/{api.ts,components/MetricsCard.tsx,components/GameReviewSummary.tsx,pages/{Analysis,Stats,Home}.tsx}` | **Built.** Per-game metric tracking: bulk backfill (`bun run metrics <user>`) + ongoing capture via one shared derivation. 4-layer drift-control architecture (L0 raw → L1 `buildTimeline` → L2 versioned `game_metrics_ext` → L3 read-time aggregates). Lichess accuracy per phase, time management, tilt, conversion/defense, out-of-book (Opening Explorer), top-3 critical moves, Elo delta, result quality; aggregates (consistency, session-fatigue, vs-opponent, ACL trend, leak-closure, TPR, repertoire, counterplay, endgame-conversion). Requirements R0–R41 / Decisions D0–D33; build sequence in `plans/game-metrics-plan.md` |
| [stats.md](project/stats.md) | `server/routes/stats.ts`, `server/lib/openings.ts`, `server/data/openings/*.tsv`, `client/src/pages/Stats.tsx`, `client/src/components/{EloTrendChart,AccuracyTrendChart}.tsx` | `/stats` sectioned dashboard (Overview / Trends / Openings / Patterns), win-rate slices, Elo + Accuracy trends, time-of-day heatmap, motifs + drill panels, Patterns windowed to last 60 days via `from`, hybrid opening classification |
| [motifs.md](project/motifs.md) | `server/lib/motifs.ts`, `server/lib/motif-tagging.ts`, `server/routes/stats.ts`, `client/src/components/MoveList.tsx` | Six tactical motif detectors, priority-capped tagging at analyze time, recurring-mistake aggregation, mover-side filtering |
| [drill.md](project/drill.md) | `server/routes/drill.ts`, `client/src/pages/Drill.tsx`, `client/src/components/ChessBoard.tsx` (interactive prop) | FSRS spaced-repetition drill queue + attempt endpoint, interactive chessground board, drill progress stats |
| [study.md](project/study.md) | `client/src/study/glossary.ts`, `client/src/pages/Study.tsx` | `/study` glossary page explaining in-app terminology (accuracy, motif, ACL, FSRS, MultiPV, PV, FEN, ECO, Lc0) |
| [roadmap.md](project/roadmap.md) | `core.md`, `analysis-mode.md`, `gallery.md`, `server/lib/db.ts` | Feature gaps vs. vision — tiered catalog of unbuilt features that move win rate / accuracy / elo, with data sources, schema impact, complexity, open questions |

## References (`references/`)

| Doc | Description |
|---|---|
| [external.md](references/external.md) | External libraries, APIs, and data sources the project depends on, with links and the local spec that covers each |

## Plans (`plans/`)

Completed planning documents. Kept for decision provenance; superseded by `project/` specs where they disagree.

| Doc | Status | Description |
|---|---|---|
| [initial-requirements.md](plans/initial-requirements.md) | done | Original implementation plan / architecture sketch |
| [roadmap-design.md](plans/roadmap-design.md) | done | Roadmap → phased implementation plan with cross-cutting decisions (D1…) |
| [roadmap-tasks.md](plans/roadmap-tasks.md) | done | Granular task list (`P{phase}.{n}`) executing `roadmap-design.md` |
| [game-metrics-plan.md](plans/game-metrics-plan.md) | done | Build sequence for `project/game_metrics.md` |
| [test-migration-plan.md](plans/test-migration-plan.md) | done | e2e suite migration to the redesigned UI |
