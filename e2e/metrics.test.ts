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

  // The per-game report lives in the "Report" tab of the right-hand rail.
  async function openReport(page: Page): Promise<void> {
    await page.getByRole("button", { name: "Report" }).click();
  }

  test("renders the per-game metrics card sections", async () => {
    const page = getPage();
    await openReport(page);
    await page.getByText("Phase Accuracy").waitFor({ state: "visible" });
    await page.getByText("Position Quality").waitFor({ state: "visible" });
    await page.getByText("Conversion / Defense").waitFor({ state: "visible" });
  });

  test("shows a result-quality badge", async () => {
    const page = getPage();
    await openReport(page);
    // e2e_game_1 is a clean win for e2e_fakeplayer (Scholar's Mate as White).
    // Quality shows in both the always-visible digest and the Report card → first().
    await page.getByText("Clean win").first().waitFor({ state: "visible" });
  });

  test("shows phase-accuracy rows", async () => {
    const page = getPage();
    await openReport(page);
    await page.getByText("Opening", { exact: true }).first().waitFor({ state: "visible" });
    await page.getByText("Middlegame", { exact: true }).first().waitFor({ state: "visible" });
    await page.getByText("Endgame", { exact: true }).first().waitFor({ state: "visible" });
  });
});

// =====================================================================
// /stats sections (redesign) — Overview / Trends / Openings / Patterns.
// Each section body renders without the error fallback on seeded data.
// (Was 15 flat tabs; the stats dashboard now groups them into 4 sections.)
// =====================================================================

const STATS_PATH = "/stats?username=e2e_fakeplayer";

// Open a top-level stats section by its tab label and wait for the panel.
async function openSection(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: label, exact: true }).click();
}

// No section body should ever surface the generic error fallback.
async function expectNoError(page: Page): Promise<void> {
  const count = await page.getByText("Error loading stats.", { exact: true }).count();
  expect(count).toBe(0);
}

describe("stats sections render", () => {
  const { getPage } = usePage(STATS_PATH);

  test("all section tabs are present", async () => {
    const page = getPage();
    for (const label of ["Overview", "Trends", "Openings", "Patterns"]) {
      await page
        .getByRole("button", { name: label, exact: true })
        .waitFor({ state: "visible" });
    }
  });

  // Consistency + Performance cards live in the default Overview section.
  test("overview shows consistency stats", async () => {
    const page = getPage();
    await page.getByText("Avg Accuracy").waitFor({ state: "visible" });
    await page.getByText("Std Dev").waitFor({ state: "visible" });
    await expectNoError(page);
  });

  test("overview shows performance (tpr) stats", async () => {
    const page = getPage();
    await page.getByText("TPR", { exact: true }).waitFor({ state: "visible" });
    await page.getByText("Avg Opp Elo").waitFor({ state: "visible" });
    await expectNoError(page);
  });

  // By-opponent + leak-closure cards live in the Patterns section.
  test("patterns shows an opponent bucket", async () => {
    const page = getPage();
    await openSection(page, "Patterns");
    // Seed opponents are unrated → bucketed under "unrated". Both the
    // by-opponent and rating-bucket cards render this label, so take first.
    await page.getByText("unrated").first().waitFor({ state: "visible" });
    await expectNoError(page);
  });

  test("patterns leak-closure renders without error", async () => {
    const page = getPage();
    await openSection(page, "Patterns");
    // Seed games have no recurring blunder tags → empty-state copy.
    await page.getByText("No leak data yet.").waitFor({ state: "visible" });
    await expectNoError(page);
  });

  // ACL trend table lives in the Trends section.
  test("trends acl table shows the rolling column", async () => {
    const page = getPage();
    await openSection(page, "Trends");
    // Default time class is blitz; e2e_game_1 is blitz → table renders.
    await page.getByText("Rolling").waitFor({ state: "visible" });
    await expectNoError(page);
  });

  // Repertoire card lives in the Openings section.
  test("openings repertoire shows the color toggle", async () => {
    const page = getPage();
    await openSection(page, "Openings");
    await expectNoError(page);
    await page
      .getByRole("button", { name: "white", exact: true })
      .waitFor({ state: "visible" });
  });
});
