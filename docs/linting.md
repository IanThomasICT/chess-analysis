# Linting & Type Safety

## ESLint Configuration

File: `eslint.config.ts`

The project uses ESLint v10 with `typescript-eslint` in **strict type-checked** mode. The config extends:
- `eslint.configs.recommended`
- `tseslint.configs.strictTypeChecked`

### Zero `any` Policy

The following rules are all set to `"error"`:

| Rule | Purpose |
|---|---|
| `no-explicit-any` | No `any` type annotations |
| `no-unsafe-argument` | No passing `any` to typed parameters |
| `no-unsafe-assignment` | No assigning `any` to typed variables |
| `no-unsafe-call` | No calling `any` as a function |
| `no-unsafe-member-access` | No accessing properties on `any` |
| `no-unsafe-return` | No returning `any` from typed functions |

### Additional Strict Rules

| Rule | Config |
|---|---|
| `strict-boolean-expressions` | `"error"` -- no truthy/falsy shortcuts on non-booleans |
| `no-non-null-assertion` | `"error"` -- no `!` postfix |
| `switch-exhaustiveness-check` | `"error"` |
| `consistent-type-imports` | `separate-type-imports` (see below) |
| `no-confusing-void-expression` | `ignoreArrowShorthand: true` |
| `no-unused-vars` | Allows `_`-prefixed names |

### Type Import Style

The `consistent-type-imports` rule enforces `separate-type-imports`:

```ts
// Correct
import type { Route } from "./+types/home";

// Wrong (breaks Vite build for virtual +types modules)
import { type Route } from "./+types/home";
```

This is required because Rollup does not elide `import { type X }` statements during bundling, but does elide `import type { X }`. The React Router `+types` virtual modules only exist during type-checking and cannot be resolved at build time.

### Ignored Paths

- `build/**`
- `.react-router/**`
- `node_modules/**`
- `*.config.ts` (root config files)

## TypeScript Configuration

File: `tsconfig.json`

Key settings:
- `strict: true`
- `types: ["bun", "vite/client"]` -- Bun globals + Vite's `import.meta.env`
- `verbatimModuleSyntax: true` -- type-only imports are required to use `import type`
- `skipLibCheck: true` -- avoids errors in third-party `.d.ts` files
- `rootDirs: [".", "./.react-router/types"]` -- merges generated route types

## Running Checks

```bash
# Lint only
bun run lint

# Full check (typegen + tsc + eslint)
bun run typecheck

# Build (also catches import resolution errors)
bun run build
```

## Common Patterns

### Bun-specific types

`Bun.spawn` with `stdin: "pipe"` returns a `FileSink` for stdin. The `write()` and `flush()` methods may return promises in the type definitions, so they must be prefixed with `void`:

```ts
void stdin.write(cmd + "\n");
void stdin.flush();
```

### Recharts type workarounds

Recharts' `Tooltip` formatter expects `number | undefined`, and `labelFormatter` expects `React.ReactNode`. The typed wrappers handle these:

```ts
formatter={(value: number | undefined) => { ... }}
labelFormatter={(label: React.ReactNode) => { ... }}
```

The chart `onClick` uses a local `ChartClickEvent` interface cast to `(data: unknown) => void`.

### SQLite result typing

Bun SQLite returns untyped results. All `.get()` and `.all()` calls use `as` assertions to named interfaces:

```ts
const game = db.prepare("SELECT * FROM games WHERE id = ?")
  .get(gameId) as GameRow | null;
```
