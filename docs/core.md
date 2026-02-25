# Core Architecture

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

## Design Principles

This is a **local-only** application. There is no hosted backend. Stockfish runs as a child process of the Bun server, and the SQLite database lives on disk at the project root (`analysis.db`, gitignored). All Chess.com API calls are proxied through the server to avoid CORS issues.

## Split-Stack Architecture

The app is a **Vite React SPA** (`client/`) communicating with a **Bun Hono API** (`server/`) via JSON endpoints.

- **Dev mode**: Vite on `:5173` proxies `/api/*` to Hono on `:3001` (configured in `client/vite.config.ts`)
- **Production**: Hono serves both the built static SPA and the API on a single port

## Server Middleware

The Hono server (`server/index.ts`) applies middleware in this order:

1. `secureHeaders()` — X-Content-Type-Options, X-Frame-Options, HSTS, etc.
2. `cors()` — development only (Vite `:5173` → Hono `:3001`); disabled in production (same-origin)
3. `rateLimit()` — per-IP: 60 req/min general, 5 req/min for `/api/analyze/*`
4. `app.onError()` — global catch-all returning generic 500 (never leaks internals)

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

File: `server/lib/db.ts`

The database is created at `analysis.db` in the project root with WAL journaling mode enabled.

### `games` table

Stores game metadata fetched from Chess.com. The `id` is the game's numeric ID extracted from its Chess.com URL.

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

Index: `idx_games_username` on `username`.

### `analysis` table

Stores per-position Stockfish evaluations. Composite primary key on `(game_id, move_index)`.

| Column | Type | Description |
|---|---|---|
| `game_id` | TEXT NOT NULL | FK to `games.id` |
| `move_index` | INTEGER NOT NULL | Position index (0 = starting position) |
| `fen` | TEXT NOT NULL | FEN string for this position |
| `move_san` | TEXT | SAN of the move that led here (null for index 0) |
| `score_cp` | INTEGER | Centipawn score (null if mate) |
| `score_mate` | INTEGER | Mate-in-N (null if centipawn) |
| `best_move` | TEXT | Stockfish's recommended move (UCI notation) |
| `depth` | INTEGER | Search depth used |

Index: `idx_analysis_game_id` on `game_id`.

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
    components/
      ChessBoard.tsx       # Chessground wrapper (React.memo)
      EvalBar.tsx          # Vertical evaluation bar (React.memo)
      EvalGraph.tsx        # uPlot canvas eval graph (React.memo)
      MoveList.tsx         # Scrollable move list with annotations (React.memo)
      GameCard.tsx         # Gallery card for a single game

server/
  index.ts                 # Hono app entry (middleware, route mounting, static serve)
  routes/
    games.ts               # GET /api/games, GET /api/games/:gameId
    analyze.ts             # GET /api/analyze/:gameId (SSE stream)
  lib/
    db.ts                  # SQLite singleton + schema creation
    chesscom.ts            # Chess.com PubAPI client
    stockfish.ts           # UCI subprocess + analysis generator
    pgn.ts                 # PGN -> FEN/move parsing (chess.js)
    rate-limit.ts          # Per-IP in-memory rate limiter
```
