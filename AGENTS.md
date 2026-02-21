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

## E2E Tests

E2e tests live in `e2e/` and use **Playwright-core** driven by **bun:test** (not the `@playwright/test` runner).

### Commands

```bash
bun run test:e2e     # Seed DB + run all e2e tests (30s timeout)
bun test --timeout 30000 e2e/smoke.test.ts   # Run a single e2e file
```

E2e tests require **both dev servers running** (`bun run dev` — Vite on `:5173` + Hono on `:3001`). The Vite dev server proxies `/api/*` to the Hono API; if only Vite is running, all API calls return 500.

### Test Data

- `e2e/fixtures.ts` seeds `analysis.db` with 3 test games under username `e2e_fakeplayer`.
- `e2e/seed.ts` is the CLI entry point (`bun e2e/seed.ts`) — run before tests.
- **The seeded username must not exist on Chess.com.** The `/api/games` route always calls Chess.com before reading the DB cache. A real Chess.com username causes the API to return real games alongside seeded ones, breaking count assertions. A nonexistent username gets a fast 404 (~0.2s) and falls through to the DB.
- Use `{ exact: true }` with `getByText` when matching result badge text ("Win", "Draw") to avoid also matching `<option>` text ("Wins", "Draws").

### Shared Page Pattern (`usePage`)

`e2e/setup.ts` exports `setupPlaywright()` which returns a `usePage(path, opts?)` helper. Each `describe` block calls `usePage` to get a shared page that navigates once, then optionally resets between tests:

```ts
describe("move navigation", () => {
  const { getPage } = usePage("/analysis/e2e_game_1", {
    reset: async (page) => {
      await page.keyboard.press("Home");
      await page.getByText(/^0 \/ \d+$/).waitFor({ state: "visible" });
    },
  });

  test("forward button works", async () => {
    const page = getPage();
    // page is already on /analysis/e2e_game_1, reset to move 0
    await page.locator("button").filter({ hasText: "\u203A" }).click();
    await page.getByText("1 / 7").waitFor({ state: "visible" });
  });
});
```

- **Do not create a new page per test.** Full `page.goto()` costs ~500ms; a keyboard reset costs ~45ms.
- Read-only describes (no state mutation) can omit the `reset` option.
- If a single test within a describe needs a different URL, call `page.goto()` in that test body rather than splitting the describe (acceptable for the last test in a block).

### Game Route Data Flow

`GET /api/games?username=X` → calls Chess.com API first (fetch + upsert) → then queries `SELECT ... FROM games WHERE username = ?`. The Chess.com call is **not skippable** — it always runs before the DB read. Tests tolerate this because nonexistent usernames fail fast (404).
