# UI Components

> All components use the single committed dark theme via Tailwind tokens (`bg-surface`, `text-blunder`,
> …) — no `dark:` variants, no raw hex. Canvas charts read the matching palette from
> `client/src/lib/theme-colors.ts`. See [ui-ux.md](ui-ux.md) for the design system.

## AppShell + UI primitives

File: `client/src/components/AppShell.tsx` + `client/src/components/ui/*`.

`AppShell` is the persistent frame: a top navbar (`h-14`) with brand, nav links
(`Games / Stats / Drill / Study`, active-state, carry `?username=`), and a settings button (current username +
gear icon) that opens `SettingsModal`, over a routed `<Outlet/>`. It wraps `SettingsProvider` so every
page reads the active user and client prefs via `useSettings()`.
All routes are children of one layout route in `App.tsx`.

Reusable primitives in `components/ui/` (compose pages from these, don't re-derive markup):

| Primitive | Purpose |
|---|---|
| `Card` | surface container + optional uppercase title + right `action` slot |
| `StatTile` | KPI: small label + large mono value (+ optional hint/tone) |
| `Chip` | tone-driven status pill (`win`/`blunder`/`info`/…), optional leading icon |
| `Tabs` | underline tab bar (controlled) — Analysis rail + Stats sections |
| `SegmentedControl` | inline option group, all choices visible; `label` → `role="group"` (a11y + tests) |
| `TimeClassIcon` | lucide time-class glyph (bullet/blitz/rapid/daily), replaces emoji |

## SettingsModal

File: `client/src/components/SettingsModal.tsx` (+ `client/src/context/Settings.tsx`).

Dialog (`role="dialog"`, aria-label `Settings`) opened from the navbar. Props: `open`, `onClose`. Holds a
local `draft` of the username (`input[name="username"]`, reseeded each open, auto-focused) and applies it
via `useSettings().setUsername` on **Save**. The default time-class `SegmentedControl` writes through
`useSettings().updateSettings` immediately (no Save needed). Closes on Escape, backdrop click, close button,
or Cancel. `SettingsProvider` persists `{ defaultTimeClass }` to localStorage key `chess-analyzer-settings`,
validating the stored value against the allowed set on read.

## MoveScrubber

File: `client/src/components/MoveScrubber.tsx`.

Replaces the `« ‹ N/M › »` stepper under the Analysis board. Props: `currentMove`, `maxMove`, `onSelect`,
`onFlip`, `classifications: MoveClass[]`, `userIsWhite`. A transparent `<input type="range">` is the
interaction layer (drag + keyboard); a styled rail, progress fill, and thumb render beneath it. Ticks
(`bg-blunder` / `bg-mistake`) mark the **user's** blunders/mistakes only (parity of move index vs
`userIsWhite`) and are clickable buttons (`aria-label="Go to <kind> at move N"`). Icon buttons
`First move` / `Previous move` / `Next move` / `Last move` / `Flip board` are aria-labelled and disabled at
the bounds. Renders the `N / M` counter the e2e suite keys on.

## GameReviewSummary

File: `client/src/components/GameReviewSummary.tsx` (memo).

Always-visible digest above the Analysis rail tabs. Props: `gameId`, `onSelectMove(positionIndex)`. Queries
`["metricDetail", gameId]` → `GET /api/metrics/game/:id` and renders the result-quality chip, Elo delta,
time-trouble chip, and the top-3 `criticalMoves` as buttons (`Jump to <SAN>`) that call
`onSelectMove(move.plyIndex)` — `plyIndex` is already the position index after the move, so no `+1`.
Pending → "Building report…"; error (game not yet analyzed → 404) → "Report available once analysis
finishes." Analysis SSE `done` invalidates the query so the digest appears live.

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

The active move is highlighted with `bg-accent/20 text-fg`; opponent plies are dimmed `opacity-50`. (The
quality colors above come from `classToColor` in `shared/classify.ts`.)

### Motif chips

When `motifs[moveIndex]` is populated, a small info-toned chip (`text-info`) renders next to the move
showing first-letter abbreviations (F=fork, P=pin, S=skewer, H=hanging piece, M=missed mate, B=back-rank
mate), with a `title` of the full names. A separate `M` badge (`bg-inaccuracy/20 text-inaccuracy`) marks
a missed conversion (opponent blundered, user didn't punish).

### Auto-Scroll

The active move button is scrolled into view via `scrollIntoView({ block: "nearest", behavior: "instant" })` whenever `currentMove` changes. Instant (not smooth) so rapid arrow-key navigation never lags behind the keystrokes.

### Layout

Moves are displayed in a 3-column grid: `[move number] [white move] [black move]`. Clicking any move calls `onSelectMove` with the corresponding position index.

## GameCard

File: `client/src/components/GameCard.tsx`

See [gallery.md](gallery.md) for details — including the optional `accuracy?` / `blunders?` chips that render when metrics are available.

## StatsPanel (KPI band)

File: `client/src/components/StatsPanel.tsx`

At-a-glance KPI band atop the Games page. Fetches `/api/stats/:username/by-side` and renders a row of
`StatTile`s: overall Record (W-D-L), Win rate, Accuracy, Blunders/game, plus per-side As White / As Black
(win% + accuracy hint). Overall figures are games-weighted across the two sides. Returns `null` while
loading, on error, or when both sides have zero games (no flicker).

## RecurrencePanel

File: `client/src/components/RecurrencePanel.tsx`

Position-recurrence widget shown in the Analysis rail's **History** tab. Fetches
`/api/positions/history?fen=…&username=…` and lists other games (excluding the current one) where the same
position appeared — matched on `fen_key` (first 4 FEN fields, transposition-friendly). Each row shows a
blunder-toned dot (`text-blunder`) if the user blundered there, the opponent's name, the played move, and
the date as a `<Link>` deep-link `/analysis/:id?move=N`. Renders flush (the rail provides the card chrome
+ scroll). Silent on empty/loading.

## AlternativesPanel

File: `client/src/components/AlternativesPanel.tsx`

Top-3 engine lines for the current position, fetched from `/api/games/:gameId/alternatives/:moveIndex`.
Each row: rank, eval (`+1.23` / `+M3`), full PV in UCI (truncated with tooltip), depth. Shown in the
Analysis rail's **Engine** tab (deep MultiPV=3 is the default). Includes the played move at the bottom.

## MetricsCard (per-game report)

File: `client/src/components/MetricsCard.tsx`

The consolidated per-game report, shown in the Analysis rail's **Report** tab (previously stacked below
the board). Fetches `/api/metrics/game/:gameId` and renders flush sections: result-quality `Chip` + Elo
delta, Phase Accuracy, Position Quality, Time, Conversion/Defense (chips), and lists of the top critical
moves + missed conversions. `memo`-wrapped; see [game_metrics.md](game_metrics.md) for the metric
definitions.

## EloTrendChart

File: `client/src/components/EloTrendChart.tsx`

Imperative-canvas uPlot wrapper used by **Stats > Trends**. Accent (blue) Elo series + dashed amber
running-peak overlay, time-scaled X, "Rating" Y label. Colors come from `lib/theme-colors.ts`. Same
deferred-init-via-ResizeObserver pattern as `EvalGraph`. A `useEffect` on `[data]` re-feeds the series
when the shared time-class toggle changes.

## AccuracyTrendChart

File: `client/src/components/AccuracyTrendChart.tsx`

Mirror of `EloTrendChart` for **Stats > Trends**. Green stroke (`CHART.good` from `lib/theme-colors.ts`),
Y pinned to `[0, 100]` for cross-time-class comparability, "Accuracy %" axis label. Data from
`fetchAccuracyTrend(username, timeClass)` → `/api/stats/:username/accuracy-trend`.
