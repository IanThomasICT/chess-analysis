# chess-analysis

A personal, single-user tool for analyzing Chess.com games with a local Stockfish engine. Built to move three numbers: **win rate**, **accuracy / blunder rate**, and **Elo**.

Read [`docs/core.md`](docs/core.md) for the full vision and architecture; [`docs/README.md`](docs/README.md) for the spec index.

## Stack

| Layer | Tech |
|---|---|
| Runtime | [Bun](https://bun.com) |
| Client | React 19, react-router v7 (library mode, CSR), TanStack Query, Tailwind v4, [chessground v10](https://github.com/lichess-org/chessground), uPlot, chess.js |
| Server | [Hono](https://hono.dev/) on Bun, [`bun:sqlite`](https://bun.com/docs/api/sqlite), Stockfish subprocess via `Bun.spawn`, [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs) |
| Testing | `bun:test` for unit, Playwright-core driven by `bun:test` for e2e |
| Linting | ESLint v10 + `typescript-eslint` strict + type-checked |

## Prerequisites

- **Bun** ≥ 1.3 ([install](https://bun.com/docs/installation))
- **Stockfish** binary on `$PATH` or at `$HOME/bin/stockfish-bin` / `$HOME/.local/bin/stockfish`. The latest release tarball from [official-stockfish/Stockfish](https://github.com/official-stockfish/Stockfish/releases) works:

  ```bash
  mkdir -p $HOME/bin && cd /tmp
  curl -sL -o sf.tar https://github.com/official-stockfish/Stockfish/releases/download/sf_18/stockfish-ubuntu-x86-64-bmi2.tar
  tar -xf sf.tar
  mv stockfish/stockfish-ubuntu-x86-64-bmi2 $HOME/bin/stockfish-bin
  chmod +x $HOME/bin/stockfish-bin
  ```

  (Pick the build matching your CPU — `bmi2` for most modern Intel/AMD, `avx2` for older, `vnni256`/`avx512` for newest server CPUs.)

## Install

```bash
bun install
```

## Run

```bash
bun run dev        # Vite SPA on :5173 + Hono API on :3001
```

Open `http://localhost:5173`. Vite proxies `/api/*` to Hono.

## Workflow at a glance

1. **Home** (`/`) — type a Chess.com username, load recent games. Filter by time class / result, sort by Worst-first to surface games worth reviewing. Accuracy + blunder chips render per card once analysis exists.
2. **Analysis** (`/analysis/:gameId`) — auto-runs Stockfish at MultiPV=3 on first open. Keyboard nav: `← → Home End` for moves, `B / Shift+B` for next/prev blunder, `M / Shift+M` for mistakes. Top-3 engine arrows + AlternativesPanel show the lines; RecurrencePanel surfaces other games where this position came up.
3. **Stats** (`/stats?username=…`) — 9 tabs covering by-side, time class, opening, rating bucket, Elo trend, accuracy trend, time-of-day heatmap, recurring motifs, drill progress.
4. **Drill** (`/drill?username=…`) — FSRS spaced-repetition over your own past blunder positions. Drag a piece to submit; right answers get longer intervals, wrong answers re-surface ~10 min later.
5. **Study** (`/study`) — in-app glossary of every term the dashboards use (Accuracy, Blunder, ACL, Motif, Drill, FSRS, MultiPV, PV, FEN, ECO, Lc0).

## Commands

```bash
bun run dev          # Start dev servers (Vite :5173 + Hono :3001)
bun run build        # Production client build (Vite)
bun run start        # Production server (NODE_ENV=production, single port)
bun run typecheck    # tsc -b (incremental, cached)
bun run lint         # ESLint with content-hash cache (<1s warm)
bun run lint:fix     # ESLint with autofix
bun run validate     # typecheck + lint + build
bun run test         # Unit tests (bun:test, tests/ directory)
bun run test:e2e     # Seed e2e DB + run Playwright tests
bun run test:all     # Unit + e2e
```

## Configuration

| Env var | Default | Use |
|---|---|---|
| `STOCKFISH_PATH` | (auto-search) | Override Stockfish binary path |
| `ENGINE_TYPE` | `stockfish` | Set to `lc0` to use Lc0 (GPU neural engine; needs weights) |
| `ENGINE_PATH` | (auto) | Override engine binary path (any engine type) |
| `WEIGHTS_PATH` | (none) | Required when `ENGINE_TYPE=lc0` |
| `ENGINE_BACKEND` | `cudnn-fp16` | Lc0 backend (only used when `ENGINE_TYPE=lc0`) |
| `USER_TZ` | `America/Los_Angeles` | Timezone for the time-of-day heatmap |
| `PORT` | `3001` | API port |
| `NODE_ENV` | `development` | `production` to tighten rate limits + serve built SPA same-origin |

## Data

- All state lives in `analysis.db` (SQLite, WAL mode, project root, gitignored). Back this up before destructive operations.
- Schema is managed by an inline migration runner in `server/lib/db.ts` (`migrations: Migration[]`). The runner reads `meta.schema_version` and applies any pending migrations in a single transaction on startup. See [`docs/core.md#database-schema`](docs/core.md) for the full schema.
- Header / opening / motif backfills run idempotently at startup; safe to restart.

## Documentation

- [`docs/README.md`](docs/README.md) — spec index
- [`docs/core.md`](docs/core.md) — vision, architecture, schema, file tree
- [`docs/metrics.md`](docs/metrics.md) — Lichess accuracy formulas, classification thresholds
- [`docs/stats.md`](docs/stats.md) — `/stats` page + endpoints
- [`docs/drill.md`](docs/drill.md) — drill mode + FSRS
- [`docs/motifs.md`](docs/motifs.md) — motif detectors + tagging
- [`docs/study.md`](docs/study.md) — glossary page
- [`docs/analysis-mode.md`](docs/analysis-mode.md) — Stockfish lifecycle + SSE + deep analysis
- [`docs/security.md`](docs/security.md) — headers, rate limits, SSRF guards

## Non-goals

This is a personal tool, not a product. No multi-user support, no accounts, no hosted backend, no mobile-optimised UI, no game-source other than Chess.com.
