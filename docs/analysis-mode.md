# Analysis Mode

## Overview

The analysis system has three layers:

1. **Stockfish subprocess** (`server/lib/engine.ts`) -- UCI protocol over stdin/stdout
2. **SSE streaming endpoint** (`server/routes/analyze.ts`) -- streams results to the browser
3. **Analysis UI** (`client/src/pages/Analysis.tsx`) -- renders board, eval bar, graph, move list

## Deep analysis (MultiPV)

The analyze SSE endpoint accepts `?multipv=3`. The engine is re-initialised with `MultiPV=3`, search time scales proportionally (`SEARCH_MOVETIME * 3`), and each position yields **three** SSE events (one per `multipvRank`, ordered 1..3 with rank 1 being the best line). All three are persisted to `analysis` with the composite PK `(game_id, move_index, multipv_rank)`.

The Analysis page **runs deep analysis by default** for any newly-opened game (the auto-start `EventSource` URL is `/api/analyze/:id?multipv=3`). Rank-1 events feed the eval graph / move list / metrics state; rank-2/3 events are persisted server-side and fetched lazily by `AlternativesPanel` per position.
- Top-3 engine lines render as graduated arrows on the board (blue / paleBlue / green).
- The `AlternativesPanel` shows the PVs with their evals, depth, and the move actually played.
- A separate endpoint `GET /api/games/:gameId/alternatives/:moveIndex` returns the three ranks for a single position (used by `AlternativesPanel`).

Single-PV is still wired (`?multipv=1` on the SSE URL) for callers that don't need alternatives, but the UI does not use it.

## Stockfish Service

File: `server/lib/engine.ts`

### Process Lifecycle

`spawnEngine()` creates an engine subprocess (Stockfish or Lc0 depending on `ENGINE_TYPE`) via `Bun.spawn` and returns an `EngineHandle`:

```ts
interface EngineHandle {
  sendCmd: (cmd: string) => void;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  init: (multipv?: number) => Promise<void>;
  cleanup: () => void;
}
```

`init(multipv)` sends `setoption name MultiPV value <n>` after the standard UCI handshake. `MultiPV=3` is the default the Analysis page requests via `?multipv=3`; the SSE endpoint also accepts `?multipv=1` for callers that only need single-line analysis. See "Deep analysis" below.

- **stdin**: Bun's `FileSink`. Commands are written with `stdin.write()` + `stdin.flush()`.
- **stdout**: `ReadableStream<Uint8Array>`. A reader is obtained via `.getReader()`.
- **stderr**: Set to `"ignore"`. Never piped -- an unread stderr pipe can fill the OS buffer (~64KB) and deadlock the Stockfish process.

Initialization sequence (matches Lichess's `protocol.ts` pattern):
1. Send `uci`
2. Wait for `uciok` (engine ready to accept options)
3. Send `setoption name Threads value 4`
4. Send `setoption name Hash value 128`
5. Send `ucinewgame` (clears hash table for clean analysis)
6. Send `isready`
7. Block until `readyok` appears in stdout

### Search Strategy

Analysis uses time-bounded search (`go movetime 1500`) instead of fixed depth. This caps each position at 1.5s, giving reasonable total analysis time (~90s for a 60-move game) while reaching high depth (typically 20-30+). The higher search time produces more accurate forced-mate distances — at lower depths, Stockfish may find valid but non-optimal (longer) mating lines.

Two module-level constants control the search:

```ts
const SEARCH_MOVETIME = 1500;  // ms per position
const MIN_CACHE_DEPTH = 16;    // minimum depth to accept from cache
```

### UCI Parsing

For each position, the engine sends:
1. Multiple `info depth N score cp X` or `info depth N score mate X` lines
2. A final `bestmove XXXX` line

`readUntilBestMove()` buffers stdout, parses each line, and keeps the **last** `info` score before the `bestmove` line as the final evaluation. Lines containing `lowerbound` or `upperbound` (aspiration window intermediates) are skipped, matching Lichess's behavior.

### Score Normalization

UCI reports scores from the **side-to-move's perspective**. `analyzeSinglePosition()` normalizes to **White's perspective** by checking the FEN's active color field and negating both `cp` and `mate` when Black is to move. This matches Lichess's `ply % 2` normalization in `protocol.ts`.

All stored scores follow this convention:
- Positive centipawns = White advantage
- Negative centipawns = Black advantage
- `score_mate > 0` = White has forced mate
- `score_mate < 0` = Black has forced mate

### Caching

Before analyzing, the service checks `COUNT(*)` in the analysis table for the given game where `depth >= MIN_CACHE_DEPTH`. If all positions are already analyzed at sufficient depth, cached results are yielded directly without spawning Stockfish.

Per-position caching: individual positions that already exist at `MIN_CACHE_DEPTH` are skipped during analysis.

### `analyzeGame()` Generator

```ts
async function* analyzeGame(gameId, fens, moves)
```

An async generator that yields one result per position. This design enables streaming: the SSE endpoint iterates the generator and sends each result to the client as it completes.

### Stockfish Path

Resolved in order: `STOCKFISH_PATH` env var → `$HOME/bin/stockfish-bin` → `$HOME/.local/bin/stockfish` → bare `"stockfish"` (relies on `$PATH`).

### Concurrency Limiting

A module-level counter limits concurrent Stockfish processes to `MAX_CONCURRENT_ANALYSES` (2). The analyze route checks `acquireAnalysisSlot()` before starting and returns 429 if at capacity. Slots are released in the SSE stream's `finally` block.

### Per-Position Timeout

`analyzeSinglePosition()` wraps `readUntilBestMove()` in `withTimeout(POSITION_TIMEOUT_MS)` (10s). If Stockfish hangs, the timeout error propagates through the async generator and the `finally` block kills the process.

### UCI Command Sanitization

`sendCmd()` strips `\r` and `\n` from commands before writing to stdin, preventing multi-command injection through crafted inputs.

## SSE Streaming Endpoint

File: `server/routes/analyze.ts`

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
  "depth": 18,
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

### Server Configuration

The Bun server (`server/index.ts`) sets `idleTimeout: 120` to prevent the default 10-second idle timeout from killing long-running SSE connections during analysis.

### Client Consumption

Analysis starts **automatically** when the game page loads and the game hasn't been analyzed yet. A `useEffect` with a ref guard opens an `EventSource` to `/api/analyze/:gameId` and streams results into component state. The progress bar updates based on `moveIndex / total`. The EventSource is cleaned up on unmount.

## Analysis View

File: `client/src/pages/Analysis.tsx`

### Data Loading

The page fetches game data via TanStack Query (`useQuery`). When the response arrives with `analyzed: false`, a `useEffect` automatically triggers SSE analysis (guarded by a `useRef` to prevent re-triggering after completion).

### Client State

| State | Purpose |
|---|---|
| `currentMove` | Index into the FEN array (0 = start) |
| `analysis` | Array of `AnalysisRow` (seeded from query, extended by SSE) |
| `isAnalyzing` | Whether SSE stream is active |
| `progress` | Percentage complete (0-100) |
| `userFlipped` | Whether the user has toggled board orientation away from the default |

### Score Helpers (module-level)

Three pure helpers at the top of `Analysis.tsx` centralize all eval math so it isn't repeated across memos:

| Helper | Purpose |
|---|---|
| `evalPawns(row)` | Convert an `AnalysisRow` to pawns (graph / bar units). Mate → ±10. |
| `evalCp(row)` | Convert to centipawn-equivalent for swing classification. Mate → ±1000. |
| `classifySwing(swing)` | Map a swing (cp, signed against the mover) to a CSS class: red blunder / orange mistake / yellow inaccuracy / empty. |

### Precomputed Derived Data

All expensive computations are memoized via `useMemo` and only recompute when `analysis` changes — **not** on every arrow key press:

| Memo | Depends on | Purpose |
|---|---|---|
| `scores` | `analysis` | Pre-indexed `number[]` by move index via `evalPawns` (O(1) lookup) |
| `scoreMates` | `analysis` | Pre-indexed `Array<number \| null>` of raw mate distances; drives the "M5" / "-M5" label on `EvalBar` |
| `bestMoves` | `analysis` | Pre-indexed `Array<string \| undefined>` of UCI best-move strings (sparse array) |
| `bestMoveShapes` | `bestMoves`, `currentMove` | `DrawShape[]` — a single blue arrow built from the current position's UCI best move, fed to `ChessBoard.autoShapes` |
| `evalData` | `analysis` | Sorted + mapped points for `EvalGraph` (via `evalPawns`) |
| `moveClasses` | `analysis`, `fens.length` | Precomputed CSS classifications via a `Map<move_index, entry>` + `evalCp` + `classifySwing` (O(n), not O(n²)) |
| `moveSans` | `moves` | Stable `string[]` reference for MoveList |
| `lastMove` | `currentMove`, `moves` | `[from, to]` tuple for board highlighting; stable reference prevents spurious ChessBoard effects |

`currentScore` and `currentMate` are plain array indexes (`scores[currentMove] ?? 0`, `scoreMates[currentMove] ?? null`), not `.find()` scans.

### Board Orientation & Player Names

Orientation logic lives entirely in `Analysis.tsx` — the `ChessBoard` component is orientation-agnostic.

- `defaultOrientation`: derived from the game — if the searched user played Black, defaults to `"black"`, else `"white"`.
- `flippedOrientation`: the opposite of `defaultOrientation` (precomputed to avoid a nested ternary).
- `orientation`: `userFlipped ? flippedOrientation : defaultOrientation`. Passed to both `ChessBoard` and `EvalBar` so they stay in sync.

A flip button in the move-navigation row toggles `userFlipped`.

Player names render above and below the board, swapped to match `orientation`:
- `topPlayerName` / `bottomPlayerName` chosen from `game.white` / `game.black` by orientation
- The searched user's name is bolded (`isSearchedUserTop` / `isSearchedUserBottom`)
- A small color-dot (white or gray-800) indicates each side

### Keyboard Navigation

| Key | Action |
|---|---|
| ArrowRight | Next move |
| ArrowLeft | Previous move |
| Home | Go to start |
| End | Go to final position |

The EvalGraph uses uPlot (canvas-based). When `currentMove` changes, only `chart.redraw()` is called — no React reconciliation. This keeps move navigation latency-free.

### Score Display

Centipawn scores are converted to pawns (`cp / 100`) for display. Mate scores collapse to ±10 pawns in `evalPawns()` (for graph / bar position) and ±1000 cp in `evalCp()` (for swing classification, so a missed defense against a forced mate always classifies as a blunder).
