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
// Analysis page — layout and header
// =====================================================================

describe("analysis page layout", () => {
  test("displays player names and result in header", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/analysis/e2e_game_1");
    await page.getByText("testplayer vs opponent1").waitFor({ state: "visible" });
    await page.getByText("1-0").waitFor({ state: "visible" });
  });

  test("displays back link to home", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/analysis/e2e_game_1");
    const backLink = page.getByRole("link", { name: /Back/ });
    await backLink.waitFor({ state: "visible" });
    expect(await backLink.getAttribute("href")).toBe("/");
  });

  test("displays the chessboard", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/analysis/e2e_game_1");
    // Chessground renders into a div with the cg-wrap class
    await page.locator("cg-board").waitFor({ state: "visible" });
  });

  test("displays the move list", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/analysis/e2e_game_1");
    // Scholar's mate moves: e4, e5, Bc4, Nc6, Qh5, Nf6, Qxf7#
    await page.getByRole("button", { name: "e4" }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Qxf7#" }).waitFor({ state: "visible" });
  });

  test("displays navigation controls", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/analysis/e2e_game_1");
    // Should show move counter "0 / 7"
    await page.getByText("0 / 7").waitFor({ state: "visible" });
  });

  test("shows time class in header", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/analysis/e2e_game_1");
    await page.getByText("blitz").waitFor({ state: "visible" });
  });

  test("displays the Analyze with Stockfish button when not analyzed", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/analysis/e2e_game_1");
    await page
      .getByRole("button", { name: "Analyze with Stockfish" })
      .waitFor({ state: "visible" });
  });
});

// =====================================================================
// Analysis page — move navigation (buttons)
// =====================================================================

describe("move navigation (buttons)", () => {
  test("starts at move 0 (starting position)", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/analysis/e2e_game_1");
    await page.getByText("0 / 7").waitFor({ state: "visible" });
  });

  test("forward button advances the move", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/analysis/e2e_game_1");
    await page.getByText("0 / 7").waitFor({ state: "visible" });
    // Click the single-forward button (rsaquo = >)
    const forwardBtn = page.locator("button").filter({ hasText: "\u203A" });
    await forwardBtn.click();
    await page.getByText("1 / 7").waitFor({ state: "visible" });
  });

  test("backward button goes back", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/analysis/e2e_game_1");
    await page.getByText("0 / 7").waitFor({ state: "visible" });
    const forwardBtn = page.locator("button").filter({ hasText: "\u203A" });
    const backBtn = page.locator("button").filter({ hasText: "\u2039" });
    await forwardBtn.click();
    await forwardBtn.click();
    await page.getByText("2 / 7").waitFor({ state: "visible" });
    await backBtn.click();
    await page.getByText("1 / 7").waitFor({ state: "visible" });
  });

  test("end button jumps to final position", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/analysis/e2e_game_1");
    await page.getByText("0 / 7").waitFor({ state: "visible" });
    const endBtn = page.locator("button").filter({ hasText: "\u00BB" });
    await endBtn.click();
    await page.getByText("7 / 7").waitFor({ state: "visible" });
  });

  test("start button jumps to initial position", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/analysis/e2e_game_1");
    await page.getByText("0 / 7").waitFor({ state: "visible" });
    const endBtn = page.locator("button").filter({ hasText: "\u00BB" });
    const startBtn = page.locator("button").filter({ hasText: "\u00AB" });
    await endBtn.click();
    await page.getByText("7 / 7").waitFor({ state: "visible" });
    await startBtn.click();
    await page.getByText("0 / 7").waitFor({ state: "visible" });
  });

  test("forward button does not go beyond last move", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/analysis/e2e_game_1");
    await page.getByText("0 / 7").waitFor({ state: "visible" });
    const endBtn = page.locator("button").filter({ hasText: "\u00BB" });
    const forwardBtn = page.locator("button").filter({ hasText: "\u203A" });
    await endBtn.click();
    await forwardBtn.click();
    await forwardBtn.click();
    await page.getByText("7 / 7").waitFor({ state: "visible" });
  });

  test("backward button does not go below 0", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/analysis/e2e_game_1");
    await page.getByText("0 / 7").waitFor({ state: "visible" });
    const backBtn = page.locator("button").filter({ hasText: "\u2039" });
    await backBtn.click();
    await backBtn.click();
    await page.getByText("0 / 7").waitFor({ state: "visible" });
  });
});

// =====================================================================
// Analysis page — keyboard navigation
// =====================================================================

describe("keyboard navigation", () => {
  test("ArrowRight advances to next move", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/analysis/e2e_game_1");
    await page.getByText("0 / 7").waitFor({ state: "visible" });
    await page.keyboard.press("ArrowRight");
    await page.getByText("1 / 7").waitFor({ state: "visible" });
  });

  test("ArrowLeft goes to previous move", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/analysis/e2e_game_1");
    await page.getByText("0 / 7").waitFor({ state: "visible" });
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");
    await page.getByText("1 / 7").waitFor({ state: "visible" });
  });

  test("Home key goes to starting position", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/analysis/e2e_game_1");
    await page.getByText("0 / 7").waitFor({ state: "visible" });
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Home");
    await page.getByText("0 / 7").waitFor({ state: "visible" });
  });

  test("End key goes to final position", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/analysis/e2e_game_1");
    await page.getByText("0 / 7").waitFor({ state: "visible" });
    await page.keyboard.press("End");
    await page.getByText("7 / 7").waitFor({ state: "visible" });
  });

  test("ArrowLeft at move 0 stays at 0", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/analysis/e2e_game_1");
    await page.getByText("0 / 7").waitFor({ state: "visible" });
    await page.keyboard.press("ArrowLeft");
    await page.getByText("0 / 7").waitFor({ state: "visible" });
  });

  test("ArrowRight at last move stays at last", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/analysis/e2e_game_1");
    await page.getByText("0 / 7").waitFor({ state: "visible" });
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowRight");
    await page.getByText("7 / 7").waitFor({ state: "visible" });
  });

  test("rapid keyboard navigation through all moves", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/analysis/e2e_game_1");
    await page.getByText("0 / 7").waitFor({ state: "visible" });
    for (let i = 0; i < 7; i++) {
      await page.keyboard.press("ArrowRight");
    }
    await page.getByText("7 / 7").waitFor({ state: "visible" });
    for (let i = 0; i < 7; i++) {
      await page.keyboard.press("ArrowLeft");
    }
    await page.getByText("0 / 7").waitFor({ state: "visible" });
  });
});

// =====================================================================
// Analysis page — move list interaction
// =====================================================================

describe("move list interaction", () => {
  test("clicking a move in the list navigates to that position", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/analysis/e2e_game_1");
    await page.getByText("0 / 7").waitFor({ state: "visible" });
    // Click "e5" (Black's first move, position index 2)
    await page.getByRole("button", { name: "e5" }).click();
    await page.getByText("2 / 7").waitFor({ state: "visible" });
  });

  test("active move is highlighted in the move list", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/analysis/e2e_game_1");
    await page.getByText("0 / 7").waitFor({ state: "visible" });
    await page.getByRole("button", { name: "e4" }).click();
    // The active button should have a blue background class
    const btn = page.getByRole("button", { name: "e4" });
    const className = await btn.getAttribute("class");
    expect(className).toContain("bg-blue");
  });

  test("clicking last move shows final position", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/analysis/e2e_game_1");
    await page.getByText("0 / 7").waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Qxf7#" }).click();
    await page.getByText("7 / 7").waitFor({ state: "visible" });
  });

  test("move list shows move numbers", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/analysis/e2e_game_1");
    // Should show "1.", "2.", "3.", "4." for Scholar's mate
    await page.getByText("1.", { exact: false }).waitFor({ state: "visible" });
    await page.getByText("4.", { exact: false }).waitFor({ state: "visible" });
  });
});

// =====================================================================
// Analysis page — Fool's mate (Black win)
// =====================================================================

describe("analysis page — Fool's mate", () => {
  test("shows correct players for Fool's mate game", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/analysis/e2e_game_2");
    await page.getByText("opponent2 vs testplayer").waitFor({ state: "visible" });
    await page.getByText("0-1").waitFor({ state: "visible" });
  });

  test("has 4 half-moves (0 / 4)", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/analysis/e2e_game_2");
    await page.getByText("0 / 4").waitFor({ state: "visible" });
  });

  test("can navigate to the end of the game", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/analysis/e2e_game_2");
    await page.getByText("0 / 4").waitFor({ state: "visible" });
    await page.keyboard.press("End");
    await page.getByText("4 / 4").waitFor({ state: "visible" });
  });
});

// =====================================================================
// Analysis page — draw game
// =====================================================================

describe("analysis page — draw game", () => {
  test("shows draw result", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/analysis/e2e_game_3");
    await page.getByText("1/2-1/2").waitFor({ state: "visible" });
  });

  test("shows rapid time class", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/analysis/e2e_game_3");
    await page.getByText("rapid").waitFor({ state: "visible" });
  });

  test("has correct number of moves (6 half-moves)", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/analysis/e2e_game_3");
    await page.getByText("0 / 6").waitFor({ state: "visible" });
  });
});

// =====================================================================
// Analysis page — eval bar (visible when analysis is present)
// =====================================================================

describe("eval bar", () => {
  test("eval bar is rendered on the page", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/analysis/e2e_game_1");
    // The eval bar is a div.w-8 containing the bar component
    const evalBarContainer = page.locator(".w-8").first();
    await evalBarContainer.waitFor({ state: "visible" });
  });
});

// =====================================================================
// Error handling
// =====================================================================

describe("error handling", () => {
  test("shows error for non-existent game ID", async () => {
    const page = getPage();
    await page.goto(baseUrl + "/analysis/nonexistent_game_id_xyz");
    // SPA shows "Game not found" message
    await page.getByText("Game not found").waitFor({ state: "visible", timeout: 10_000 });
  });
});
