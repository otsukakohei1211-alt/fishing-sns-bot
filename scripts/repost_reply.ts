/**
 * repost_reply.ts — 既存ツイートへリプライを1件だけ投稿し直すワンオフ。
 * 主にアフィリンクの取りこぼし救済用。
 *
 * 使い方: tsx scripts/repost_reply.ts <parentTweetId> <text>
 */
import "dotenv/config";
import { existsSync } from "node:fs";
import { chromium } from "playwright";
import { postReply } from "../src/x_post.js";

const STATE_FILE = "data/auth/x_state.json";

async function main() {
  const parentId = process.argv[2];
  const text = process.argv[3];
  if (!parentId || !text) {
    console.error("使い方: tsx scripts/repost_reply.ts <parentTweetId> <text>");
    process.exit(1);
  }
  if (!existsSync(STATE_FILE)) throw new Error(`${STATE_FILE} が見つかりません`);

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
      permissions: ["clipboard-read", "clipboard-write"],
    });
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    const page = await ctx.newPage();
    const id = await postReply(page, parentId, text, "リプライ");
    console.log(`✅ 完了 (ID: ${id ?? "unknown"})`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
