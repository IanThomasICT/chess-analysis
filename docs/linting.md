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
import type { GameRow } from "../api";

// Wrong
import { type GameRow } from "../api";
```

Combined with `verbatimModuleSyntax: true` in both tsconfigs, `import type` is required for all type-only imports. The TypeScript compiler will error if a type-only import does not use the `import type` syntax.

### React Rules (client only)

Scoped to `client/src/**/*.{ts,tsx}` via two plugins:

**`eslint-plugin-react-hooks`** — the two non-negotiable hooks rules:

| Rule | Level | Purpose |
|---|---|---|
| `rules-of-hooks` | error | Hooks must not be called conditionally, in loops, or after early returns |
| `exhaustive-deps` | error | Every reactive value used inside a hook must appear in its dependency array |

**`@eslint-react/eslint-plugin`** — `recommended-type-checked` preset plus overrides:

| Category | Key rules (all error) |
|---|---|
| Leak detection | `no-leaked-event-listener`, `no-leaked-interval`, `no-leaked-timeout`, `no-leaked-resize-observer` |
| DOM safety | `no-dangerously-set-innerhtml`, `no-script-url`, `no-unsafe-iframe-sandbox`, `no-void-elements-with-children` |
| Component correctness | `no-nested-component-definitions`, `no-missing-key`, `no-leaked-conditional-rendering` |
| Naming conventions | `ref-name` (refs must end in `Ref`), `use-state` (`[val, setVal]`), `context-name` |
| React 19 deprecations | `no-forward-ref`, `no-context-provider`, `no-default-props` |
| Disabled | `rsc/function-definition` (not using server components) |

### Ignored Paths

- `build/**`
- `node_modules/**`
- `*.config.ts` (root config files)
- `e2e/**`

## TypeScript Configuration

Root file: `tsconfig.json` (project references to `client/` and `server/`)

### Client (`client/tsconfig.json`)

- `lib: ["DOM", "DOM.Iterable", "ES2022"]`
- `types: ["vite/client"]` — Vite's `import.meta.env` types
- `jsx: "react-jsx"`
- `paths: { "~/*": ["./src/*"] }` — path alias (defined but not used in practice)
- `verbatimModuleSyntax: true`
- `strict: true`

### Server (`server/tsconfig.json`)

- `lib: ["ES2022"]` — no DOM types
- `types: ["bun"]` — Bun globals (`Bun.spawn`, `bun:sqlite`, etc.)
- `verbatimModuleSyntax: true`
- `strict: true`

## Running Checks

```bash
# Lint only
bun run lint

# Full check (tsc -b + eslint)
bun run typecheck

# Build (also catches import resolution errors)
bun run build

# All three combined (run after every change)
bun run validate
```

## Common Patterns

### Bun-specific types

`Bun.spawn` with `stdin: "pipe"` returns a `FileSink` for stdin. The `write()` and `flush()` methods may return promises in the type definitions, so they must be prefixed with `void`:

```ts
void stdin.write(cmd + "\n");
void stdin.flush();
```

### SQLite result typing

Bun SQLite returns untyped results. All `.get()` and `.all()` calls use `as` assertions to named interfaces:

```ts
const game = db.prepare("SELECT * FROM games WHERE id = ?")
  .get(gameId) as GameRow | null;
```
