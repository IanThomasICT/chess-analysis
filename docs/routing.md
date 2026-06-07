# Routing

## Client-Side Routing

Files: `client/src/main.tsx` (router + providers), `client/src/App.tsx` (route table).

The app uses **react-router v7 in library mode** (CSR, not framework mode). `main.tsx` wraps `<App />` in `<BrowserRouter>` alongside `<QueryClientProvider>` and `<StrictMode>`. `App.tsx` contains only the route table — `<Routes>` + `<Route>` elements, no router component. All page routes are **children of a single layout route** that renders `<AppShell/>` (persistent top navbar + `UsernameProvider` + `<Outlet/>`):

```tsx
<Route element={<AppShell />}>
  <Route path="/" element={<Home />} /> … </Route>
```

| URL Pattern | Component | Purpose |
|---|---|---|
| `/` | `Home` | Game gallery (index route) |
| `/analysis/:gameId` | `Analysis` | No-scroll analysis view (deep MultiPV=3 by default) |
| `/stats` | `Stats` | Dashboard sections (`?username=…`) |
| `/drill` | `Drill` | Spaced-repetition drill mode (`?username=…`) |
| `/study` | `Study` | In-app glossary |

Navigation between pages and the active `?username=` are owned by the navbar (see
[ui-ux.md](ui-ux.md)); pages read the username via `useUsername()`. There is no server-side rendering —
the Vite SPA handles all routing client-side.

## API Routes (Server)

Files: `server/routes/{games,analyze,stats,positions,drill}.ts`. All routers mounted on `/api`.

| Endpoint | Handler | Purpose |
|---|---|---|
| `GET /api/games?username=X` | `games.ts` | Fetch + cache games from Chess.com |
| `GET /api/games/metrics?username=X` | `games.ts` | Bulk per-game metrics (registered **before** `/games/:gameId` to avoid Hono capturing the literal `metrics` as a `:gameId`) |
| `GET /api/games/:gameId` | `games.ts` | Load single game with FENs, moves, analysis, motifs |
| `GET /api/games/:gameId/metrics` | `games.ts` | Per-game accuracy / blunder metrics (lazy compute + cache) |
| `GET /api/games/:gameId/alternatives/:moveIndex` | `games.ts` | Top-3 engine lines for a single position (MultiPV ranks) |
| `GET /api/analyze/:gameId?multipv=` | `analyze.ts` | SSE Stockfish analysis stream; `multipv=3` is the default the UI sends |
| `GET /api/positions/history?fen=&username=` | `positions.ts` | Position recurrence by `fen_key` (transposition-friendly) |
| `GET /api/stats/:user/by-side` | `stats.ts` | White vs Black breakdown |
| `GET /api/stats/:user/win-rate?slice=&from=&to=` | `stats.ts` | Win-rate slice (color / time_class / rating_bucket / opening) |
| `GET /api/stats/:user/elo-trend?time_class=` | `stats.ts` | Elo time series |
| `GET /api/stats/:user/accuracy-trend?time_class=` | `stats.ts` | Accuracy time series |
| `GET /api/stats/:user/by-time-of-day` | `stats.ts` | 7×24 heatmap (uses `USER_TZ`) |
| `GET /api/stats/:user/motifs?from=&to=` | `stats.ts` | Recurring motif counts (user-side only) |
| `GET /api/stats/:user/drill-progress` | `stats.ts` | Total attempts, accuracy %, due-today, streak |
| `GET /api/drill/queue?username=&limit=` | `drill.ts` | FSRS drill queue (due + new positions) |
| `POST /api/drill/attempt` | `drill.ts` | Record an attempt; FSRS schedules next due |

## Data Loading

The client uses **TanStack Query** (`useQuery`) for data fetching, not React Router loaders.

### Home page (`Home.tsx`)

- `useQuery` calls `fetchGames(username)` from `client/src/api.ts`
- The API handler fetches from Chess.com first (fetch + upsert), then queries the DB
- Returns `{ games: GameRow[], username: string | null }`

### Analysis page (`Analysis.tsx`)

- `useQuery` calls `fetchGame(gameId)` from `client/src/api.ts`
- The API handler loads the game from SQLite, parses PGN → FENs and moves, checks analysis cache
- Returns `{ game, fens, moves, analysis, analyzed }`
- When `analyzed === false`, a `useEffect` automatically opens an SSE `EventSource` to stream analysis results

### SSE analysis stream (`analyze.ts`)

- Returns `Content-Type: text/event-stream`
- Iterates the `analyzeGame()` async generator, sending per-position results
- Completion: `{ done: true }`, Error: `{ error: "Analysis failed" }`

## Dev Proxy

In development, Vite on `:5173` proxies `/api/*` requests to the Hono server on `:3001` (configured in `client/vite.config.ts`). Both servers must be running for the app to work (`bun run dev` starts both via `concurrently`).

## Production

In production, Hono serves the built SPA from `build/client/` as static files alongside the API on a single port. The SPA's `index.html` is served as a fallback for all non-API routes to support client-side routing.
