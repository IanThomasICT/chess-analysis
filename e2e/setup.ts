import { chromium } from "playwright-core";
import { beforeAll, afterAll, beforeEach } from "bun:test";

import type { Browser, BrowserContext, Page } from "playwright-core";

export const BASE_URL = "http://localhost:5173";

let browser: Browser | null = null;

async function ensureBrowser(): Promise<Browser> {
  if (browser === null || !browser.isConnected()) {
    browser = await chromium.launch();
  }
  return browser;
}

/**
 * Set up Playwright browser lifecycle for a test file.
 *
 * Creates a shared BrowserContext for the file. Individual describe blocks
 * call `usePage(path)` to get a shared page that navigates once and
 * optionally resets state between tests — much faster than creating a
 * fresh page + full navigation per test.
 */
export function setupPlaywright() {
  let context: BrowserContext;

  beforeAll(async () => {
    const b = await ensureBrowser();
    context = await b.newContext();
  });

  afterAll(async () => {
    try {
      await context.close();
    } catch {
      // context may already be closed
    }
  });

  /**
   * Navigate to `path` once for the current describe block and share
   * the page across all tests within it.
   *
   * @param path   URL path appended to BASE_URL (e.g. "/analysis/e2e_game_1")
   * @param opts.reset  Optional callback run before each test to restore
   *                    the page to a known state (e.g. press Home key).
   */
  function usePage(
    path: string,
    opts?: { reset?: (page: Page) => Promise<void> }
  ) {
    let page: Page;

    beforeAll(async () => {
      try {
        page = await context.newPage();
      } catch {
        // context was corrupted by a prior timeout; recreate it
        const b = await ensureBrowser();
        context = await b.newContext();
        page = await context.newPage();
      }
      await page.goto(BASE_URL + path);
    });

    if (opts?.reset !== undefined) {
      beforeEach(async () => {
        await opts.reset!(page);
      });
    }

    afterAll(async () => {
      try {
        await page.close();
      } catch {
        // page may already be closed after a timeout
      }
    });

    return { getPage: () => page };
  }

  return {
    usePage,
    baseUrl: BASE_URL,
  };
}
