# Chess Board

## Chessground Integration

File: `client/src/components/ChessBoard.tsx`

The board is rendered by `@lichess-org/chessground` v10 (the scoped package, not the old `chessground` package). It is wrapped in `React.memo`. The default mode is view-only; opt-in `interactive` mode enables drag-drop with legal-move enforcement (used by `/drill`).

### Component API

```tsx
interface ChessBoardProps {
  fen: string;                        // FEN string to display
  orientation?: "white" | "black";    // Board orientation (default "white")
  lastMove?: [Key, Key];              // [from, to] squares to highlight
  autoShapes?: DrawShape[];           // Arrows/circles drawn on the board (e.g. best move arrow)
  config?: Partial<Config>;           // Additional chessground config overrides
  interactive?: boolean;              // Enable drag-drop with legal-move enforcement (default false)
  onMove?: (orig: string, dest: string, promotion?: string) => void; // Fires after a legal drag-drop in interactive mode
}
```

### Initialization

Chessground is initialized once via a `useEffect` with empty deps. Subsequent FEN/lastMove/autoShapes/orientation changes are applied via `api.current?.set(...)` without recreating the instance. The instance is destroyed on unmount.

### Orientation prop (board is orientation-agnostic)

The `orientation` prop just gets forwarded to Chessground. `ChessBoard` makes no decisions about it — all orientation logic (default to searched user's color + manual flip toggle) lives in `Analysis.tsx`. See [analysis-mode.md](analysis-mode.md#board-orientation--player-names) for that logic.

Position updates pass `animation: { enabled: false }` to `api.set()` for instant piece placement. The 200ms animation from initialization only applies to the first render. This prevents animation queueing during rapid keyboard navigation.

### autoShapes prop (best-move arrow)

The parent passes arrow/circle overlays via `autoShapes`. `Analysis.tsx` uses this to draw a blue arrow showing Stockfish's recommended best move from the current position. The UCI best-move string (e.g. `"e2e4"`) is split into `orig`/`dest` squares in a `bestMoveShapes` memo (keyed on `[bestMoves, currentMove]`) and rendered as a `DrawShape` with the built-in `"blue"` brush. The arrow updates reactively as the user navigates.

### Interactive mode (`interactive={true}`)

When `interactive` is true the board enables `draggable`, computes `movable.dests` from `chess.js` `chess.moves({verbose:true})` (memoized on `[fen, interactive]`), sets `movable.color` to the side-to-move derived from the FEN, and fires `onMove(orig, dest, promotion?)` after a legal drop. A small `isPromotion(fen, orig, dest)` helper detects pawn promotions and defaults the promotion piece to queen — callers can intercept for a picker. The `"a0"` chessground sentinel key is filtered out before the chess.js cast.

The non-interactive default still locks down all interaction:

- `movable.free: false` -- pieces cannot be moved
- `draggable.enabled: false` -- no drag-and-drop
- `selectable.enabled: false` -- no square selection
- `animation.enabled: true, duration: 200` -- smooth piece transitions (initial mount only)

### CSS

Three CSS files are imported globally in `client/src/main.tsx`:

- `chessground.base.css` -- layout and sizing
- `chessground.brown.css` -- brown board theme
- `chessground.cburnett.css` -- cburnett piece set

### Vite Config

Chessground ships its own ESM and must be excluded from Vite's dep optimization:

```ts
// client/vite.config.ts
optimizeDeps: { exclude: ["@lichess-org/chessground"] }
```

### Types

The `Key` type from `@lichess-org/chessground/types` is a string literal union of all valid squares (`"a1"` through `"h8"` plus `"a0"`). The `lastMove` prop uses `[Key, Key]` to match chessground's expected format.

## PGN Parsing

File: `server/lib/pgn.ts`

Uses `chess.js` to convert PGN strings into usable data structures.

### `pgnToFens(pgn: string): string[]`

Returns an array of FEN strings starting from the initial position (index 0) through each position after every move. A game with N moves produces N+1 FENs.

Implementation: Loads the PGN, extracts verbose history, then replays each move on a fresh `Chess` instance to capture each intermediate FEN.

### `pgnToMoves(pgn: string): MoveInfo[]`

Returns detailed move information:

```ts
interface MoveInfo {
  san: string;   // e.g. "e4", "Nf3", "O-O"
  from: string;  // e.g. "e2"
  to: string;    // e.g. "e4"
  fen: string;   // FEN after this move
}
```

### `pgnHeaders(pgn: string): PgnHeaders`

Parses all `[Key "Value"]` PGN headers into a `PgnHeaders` record (`Partial<Record<string, string>>`). Used everywhere headers are needed — Elo backfill, ECO/Opening extraction, result lookup.

### `getGameResult(pgn: string): string | null`

Returns the `Result` header. Delegates to `pgnHeaders(pgn).Result ?? null`.

## Move Indexing Convention

Throughout the app, positions are 0-indexed:

- Index 0 = starting position (before any move)
- Index 1 = position after White's first move
- Index 2 = position after Black's first move
- Index N = final position

The `moves` array from `pgnToMoves` is 0-indexed by move number, so `moves[0]` is White's first move, `moves[1]` is Black's first move, etc. The FEN at `fens[i+1]` is the position after `moves[i]`.
