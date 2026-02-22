# UI Components

## EvalBar

File: `client/src/components/EvalBar.tsx`

A vertical evaluation bar with white on the bottom and black on top.

### Props

```ts
interface EvalBarProps {
  score: number;           // in pawns, from White's perspective
  scoreMate: number | null; // mate distance (positive = White mates), null when no forced mate
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
| `scoreMate !== null` (positive) | `"M5"` (mate-in-N for White) |
| `scoreMate !== null` (negative) | `"-M5"` (mate-in-N for Black) |
| `score > 0` | `"+X.X"` |
| `score <= 0` | `"X.X"` |

The label is positioned absolutely near the boundary between the white and black sections.

## EvalGraph

File: `client/src/components/EvalGraph.tsx`

A canvas-based eval chart using [uPlot](https://github.com/leeoniya/uPlot). Wrapped in `React.memo` to skip re-renders when props are reference-equal.

### Props

```ts
interface EvalGraphProps {
  data: EvalDataPoint[];                    // { moveIndex, score }
  currentMove: number;                      // highlighted position
  onSelectMove: (moveIndex: number) => void; // click handler
}
```

### Features

- **Clamped display**: Scores are clamped to `[-5, 5]` for the Y axis
- **Zero line**: A dashed reference line at y=0
- **Inflection points**: Positions where `|score[i] - score[i-1]| > 0.5` pawns are rendered as colored dots (green = score went up from White's perspective, red = went down)
- **Current move indicator**: An amber dot with white border marks the active position
- **Click navigation**: Clicking on the chart jumps to that move
- **Tooltip**: Hover shows move number and eval score

### Architecture (imperative canvas)

uPlot is initialized in a `useEffect` with `[]` deps. The chart is **not** created inline — instead, a `ResizeObserver` watches the container and creates the chart on the first callback with non-zero dimensions. This avoids the 0×0 canvas problem when the container hasn't been laid out yet (common with conditional rendering + StrictMode double-mount). The latest data is read from `alignedDataRef` at creation time so it's never stale.

All updates bypass React reconciliation:

| Trigger | Update path |
|---|---|
| New analysis data (SSE) | `chart.setData(alignedData)` via `useEffect([alignedData])` |
| `currentMove` change | `chart.redraw()` via `useEffect([currentMove])` — the `draw` hook reads `currentMoveRef` |
| Container resize | `ResizeObserver` → `chart.setSize()` |

Custom overlays are drawn in the `draw` hook directly on `self.ctx` (the canvas 2D context):
1. Dashed zero reference line
2. Inflection dots (read from `inflectionsRef`)
3. Current-move indicator (read from `currentMoveRef`)

Click-to-navigate uses a named event listener on `self.over` (the plot overlay div), with proper cleanup via `removeEventListener`.

### Performance

- **No React reconciliation on move change**: `currentMove` triggers only `chart.redraw()` (~0.1ms canvas repaint), not a React component tree diff.
- **No `useDeferredValue` needed**: The graph no longer blocks the critical path (board, eval bar, move list).
- **Bundle size**: uPlot is ~35KB min vs ~200KB+ for Recharts (including D3 transitive deps).
- `inflections` and `alignedData` are memoized via `useMemo([data])` — they only recompute when analysis data changes.

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
