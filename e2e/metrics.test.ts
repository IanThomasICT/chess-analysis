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

// =====================================================================
// MetricsCard — appears on the Analysis page once a game has analysis
// (seed marks games analyzed, so the per-game metrics rebuild lazily).
// =====================================================================

describe("metrics card on analysis page", () => {
  const { getPage } = usePage("/analysis/e2e_game_1");

  test("renders the per-game metrics card sections", async () => {
    const page = getPage();
    await page.getByText("Phase Accuracy").waitFor({ state: "visible" });
    await page.getByText("Position Quality").waitFor({ state: "visible" });
    await page.getByText("Conversion / Defense").waitFor({ state: "visible" });
  });

  test("shows a result-quality badge", async () => {
    const page = getPage();
    // e2e_game_1 is a clean win for e2e_fakeplayer (Scholar's Mate as White).
    await page.getByText("Clean win").waitFor({ state: "visible" });
  });

  test("shows phase-accuracy rows", async () => {
    const page = getPage();
    await page.getByText("Opening", { exact: true }).first().waitFor({ state: "visible" });
    await page.getByText("Middlegame", { exact: true }).first().waitFor({ state: "visible" });
    await page.getByText("Endgame", { exact: true }).first().waitFor({ state: "visible" });
  });
});

// =====================================================================
// New /stats tabs (R41b) — each renders without error on seeded data.
// =====================================================================

const STATS_PATH = "/stats?username=e2e_fakeplayer";

// Click a top-level stats tab button by its label and wait for the panel.
async function openTab(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: label, exact: true }).click();
}

// No tab body should ever surface the generic error fallback.
async function expectNoError(page: Page): Promise<void> {
  const count = await page.getByText("Error.", { exact: true }).count();
  expect(count).toBe(0);
}

describe("new stats tabs render", () => {
  const { getPage } = usePage(STATS_PATH);

  test("all new tab buttons are present", async () => {
    const page = getPage();
    for (const label of [
      "Consistency",
      "By Opponent",
      "ACL Trend",
      "Performance",
      "Leak Closure",
      "Repertoire",
    ]) {
      await page
        .getByRole("button", { name: label, exact: true })
        .waitFor({ state: "visible" });
    }
  });

  test("consistency tab shows accuracy stats", async () => {
    const page = getPage();
    await openTab(page, "Consistency");
    await page.getByText("Avg Accuracy").waitFor({ state: "visible" });
    await page.getByText("Std Dev").waitFor({ state: "visible" });
    await expectNoError(page);
  });

  test("by-opponent tab shows an opponent bucket", async () => {
    const page = getPage();
    await openTab(page, "By Opponent");
    // Seed opponents are unrated → bucketed under "unrated".
    await page.getByText("unrated").waitFor({ state: "visible" });
    await expectNoError(page);
  });

  test("acl-trend tab shows the rolling column", async () => {
    const page = getPage();
    await openTab(page, "ACL Trend");
    // Default time class is blitz; e2e_game_1 is blitz → table renders.
    await page.getByText("Rolling").waitFor({ state: "visible" });
    await expectNoError(page);
  });

  test("performance (tpr) tab shows TPR stats", async () => {
    const page = getPage();
    await openTab(page, "Performance");
    await page.getByText("TPR", { exact: true }).waitFor({ state: "visible" });
    await page.getByText("Avg Opp Elo").waitFor({ state: "visible" });
    await expectNoError(page);
  });

  test("leak-closure tab renders without error", async () => {
    const page = getPage();
    await openTab(page, "Leak Closure");
    // Seed games have no recurring blunder tags → empty-state copy.
    await page.getByText("No leak data yet.").waitFor({ state: "visible" });
    await expectNoError(page);
  });

  test("repertoire tab shows opening rows", async () => {
    const page = getPage();
    await openTab(page, "Repertoire");
    // White repertoire has seed data; ensure no error fallback.
    await expectNoError(page);
    await page
      .getByRole("button", { name: "white", exact: true })
      .waitFor({ state: "visible" });
  });
});
