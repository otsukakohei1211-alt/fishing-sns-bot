/**
 * diagnose_x.ts — X セッションの状態を診断する。
 * compose 画面を開いて何が表示されるかスクリーンショットと URL で確認する。
 */
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const STATE_FILE = "data/auth/x_state.json";

async function main() {
  if (!existsSync(STATE_FILE)) {
    console.log("x_state.json がありません");
    return;
  }
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  try {
    const ctx = await browser.newContext({
      storageState: STATE_FILE,
      locale: "ja-JP",
      timezoneId: "Asia/Tokyo",
      viewport: { width: 1280, height: 900 },
    });
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    const page = await ctx.newPage();

    page.on("response", (res) => {
      const url = res.url();
      if (url.includes("/i/api/") && res.status() >= 400) {
        console.log(`  API error: ${res.status()} ${url.replace(/^https?:\/\/[^/]+/, "").slice(0, 80)}`);
      }
    });

    console.log("1) ホームへ移動 …");
    await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(6_000);
    console.log("   URL:", page.url());
    await page.screenshot({ path: "data/logs/diag_home.png" });

    console.log("2) compose へ移動 …");
    await page.goto("https://x.com/compose/post", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(6_000);
    console.log("   URL:", page.url());
    await page.screenshot({ path: "data/logs/diag_compose.png" });

    const editorVisible = await page
      .locator('[data-testid="tweetTextarea_0"]')
      .first()
      .isVisible()
      .catch(() => false);
    console.log("   tweetTextarea_0 visible:", editorVisible);

    const bodyText = (await page.locator("body").innerText().catch(() => "")).slice(0, 300);
    console.log("   body 先頭300字:", bodyText.replace(/\n+/g, " | "));
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
