# Chess Board

## Chessground Integration

File: `app/components/ChessBoard.tsx`

The board is rendered by `@lichess-org/chessground` v10 (the scoped package, not the old `chessground` package). It is a view-only board with no move interaction.

### Component API

```tsx
interface ChessBoardProps {
  fen: string;               // FEN string to display
  lastMove?: [Key, Key];     // [from, to] squares to highlight
  config?: Partial<Config>;  // Additional chessground config overrides
}
```

### Initialization

Chessground is initialized once via a `useEffect` with empty deps. Subsequent FEN/lastMove changes are applied via `api.current?.set(...)` without recreating the instance. The instance is destroyed on unmount.

Configuration locks down all interaction:

- `movable.free: false` -- pieces cannot be moved
- `draggable.enabled: false` -- no drag-and-drop
- `selectable.enabled: false` -- no square selection
- `animation.enabled: true, duration: 200` -- smooth piece transitions

### CSS

Three CSS files are imported globally in `app/root.tsx`:

- `chessground.base.css` -- layout and sizing
- `chessground.brown.css` -- brown board theme
- `chessground.cburnett.css` -- cburnett piece set

### Vite Config

Chessground ships its own ESM and must be excluded from Vite's dep optimization:

```ts
// vite.config.ts
optimizeDeps: { exclude: ["@lichess-org/chessground"] }
```

### Types

The `Key` type from `@lichess-org/chessground/types` is a string literal union of all valid squares (`"a1"` through `"h8"` plus `"a0"`). The `lastMove` prop uses `[Key, Key]` to match chessground's expected format.

## PGN Parsing

File: `app/lib/pgn.ts`

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

### `getGameResult(pgn: string): string | null`

Extracts the `[Result "..."]` header from raw PGN text via regex.

## Move Indexing Convention

Throughout the app, positions are 0-indexed:

- Index 0 = starting position (before any move)
- Index 1 = position after White's first move
- Index 2 = position after Black's first move
- Index N = final position

The `moves` array from `pgnToMoves` is 0-indexed by move number, so `moves[0]` is White's first move, `moves[1]` is Black's first move, etc. The FEN at `fens[i+1]` is the position after `moves[i]`.
