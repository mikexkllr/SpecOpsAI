// Rasterize assets/icon.svg -> assets/icon.png with a transparent background.
// Uses the Chromium that ships with Playwright (already a dependency) so the
// corners outside the squircle stay transparent — qlmanage flattens them to
// white, which shows up as white borders on the macOS dock.
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SIZE = 1024;
const svg = readFileSync(join(root, "assets/icon.svg"), "utf8");

// Use the system Chrome so we don't need to download Playwright's Chromium.
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({
  viewport: { width: SIZE, height: SIZE },
  deviceScaleFactor: 1,
});
await page.setContent(
  `<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`,
  { waitUntil: "networkidle" },
);
const el = await page.$("svg");
const png = await el.screenshot({ omitBackground: true });
writeFileSync(join(root, "assets/icon.png"), png);
await browser.close();
console.log(`wrote assets/icon.png (${png.length} bytes, ${SIZE}x${SIZE})`);
