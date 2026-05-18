# UI Components

## EvalBar

File: `client/src/components/EvalBar.tsx`

A vertical evaluation bar that flips to match the board orientation.

### Props

```ts
interface EvalBarProps {
  score: number;                    // in pawns, from White's perspective
  scoreMate: number | null;         // mate distance (positive = White mates), null when no forced mate
  orientation?: "white" | "black";  // matches board orientation (default "white")
}
```

### Orientation

When `orientation` is `"white"` (default), white is on the bottom and black on top. When `"black"`, the sections swap — white goes to the top and black to the bottom. The score label is always positioned 2% inside the winning side's section, near the boundary between sections. The Analysis page passes the same orientation value used by the ChessBoard so both stay in sync.

### Exponential Score Mapping

The score is mapped to a percentage using `tanh` for exponential growth that saturates near the edges:

```
whitePercent = 50 + 50 * tanh(score / 3)
```

| Score (pawns) | White % | Interpretation |
|---|---|---|
| 0 | 50% | Equal position |
| +1 | ~66% | Slight advantage |
| +3 | ~88% | Clear advantage |
| +5.5 | ~97.5% | Near-certain win |
| +10 (mate) | ~99.9% | Decisive |

The curve grows quickly for the first few pawns and asymptotically approaches the edges. No clamping is needed since `tanh` naturally saturates.

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
  moves: string[];                          // SAN strings (stable reference via useMemo in parent)
  currentMove: number;                      // active position index
  onSelectMove: (moveIndex: number) => void;
  classifications: MoveClass[];             // typed enum per move (best/good/inaccuracy/mistake/blunder)
  motifs?: Record<string, string[]>;        // optional motif tags keyed by stringified move_index
}
```

### Move Classification

Classifications are **precomputed in the parent** (`Analysis.tsx`) via `useMemo` and passed as `MoveClass[]`. The component derives the rendered CSS at render-time via `classToColor(class)` from `client/src/lib/classify.ts`, which re-exports `shared/classify.ts`.

Thresholds follow Lichess Win%-delta (see [docs/metrics.md](metrics.md) for the full formulas):

| wpDelta (0–1 scale) | Classification | Rendered CSS |
|---|---|---|
| ≥ 0.30 | blunder | `text-red-500 font-bold` |
| ≥ 0.20 | mistake | `text-orange-500 font-semibold` |
| ≥ 0.10 | inaccuracy | `text-yellow-500` |
| ≤ 0.02 | best | (none) |
| else | good | (none) |

### Motif chips

When `motifs[moveIndex]` is populated, a small purple chip renders next to the move showing first-letter abbreviations (F=fork, P=pin, S=skewer, H=hanging piece, M=missed mate, B=back-rank mate). The chip carries a `title` attribute with the full motif names (underscores → spaces) so hovering reveals the meaning.

### Auto-Scroll

The active move button is scrolled into view via `scrollIntoView({ block: "nearest", behavior: "instant" })` whenever `currentMove` changes. Instant (not smooth) so rapid arrow-key navigation never lags behind the keystrokes.

### Layout

Moves are displayed in a 3-column grid: `[move number] [white move] [black move]`. Clicking any move calls `onSelectMove` with the corresponding position index.

## GameCard

File: `client/src/components/GameCard.tsx`

See [gallery.md](gallery.md) for details — including the optional `accuracy?` / `blunders?` chips that render when metrics are available.

## StatsPanel

File: `client/src/components/StatsPanel.tsx`

Compact horizontal panel slotted above the gallery filter bar on Home. Fetches `/api/stats/:username/by-side` via TanStack Query and renders two side-by-side blocks: "As White" and "As Black", each showing W-D-L, win rate, avg accuracy, and blunders/game. Returns `null` while loading, on error, or when both sides have zero games (no flicker). The "As Black" block is separated by a thin vertical divider.

## RecurrencePanel

File: `client/src/components/RecurrencePanel.tsx`

Position-recurrence widget on the Analysis page. Fetches `/api/positions/history?fen=…&username=…` and lists other games (excluding the current one) where the same position appeared — matched on `fen_key` (first 4 FEN fields, transposition-friendly). Each row shows a red dot if the user blundered at that move, the opponent's name, the played move, and the game date as a `<Link>` deep-link `/analysis/:id?move=N`. Silent on empty/loading so navigation between moves doesn't flash. Hidden until at least one prior game matches.

## AlternativesPanel

File: `client/src/components/AlternativesPanel.tsx`

Top-3 engine lines for the current position, fetched from `/api/games/:gameId/alternatives/:moveIndex`. Each row: rank, eval (formatted `+1.23` or `+M3`), full PV in UCI (truncated with tooltip), depth. Always rendered on the Analysis page because deep analysis (MultiPV=3) is the default. Includes the actually-played move at the bottom for comparison.

## EloTrendChart

File: `client/src/components/EloTrendChart.tsx`

Imperative-canvas uPlot wrapper used by `/stats > Elo Trend`. Single blue series, time-scaled X axis, "Rating" Y label. Same deferred-init-via-ResizeObserver pattern as `EvalGraph` to avoid 0×0 canvas problems. A second `useEffect` on `[data]` re-feeds the series when the user toggles time class.

## AccuracyTrendChart

File: `client/src/components/AccuracyTrendChart.tsx`

Mirror of `EloTrendChart` for `/stats > Accuracy Trend`. Green stroke (`#22c55e`), Y axis pinned to `[0, 100]` so accuracy values across time classes stay visually comparable, "Accuracy %" axis label. Data comes from `fetchAccuracyTrend(username, timeClass)` which hits `/api/stats/:username/accuracy-trend`.
