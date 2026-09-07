# UI / UX Design

Canonical record of the interface vision and the design decisions that express it.
Read this before touching anything under `client/src/` so new work stays coherent.

Related files: `client/src/app.css`, `client/src/main.tsx`, `client/src/lib/theme-colors.ts`,
`client/src/components/AppShell.tsx`, `client/src/components/SettingsModal.tsx`,
`client/src/components/MoveScrubber.tsx`, `client/src/components/GameReviewSummary.tsx`,
`client/src/context/Settings.tsx`,
`client/src/components/ui/*`, all `client/src/pages/*`.

---

## Vision

A focused, **lichess-grade analysis surface** for one improving player. The product exists to move
three metrics (win rate, accuracy/blunder rate, Elo — see `core.md`); the UI's only job is to make the
*evidence behind those metrics* readable in the fewest possible glances.

The essence in one line: **everything that matters is on screen at first glance — no scrolling to find
your mistakes, no tab-hunting to read your stats.**

Three feelings to preserve:
- **Familiar.** It should feel like a serious chess tool a player already trusts. We borrow the
  conventions of lichess/chess.com analysis (board left, eval bar, move list, eval graph) rather than
  inventing novel patterns. Recognition beats cleverness.
- **Calm and dense.** Dark, warm, low-chrome. Information-dense without feeling noisy — data is the
  decoration. Mono numerals make evals/ratings/accuracies scannable like a cockpit.
- **Improvement-first.** Every surface answers "what should I fix?" The blunder, the leaking opening,
  the phase you play worst should be reachable in one click, never buried.

---

## Design principles

1. **At-a-glance over drill-down.** Prefer showing many related numbers together (KPI bands, multi-panel
   dashboard sections) to one-metric-per-click navigation. Segmented toggles (all options visible) beat
   dropdowns.
2. **One viewport on the working surfaces.** The Analysis page never scrolls the page; the board, eval,
   moves, and the full per-game report all live inside `100vh - navbar`. Secondary detail moves into a
   tabbed rail, not below the fold.
3. **The board is sacred.** Chessground's brown board + cburnett pieces are unchanged. The theme is built
   *around* the board's warmth, never recolors it. Give the board the horizontal space it needs (top
   navbar, not a sidebar).
4. **One committed theme.** A single dark theme — no light mode, no `dark:` variants. Fewer decisions,
   more consistency, less code.
5. **Tokens, not literals.** All color comes from theme tokens (`bg-surface`, `text-blunder`, …). Charts
   read the same palette from `lib/theme-colors.ts`. No raw `bg-gray-800` / hex in components.
6. **Icons, not emoji.** Iconography is `lucide-react`. The only glyphs allowed are true chess characters
   (`♔ ♚ ● ○`) — they are typographic, monochrome, and on-theme.
7. **Reuse the vocabulary.** Compose pages from the shared primitives in `components/ui/` instead of
   re-deriving ad-hoc markup.

---

## Visual language

### Theme tokens (`app.css` `@theme`)
Warm-dark neutrals chosen to sit under a wooden board. Tailwind v4 generates `bg-*/text-*/border-*`
utilities from these; opacity tints (`bg-blunder/15`) make status chips.

| Token | Role |
|---|---|
| `canvas` | page background (deepest) |
| `surface` | cards, panels, navbar |
| `raised` | inset tiles, hover, chip backgrounds |
| `line` | borders / dividers |
| `fg` / `muted` / `faint` | text: primary / secondary / tertiary |
| `accent` (+ `accent-hover`, `on-accent`) | primary action, active state, eval line |
| `win`·`best`·`good` / `inaccuracy` / `mistake` / `blunder`·`loss` / `draw` | move-quality + result semantics |
| `info` / `swindle` | special chips (unlucky / swindle) |

### Color semantics (fixed meaning, do not repurpose)
- **Green = good** (win, best move, ≥90% accuracy, improvement).
- **Yellow = inaccuracy** (also "missed conversion", ~70–90% accuracy).
- **Orange = mistake.**
- **Red = blunder / loss** (also <70% accuracy, flagged on time).
- **Accent blue = neutral interactive** (active tab, primary button, current eval).

### Typography
- **Hanken Grotesk** — UI/body. Distinctive but quiet; not Inter/Roboto.
- **JetBrains Mono** — all data: evals, SAN, clocks, ratings, ACL, percentages, table figures.
  Numbers are tabular so columns align. Self-hosted via `@fontsource`, imported only in `main.tsx`.

### Iconography
`lucide-react`. Time classes map through `ui/TimeClassIcon` (bullet→Crosshair, blitz→Zap, rapid→Timer,
daily→CalendarDays, fallback→Dices). Blunders→AlertTriangle, time trouble→Clock, flagged→Flag.

---

## Layout system

### App shell (`AppShell.tsx`)
A persistent top navbar (`h-14`) over a routed `<Outlet/>` — the single source of navigation. Nav links
(`Games / Stats / Drill / Study`) carry the active `?username=` and show an active state. The right side is
a single **settings button** (shows the current username + a gear icon) that opens `SettingsModal` — there
is no inline username field or `Load` button. `SettingsProvider` (`context/Settings.tsx`) owns the active
username (`?username=` query param, mirrored to localStorage) plus client-only prefs (currently
`defaultTimeClass`, localStorage). Pages read all of it via one `useSettings()` hook
without prop-drilling. All routes are children of one layout route in `App.tsx`.

### Settings modal (`SettingsModal.tsx`)
Centered dialog (`role="dialog"`, aria-label `Settings`) opened from the navbar. Sets the Chess.com
username (`input[name="username"]`, applied on **Save**) and the default gallery time class. Closes on
Escape, backdrop click, or the close button.

### Page archetypes
- **Scrolling content pages** (Games, Stats, Drill, Study): `mx-auto max-w-7xl px-4 py-6`; body grows and
  the window scrolls.
- **Fixed working surface** (Analysis): `h-[calc(100vh-3.5rem)]` flex column, `overflow-hidden`; internal
  panels scroll, the page does not.

---

## Component vocabulary (`components/ui/`)

| Primitive | Purpose |
|---|---|
| `Card` | surface container with optional uppercase title + right-aligned `action` slot |
| `StatTile` | KPI: small label + large mono value (+ optional hint/tone) |
| `Chip` | tinted status pill, tone-driven (`win`/`blunder`/…), optional leading icon |
| `Tabs` | underline tab bar (controlled) — rail tabs and Stats sections |
| `SegmentedControl` | inline option group (all choices visible); `label` sets `role="group"` for a11y + tests |
| `TimeClassIcon` | emoji-free time-class glyph |

---

## Per-surface intent

- **Games (`Home`).** Opens with a KPI band (`StatsPanel` → record, win rate, accuracy, blunders/game,
  per-side) so the player's standing is the first thing seen. Compact segmented filters (time class /
  result / sort) — no free-text search; the time-class filter defaults to the saved `defaultTimeClass`
  preference until the user overrides it. Dense `GameCard` grid: result chip, time-class icon, accuracy
  mini-bar + mono %, and diagnostic chips (blunders, swindle, unlucky, time, flag). The grid is
  **lazy-rendered** — the latest 25 cards paint immediately and the rest stream in `PAGE_SIZE` at a time as
  an `IntersectionObserver` sentinel scrolls into view.
- **Analysis.** The flagship no-scroll surface. Left: eval bar + board (+ player rows). Under the board:
  slim eval-graph strip and a **move scrubber** (`MoveScrubber`) — a draggable timeline with red/orange
  ticks at your blunders/mistakes, framed by icon prev/next/first/last/flip controls (aria-labelled,
  disabled at the bounds) plus an `N / M` counter; below it the blunder/mistake/missed jump buttons.
  Right: a full-height rail that **always** shows, above the tabs, an accuracy strip (your/opponent %, with
  a clickable blunder chip that jumps to your next blunder) and `GameReviewSummary` (result quality, Elo
  swing, and the top-3 critical moves to review — each a button that jumps the board there). Tabs below:
  *Moves*, *Report* (the consolidated per-game `MetricsCard`), *Engine* (alternatives), *History*
  (recurrence). The headline "what should I fix?" is now visible without opening a tab.
- **Stats.** Consolidated from 15 flat tabs into **4 dashboard sections** — *Overview* (by-side,
  performance/TPR, consistency, drill, win-rate by time class), *Trends* (Elo/Accuracy/ACL with one shared
  time-class toggle), *Openings* (repertoire, by opening), *Patterns* (motifs, leak closure, by opponent,
  by rating, time-of-day). Each section shows several panels at once. The **Patterns** section is scoped to
  the **last 60 days** (`PATTERN_WINDOW_DAYS`) — passed as `from` to the motif/leak/vs-opponent/rating/
  time-of-day queries — so weaknesses reflect the player's current level, not games from a much lower Elo.
- **Drill.** Distraction-free: compact session header (score / card N of M), centered interactive board,
  tonal correct/incorrect feedback, next.
- **Study.** Sticky term TOC beside themed glossary cards; metric badges colored by token.

---

## Accessibility & test handles (do not break casually)
The e2e suite couples to stable, user-meaningful handles — preserve them or update tests deliberately:
- Move counter renders exact `N / M`; scrubber nav buttons expose aria-labels `First move` / `Previous
  move` / `Next move` / `Last move` / `Flip board` (disabled at the bounds); move list renders SAN buttons
  (match bare SAN with `exact: true` so the "Review these moves" buttons don't collide).
- Brand link contains "Chess Analyzer"; `Back` link → `/`. Username lives in the settings dialog: open via
  the `Open settings` button, then `input[name="username"]` + `Save` (inside `role="dialog"` "Settings").
- `SegmentedControl label` exposes `role="group"` with an accessible name (filter tests scope by it).
- Active move highlight uses an `bg-accent`-prefixed class.

---

## Conventions for new UI
- **Single theme:** never add `dark:` variants; use tokens.
- **Type imports are inline:** combine value + type from one module as
  `import { Foo, type Bar } from "..."` (the lint config flags separate `import type` lines from a module
  that is also value-imported — `no-duplicate-imports`). This supersedes the "separate type import line"
  phrasing elsewhere.
- **No nested ternaries** in JSX (lint-enforced): precompute a `body: ReactNode` with `if/else`.
- **Arrays of non-simple types** use `Array<T>`, not `T[]`.
- **React 19 context:** render `<Context value=…>` (not `.Provider`), read with `use()`, memo the value.
- Keep files small and feature-focused; lift shared bits into `components/ui/`.
