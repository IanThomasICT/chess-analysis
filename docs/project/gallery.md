# Game Gallery

## Chess.com API Client

File: `server/lib/chesscom.ts`

All requests are server-side only to avoid CORS. The Chess.com Published Data API is fully public and requires no authentication.

### Functions

#### `fetchArchives(username: string): Promise<string[]>`

Fetches the list of monthly archive URLs for a player. Each URL points to a month of games (e.g. `https://api.chess.com/pub/player/hikaru/games/2026/02`).

#### `fetchMonthGames(archiveUrl: string): Promise<ChessComGame[]>`

Fetches all games for a specific monthly archive.

#### `fetchRecentGames(username: string, months?: number): Promise<ChessComGame[]>`

Convenience function: fetches the last N months (default 3) of archives, combines all games, and sorts by `end_time` descending (most recent first).

### `ChessComGame` Interface

```ts
interface ChessComGame {
  url: string;
  pgn: string;
  time_control: string;
  time_class: string;    // "bullet" | "blitz" | "rapid" | "daily"
  end_time: number;      // Unix timestamp
  rated: boolean;
  rules: string;
  white: { username: string; rating: number; result: string };
  black: { username: string; rating: number; result: string };
}
```

All requests include a `User-Agent: chess-analyzer/1.0` header as required by Chess.com's API policy.

### Bot exclusion (real-people only)

Bot/coach practice games (e.g. vs Coach-Levy) are detected by their PGN `[Event
"Play vs …"]` header (`pgn.ts` `isBotGame`) — the Chess.com profile API can't be
used, since its bots report `status: "basic"`. Such games are **skipped at import**
(never stored); existing ones were purged by migration #14. `games.vs_bot` is set
from the same header and the gallery/bulk-metrics queries exclude `vs_bot = 1` as
defense-in-depth. See `game_metrics.md` D35.

### Input Validation

The `username` query parameter is validated against `/^[a-zA-Z0-9_-]{1,50}$/` in the route handler (`server/routes/games.ts`) before being passed to any API or DB call. Invalid usernames return 400.

### SSRF Protection

`fetchMonthGames()` validates that archive URLs start with `https://api.chess.com/` before fetching, preventing the server from being redirected to arbitrary endpoints.

### Result Mapping

Chess.com uses result strings like `"win"`, `"resigned"`, `"timeout"`, etc. The server normalizes these to standard notation:
- White's `result === "win"` -> `"1-0"`
- Black's `result === "win"` -> `"0-1"`
- Otherwise -> `"1/2-1/2"`

## Home Page

File: `client/src/pages/Home.tsx`

### Data Loading

The page uses TanStack Query (`useQuery`) to fetch games via `fetchGames(username)` from `client/src/api.ts`. The server handler:
1. Reads `?username=` from the URL query params
2. **Cache-first refresh.** Counts cached (non-bot) games for the user. If **zero** (first import), it `await`s a Chess.com sync before responding; otherwise it kicks the sync off in the **background** (`void syncFromChessCom`) and returns the DB cache immediately. This is the critical path for the gallery — awaiting the 6-month archive pull on every load (the old behavior) blocked the response ~10–12s, so the gallery sat on "Loading games…" each visit. An `inFlightSync` guard skips a sync already running for that user.
3. `syncFromChessCom` fetches the last 6 months from Chess.com (`FETCH_MONTHS`) and upserts into the `games` table (`INSERT OR REPLACE`) — each row populated via the exported `buildGameRow(username, ChessComGame)` helper, which extracts WhiteElo / BlackElo / ECO / Opening from PGN headers (falling back to `classifyOpening(pgnToMoves(pgn))` when headers are absent). Bot/coach games are skipped. Network failures are logged, not thrown.
4. Loads all non-bot games for the username from the DB, sorted by `end_time DESC`, and returns them. Newly synced games surface on the next load.

The game ID is extracted from the Chess.com game URL: `g.url.split("/").pop()`.

A second `useQuery` calls `fetchBulkMetrics(username)` against `/api/games/metrics` to prefetch accuracy + blunder counts for every game in one round-trip. The result is a `Record<gameId, GameMetrics | null>` and feeds the card chips below. Up to 20 cache misses are computed on the fly per call; beyond that, lazy per-card.

### Username persistence

The active username now lives in the shared `SettingsProvider` (`client/src/context/Settings.tsx`),
rendered by `AppShell`. It mirrors the `?username=` query param to `localStorage`
(`"chess-analyzer-username"`) and, on a cold load with no param, restores the cached value via
`setSearchParams({ replace: true })`. The username is set through the **settings dialog** (gear button in
the navbar, see `SettingsModal.tsx`) — there is no inline input or `Load` button. Pages read the value with
`useSettings()`. (Home no longer owns this logic.)

### Client Filters + Sort

The gallery supports two client-side filters and a sort mode (no server round-trip, no free-text search).
Filters are `SegmentedControl` pill-groups (all options visible at a glance — see [ui-ux.md](ui-ux.md)),
not dropdowns; each group carries an accessible `label` (`role="group"`).

| Control | Type | Options |
|---|---|---|
| Time class | SegmentedControl (`label="Time class"`) | All, Bullet, Blitz, Rapid, Daily (defaults to the `defaultTimeClass` setting) |
| Result | SegmentedControl (`label="Result"`) | All, Wins, Losses, Draws |
| Sort | SegmentedControl (`label="Sort"`) | Recent (default), Worst, Best |

Result filtering is relative to the queried username (e.g. "Wins" means games where that user won). Worst/Best sort by the user-side accuracy from `metricsMap`; games with no metrics sort to the end regardless of mode.

A count badge shows the number of filtered results.

### Lazy rendering

All matching games are fetched once (server cache) but the `GameCard` grid renders incrementally: the first
`PAGE_SIZE` (25) cards paint immediately, and an `IntersectionObserver` sentinel below the grid grows the
window by `PAGE_SIZE` each time it nears the viewport. The window resets to 25 whenever the filter/sort/
username changes.

### KPI band (StatsPanel)

`<StatsPanel username={username} />` renders atop the gallery. It calls `/api/stats/:username/by-side`
and renders a row of `StatTile`s — overall Record (W-D-L), Win rate, Accuracy, Blunders/game, plus
per-side As White / As Black (win% + accuracy). Overall figures are games-weighted across the two
sides. Returns `null` while loading or when both sides are empty (no layout flicker).

## GameCard Component

File: `client/src/components/GameCard.tsx`

Each card is a `<Link>` to `/analysis/:gameId` and displays (emoji-free — lucide icons + theme tokens):
- Result `Chip` (Win/Loss/Draw), tone-colored win/loss/draw
- Time class via `TimeClassIcon` + label
- White / black player names (♔ / ♚ glyphs)
- Accuracy mini-bar + mono % (green ≥90 / amber 70–89 / red <70) when bulk metrics are loaded
- Status chips: blunders (`AlertTriangle`, red ≥3 / orange 1–2), Swindle, Unlucky, time trouble (`Clock`), lost-on-time (`Flag`)
- Date + final clocks (mono)

The accuracy + blunder values are the user's side (white if user played white, else black). `resultInfo` determines win/loss relative to the queried username.
