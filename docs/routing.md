# Routing

## Client-Side Routing

File: `client/src/App.tsx`

The app uses **react-router v7 in library mode** (CSR, not framework mode). Routes are defined with JSX `<Route>` elements inside a `<BrowserRouter>`:

| URL Pattern | Component | Purpose |
|---|---|---|
| `/` | `Home` | Game gallery (index route) |
| `/analysis/:gameId` | `Analysis` | Analysis view |

There is no server-side rendering. The Vite SPA handles all routing client-side.

## API Routes (Server)

File: `server/routes/games.ts`, `server/routes/analyze.ts`

API routes are registered as Hono sub-routers mounted on `/api`:

| Endpoint | Handler | Purpose |
|---|---|---|
| `GET /api/games?username=X` | `games.ts` | Fetch + cache games from Chess.com |
| `GET /api/games/:gameId` | `games.ts` | Load single game with FENs, moves, analysis |
| `GET /api/analyze/:gameId` | `analyze.ts` | SSE Stockfish analysis stream |

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
