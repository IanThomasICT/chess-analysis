import { chromium } from "playwright-core";
import { beforeAll, afterAll, beforeEach, afterEach } from "bun:test";

import type { Browser, BrowserContext, Page } from "playwright-core";

const BASE_URL = "http://localhost:5173";

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
 * Each call creates its own BrowserContext (isolated cookies/storage)
 * and a fresh Page per test. The browser itself is a singleton shared
 * across all test files in the process.
 */
export function setupPlaywright() {
  let context: BrowserContext;
  let page: Page;

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

  beforeEach(async () => {
    try {
      page = await context.newPage();
    } catch {
      // context was corrupted by a prior timeout; recreate it
      const b = await ensureBrowser();
      context = await b.newContext();
      page = await context.newPage();
    }
  });

  afterEach(async () => {
    try {
      await page.close();
    } catch {
      // page may already be closed after a timeout
    }
  });

  return {
    getPage: () => page,
    baseUrl: BASE_URL,
  };
}
