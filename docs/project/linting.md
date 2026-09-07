# Linting & Type Safety

## ESLint Configuration

File: `eslint.config.ts`

The project uses ESLint v10 with `typescript-eslint` in **strict + stylistic type-checked** mode. The base config extends:

- `eslint.configs.recommended`
- `tseslint.configs.strictTypeChecked`
- `tseslint.configs.stylisticTypeChecked`

`reportUnusedDisableDirectives: "error"` is set at the linter-options level — stale `eslint-disable` comments are themselves errors.

### Zero `any` / zero unsafe

All set to `"error"`:

| Rule | Purpose |
|---|---|
| `no-explicit-any` | No `any` type annotations |
| `no-unsafe-argument` | No passing `any` to typed parameters |
| `no-unsafe-assignment` | No assigning `any` to typed variables |
| `no-unsafe-call` | No calling `any` as a function |
| `no-unsafe-member-access` | No accessing properties on `any` |
| `no-unsafe-return` | No returning `any` |
| `no-unsafe-unary-minus` | No `-x` on `any`/unknown |
| `no-non-null-assertion` | No `!` postfix |
| `strict-boolean-expressions` | No truthy/falsy shortcuts on non-booleans |
| `switch-exhaustiveness-check` | With `considerDefaultExhaustiveForUnions: true` |
| `use-unknown-in-catch-callback-variable` | `catch (e: unknown)` |

### Promise hygiene

Catches fire-and-forget bugs in async flows (SSE, fetch, Stockfish, DB):

| Rule | Purpose |
|---|---|
| `no-floating-promises` | All promises must be awaited or explicitly voided |
| `no-misused-promises` | `checksVoidReturn: { attributes: false }` (allow async event handlers in JSX) |
| `promise-function-async` | Functions returning a Promise must be `async` |
| `await-thenable` | No `await` on non-Promise values |
| `require-await` | No `async` without `await` |
| `no-promise-executor-return` | No returning from `new Promise(...)` executor |
| `prefer-promise-reject-errors` | `Promise.reject` must take an Error |
| `only-throw-error` | `throw` must take an Error |

### Dead-code / redundancy

| Rule |
|---|
| `no-unnecessary-condition` |
| `no-unnecessary-type-arguments` |
| `no-unnecessary-type-assertion` |
| `no-unnecessary-boolean-literal-compare` |
| `no-unnecessary-template-expression` |
| `no-redundant-type-constituents` |
| `no-useless-empty-export` |
| `no-meaningless-void-operator` |
| `no-confusing-non-null-assertion` |
| `no-duplicate-enum-values` |
| `no-mixed-enums` |

### Type style

| Rule | Config |
|---|---|
| `consistent-type-imports` | `separate-type-imports` (see below) |
| `consistent-type-exports` | Required |
| `no-import-type-side-effects` | Required |
| `array-type` | `array-simple` (`T[]` for simple types, `Array<T>` for complex) |
| `consistent-indexed-object-style` | `record` (prefer `Record<K, V>` over index signatures) |
| `method-signature-style` | `property` (functions, not method shorthand) |
| `prefer-nullish-coalescing` | Prefer `??` over `\|\|` for null/undefined |
| `prefer-optional-chain` | Prefer `?.` over `&&` chains |
| `prefer-reduce-type-parameter` | Type the reducer initial value via generic |
| `prefer-find` | Prefer `find` over `filter(...)[0]` |
| `prefer-includes` | Prefer `includes` over `indexOf >= 0` |
| `prefer-string-starts-ends-with` | Prefer over regex |
| `restrict-template-expressions` | Only `number` and `string` in template literals |
| `unbound-method` | No accidentally-unbound `this` references |
| `prefer-readonly` | Class fields not reassigned outside ctor → `readonly` |

### Type import style

```ts
// Correct
import type { GameRow } from "../api";
// or inline:
import { fetchGame, type GameRow } from "../api";

// Wrong (consistent-type-imports + verbatimModuleSyntax)
import { GameRow } from "../api";
```

### Core ESLint hardening

| Rule | Config |
|---|---|
| `no-console` | `error`, `allow: ["warn", "error", "info"]` (off in `server/`) |
| `eqeqeq` | `always`, `null: ignore` |
| `curly` | `all` (always brace single-statement bodies) |
| `no-implicit-coercion` | Prevents `+x` / `!!x` / `'' + x` idioms |
| `no-param-reassign` | `props: true` — no mutation of params or their fields |
| `prefer-const`, `prefer-template`, `no-var`, `object-shorthand` | Standard modernizations |
| `no-duplicate-imports`, `no-useless-rename`, `no-useless-concat` | Cleanup |
| `no-nested-ternary`, `no-unneeded-ternary` | Extract to helpers instead |

### React rules (client only)

Scoped to `client/src/**/*.{ts,tsx}`.

**`eslint-plugin-react-hooks`** — non-negotiable:

| Rule | Level |
|---|---|
| `rules-of-hooks` | error |
| `exhaustive-deps` | error |

**`@eslint-react/eslint-plugin`** — `strict-type-checked` preset plus explicit upgrades:

| Category | Rules |
|---|---|
| Leak detection | `no-leaked-event-listener`, `no-leaked-interval`, `no-leaked-timeout`, `no-leaked-resize-observer` |
| DOM safety | `no-dangerously-set-innerhtml`, `no-script-url`, `no-unsafe-iframe-sandbox`, `no-missing-button-type`, `no-missing-iframe-sandbox` |
| Render correctness | `no-array-index-key`, `no-missing-key`, `no-unnecessary-key`, `jsx-key-before-spread`, `no-duplicate-key`, `no-implicit-key`, `no-nested-component-definitions`, `no-unstable-context-value`, `no-unstable-default-props`, `no-leaked-conditional-rendering` |
| Style | `jsx-shorthand-fragment`, `jsx-shorthand-boolean`, `no-useless-fragment` |
| Modern React (block deprecated APIs) | `no-class-component`, `no-create-ref`, `no-default-props`, `no-context-provider`, `no-forward-ref` |
| Hook hygiene | `no-unnecessary-use-callback`, `no-unnecessary-use-memo`, `no-unnecessary-use-prefix`, `prefer-use-state-lazy-initialization` |
| Naming | `naming-convention/component-name`, `naming-convention/use-state` |
| Disabled | `rsc/function-definition` (client SPA), `hooks-extra/no-direct-set-state-in-use-effect` (false positives on seed/init patterns) |

### Scope overrides

- `server/**/*.ts` — `no-console: off` (logging allowed)
- `tests/**/*.ts`, `e2e/**/*.ts` — `no-non-null-assertion`, `no-floating-promises`, `no-unsafe-{assignment,member-access,call}`, `no-console` all off

### Ignored paths

- `build/**`
- `node_modules/**`
- `*.config.ts` (root config files)

## TypeScript Configuration

Root: `tsconfig.json` (project references to `client/`, `server/`).

Test files live in `tests/` and `e2e/`, each with a thin `tsconfig.json` that extends `server/tsconfig.json` (composite off, rootDir parent). This is required so typescript-eslint's `projectService` can resolve them.

### Client (`client/tsconfig.json`)

- `lib: ["DOM", "DOM.Iterable", "ES2022"]`
- `types: ["vite/client"]` — Vite's `import.meta.env` types
- `jsx: "react-jsx"`
- `paths: { "~/*": ["./src/*"] }` — defined, not used in practice
- `verbatimModuleSyntax: true`
- `strict: true`
- `composite: true`

### Server (`server/tsconfig.json`)

- `lib: ["ES2022"]` — no DOM types
- `types: ["bun"]` — Bun globals (`Bun.spawn`, `bun:sqlite`)
- `verbatimModuleSyntax: true`
- `strict: true`
- `composite: true`

## Caching & Performance

| Tool | Cache | Location |
|---|---|---|
| ESLint | `--cache --cache-strategy content` | `node_modules/.cache/eslint/` |
| TypeScript | `composite: true` → incremental build info | `*.tsbuildinfo` (gitignored) |
| Vite | Dep pre-bundling cache | `node_modules/.vite/` |

### Warm-cache targets (single-user dev machine)

| Step | Warm |
|---|---|
| `bun run lint` | < 1s |
| `bun run typecheck` | ~2.5s |
| `bun run build` | ~1.2s |
| `bun run validate` (all three) | ~2s |

If lint or build exceeds targets after a single-file edit, the cache directory was probably blown away (e.g. `rm -rf node_modules`). Re-run once to warm.

## Running Checks

```bash
bun run lint        # ESLint with cache
bun run lint:fix    # ESLint with cache + autofix
bun run typecheck   # tsc -b (incremental)
bun run build       # vite build
bun run validate    # typecheck + lint + build
```

## Common Patterns

### Bun-specific types

`Bun.spawn` with `stdin: "pipe"` returns a `FileSink`. `write()` and `flush()` are promise-typed, so prefix with `void`:

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

### Disabling rules

Prefer fixing the underlying issue. If a rule fires on a legitimate pattern, use `// eslint-disable-next-line <rule>` with a comment explaining why — `reportUnusedDisableDirectives` will fail the build if the directive becomes stale.
