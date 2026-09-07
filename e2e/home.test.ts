import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import type { Page } from "playwright-core";
import { setupPlaywright } from "./setup";
import { seedTestDatabase, cleanTestDatabase } from "./fixtures";

const { usePage } = setupPlaywright();

beforeAll(() => {
  seedTestDatabase();
});

afterAll(() => {
  cleanTestDatabase();
});

// Helper: reset all client-side filters to default state.
async function resetFilters(page: Page) {
  await page.getByRole("group", { name: "Time class" }).getByRole("button", { name: "All" }).click();
  await page.getByRole("group", { name: "Result" }).getByRole("button", { name: "All" }).click();
  // Wait for all 3 cards to be visible after clearing filters
  await page.locator('a[href^="/analysis/"]').first().waitFor({ state: "visible" });
}

// =====================================================================
// Home page — initial state
// =====================================================================

describe("home page", () => {
  // Read-only tests — no reset needed
  const { getPage } = usePage("/");

  test("shows the app title", async () => {
    const page = getPage();
    const brand = page.getByRole("link", { name: /Chess Analyzer/ }).first();
    await brand.waitFor({ state: "visible" });
    expect(await brand.textContent()).toContain("Chess Analyzer");
  });

  test("settings modal exposes the username input and Save button", async () => {
    const page = getPage();
    await page.getByRole("button", { name: "Open settings" }).click();
    await page.locator('input[name="username"]').waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Save" }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Close settings" }).click();
  });

  test("shows welcome message when no username entered", async () => {
    const page = getPage();
    await page.getByText("No username set").waitFor({ state: "visible" });
  });
});

// =====================================================================
// Home page — game gallery with seeded data
// =====================================================================

describe("game gallery (seeded data)", () => {
  // Read-only tests — no reset needed
  const { getPage } = usePage("/?username=e2e_fakeplayer");

  test("displays games when username is provided", async () => {
    const page = getPage();
    await page.locator('a[href^="/analysis/"]').first().waitFor({ state: "visible" });
    expect(await page.locator('a[href^="/analysis/"]').count()).toBe(3);
  });

  test("shows correct player names on game cards", async () => {
    const page = getPage();
    // Scope to the gallery cards — the navbar also renders the active username.
    const inCards = page
      .locator('a[href^="/analysis/"]')
      .getByText("e2e_fakeplayer");
    expect(await inCards.count()).toBe(3);
  });

  test("shows result badges", async () => {
    const page = getPage();
    // e2e_fakeplayer won game 1 (white, 1-0), won game 2 (black, 0-1), drew game 3
    expect(await page.getByText("Win", { exact: true }).count()).toBe(2);
    expect(await page.getByText("Draw", { exact: true }).count()).toBe(1);
  });

  test("shows game count badge", async () => {
    const page = getPage();
    // The KPI band also renders a "N games" stat, so scope to the gallery
    // badge (the <span> beside the filter row) to avoid a strict-mode clash.
    await page.locator("span", { hasText: /^3 games$/ }).waitFor({ state: "visible" });
  });
});

// =====================================================================
// No-games message (separate describe — different URL)
// =====================================================================

describe("no-games message", () => {
  const { getPage } = usePage("/?username=nonexistentuser12345xyz");

  test("shows no-games message for unknown user", async () => {
    const page = getPage();
    await page.getByText(/No games found/).waitFor({ state: "visible", timeout: 15_000 });
  });
});

// =====================================================================
// Client-side filtering
// =====================================================================

describe("client-side filters", () => {
  const { getPage } = usePage("/?username=e2e_fakeplayer", {
    reset: resetFilters,
  });

  test("time class filter works", async () => {
    const page = getPage();
    const tc = page.getByRole("group", { name: "Time class" });
    await tc.getByRole("button", { name: "Blitz" }).click();
    expect(await page.locator('a[href^="/analysis/"]').count()).toBe(1);
    await tc.getByRole("button", { name: "Bullet" }).click();
    expect(await page.locator('a[href^="/analysis/"]').count()).toBe(1);
    await tc.getByRole("button", { name: "Rapid" }).click();
    expect(await page.locator('a[href^="/analysis/"]').count()).toBe(1);
    await tc.getByRole("button", { name: "All" }).click();
    expect(await page.locator('a[href^="/analysis/"]').count()).toBe(3);
  });

  test("result filter shows only wins", async () => {
    const page = getPage();
    await page.getByRole("group", { name: "Result" }).getByRole("button", { name: "Wins" }).click();
    expect(await page.locator('a[href^="/analysis/"]').count()).toBe(2);
  });

  test("result filter shows only draws", async () => {
    const page = getPage();
    await page.getByRole("group", { name: "Result" }).getByRole("button", { name: "Draws" }).click();
    expect(await page.locator('a[href^="/analysis/"]').count()).toBe(1);
  });

  test("count badge updates with filter", async () => {
    const page = getPage();
    // Scope to the gallery badge <span> (KPI band has its own "N games").
    await page.locator("span", { hasText: /^3 games$/ }).waitFor({ state: "visible" });
    await page.getByRole("group", { name: "Time class" }).getByRole("button", { name: "Blitz" }).click();
    await page.locator("span", { hasText: /^1 game$/ }).waitFor({ state: "visible" });
  });

  test("combining filters (AND logic)", async () => {
    const page = getPage();
    await page.getByRole("group", { name: "Result" }).getByRole("button", { name: "Wins" }).click();
    // 2 wins
    expect(await page.locator('a[href^="/analysis/"]').count()).toBe(2);

    await page.getByRole("group", { name: "Time class" }).getByRole("button", { name: "Blitz" }).click();
    // 1 blitz win
    expect(await page.locator('a[href^="/analysis/"]').count()).toBe(1);
  });
});

// =====================================================================
// Navigation from gallery to analysis
// =====================================================================

describe("gallery navigation", () => {
  const { getPage } = usePage("/?username=e2e_fakeplayer");

  test("clicking a game card navigates to the analysis page", async () => {
    const page = getPage();
    await page.locator('a[href^="/analysis/"]').first().waitFor({ state: "visible" });
    await page.locator('a[href^="/analysis/"]').first().click();
    await page.waitForURL(/\/analysis\/e2e_game_/);
    expect(page.url()).toMatch(/\/analysis\/e2e_game_/);
  });
});
