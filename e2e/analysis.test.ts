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

// Helper: reset the board to starting position (move 0).
async function resetToStart(page: Page) {
  await page.keyboard.press("Home");
  await page.getByText(/^0 \/ \d+$/).waitFor({ state: "visible" });
}

// =====================================================================
// Analysis page — layout and header
// =====================================================================

describe("analysis page layout", () => {
  // Read-only tests — no reset needed
  const { getPage } = usePage("/analysis/e2e_game_1");

  test("displays player names and result in header", async () => {
    const page = getPage();
    await page.getByText("e2e_fakeplayer vs opponent1").waitFor({ state: "visible" });
    await page.getByText("1-0").waitFor({ state: "visible" });
  });

  test("displays back link to home", async () => {
    const page = getPage();
    const backLink = page.getByRole("link", { name: /Back/ });
    await backLink.waitFor({ state: "visible" });
    expect(await backLink.getAttribute("href")).toBe("/");
  });

  test("displays the chessboard", async () => {
    const page = getPage();
    await page.locator("cg-board").waitFor({ state: "visible" });
  });

  test("displays the move list", async () => {
    const page = getPage();
    // Scholar's mate moves: e4, e5, Bc4, Nc6, Qh5, Nf6, Qxf7#
    await page.getByRole("button", { name: "e4" }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Qxf7#" }).waitFor({ state: "visible" });
  });

  test("displays navigation controls", async () => {
    const page = getPage();
    await page.getByText("0 / 7").waitFor({ state: "visible" });
  });

  test("shows time class in header", async () => {
    const page = getPage();
    await page.getByText("blitz").waitFor({ state: "visible" });
  });
});

// =====================================================================
// Analysis page — move navigation (buttons)
// =====================================================================

describe("move navigation (buttons)", () => {
  const { getPage } = usePage("/analysis/e2e_game_1", { reset: resetToStart });

  test("starts at move 0 (starting position)", async () => {
    const page = getPage();
    await page.getByText("0 / 7").waitFor({ state: "visible" });
  });

  test("forward button advances the move", async () => {
    const page = getPage();
    const forwardBtn = page.getByRole("button", { name: "Next move" });
    await forwardBtn.click();
    await page.getByText("1 / 7").waitFor({ state: "visible" });
  });

  test("backward button goes back", async () => {
    const page = getPage();
    const forwardBtn = page.getByRole("button", { name: "Next move" });
    const backBtn = page.getByRole("button", { name: "Previous move" });
    await forwardBtn.click();
    await forwardBtn.click();
    await page.getByText("2 / 7").waitFor({ state: "visible" });
    await backBtn.click();
    await page.getByText("1 / 7").waitFor({ state: "visible" });
  });

  test("end button jumps to final position", async () => {
    const page = getPage();
    const endBtn = page.getByRole("button", { name: "Last move" });
    await endBtn.click();
    await page.getByText("7 / 7").waitFor({ state: "visible" });
  });

  test("start button jumps to initial position", async () => {
    const page = getPage();
    const endBtn = page.getByRole("button", { name: "Last move" });
    const startBtn = page.getByRole("button", { name: "First move" });
    await endBtn.click();
    await page.getByText("7 / 7").waitFor({ state: "visible" });
    await startBtn.click();
    await page.getByText("0 / 7").waitFor({ state: "visible" });
  });

  test("forward button does not go beyond last move", async () => {
    const page = getPage();
    const endBtn = page.getByRole("button", { name: "Last move" });
    const forwardBtn = page.getByRole("button", { name: "Next move" });
    await endBtn.click();
    await page.getByText("7 / 7").waitFor({ state: "visible" });
    // At the final move the forward/last controls disable.
    expect(await forwardBtn.isDisabled()).toBe(true);
    expect(await endBtn.isDisabled()).toBe(true);
  });

  test("backward button does not go below 0", async () => {
    const page = getPage();
    const backBtn = page.getByRole("button", { name: "Previous move" });
    const startBtn = page.getByRole("button", { name: "First move" });
    await page.getByText("0 / 7").waitFor({ state: "visible" });
    // At the starting position the back/first controls disable.
    expect(await backBtn.isDisabled()).toBe(true);
    expect(await startBtn.isDisabled()).toBe(true);
  });
});

// =====================================================================
// Analysis page — keyboard navigation
// =====================================================================

describe("keyboard navigation", () => {
  const { getPage } = usePage("/analysis/e2e_game_1", { reset: resetToStart });

  test("ArrowRight advances to next move", async () => {
    const page = getPage();
    await page.keyboard.press("ArrowRight");
    await page.getByText("1 / 7").waitFor({ state: "visible" });
  });

  test("ArrowLeft goes to previous move", async () => {
    const page = getPage();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");
    await page.getByText("1 / 7").waitFor({ state: "visible" });
  });

  test("Home key goes to starting position", async () => {
    const page = getPage();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Home");
    await page.getByText("0 / 7").waitFor({ state: "visible" });
  });

  test("End key goes to final position", async () => {
    const page = getPage();
    await page.keyboard.press("End");
    await page.getByText("7 / 7").waitFor({ state: "visible" });
  });

  test("ArrowLeft at move 0 stays at 0", async () => {
    const page = getPage();
    await page.keyboard.press("ArrowLeft");
    await page.getByText("0 / 7").waitFor({ state: "visible" });
  });

  test("ArrowRight at last move stays at last", async () => {
    const page = getPage();
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowRight");
    await page.getByText("7 / 7").waitFor({ state: "visible" });
  });

  test("rapid keyboard navigation through all moves", async () => {
    const page = getPage();
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
  const { getPage } = usePage("/analysis/e2e_game_1", { reset: resetToStart });

  test("clicking a move in the list navigates to that position", async () => {
    const page = getPage();
    // Click "e5" (Black's first move, position index 2)
    await page.getByRole("button", { name: "e5" }).click();
    await page.getByText("2 / 7").waitFor({ state: "visible" });
  });

  test("active move is highlighted in the move list", async () => {
    const page = getPage();
    await page.getByRole("button", { name: "e4" }).click();
    // The active button should have a blue background class
    const btn = page.getByRole("button", { name: "e4" });
    const className = await btn.getAttribute("class");
    expect(className).toContain("bg-accent");
  });

  test("clicking last move shows final position", async () => {
    const page = getPage();
    await page.getByRole("button", { name: "Qxf7#" }).click();
    await page.getByText("7 / 7").waitFor({ state: "visible" });
  });

  test("move list shows move numbers", async () => {
    const page = getPage();
    // Should show "1.", "2.", "3.", "4." for Scholar's mate.
    // AlternativesPanel also renders "1.", "2.", "3." for rank labels, so
    // scope to the MoveList by selecting the .first() text node — the move
    // list is rendered above the alternatives panel in DOM order.
    await page.getByText("1.", { exact: true }).first().waitFor({ state: "visible" });
    await page.getByText("4.", { exact: true }).first().waitFor({ state: "visible" });
  });
});

// =====================================================================
// Analysis page — Fool's mate (Black win)
// =====================================================================

describe("analysis page — Fool's mate", () => {
  const { getPage } = usePage("/analysis/e2e_game_2", { reset: resetToStart });

  test("shows correct players for Fool's mate game", async () => {
    const page = getPage();
    await page.getByText("opponent2 vs e2e_fakeplayer").waitFor({ state: "visible" });
    await page.getByText("0-1").waitFor({ state: "visible" });
  });

  test("has 4 half-moves (0 / 4)", async () => {
    const page = getPage();
    await page.getByText("0 / 4").waitFor({ state: "visible" });
  });

  test("can navigate to the end of the game", async () => {
    const page = getPage();
    await page.keyboard.press("End");
    await page.getByText("4 / 4").waitFor({ state: "visible" });
  });
});

// =====================================================================
// Analysis page — draw game
// =====================================================================

describe("analysis page — draw game", () => {
  // Read-only tests — no reset needed
  const { getPage } = usePage("/analysis/e2e_game_3");

  test("shows draw result", async () => {
    const page = getPage();
    await page.getByText("1/2-1/2").waitFor({ state: "visible" });
  });

  test("shows rapid time class", async () => {
    const page = getPage();
    await page.getByText("rapid").waitFor({ state: "visible" });
  });

  test("has correct number of moves (6 half-moves)", async () => {
    const page = getPage();
    await page.getByText("0 / 6").waitFor({ state: "visible" });
  });
});

// =====================================================================
// Analysis page — eval bar (visible when analysis is present)
// =====================================================================

describe("eval bar", () => {
  const { getPage } = usePage("/analysis/e2e_game_1");

  test("eval bar is rendered on the page", async () => {
    const page = getPage();
    const evalBarContainer = page.locator(".w-8").first();
    await evalBarContainer.waitFor({ state: "visible" });
  });
});

// =====================================================================
// Tabbed rail (redesign) — Moves / Report / Engine / History
// =====================================================================

describe("rail tabs", () => {
  const { getPage } = usePage("/analysis/e2e_game_1");

  test("switching tabs swaps the rail body", async () => {
    const page = getPage();
    // Moves is the default tab → SAN move buttons are present. Match the bare
    // SAN exactly so the always-visible "Review these moves" buttons (which embed
    // SAN in a longer label) don't collide.
    await page.getByRole("button", { name: "e4", exact: true }).first().waitFor({ state: "visible" });

    // Report tab unmounts the move list and shows the metrics card.
    await page.getByRole("button", { name: "Report" }).click();
    await page.getByText("Phase Accuracy").waitFor({ state: "visible" });
    expect(await page.getByRole("button", { name: "e4", exact: true }).count()).toBe(0);

    // Back to Moves restores the move list.
    await page.getByRole("button", { name: "Moves" }).click();
    await page.getByRole("button", { name: "e4", exact: true }).first().waitFor({ state: "visible" });
  });
});

// =====================================================================
// Error handling
// =====================================================================

describe("error handling", () => {
  const { getPage } = usePage("/analysis/nonexistent_game_id_xyz");

  test("shows error for non-existent game ID", async () => {
    const page = getPage();
    await page.getByText("Game not found").waitFor({ state: "visible", timeout: 10_000 });
  });
});
