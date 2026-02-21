import { describe, test, expect } from "bun:test";
import { setupPlaywright } from "./setup";

const { getPage, baseUrl } = setupPlaywright();

describe("smoke tests", () => {
  test("page loads and shows title", async () => {
    const page = getPage();
    await page.goto(baseUrl);
    await page.locator("h1").waitFor({ state: "visible" });
    expect(await page.locator("h1").textContent()).toBe("Chess Analyzer");
  });
});

describe("real data smoke tests", () => {
  test("loads games for kidkasu", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/?username=kidkasu");
    // Wait for game cards to appear (fetched from Chess.com API)
    await page.locator('a[href^="/analysis/"]').first().waitFor({
      state: "visible",
      timeout: 30_000,
    });
    const count = await page.locator('a[href^="/analysis/"]').count();
    expect(count).toBeGreaterThan(0);
  });

  test("loads analysis page for game 164920702934", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/analysis/164920702934");
    // Wait for board and player names to render
    await page.locator("cg-board").waitFor({ state: "visible", timeout: 15_000 });
    // Verify navigation controls are present
    const moveCounter = page.getByText(/\d+ \/ \d+/);
    await moveCounter.waitFor({ state: "visible" });
  });
});
