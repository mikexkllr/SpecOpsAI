import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import { loadDeps } from "./deepagentsDeps";

type BrowserState = {
  browser: import("playwright").Browser;
  page: import("playwright").Page;
};

let activeBrowser: BrowserState | null = null;

async function getPage(): Promise<import("playwright").Page> {
  if (activeBrowser) return activeBrowser.page;
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  activeBrowser = { browser, page };
  return page;
}

export async function closeBrowser(): Promise<void> {
  if (!activeBrowser) return;
  try {
    await activeBrowser.browser.close();
  } finally {
    activeBrowser = null;
  }
}

export function makeBrowserTools() {
  // Loaded lazily; tools are plain objects so we build them synchronously
  // and load the T.tool wrapper at call-time via loadDeps.
  return {
    closeBrowser,

    async buildTools() {
      const { tools: T } = await loadDeps();

      const browserNavigate = T.tool(
        async (input: { url: string }) => {
          try {
            const page = await getPage();
            const response = await page.goto(input.url, { waitUntil: "domcontentloaded", timeout: 15000 });
            const title = await page.title();
            const status = response?.status() ?? 0;
            return JSON.stringify({ title, status, url: page.url() });
          } catch (err) {
            return `Error navigating: ${(err as Error).message}`;
          }
        },
        {
          name: "browser_navigate",
          description:
            "Open a URL in a headless browser and return the page title and HTTP status. Use this to verify the app is running and reachable.",
          schema: z.object({ url: z.string().describe("The URL to navigate to") }),
        },
      );

      const browserGetText = T.tool(
        async (input: { selector?: string }) => {
          try {
            const page = await getPage();
            const text = input.selector
              ? await page.locator(input.selector).innerText({ timeout: 5000 }).catch(() => "(element not found)")
              : await page.evaluate<string>("document.body.innerText");
            return (text as string).slice(0, 4000);
          } catch (err) {
            return `Error getting text: ${(err as Error).message}`;
          }
        },
        {
          name: "browser_get_text",
          description:
            "Get the visible text content of the current page, or of a specific element identified by a CSS selector. Useful to verify expected content is rendered.",
          schema: z.object({
            selector: z.string().optional().describe("Optional CSS selector — omit to get full page text"),
          }),
        },
      );

      const browserScreenshot = T.tool(
        async () => {
          try {
            const page = await getPage();
            const file = path.join(os.tmpdir(), `specops-review-${Date.now()}.png`);
            await page.screenshot({ path: file, fullPage: false });
            return `Screenshot saved to: ${file}`;
          } catch (err) {
            return `Error taking screenshot: ${(err as Error).message}`;
          }
        },
        {
          name: "browser_screenshot",
          description:
            "Take a screenshot of the current browser page and save it to a temp file. Returns the file path. Use to visually confirm UI state.",
          schema: z.object({}),
        },
      );

      const browserClick = T.tool(
        async (input: { selector: string }) => {
          try {
            const page = await getPage();
            await page.locator(input.selector).click({ timeout: 5000 });
            await page.waitForLoadState("domcontentloaded").catch(() => undefined);
            return `Clicked: ${input.selector}`;
          } catch (err) {
            return `Error clicking: ${(err as Error).message}`;
          }
        },
        {
          name: "browser_click",
          description: "Click an element on the current page by CSS selector.",
          schema: z.object({ selector: z.string().describe("CSS selector of the element to click") }),
        },
      );

      const browserType = T.tool(
        async (input: { selector: string; text: string }) => {
          try {
            const page = await getPage();
            await page.locator(input.selector).fill(input.text, { timeout: 5000 });
            return `Typed into: ${input.selector}`;
          } catch (err) {
            return `Error typing: ${(err as Error).message}`;
          }
        },
        {
          name: "browser_type",
          description: "Fill a text input on the current page with the given text.",
          schema: z.object({
            selector: z.string().describe("CSS selector of the input element"),
            text: z.string().describe("Text to fill in"),
          }),
        },
      );

      const browserClose = T.tool(
        async () => {
          await closeBrowser();
          return "Browser closed.";
        },
        {
          name: "browser_close",
          description: "Close the headless browser. Call this when you are done with browser verification.",
          schema: z.object({}),
        },
      );

      return [browserNavigate, browserGetText, browserScreenshot, browserClick, browserType, browserClose];
    },
  };
}
