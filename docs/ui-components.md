# UI Components

## EvalBar

File: `client/src/components/EvalBar.tsx`

A vertical evaluation bar with white on the bottom and black on top.

### Props

```ts
interface EvalBarProps {
  score: number;  // in pawns, from White's perspective
}
```

### Score Clamping

The score is clamped to `[-10, 10]` pawns and mapped to a percentage:

```
whiteHeight = ((clampedScore + 10) / 20) * 100
```

- Score of 0 -> white fills 50%
- Score of +10 -> white fills 100%
- Score of -10 -> white fills 0%

### Display Label

| Condition | Display |
|---|---|
| `abs(score) >= 10` | `"M"` or `"-M"` (mate) |
| `score > 0` | `"+X.X"` |
| `score <= 0` | `"X.X"` |

The label is positioned absolutely near the boundary between the white and black sections.

## EvalGraph

File: `client/src/components/EvalGraph.tsx`

A Recharts `LineChart` showing the evaluation over the course of the game. Wrapped in `React.memo` to skip re-renders when props are reference-equal.

### Props

```ts
interface EvalGraphProps {
  data: EvalDataPoint[];                    // { moveIndex, score }
  currentMove: number;                      // highlighted position (received via useDeferredValue)
  onSelectMove: (moveIndex: number) => void; // click handler
}
```

### Features

- **Clamped display**: Scores are clamped to `[-5, 5]` for the Y axis
- **Zero line**: A dashed reference line at y=0
- **Inflection points**: Positions where `|score[i] - score[i-1]| > 0.5` pawns are rendered as colored dots (green = score improved for the moving side, red = worsened)
- **Current move indicator**: A yellow dot with white border marks the active position
- **Click navigation**: Clicking on the chart jumps to that move

### Performance

`clampedData` and `inflectionDots` are memoized via `useMemo([data])` -- they only recompute when the analysis data changes, not when `currentMove` changes. The parent passes `currentMove` through `useDeferredValue` so Recharts re-renders are deferred to idle frames, keeping board/eval bar/move list updates on the critical path.

### Type Safety

The `onClick` handler uses a typed `ChartClickEvent` interface instead of `any`:

```ts
interface ChartClickPayloadEntry {
  payload: ClampedDataPoint;
}
interface ChartClickEvent {
  activePayload?: ChartClickPayloadEntry[];
}
```

The handler is cast to `(data: unknown) => void` at the JSX boundary to satisfy Recharts' generic `onClick` type.

## MoveList

File: `client/src/components/MoveList.tsx`

A scrollable grid of moves in standard notation, grouped into pairs (white move, black move). Wrapped in `React.memo`.

### Props

```ts
interface MoveListProps {
  moves: string[];              // SAN strings (stable reference via useMemo in parent)
  currentMove: number;          // active position index
  onSelectMove: (moveIndex: number) => void;
  moveClasses: string[];        // precomputed CSS classes per move (blunder/mistake/inaccuracy)
}
```

### Move Classification

Classifications are **precomputed in the parent** (`Analysis.tsx`) via `useMemo` with a `Map<move_index, entry>` for O(1) lookups, then passed as a simple `string[]`. MoveList indexes into this array (`moveClasses[positionIndex] ?? ""`). No per-render computation.

The classification thresholds (applied in the parent):

| Eval Swing (centipawns) | Classification | CSS |
|---|---|---|
| < -300 | Blunder | `text-red-500 font-bold` |
| < -100 | Mistake | `text-orange-500 font-semibold` |
| < -50 | Inaccuracy | `text-yellow-500` |
| >= -50 | Normal | (no extra class) |

The swing direction is relative to the side that moved. A negative swing means the position got worse for the player who just moved.

### Auto-Scroll

The active move button is scrolled into view via `scrollIntoView({ block: "nearest", behavior: "smooth" })` whenever `currentMove` changes.

### Layout

Moves are displayed in a 3-column grid: `[move number] [white move] [black move]`. Clicking any move calls `onSelectMove` with the corresponding position index.

## GameCard

File: `client/src/components/GameCard.tsx`

See [gallery.md](gallery.md) for details.
