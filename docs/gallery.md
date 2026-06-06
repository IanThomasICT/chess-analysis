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
2. Fetches the last 6 months from Chess.com (`FETCH_MONTHS` in `server/routes/games.ts`)
3. Upserts all games into the `games` table (using `INSERT OR REPLACE`) — each row populated via the exported `buildGameRow(username, ChessComGame)` helper, which extracts WhiteElo / BlackElo / ECO / Opening from PGN headers (falling back to `classifyOpening(pgnToMoves(pgn))` when headers are absent)
4. If the Chess.com fetch fails, falls through to load from the DB cache
5. Returns all games for the username, sorted by `end_time DESC`

The game ID is extracted from the Chess.com game URL: `g.url.split("/").pop()`.

A second `useQuery` calls `fetchBulkMetrics(username)` against `/api/games/metrics` to prefetch accuracy + blunder counts for every game in one round-trip. The result is a `Record<gameId, GameMetrics | null>` and feeds the card chips below. Up to 20 cache misses are computed on the fly per call; beyond that, lazy per-card.

### Username persistence

The username param is mirrored to `localStorage` under `USERNAME_STORAGE_KEY` ("chess-analyzer-username"). On a cold load with no `?username=`, the stored value is restored via `setSearchParams({ replace: true })`.

### Client Filters + Sort

The gallery supports three client-side filters and a sort mode (no server round-trip):

| Control | Type | Options |
|---|---|---|
| Text search | Free text input | Matches against white/black usernames |
| Time class | Select dropdown | All, Bullet, Blitz, Rapid, Daily |
| Result | Select dropdown | All, Wins, Losses, Draws |
| Sort | Three buttons | Recent (default), Worst first, Best first |

Result filtering is relative to the queried username (e.g. "Wins" means games where that user won). Worst/Best-first sort by the user-side accuracy from `metricsMap`; games with no metrics sort to the end regardless of mode.

A count badge shows the number of filtered results.

### StatsPanel banner

`<StatsPanel username={username} />` renders above the filter bar. It calls `/api/stats/:username/by-side` and shows a two-card "As White" / "As Black" breakdown (W-D-L, win rate, avg accuracy, blunders/game). The panel returns `null` when stats are still loading or both sides are empty, so the gallery layout doesn't flicker.

## GameCard Component

File: `client/src/components/GameCard.tsx`

Each card is a `<Link>` to `/analysis/:gameId` and displays:
- Result badge (Win/Loss/Draw) color-coded green/red/gray
- Time class with icon
- White and black player names
- Date (formatted as "Mon DD, YYYY")
- Optional `accuracy` chip (green ≥90 / amber 70–89 / red <70) when bulk metrics are loaded
- Optional `blunders` chip (red ≥3 / amber 1–2 / hidden at 0)

The accuracy + blunder values are the user's side (white if user played white, else black). The `ResultBadge` sub-component determines win/loss relative to the queried username.
