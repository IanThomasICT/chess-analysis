# Core Vision

## Purpose

A **personal, single-user tool** for the project owner (Ian) to analyze his own Chess.com games and **measurably improve at chess**. Not a product. Not multi-tenant. Not a public service. Every feature exists to move one of three metrics:

| Metric | What it measures | How this tool helps |
|---|---|---|
| **Win rate** | % games won across a time class | Surface losing patterns (openings, time pressure, recurring blunders) so they can be drilled and eliminated |
| **Accuracy / blunder rate** | Stockfish-judged move quality per game | Pinpoint the exact moves where eval swings, classify them (inaccuracy / mistake / blunder), and make the pattern reviewable |
| **Elo** | Chess.com rating progression | Lagging indicator. Tracked over time to validate that the above two metrics actually translate into rating gains |

If a proposed feature does not plausibly move one of those three numbers for **this single user**, it does not belong in this tool.

## Design Principles

1. **Local-first, single-user.** Runs on Ian's machine. No auth, no accounts, no hosted backend. SQLite on disk, Stockfish as a child process. Chess.com API is proxied through the local server only to dodge CORS.
2. **Optimize for review velocity.** The bottleneck on improvement is *games reviewed per week*. Every interaction should make it faster to: load a game → spot the critical moments → understand what went wrong → move to the next game.
3. **Trust the engine, surface the signal.** Stockfish evals are ground truth. The UI's job is to make eval swings, blunders, and missed best moves *instantly visible* — not to bury them in noise.
4. **Cache aggressively.** Analysis is expensive (Stockfish CPU time). Re-analyzing a position is waste. Every eval is persisted to SQLite keyed by `(game_id, move_index)` and reused forever.
5. **No premature generality.** No multi-user schema, no plugin system, no abstractions for hypothetical future games sites. If Lichess support is ever wanted, it gets added then — not designed for now.

## Feature Alignment

Each existing feature should trace back to a metric:

| Feature | Serves |
|---|---|
| Chess.com game import + gallery | Review velocity — get to the game fast |
| Filter by result / time class | Win rate analysis — isolate losses in a specific format |
| Stockfish per-position eval + cache | Accuracy / blunder rate — ground truth |
| Eval graph with inflection dots | Review velocity — jump straight to the critical moments |
| Best-move arrow on board | Accuracy — show what should have been played |
| Move list with classification annotations | Blunder rate — at-a-glance move quality |
| EvalBar | Review velocity — current position assessment without parsing numbers |

Features **not yet built but aligned** with the vision (candidates, not commitments):

- Aggregate dashboards: blunder rate over time, accuracy by opening, win rate by time-of-day or time class
- Opening explorer keyed to the user's own results (which openings actually win for *me*)
- Recurring-mistake detection: cluster blunder positions by motif (hanging piece, missed fork, back-rank, etc.)
- Elo trend overlay with annotations for behavioral changes (e.g. "started reviewing daily on date X")

## Non-Goals

- Multi-user support, accounts, sharing, public deployment
- Real-time play, puzzles, training modes unrelated to the user's own game history
- Lichess or other game-source integration (until/unless the user actually wants it)
- Mobile-optimized UI (desktop review is the workflow)
- Engine choice beyond Stockfish

---

# Architecture

## Stack

| Layer | Technology |
|---|---|
| Runtime | Bun |
| Client framework | React 19, react-router v7 (library mode, CSR) |
| Server framework | Hono (HTTP framework on Bun) |
| Data fetching | TanStack Query (`@tanstack/react-query`) |
| UI | Tailwind CSS v4 |
| Chess board | `@lichess-org/chessground` v10 |
| Chess logic | `chess.js` v1 |
| Charts | uPlot v1 (canvas) |
| Database | Bun's built-in SQLite (`bun:sqlite`) |
| Engine | Stockfish (local subprocess via `Bun.spawn`) |
| Linting | ESLint + `typescript-eslint` (strict + type-checked) |
| Security | `hono/secure-headers`, in-memory rate limiter (`server/lib/rate-limit.ts`) |

Stack choices follow the vision: Bun + SQLite + local Stockfish = zero-ops, single-machine, fast iteration. No cloud DB, no managed engine API, no auth provider.

## Split-Stack

**Vite React SPA** (`client/`) ↔ **Bun Hono API** (`server/`) via JSON + SSE.

- **Dev**: Vite on `:5173` proxies `/api/*` to Hono on `:3001` (`client/vite.config.ts`)
- **Production**: Hono serves both built SPA and API on one port

## Server Middleware

Order in `server/index.ts`:

1. `secureHeaders()` — standard hardening
2. `cors()` — dev only (`:5173` → `:3001`); disabled in production (same-origin)
3. `rateLimit()` — 60 req/min general, 5 req/min on `/api/analyze/*`
4. `app.onError()` — generic 500, no internal leaks

Security middleware exists because the server *can* be exposed (e.g. tunnel for review on another device) — not because it's a public service.

## Data Flow

```
Browser (React SPA)              Bun Server (Hono API)
  |                                  |
  |-- GET /api/games?username=X ---->|
  |                                  |-- fetch chess.com PubAPI
  |                                  |-- upsert games into SQLite
  |<---- JSON { games: [...] } ------|
  |                                  |
  |-- GET /api/games/:gameId ------->|
  |                                  |-- load game PGN from SQLite
  |                                  |-- parse PGN -> FENs (chess.js)
  |                                  |-- check if analysis cached
  |<---- JSON { game, fens, moves }--|
  |                                  |
  |-- EventSource /api/analyze/:id ->|
  |                                  |-- spawn Stockfish subprocess
  |                                  |-- for each FEN: send UCI, read eval
  |                                  |-- upsert each result into SQLite
  |<---- SSE: {moveIndex, score} ----|  (streamed per-position)
  |<---- SSE: {done: true} ----------|
```

## Database Schema

File: `server/lib/db.ts`. SQLite at `analysis.db` (project root, gitignored), WAL mode.

### `games`

Game metadata from Chess.com. `id` is the numeric ID from the game URL.

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | Game ID (from Chess.com URL) |
| `username` | TEXT NOT NULL | Queried username (lowercased) |
| `pgn` | TEXT NOT NULL | Full PGN string |
| `white` | TEXT | White player username |
| `black` | TEXT | Black player username |
| `result` | TEXT | `"1-0"`, `"0-1"`, or `"1/2-1/2"` |
| `time_class` | TEXT | `"bullet"`, `"blitz"`, `"rapid"`, `"daily"` |
| `end_time` | INTEGER | Unix timestamp |
| `created_at` | INTEGER | Auto-set via `unixepoch()` |
| `white_elo` | INTEGER | White's rating at game end (parsed from PGN `[WhiteElo]`) |
| `black_elo` | INTEGER | Black's rating at game end (parsed from PGN `[BlackElo]`) |
| `user_elo` | INTEGER | Queried user's rating at game end (denormalized for filtering) |
| `eco` | TEXT | ECO code parsed from PGN `[ECO]` header |
| `opening` | TEXT | Opening name parsed from PGN `[Opening]` header |

Index: `idx_games_username` on `username`.

### `analysis`

Per-position Stockfish evaluations. Composite PK `(game_id, move_index, multipv_rank)`. This table is the **accuracy/blunder ground truth** — every metric eventually derives from it.

| Column | Type | Description |
|---|---|---|
| `game_id` | TEXT NOT NULL | FK to `games.id` |
| `move_index` | INTEGER NOT NULL | Position index (0 = starting position) |
| `multipv_rank` | INTEGER NOT NULL DEFAULT 1 | 1 = engine's top line; 2/3 from deep analysis |
| `fen` | TEXT NOT NULL | FEN string for this position |
| `move_san` | TEXT | SAN of move that led here (null for index 0; null for rank > 1) |
| `score_cp` | INTEGER | Centipawn score (null if mate) |
| `score_mate` | INTEGER | Mate-in-N (null if centipawn) |
| `best_move` | TEXT | Engine's recommended move (UCI) — first PV move |
| `pv` | TEXT | Space-separated UCI moves for the full PV (multipv only) |
| `depth` | INTEGER | Search depth used |
| `fen_key` | TEXT | First 4 FEN fields (board/side/castling/ep) for transposition match |

Indexes: `idx_analysis_game_id` on `game_id`, `idx_analysis_fen` on `fen`, `idx_analysis_fen_key` on `fen_key` (used by `/api/positions/history`).

All scores normalized to **White's perspective** (positive = White advantage).

### `game_metrics`

Per-game derived metrics cache (Lichess accuracy / blunder counts). Computed lazily on first request, invalidated when an analyze SSE stream starts for the game.

| Column | Type | Description |
|---|---|---|
| `game_id` | TEXT PK | FK to `games.id` |
| `accuracy_white` | REAL NOT NULL | Mover-perspective accuracy 0..100 (arithmetic mean) |
| `accuracy_black` | REAL NOT NULL | Mover-perspective accuracy 0..100 |
| `blunders_white` / `blunders_black` | INTEGER NOT NULL | Per-side blunder counts |
| `mistakes_white` / `mistakes_black` | INTEGER NOT NULL | Per-side mistake counts |
| `inaccuracies_white` / `inaccuracies_black` | INTEGER NOT NULL | Per-side inaccuracy counts |
| `acl_white` / `acl_black` | REAL NOT NULL | Average centipawn loss (skip first 8 plies) |
| `computed_at` | INTEGER NOT NULL | unix epoch (seconds) |

### `meta`

Migration bookkeeping. Single key `schema_version` tracks the highest applied migration id.

| Column | Type | Description |
|---|---|---|
| `key` | TEXT PK | e.g. `"schema_version"` |
| `value` | TEXT | Stringified value (SQLite stores all as TEXT here) |

Migrations are defined inline in `server/lib/db.ts` as an append-only `migrations: Migration[]` array. `runMigrations(db)` runs every migration with `id > current` inside a single transaction at server startup.

### Engine abstraction

`server/lib/engine.ts` (renamed from `stockfish.ts`) is engine-agnostic — UCI protocol is identical for Stockfish and Lc0. Env-driven config:

| Env var | Default | Notes |
|---|---|---|
| `ENGINE_TYPE` | `stockfish` | `stockfish` or `lc0` |
| `ENGINE_PATH` | (auto) | Binary path; falls back to PATH lookup |
| `WEIGHTS_PATH` | (none) | Required when `ENGINE_TYPE=lc0` |
| `ENGINE_BACKEND` | `cudnn-fp16` | Lc0 only |

`MAX_CONCURRENT_ANALYSES` is 1 for Lc0 (single-GPU contention), 2 for Stockfish.

### `annotations`

Manual notes layered onto Elo trend / stats views. CRUD endpoints deferred — render-only for Phase 2.

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | row id |
| `t` | INTEGER NOT NULL | unix epoch seconds |
| `time_class` | TEXT NOT NULL | bullet/blitz/rapid/daily |
| `text` | TEXT NOT NULL | freeform note |

Index: `idx_annotations_time_class` on `(time_class, t)`.

### Shared classification

`shared/classify.ts` — `MoveClass` enum (`"best" | "good" | "inaccuracy" | "mistake" | "blunder"`) and `classifySwing(wpDelta)` using Lichess thresholds (DESIGN D1). Imported by both client (`client/src/lib/classify.ts` re-export) and server (`server/lib/metrics.ts` once Phase 1 lands).

## File Structure

```
client/
  src/
    main.tsx               # ReactDOM.createRoot + providers + CSS imports
    App.tsx                # Routes config (react-router library mode)
    app.css                # Tailwind base + theme
    api.ts                 # Typed fetch wrappers + shared interfaces
    pages/
      Home.tsx             # Game gallery (index route)
      Analysis.tsx         # Analysis view
      Stats.tsx            # Tabbed dashboards (by-side / opening / rating / elo trend / time-of-day)
    components/
      ChessBoard.tsx       # Chessground wrapper (React.memo)
      EvalBar.tsx          # Vertical evaluation bar (React.memo)
      EvalGraph.tsx        # uPlot canvas eval graph (React.memo)
      MoveList.tsx         # Scrollable move list with annotations (React.memo)
      GameCard.tsx         # Gallery card; accuracy/blunder chips when metrics present
      StatsPanel.tsx       # Home page by-side breakdown panel
      EloTrendChart.tsx    # uPlot line chart for /stats Elo trend tab
      RecurrencePanel.tsx  # Position-recurrence list on Analysis page
      AlternativesPanel.tsx # Top-3 engine PVs (deep-analysis mode)
      AclTrendChart.tsx    # uPlot ACL trend on /stats page
      GameCard.tsx         # Gallery card for a single game

server/
  index.ts                 # Hono app entry (middleware, route mounting, static serve)
  routes/
    games.ts               # GET /api/games, GET /api/games/:gameId, /:id/metrics, /metrics?username=
    analyze.ts             # GET /api/analyze/:gameId (SSE stream; invalidates game_metrics)
    stats.ts               # /api/stats/:user/{by-side,win-rate,elo-trend,by-time-of-day}
    positions.ts           # GET /api/positions/history?fen=&username= (recurrence)
  data/
    openings/{a..e}.tsv    # lichess-org/chess-openings (CC0)
  lib/
    db.ts                  # SQLite singleton + schema + migration runner
    chesscom.ts            # Chess.com PubAPI client
    engine.ts              # UCI subprocess (Stockfish/Lc0) + analysis generator
    pgn.ts                 # PGN -> FEN/move parsing + pgnHeaders (chess.js)
    backfill.ts            # Idempotent header + opening backfill on startup
    metrics.ts             # Lichess D1 formulas + gameMetrics() per-side aggregator
    openings.ts            # ECO/Opening TSV loader + classifyOpening longest-prefix match
    rate-limit.ts          # Per-IP in-memory rate limiter

shared/
  classify.ts              # MoveClass enum + classifySwing (Lichess thresholds)
```
