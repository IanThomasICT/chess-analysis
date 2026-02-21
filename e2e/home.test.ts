import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { setupPlaywright } from "./setup";
import { seedTestDatabase, cleanTestDatabase } from "./fixtures";

const { getPage, baseUrl } = setupPlaywright();

beforeAll(() => {
  seedTestDatabase();
});

afterAll(() => {
  cleanTestDatabase();
});

// =====================================================================
// Home page — initial state
// =====================================================================

describe("home page", () => {
  test("shows the app title", async () => {
    const page = getPage();
    await page.goto(baseUrl);
    await page.locator("h1").waitFor({ state: "visible" });
    expect(await page.locator("h1").textContent()).toBe("Chess Analyzer");
  });

  test("shows the username input and Load Games button", async () => {
    const page = getPage();
    await page.goto(baseUrl);
    await page.locator('input[name="username"]').waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Load Games" }).waitFor({ state: "visible" });
  });

  test("shows welcome message when no username entered", async () => {
    const page = getPage();
    await page.goto(baseUrl);
    await page
      .getByText("Enter a Chess.com username to get started")
      .waitFor({ state: "visible" });
  });
});

// =====================================================================
// Home page — game gallery with seeded data
// =====================================================================

describe("game gallery (seeded data)", () => {
  test("displays games when username is provided", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/?username=testplayer");
    // Should show 3 seeded games
    await page.locator('a[href^="/analysis/"]').first().waitFor({ state: "visible" });
    expect(await page.locator('a[href^="/analysis/"]').count()).toBe(3);
  });

  test("shows correct player names on game cards", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/?username=testplayer");
    await page.locator('a[href^="/analysis/"]').first().waitFor({ state: "visible" });
    expect(await page.getByText("testplayer").count()).toBe(6);
  });

  test("shows result badges", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/?username=testplayer");
    await page.locator('a[href^="/analysis/"]').first().waitFor({ state: "visible" });
    // testplayer won game 1 (white, 1-0), won game 2 (black, 0-1), drew game 3
    expect(await page.getByText("Win").count()).toBe(2);
    expect(await page.getByText("Draw").count()).toBe(1);
  });

  test("shows game count badge", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/?username=testplayer");
    await page.locator('a[href^="/analysis/"]').first().waitFor({ state: "visible" });
    await page.getByText("3 games").waitFor({ state: "visible" });
  });

  test("shows no-games message for unknown user", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/?username=nonexistentuser12345xyz");
    await page.getByText(/No games found/).waitFor({ state: "visible", timeout: 15_000 });
  });
});

// =====================================================================
// Client-side filtering
// =====================================================================

describe("client-side filters", () => {
  test("text filter narrows results by opponent name", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/?username=testplayer");
    await page.locator('a[href^="/analysis/"]').first().waitFor({ state: "visible" });

    const searchInput = page.getByPlaceholder("Search by opponent...");
    await searchInput.fill("opponent1");
    expect(await page.locator('a[href^="/analysis/"]').count()).toBe(1);
  });

  test("text filter is case-insensitive", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/?username=testplayer");
    await page.locator('a[href^="/analysis/"]').first().waitFor({ state: "visible" });

    const searchInput = page.getByPlaceholder("Search by opponent...");
    await searchInput.fill("OPPONENT1");
    expect(await page.locator('a[href^="/analysis/"]').count()).toBe(1);
  });

  test("text filter shows all when cleared", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/?username=testplayer");
    await page.locator('a[href^="/analysis/"]').first().waitFor({ state: "visible" });

    const searchInput = page.getByPlaceholder("Search by opponent...");
    await searchInput.fill("opponent1");
    expect(await page.locator('a[href^="/analysis/"]').count()).toBe(1);
    await searchInput.clear();
    expect(await page.locator('a[href^="/analysis/"]').count()).toBe(3);
  });

  test("time class filter works", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/?username=testplayer");
    await page.locator('a[href^="/analysis/"]').first().waitFor({ state: "visible" });

    const select = page.locator("select").first();
    await select.selectOption("blitz");
    expect(await page.locator('a[href^="/analysis/"]').count()).toBe(1);
    await select.selectOption("bullet");
    expect(await page.locator('a[href^="/analysis/"]').count()).toBe(1);
    await select.selectOption("rapid");
    expect(await page.locator('a[href^="/analysis/"]').count()).toBe(1);
    await select.selectOption("all");
    expect(await page.locator('a[href^="/analysis/"]').count()).toBe(3);
  });

  test("result filter shows only wins", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/?username=testplayer");
    await page.locator('a[href^="/analysis/"]').first().waitFor({ state: "visible" });

    const resultSelect = page.locator("select").nth(1);
    await resultSelect.selectOption("win");
    expect(await page.locator('a[href^="/analysis/"]').count()).toBe(2);
  });

  test("result filter shows only draws", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/?username=testplayer");
    await page.locator('a[href^="/analysis/"]').first().waitFor({ state: "visible" });

    const resultSelect = page.locator("select").nth(1);
    await resultSelect.selectOption("draw");
    expect(await page.locator('a[href^="/analysis/"]').count()).toBe(1);
  });

  test("count badge updates with filter", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/?username=testplayer");
    await page.locator('a[href^="/analysis/"]').first().waitFor({ state: "visible" });

    await page.getByText("3 games").waitFor({ state: "visible" });
    const searchInput = page.getByPlaceholder("Search by opponent...");
    await searchInput.fill("opponent1");
    await page.getByText("1 game").waitFor({ state: "visible" });
  });

  test("combining filters (AND logic)", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/?username=testplayer");
    await page.locator('a[href^="/analysis/"]').first().waitFor({ state: "visible" });

    const resultSelect = page.locator("select").nth(1);
    await resultSelect.selectOption("win");
    // 2 wins
    expect(await page.locator('a[href^="/analysis/"]').count()).toBe(2);

    const timeSelect = page.locator("select").first();
    await timeSelect.selectOption("blitz");
    // 1 blitz win
    expect(await page.locator('a[href^="/analysis/"]').count()).toBe(1);
  });
});

// =====================================================================
// Navigation from gallery to analysis
// =====================================================================

describe("gallery navigation", () => {
  test("clicking a game card navigates to the analysis page", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/?username=testplayer");
    await page.locator('a[href^="/analysis/"]').first().waitFor({ state: "visible" });
    await page.locator('a[href^="/analysis/"]').first().click();
    await page.waitForURL(/\/analysis\/e2e_game_/);
    expect(page.url()).toMatch(/\/analysis\/e2e_game_/);
  });
});
