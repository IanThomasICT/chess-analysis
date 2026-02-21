# Core Architecture

## Stack

| Layer | Technology |
|---|---|
| Runtime | Bun |
| Framework | React Router v7 (framework mode, SSR) |
| UI | React 19, Tailwind CSS v4 |
| Chess board | `@lichess-org/chessground` v10 |
| Chess logic | `chess.js` v1 |
| Charts | Recharts v3 |
| Database | Bun's built-in SQLite (`bun:sqlite`) |
| Engine | Stockfish (local subprocess via `Bun.spawn`) |
| Linting | ESLint + `typescript-eslint` (strict + type-checked) |

## Design Principles

This is a **local-only** application. There is no hosted backend. Stockfish runs as a child process of the Bun server, and the SQLite database lives on disk at the project root (`analysis.db`, gitignored). All Chess.com API calls are proxied through the server to avoid CORS issues.

## Data Flow

```
Browser                          Bun Server
  |                                  |
  |-- GET /?username=X ------------->|
  |                                  |-- fetch chess.com PubAPI
  |                                  |-- upsert games into SQLite
  |<---- HTML (game gallery) --------|
  |                                  |
  |-- GET /analysis/:gameId -------->|
  |                                  |-- load game PGN from SQLite
  |                                  |-- parse PGN -> FENs (chess.js)
  |                                  |-- check if analysis cached
  |<---- HTML (board + moves) -------|
  |                                  |
  |-- EventSource /api/analyze/:id ->|
  |                                  |-- spawn Stockfish subprocess
  |                                  |-- for each FEN: send UCI, read eval
  |                                  |-- upsert each result into SQLite
  |<---- SSE: {moveIndex, score} ----|  (streamed per-position)
  |<---- SSE: {done: true} ----------|
```

## Database Schema

File: `app/lib/db.server.ts`

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
app/
  lib/
    db.server.ts           # SQLite singleton + schema
    chesscom.server.ts     # Chess.com PubAPI client
    stockfish.server.ts    # UCI subprocess + analysis generator
    pgn.ts                 # PGN -> FEN/move parsing (chess.js)
  components/
    ChessBoard.tsx         # Chessground wrapper
    EvalBar.tsx            # Vertical evaluation bar
    EvalGraph.tsx          # Recharts eval line graph
    MoveList.tsx           # Scrollable move list with annotations
    GameCard.tsx           # Gallery card for a single game
  routes/
    home.tsx               # Game gallery (index route)
    analysis.$gameId.tsx   # Analysis view
    api.analyze.$gameId.ts # SSE Stockfish stream endpoint
  root.tsx                 # App shell, CSS imports, error boundary
  routes.ts                # Route config
  app.css                  # Tailwind base + theme
```
