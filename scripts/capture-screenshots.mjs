/**
 * Captures the documentation screenshots against a running dev server.
 *
 * Every figure on screen comes from the fictional sample plan below — no real
 * balances are ever used for documentation.
 *
 *   npm run dev            # in one terminal
 *   npm run screenshots    # in another
 */
import { mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";

const BASE_URL = process.env.SCREENSHOT_URL ?? "http://localhost:5173";
const OUT_DIR = resolve(process.cwd(), "docs", "screenshots");
const WIDTH = 1440;
const HEIGHT = 1000;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  `${process.env.LOCALAPPDATA ?? ""}/Google/Chrome/Application/chrome.exe`,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

/** A fictional two-person household, used only for documentation. */
const SAMPLE_PLAN = {
  extra: 250,
  strategy: "snowball",
  debts: [
    { id: 1, name: "Riverside Store Card", balance: 840, original: 1500, apr: 26.99, minimum: 35, dueDay: 6, accent: "#a2704f", mark: "R", owner: "Jordan" },
    { id: 2, name: "Northgate Rewards Visa", balance: 3180, original: 4200, apr: 22.49, minimum: 95, dueDay: 12, accent: "#5b7fa6", mark: "N", owner: "Jordan" },
    { id: 3, name: "Blue Harbor Mastercard", balance: 6740, original: 8000, apr: 19.99, minimum: 170, dueDay: 18, accent: "#3f6d63", mark: "B", owner: "Sam" },
    { id: 4, name: "Summit Travel Card", balance: 2260, original: 3500, apr: 24.99, minimum: 70, dueDay: 23, accent: "#7a6b95", mark: "S", owner: "Sam" },
  ],
};

const SHOTS = [
  { file: "01-overview", view: "Overview", full: true },
  { file: "02-accounts", view: "Accounts" },
  { file: "03-payoff-plan", view: "Payoff Plan", full: true },
  { file: "04-schedule", view: "Schedule", full: true },
  { file: "05-progress", view: "Progress", full: true },
  { file: "06-progress-by-cardholder", view: "Progress", byOwner: true, full: true },
  { file: "07-reminders", view: "Reminders" },
  { file: "08-settings", view: "Settings", full: true },
];

function findChrome() {
  const found = CHROME_CANDIDATES.find((path) => existsSync(path));
  if (!found) {
    throw new Error(
      `No Chrome or Edge found. Set CHROME_PATH to the executable.\nLooked in:\n  ${CHROME_CANDIDATES.join("\n  ")}`,
    );
  }
  return found;
}

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: "shell",
  defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 },
  args: ["--hide-scrollbars", "--force-color-profile=srgb", "--font-render-hinting=none"],
});

try {
  const page = await browser.newPage();
  await page.goto(BASE_URL, { waitUntil: "networkidle0" });

  await page.evaluate((plan) => {
    localStorage.setItem("debt-snowball-state", JSON.stringify(plan));
    localStorage.removeItem("debt-snowball-hide-support");
  }, SAMPLE_PLAN);

  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector(".hero-grid", { timeout: 15000 });

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  for (const shot of SHOTS) {
    // The nav button holds an icon glyph plus the label, so match the label
    // span rather than the whole textContent.
    const switched = await page.evaluate((view) => {
      const button = [...document.querySelectorAll(".sidebar nav button")]
        .find((candidate) => candidate.querySelector("span:last-child")?.textContent.trim() === view);
      if (!button) return false;
      button.click();
      return true;
    }, shot.view);
    if (!switched) throw new Error(`Could not find the "${shot.view}" nav button`);

    if (shot.byOwner) {
      const toggled = await page.evaluate(() => {
        const toggle = [...document.querySelectorAll(".segmented button")]
          .find((candidate) => candidate.textContent.includes("cardholder"));
        if (!toggle) return false;
        toggle.click();
        return true;
      });
      if (!toggled) throw new Error("Could not find the by-cardholder toggle");
    }

    // Let the view transition and the chart's resize measurement settle.
    await new Promise((done) => setTimeout(done, 700));

    const heading = await page.$eval(".topbar h1", (node) => node.textContent.trim());
    const expected = shot.view === "Overview" ? "Good" : shot.view;
    if (!heading.includes(expected)) {
      throw new Error(`Expected the "${shot.view}" view but the page reads "${heading}"`);
    }

    const path = resolve(OUT_DIR, `${shot.file}.png`);
    await page.screenshot({ path, fullPage: Boolean(shot.full) });
    console.log(`  ${shot.file}.png  (${heading})`);
  }

  console.log(`\nWrote ${SHOTS.length} screenshots to docs/screenshots/`);
} finally {
  await browser.close();
}
