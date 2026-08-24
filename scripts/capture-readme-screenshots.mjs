import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(projectRoot, "docs/images");
const baseUrl = process.env.PIKMIN_SCREENSHOT_URL?.trim() || "http://127.0.0.1:3000";

await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
  locale: "zh-TW",
  colorScheme: "light",
  reducedMotion: "reduce",
});
const page = await context.newPage();

async function settle() {
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        caret-color: transparent !important;
      }
    `,
  });
  await page.waitForTimeout(150);
}

async function screenshot(name) {
  await settle();
  await page.screenshot({
    path: path.join(outputDirectory, name),
    type: "jpeg",
    quality: 86,
    fullPage: false,
  });
}

async function openPostcard(id, name) {
  const search = page.getByRole("searchbox");
  await search.fill(name);
  const card = page.locator(`[data-postcard-id="${id}"]`);
  await card.waitFor({ state: "visible" });
  await card.locator(".image-button").click();
  await page.locator(".detail-modal").waitFor({ state: "visible" });
}

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.locator(".postcard-card").first().waitFor({ state: "visible" });
  const noticeClose = page.getByRole("button", { name: "關閉通知" });
  if (await noticeClose.isVisible().catch(() => false)) await noticeClose.click();
  await page.locator("#archive").evaluate((element) => {
    window.scrollTo({ top: element.getBoundingClientRect().top + window.scrollY, behavior: "instant" });
  });
  await screenshot("archive-overview.jpg");

  await openPostcard("pc-0151", "ミクリガ池");
  await screenshot("postcard-detail.jpg");
  await page.getByRole("button", { name: "關閉" }).click();

  await openPostcard("pc-0130", "中国同盟会発祥の地");
  await page.locator(".research-summary-button").click();
  await page.locator("#research-dialog").waitFor({ state: "visible" });
  await screenshot("long-research.jpg");
  await page.getByRole("button", { name: "關閉長版研究" }).click();
  await page.getByRole("button", { name: "關閉" }).click();

  await page.getByRole("button", { name: "朋友足跡" }).click();
  const friendSection = page.locator(".friend-section");
  await friendSection.waitFor({ state: "visible" });
  await friendSection.evaluate((element) => {
    const top = element.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top, behavior: "instant" });
  });
  await screenshot("friend-footprints.jpg");

  await page.goto(`${baseUrl}/settings`, { waitUntil: "networkidle" });
  await page.locator(".settings-content").waitFor({ state: "visible" });
  await screenshot("settings.jpg");
} finally {
  await browser.close();
}

console.log(`README screenshots written to ${outputDirectory}`);
