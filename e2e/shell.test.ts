import { describe, test, expect } from "bun:test";
import { setupPlaywright } from "./setup";

// App-shell coverage for the redesign: the top navbar, section navigation,
// and the `?username=` persistence wired through the Username context.
//
// These assertions are intentionally DATA-FREE — they exercise the shell
// frame, nav-link targets, and URL state only. Start on /study (a static
// glossary page that needs no username and reads no game data), so this file
// never seeds or otherwise touches analysis.db.

const { usePage } = setupPlaywright();

describe("app shell navbar", () => {
  // Define the navigating test last; usePage shares one page per describe.
  const { getPage } = usePage("/study");

  test("shows the brand link and primary nav", async () => {
    const page = getPage();
    // Scope to the navbar <header> (role=banner): the Study glossary body has
    // its own in-page anchor links (e.g. <a href="#drill">) that would clash.
    const navbar = page.getByRole("banner");
    await navbar
      .getByRole("link", { name: /Chess Analyzer/ })
      .waitFor({ state: "visible" });
    for (const label of ["Games", "Stats", "Drill", "Study"]) {
      await navbar.getByRole("link", { name: label }).waitFor({ state: "visible" });
    }
  });

  test("nav links point at their routes", async () => {
    const page = getPage();
    const navbar = page.getByRole("banner");
    const routes: Record<string, string> = {
      Games: "/",
      Stats: "/stats",
      Drill: "/drill",
      Study: "/study",
    };
    for (const [label, route] of Object.entries(routes)) {
      const href = await navbar.getByRole("link", { name: label }).getAttribute("href");
      expect(href).toBe(route);
    }
  });

  test("clicking a nav link navigates within the SPA", async () => {
    const page = getPage();
    await page.getByRole("banner").getByRole("link", { name: "Stats" }).click();
    await page.waitForURL("**/stats");
    // No username set → Stats renders its empty-state prompt (no DB read).
    await page.getByText("Enter a username to view stats.").waitFor({ state: "visible" });
  });
});

describe("username persistence", () => {
  const { getPage } = usePage("/study");

  test("Settings sets the username in the URL and threads it through nav", async () => {
    const page = getPage();
    const navbar = page.getByRole("banner");
    await navbar.getByRole("button", { name: "Open settings" }).click();
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await dialog.locator('input[name="username"]').fill("capybara_test");
    await dialog.getByRole("button", { name: "Save" }).click();

    await page.waitForURL("**/study?username=capybara_test");

    // withUser nav links carry the active username. Wait on the href (the link
    // re-renders a tick after the URL commits, so retry rather than read once).
    await navbar
      .locator('a[href="/stats?username=capybara_test"]')
      .waitFor({ state: "visible" });
    // ...but the Study link itself (withUser: false) stays param-free.
    expect(
      await navbar.getByRole("link", { name: "Study" }).getAttribute("href"),
    ).toBe("/study");
  });
});
