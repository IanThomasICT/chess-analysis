import { describe, test, expect } from "bun:test";
import { setupPlaywright } from "./setup";

const { usePage, baseUrl } = setupPlaywright();

describe("smoke tests", () => {
  const { getPage } = usePage("/");

  test("page loads and shows title", async () => {
    const page = getPage();
    const brand = page.getByRole("link", { name: /Chess Analyzer/ }).first();
    await brand.waitFor({ state: "visible" });
    expect(await brand.textContent()).toContain("Chess Analyzer");
  });
});

describe("real data smoke tests", () => {
  // Each test navigates to a different URL, so we start on the home page
  // and navigate within each test body.
  const { getPage } = usePage("/");

  test("loads games for kidkasu", async () => {
    const page = getPage();
    await page.goto(`${baseUrl  }/?username=kidkasu`);
    // Wait for game cards to appear (fetched from Chess.com API)
    await page.locator('a[href^="/analysis/"]').first().waitFor({
      state: "visible",
      timeout: 30_000,
    });
    const count = await page.locator('a[href^="/analysis/"]').count();
    expect(count).toBeGreaterThan(0);
  });

  test("loads analysis page from first kidkasu game card", async () => {
    const page = getPage();
    // Load games first
    await page.goto(`${baseUrl}/?username=kidkasu`);
    const firstCard = page.locator('a[href^="/analysis/"]').first();
    await firstCard.waitFor({ state: "visible", timeout: 30_000 });
    const href = await firstCard.getAttribute("href");
    expect(href).toMatch(/^\/analysis\/.+/);

    // Navigate to that game
    await page.goto(`${baseUrl}${href ?? ""}`);
    await page.locator("cg-board").waitFor({ state: "visible", timeout: 15_000 });
    const moveCounter = page.getByText(/\d+ \/ \d+/);
    await moveCounter.waitFor({ state: "visible" });
  });

  test("Study page is reachable from Home", async () => {
    const page = getPage();
    await page.goto(`${baseUrl}/`);
    await page.getByRole("link", { name: /Study/ }).click();
    await page.getByRole("heading", { name: "Study", exact: true }).waitFor({ state: "visible" });
    // Glossary entries render
    await page.getByText("Accuracy", { exact: true }).first().waitFor({ state: "visible" });
  });

  test("Stats page loads for kidkasu", async () => {
    const page = getPage();
    await page.goto(`${baseUrl}/stats?username=kidkasu`);
    await page.getByRole("button", { name: "Overview" }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Trends" }).waitFor({ state: "visible" });
  });
});
