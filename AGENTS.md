# Agent Rules

## Documentation

Read `docs/README.md` first. It indexes all specs with related files so you can jump to the right doc efficiently.

## Commands

```bash
bun run dev          # Start dev servers (Vite SPA + Hono API)
bun run build        # Production build (Vite client)
bun run typecheck    # tsc -b + eslint (run this before committing)
bun run lint         # ESLint only
```

Always run `bun run typecheck` before considering work done. It runs TypeScript project-references build followed by ESLint.

## Architecture

Split-stack: **Vite React SPA** (`client/`) + **Bun Hono API** (`server/`).

- `client/` — React SPA with TanStack Query, react-router (library mode), Tailwind CSS
- `server/` — Hono HTTP framework on Bun, SQLite database, Stockfish integration
- Dev mode: Vite on `:5173` proxies `/api/*` to Hono on `:3001`
- Production: Hono serves both built static SPA and API on a single port

## Strict Type Safety — No Exceptions

This codebase enforces **zero `any` types**. The ESLint config (`eslint.config.ts`) uses `typescript-eslint` strict type-checked mode with all `no-unsafe-*` rules set to error.

- Never use `any`. Use `unknown` and narrow with type guards, or define a proper interface.
- Never use `as any`. If you need a type assertion, assert to a specific type.
- Never use `// eslint-disable` to suppress type safety rules.
- Use `void` to explicitly discard promise return values when the result is intentionally unused (e.g. `void stdin.flush()`).

## Type Import Style

`separate-type-imports` is enforced by ESLint. Use `import type` for type-only imports.

## Boolean Expressions

`strict-boolean-expressions` is enabled. Do not use truthy/falsy shortcuts on strings, numbers, or objects:

```ts
// WRONG
if (username) { ... }
if (data.error) { ... }

// CORRECT
if (username !== null && username !== "") { ... }
if (data.error !== undefined) { ... }
```

## Server Code

All server-only code lives in `server/`. Database access (`bun:sqlite`), Chess.com API calls, and Stockfish subprocess code are in `server/lib/`. API routes are in `server/routes/`.

## Database

- SQLite database is at `analysis.db` in the project root (gitignored).
- Schema is created on import in `server/lib/db.ts`.
- All query results use `as` assertions to typed interfaces — keep these interfaces in sync with the schema.
- The analysis table caches Stockfish results. Before spawning Stockfish, check `COUNT(*)` to avoid re-analyzing.

## Stockfish

- Binary path: `STOCKFISH_PATH` env var, or `$HOME/.local/bin/stockfish`, or `/usr/local/bin/stockfish`.
- Stockfish must be installed separately — it is not bundled with the project.
- The service uses `Bun.spawn` with `stdin: "pipe"` (returns `FileSink`, not `WritableStream`).
- All scores are from White's perspective (positive = White advantage).

## Chessground

- Use `@lichess-org/chessground` (v10 scoped package), not the old `chessground` package.
- Must be excluded from Vite's `optimizeDeps` in `client/vite.config.ts`.
- The `Key` type comes from `@lichess-org/chessground/types`.
- Board CSS is imported in `client/src/main.tsx` — do not import it elsewhere.

## Recharts Type Workarounds

Recharts' generic types are loose. When working with `Tooltip` or chart event handlers:
- `formatter` receives `number | undefined`, not `number`
- `labelFormatter` receives `React.ReactNode`, not `string`
- Chart `onClick` has no useful generic — define a local typed interface and cast at the boundary

## Move Indexing

Position index 0 = starting position (before any move). Move array index 0 = first move (White's first). `fens[i+1]` is the position after `moves[i]`.
