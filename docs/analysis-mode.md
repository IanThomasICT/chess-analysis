# Analysis Mode

## Overview

The analysis system has three layers:

1. **Stockfish subprocess** (`app/lib/stockfish.server.ts`) -- UCI protocol over stdin/stdout
2. **SSE streaming endpoint** (`app/routes/api.analyze.$gameId.ts`) -- streams results to the browser
3. **Analysis UI** (`app/routes/analysis.$gameId.tsx`) -- renders board, eval bar, graph, move list

## Stockfish Service

File: `app/lib/stockfish.server.ts`

### Process Lifecycle

`spawnStockfish()` creates a Stockfish subprocess via `Bun.spawn` and returns a `StockfishHandle`:

```ts
interface StockfishHandle {
  sendCmd: (cmd: string) => void;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  init: () => Promise<void>;
  cleanup: () => void;
}
```

- **stdin**: Bun's `FileSink`. Commands are written with `stdin.write()` + `stdin.flush()`.
- **stdout**: `ReadableStream<Uint8Array>`. A reader is obtained via `.getReader()`.

Initialization sequence:
1. Send `uci`
2. Send `setoption name Threads value 4`
3. Send `setoption name Hash value 128`
4. Send `isready`
5. Block until `readyok` appears in stdout

### UCI Parsing

For each position, the engine sends:
1. Multiple `info depth N score cp X` or `info depth N score mate X` lines
2. A final `bestmove XXXX` line

`readUntilBestMove()` buffers stdout, parses each line, and keeps the **last** `info` score before the `bestmove` line as the final evaluation.

### Score Convention

All scores are stored from **White's perspective**:
- Positive centipawns = White advantage
- Negative centipawns = Black advantage
- `score_mate > 0` = White has forced mate
- `score_mate < 0` = Black has forced mate

### Caching

Before analyzing, the service checks `COUNT(*)` in the analysis table for the given game and depth. If all positions are already analyzed at sufficient depth, cached results are yielded directly without spawning Stockfish.

Per-position caching: individual positions that already exist at the requested depth are skipped during analysis.

### `analyzeGame()` Generator

```ts
async function* analyzeGame(gameId, fens, moves, depth?)
```

An async generator that yields one result per position. This design enables streaming: the SSE endpoint iterates the generator and sends each result to the client as it completes.

### Stockfish Path

Resolved from `STOCKFISH_PATH` env var, falling back to `$HOME/.local/bin/stockfish`, then `/usr/local/bin/stockfish`.

## SSE Streaming Endpoint

File: `app/routes/api.analyze.$gameId.ts`

### Protocol

The endpoint returns `Content-Type: text/event-stream`. Each SSE message is a JSON object:

**Progress event:**
```json
{
  "moveIndex": 0,
  "fen": "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
  "scoreCp": 20,
  "scoreMate": null,
  "bestMove": "e7e5",
  "depth": 20,
  "total": 85
}
```

**Completion event:**
```json
{ "done": true }
```

**Error event:**
```json
{ "error": "Stockfish process failed" }
```

### Client Consumption

The analysis route creates an `EventSource` pointed at `/api/analyze/:gameId`. Each `onmessage` event is parsed as `AnalysisEvent` (a typed interface, not `any`) and used to build up the analysis state incrementally. The progress bar updates based on `moveIndex / total`.

## Analysis View

File: `app/routes/analysis.$gameId.tsx`

### Loader

The loader is synchronous (no `async`). It:
1. Fetches the game from SQLite
2. Parses PGN into FENs and moves via `chess.js`
3. Checks if analysis is already cached
4. Returns game metadata, FENs, moves, and any cached analysis

### Client State

| State | Purpose |
|---|---|
| `currentMove` | Index into the FEN array (0 = start) |
| `analysis` | Array of `AnalysisRow` (populated from loader or SSE) |
| `isAnalyzing` | Whether SSE stream is active |
| `progress` | Percentage complete (0-100) |

### Keyboard Navigation

| Key | Action |
|---|---|
| ArrowRight | Next move |
| ArrowLeft | Previous move |
| Home | Go to start |
| End | Go to final position |

### Score Display

Centipawn scores are converted to pawns (`cp / 100`) for display. Mate scores are clamped to +/-10 pawns equivalent.
