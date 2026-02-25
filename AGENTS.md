# Agent Rules

## After Every Change

After completing any set of code changes, always do both steps before considering work done:

1. **Verify** — run `bun run validate` (typecheck + lint + build) and resolve every error. Do not move on with warnings-as-errors or build failures outstanding.
2. **Update docs** — if the changes affect architecture, APIs, component contracts, linting rules, or conventions, update the relevant spec in `docs/` and keep `docs/README.md` in sync. If a discovery was made during the work (e.g. a new constraint, footgun, or pattern), document it in the appropriate spec or in `AGENTS.md` so the knowledge is not lost.

## Documentation

Read `docs/README.md` first. It indexes all specs with related files so you can jump to the right doc efficiently.

## Commands

```bash
bun run dev          # Start dev servers (Vite SPA on :5173 + Hono API on :3001)
bun run build        # Production build (Vite client)
bun run typecheck    # tsc -b + eslint (run this before committing)
bun run lint         # ESLint only
bun run validate     # typecheck + lint + build (run after every change)
bun run test         # Unit tests (bun:test, tests/ directory)
bun test tests/pgn.test.ts              # Run a single unit test file
bun run test:e2e     # Seed DB + run all e2e tests (requires dev servers running)
bun test --timeout 30000 e2e/smoke.test.ts  # Run a single e2e file
bun run test:all     # Unit tests + e2e tests
```

## Architecture

Split-stack: **Vite React SPA** (`client/`) + **Bun Hono API** (`server/`).

- `client/` — React 19 SPA with TanStack Query, react-router v7 (library mode, CSR), Tailwind CSS v4
- `server/` — Hono HTTP framework on Bun, SQLite database (`bun:sqlite`), Stockfish integration
- Dev mode: Vite on `:5173` proxies `/api/*` to Hono on `:3001`
- Production: Hono serves both built static SPA and API on a single port

### Key directories

- `client/src/pages/` — route-level page components (`Home.tsx`, `Analysis.tsx`)
- `client/src/components/` — reusable UI components (`ChessBoard`, `EvalBar`, `EvalGraph`, `MoveList`, `GameCard`)
- `client/src/api.ts` — typed fetch wrappers and shared interfaces (`GameRow`, `AnalysisRow`, etc.)
- `server/routes/` — Hono route handlers (`games.ts`, `analyze.ts`)
- `server/lib/` — database, Chess.com API, Stockfish subprocess, PGN parsing, rate limiting

## Code Style

### Strict Type Safety — No Exceptions

Zero `any` types enforced. ESLint uses `typescript-eslint` strict type-checked mode with all `no-unsafe-*` rules set to error.

- Never use `any`. Use `unknown` and narrow with type guards, or define a proper interface.
- Never use `as any`. Assert to a specific type if needed.
- Never use `// eslint-disable` to suppress type safety rules.
- Use `void` to explicitly discard promise return values (e.g. `void stdin.flush()`).

### Imports

- **Type imports**: `separate-type-imports` enforced. Always use `import type` on a separate line for type-only imports.
- **Relative paths**: All imports use relative paths. A `~/*` path alias exists in `client/tsconfig.json` but is not used.
- **CSS imports**: Centralized in `client/src/main.tsx` only. Do not import CSS elsewhere.
- `verbatimModuleSyntax: true` in both tsconfigs — `import type` is required for type-only imports.

### Boolean Expressions

`strict-boolean-expressions` is enabled. No truthy/falsy shortcuts on strings, numbers, or objects:

```ts
// WRONG
if (username) { ... }

// CORRECT
if (username !== null && username !== "") { ... }
```

### Naming Conventions

| Category | Convention | Examples |
|---|---|---|
| Components | PascalCase files, named exports | `ChessBoard.tsx`, `export const ChessBoard = memo(...)` |
| Pages | PascalCase files | `Home.tsx`, `Analysis.tsx` |
| Server libs/routes | camelCase files | `db.ts`, `chesscom.ts`, `games.ts` |
| Tests | kebab-case with `.test.ts` | `pgn.test.ts`, `eval-logic.test.ts` |
| Module constants | SCREAMING_SNAKE_CASE | `EMPTY_FENS`, `MAX_CONCURRENT_ANALYSES` |
| Functions | camelCase | `fetchGames`, `pgnToFens`, `analyzeGame` |
| Interfaces | PascalCase | `GameRow`, `AnalysisRow`, `ChessBoardProps` |
| Refs | Must end in `Ref` | `boardRef`, `apiRef`, `analysisStartedRef` |
| Unused vars | Prefix with `_` | `_unused` (ESLint allows `_`-prefixed) |

### React Patterns

- **Hooks before returns**: All hooks must appear before any `if (...) return` guard.
- **Exhaustive deps enforced**: Every reactive value in `useEffect`/`useMemo`/`useCallback` must be in the dependency array.
- **Stable fallback references**: Use module-level constants instead of inline `?? []` to avoid new references each render.
- **React.memo**: Components receiving stable props should be wrapped. Current memo'd components: `ChessBoard`, `EvalBar`, `EvalGraph`, `MoveList`.
- **useState naming**: Destructure as `[val, setVal]` (enforced by `@eslint-react`).

### Error Handling

- **Server**: Global `app.onError()` returns generic 500. SSE errors emit `"Analysis failed"` — never internal details.
- **Client**: `useQuery` provides `isPending`/`isError` states. API wrappers throw on non-OK responses.
- **Input validation**: Route parameters validated with regexes (`/^[a-zA-Z0-9_-]{1,50}$/`). Invalid input returns 400.
- **PGN parsing**: Wrapped in try/catch. Invalid PGN returns 500 with generic message.

## Database

- SQLite at `analysis.db` in project root (gitignored). Schema created on import in `server/lib/db.ts`.
- All query results use `as` assertions to typed interfaces — keep interfaces in sync with schema.
- The `analysis` table caches Stockfish results. Check `COUNT(*)` before spawning Stockfish to avoid re-analyzing.

## Stockfish

- Binary path: `STOCKFISH_PATH` env var → `$HOME/bin/stockfish-bin` → `$HOME/.local/bin/stockfish` → bare `"stockfish"` (PATH lookup).
- Uses `Bun.spawn` with `stdin: "pipe"` (returns `FileSink`, not `WritableStream`).
- All scores normalized to White's perspective (positive = White advantage).
- Max 2 concurrent analysis processes. Per-position timeout of 10 seconds.
- `sendCmd()` strips newlines from commands to prevent UCI injection.

## Chessground

- Use `@lichess-org/chessground` (v10 scoped package), not the old `chessground` package.
- Excluded from Vite's `optimizeDeps` in `client/vite.config.ts`.
- CSS imported in `client/src/main.tsx` — do not import elsewhere.

## uPlot

- Imperative canvas-based charting. One-time init in `useEffect`, then `setData()`/`redraw()` for updates.
- **Deferred init via ResizeObserver**: Chart created on first non-zero dimension callback, not inline in `useEffect`. Avoids 0x0 canvas with conditional rendering + StrictMode.
- Custom overlays (zero line, inflection dots, current-move indicator) drawn via the `draw` hook on canvas context.
- CSS imported in `client/src/main.tsx`.

## Move Indexing

Position index 0 = starting position (before any move). Move array index 0 = first move (White's first). `fens[i+1]` is the position after `moves[i]`.

## Testing

### Unit Tests (`tests/`)

Tests use `bun:test`. They replicate pure logic from components/services rather than importing React components directly, avoiding rendering and subprocess dependencies.

### E2E Tests (`e2e/`)

Use **Playwright-core** driven by **bun:test** (not the `@playwright/test` runner). Require both dev servers running (`bun run dev`).

- `e2e/fixtures.ts` seeds `analysis.db` with test games under username `e2e_fakeplayer` (must not exist on Chess.com).
- **Shared page pattern**: `usePage(path, opts?)` navigates once per `describe` block. Do not create a new page per test.
- Use `{ exact: true }` with `getByText` for ambiguous text matches ("Win" vs "Wins").

## Security

- **Rate limiting**: 60 req/min general, 5 req/min for `/api/analyze/*`
- **CORS**: Development only. Production is same-origin.
- **SSRF protection**: Archive URLs validated to start with `https://api.chess.com/`.
- **Security headers**: `hono/secure-headers` adds standard hardening headers.
