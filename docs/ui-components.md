# UI Components

## EvalBar

File: `app/components/EvalBar.tsx`

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

File: `app/components/EvalGraph.tsx`

A Recharts `LineChart` showing the evaluation over the course of the game.

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
- **Inflection points**: Positions where `|score[i] - score[i-1]| > 0.5` pawns are rendered as colored dots (green = score improved for the moving side, red = worsened)
- **Current move indicator**: A yellow dot with white border marks the active position
- **Click navigation**: Clicking on the chart jumps to that move

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

File: `app/components/MoveList.tsx`

A scrollable grid of moves in standard notation, grouped into pairs (white move, black move).

### Props

```ts
interface MoveListProps {
  moves: string[];              // SAN strings
  currentMove: number;          // active position index
  onSelectMove: (moveIndex: number) => void;
  analysis: AnalysisEntry[];    // for coloring blunders/mistakes
}
```

### Move Classification

`getMoveClass()` compares the evaluation before and after each move to classify it:

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

File: `app/components/GameCard.tsx`

See [gallery.md](gallery.md) for details.
