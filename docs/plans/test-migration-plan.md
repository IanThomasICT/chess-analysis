# Test Migration Plan — UI/UX Redesign

Plan for bringing the test suite in line with the redesign (single dark theme, top-navbar app shell,
no-scroll Analysis with a tabbed rail, consolidated Stats sections, emoji→lucide). See `docs/project/ui-ux.md`.

**Scope:** only the **e2e** suite (`e2e/`) couples to UI markup. The unit suite (`tests/`) is pure logic
and needs **no changes** (verified — see §Unit). The edits in §2 are already applied; they remain
**unverified against a running app** because e2e needs both dev servers up. §4 is the run/verify gate.

---

## 1. Inventory & status

| File | UI-coupled? | Status | Notes |
|---|---|---|---|
| `tests/*.test.ts` (all) | No | ✅ no change | Pure logic; `eval-logic.test.ts` replicates EvalBar math (unchanged). |
| `e2e/fixtures.ts`, `e2e/seed.ts`, `e2e/setup.ts` | No | ✅ no change | DB seeding + Playwright harness; no UI assertions. |
| `e2e/smoke.test.ts` | Yes | ✏️ edited (verify) | Title via brand link; Stats buttons → section nav. |
| `e2e/home.test.ts` | Yes | ✏️ edited (verify) | Title, Load button, filters select→SegmentedControl groups. |
| `e2e/analysis.test.ts` | Yes | ✏️ edited (verify) | Active-move class `bg-blue`→`bg-accent`. |
| `e2e/metrics.test.ts` | Yes | ✏️ edited (verify) | MetricsCard behind Report tab; Stats tabs→sections. |

---

## 2. Changes applied (per file)

### `e2e/smoke.test.ts`
- **App title:** old assert `h1.textContent === "Chess Analyzer"`. Home no longer has that `h1` (brand is
  a navbar link). → assert the brand link: `getByRole("link", { name: /Chess Analyzer/ }).first()`.
- **Stats page:** old waited for buttons `"By Side"` / `"Accuracy Trend"` (gone). → wait for section tabs
  `"Overview"` / `"Trends"`.
- Unchanged: kidkasu game-load, analysis-from-card, Study reachability.

### `e2e/home.test.ts`
- **Title test:** same brand-link change as smoke.
- **Username controls:** button label `"Load Games"` → `"Load"` (navbar). `input[name="username"]` still
  exists (now in navbar) — unchanged.
- **Filters:** `<select>` dropdowns replaced by `SegmentedControl` groups. Each group has an accessible
  `label` → `role="group"`. New interaction pattern:
  `page.getByRole("group", { name: "Time class" }).getByRole("button", { name: "Blitz" }).click()`.
  Updated `resetFilters`, time-class, result (Wins/Draws), and combining-filters tests accordingly.
- Unchanged: card count via `a[href^="/analysis/"]`, player-name counts, `Win`/`Draw` chip counts,
  `"N games"` badge, search placeholder (`"Search by opponent..."` kept), no-games message.

### `e2e/analysis.test.ts`
- **Active move highlight:** assertion `class` contains `bg-blue` → `bg-accent` (MoveList active state is
  now `bg-accent/20`).
- Unchanged & deliberately preserved as stable handles: header `"white vs black"`, result/time-class
  text, `Back`→`/`, `cg-board`, SAN move buttons, `N / M` counter, nav glyphs `« ‹ › »`, eval-bar `.w-8`,
  move-number `"1."`/`"4."` (Alternatives moved out of the Moves tab, so `.first()` is now less ambiguous).

### `e2e/metrics.test.ts`
- **MetricsCard:** now lives in the Analysis rail's **Report** tab (was below the board). Added
  `openReport(page)` = click `getByRole("button", { name: "Report" })` at the start of each metrics-card
  test before asserting `Phase Accuracy` / `Position Quality` / `Conversion / Defense` / `Clean win` /
  phase rows.
- **Stats tabs → sections:** the 15 flat tabs are gone. Rewrite each assertion to open the owning section
  and check its panel:
  | Old tab | New location | Open with |
  |---|---|---|
  | Consistency, Performance/TPR | Overview (default) | none |
  | By Opponent, Leak Closure | Patterns | `openSection("Patterns")` |
  | ACL Trend | Trends | `openSection("Trends")` |
  | Repertoire | Openings | `openSection("Openings")` |
  - `expectNoError` should match the real fallback copy `"Error loading stats."` (the unified `Failed`
    component), not the old `"Error."`.

> NOTE: the §2 rewrites for `metrics.test.ts` Stats-section assertions and `expectNoError` text are the
> least-certain edits — confirm them against the running app in §4 and adjust selectors as needed.

---

## 3. Stable handles to preserve (don't break in future UI work)
These are the contract between the UI and e2e; change the test deliberately if you change the markup:
- Brand link text contains `Chess Analyzer`; `Back` link → `/`; `input[name="username"]` + `Load` button.
- Analysis: `N / M` counter, nav glyphs `« ‹ › »`, SAN move buttons, `cg-board`, eval-bar `.w-8`,
  active-move `bg-accent`-prefixed class.
- `SegmentedControl` exposes `role="group"` + accessible name (filter tests scope by it).
- Rail tabs are buttons named `Moves` / `Report` / `Engine` / `History`; Stats sections `Overview` /
  `Trends` / `Openings` / `Patterns`.

---

## 4. Execution / verification gate
Run in order; fix fallout before marking done.

1. **Unit (fast, should already pass):** `bun run test`
2. **Static:** `bun run validate` (typecheck + lint + build) — already green.
3. **Start servers:** `bun run dev` (Vite :5173 + Hono :3001) in one terminal.
4. **E2E:** `bun run test:e2e` (seeds DB, then runs `e2e/`). Or per file:
   `bun test --timeout 30000 e2e/smoke.test.ts` etc.
5. **Triage failures:**
   - Selector-not-found → confirm the new accessible name/role in the running UI, update the test.
   - Visibility timeouts on Analysis → check the no-scroll grid fits the Playwright viewport (1280×720);
     elements need to be in the DOM + sized (not necessarily scrolled into view).
   - `role="group"` filter clicks failing → verify the `label` prop is set on the Home `SegmentedControl`s.
6. **Manual smoke (optional but recommended):** load `?username=kidkasu`, open a game, click each rail tab,
   walk the four Stats sections; confirm no emoji remain (`grep -rn` the emoji set under `client/src`).

---

## 5. Risks / open items
- **Viewport fit** of the no-scroll Analysis layout under Playwright — most likely source of new flakes;
  if assertions on the eval graph / nav toolbar flake, assert presence in DOM rather than strict
  visibility, or set a larger viewport in `e2e/setup.ts`.
- **`metrics.test.ts` section selectors** (§2 NOTE) — highest chance of needing a tweak after the first run.
- No new tests were added for the **redesign-specific** surfaces (rail tab switching, KPI band, section
  nav). Optional follow-up: add a small `e2e/shell.test.ts` covering navbar navigation + username
  persistence, and a rail-tab-switch assertion on the Analysis page.

## 6. Unit suite (why untouched)
`tests/` replicates pure functions (eval mapping, classification thresholds, metrics formulas, route
handlers) and imports no React components or theme classes. The redesign changed presentation only — no
formula, threshold, endpoint, or data shape moved — so the unit suite stays valid as-is.
