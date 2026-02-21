# Routing

## Route Configuration

File: `app/routes.ts`

```ts
export default [
  index("routes/home.tsx"),
  route("analysis/:gameId", "routes/analysis.$gameId.tsx"),
  route("api/analyze/:gameId", "routes/api.analyze.$gameId.ts"),
] satisfies RouteConfig;
```

| URL Pattern | File | Purpose |
|---|---|---|
| `/` | `routes/home.tsx` | Game gallery (index route) |
| `/analysis/:gameId` | `routes/analysis.$gameId.tsx` | Analysis view |
| `/api/analyze/:gameId` | `routes/api.analyze.$gameId.ts` | SSE analysis stream |

## Route Type Generation

React Router v7 generates type-safe route types via `react-router typegen`. Generated files live in `.react-router/types/` (gitignored).

Each route file imports its generated types:

```ts
import type { Route } from "./+types/analysis.$gameId";
```

**Critical**: These must use `import type { ... }` (top-level type-only import), **not** `import { type ... }` (inline type import). The Vite/Rollup bundler cannot resolve the virtual `+types` module paths for non-type-only imports. The ESLint config enforces `separate-type-imports` style for this reason.

The `typecheck` script runs typegen before `tsc`:

```json
"typecheck": "react-router typegen && tsc && eslint app/"
```

## Loaders

### `home.tsx` loader (async)

- Reads `?username=` from search params
- Fetches games from Chess.com API (server-side)
- Upserts into SQLite
- Returns `{ games: GameRow[], username: string | null }`

### `analysis.$gameId.tsx` loader (sync)

- Looks up game by ID in SQLite
- Parses PGN -> FENs and moves
- Checks analysis cache
- Returns game metadata, FENs, moves, analysis, and analyzed flag

### `api.analyze.$gameId.ts` loader (sync, returns Response)

- Looks up game, parses PGN
- Returns a `ReadableStream` wrapped in a `Response` with SSE headers
- The stream iterates the `analyzeGame()` async generator internally

## React Router Config

File: `react-router.config.ts`

```ts
export default { ssr: true } satisfies Config;
```

SSR is enabled (default). The app uses `@react-router/serve` for the production server.

## Server vs Client Boundaries

Files with `.server.ts` suffix are server-only and never bundled into the client. This includes:
- `app/lib/db.server.ts` (Bun SQLite)
- `app/lib/chesscom.server.ts` (fetch calls)
- `app/lib/stockfish.server.ts` (subprocess)

Files without the `.server` suffix (`app/lib/pgn.ts`) can be used on both server and client, though in practice `chess.js` is only used in loaders.

Components in `app/components/` are client-side React components. They receive data from loaders via `useLoaderData`.
