import { chromium } from "playwright";
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const STATE_FILE = "data/auth/x_state.json";

async function findLatestPostFile(): Promise<string> {
  const files = (await readdir("data/snapshots"))
    .filter((f) => f.startsWith("post_") && f.endsWith(".txt"))
    .sort();
  if (files.length === 0) {
    throw new Error(
      "投稿文ファイルが見つかりません。先に `npm run compose` か `npm run run:weekly` を実行してください。",
    );
  }
  return `data/snapshots/${files[files.length - 1]}`;
}

if (!existsSync(STATE_FILE)) {
  console.error(
    `${STATE_FILE} が見つかりません。先に \`npm run x:login\` で初回ログインしてください。`,
  );
  process.exit(1);
}

const postFile = process.argv[2] ?? (await findLatestPostFile());
const text = (await readFile(postFile, "utf8")).trim();
const charCount = Array.from(text).length;
console.log(`source: ${postFile} (${charCount} chars)`);

const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({
  storageState: STATE_FILE,
  locale: "ja-JP",
  timezoneId: "Asia/Tokyo",
  viewport: { width: 1280, height: 900 },
});
const page = await ctx.newPage();

console.log("opening X compose page …");
await page.goto("https://x.com/compose/post", { waitUntil: "domcontentloaded" });

// /compose/post opens as a modal overlaid on the home timeline, so both the
// modal's textarea and the home inline composer match the same testid. Scope
// to the modal (role=dialog) to disambiguate.
const dialog = page.locator('[role="dialog"][aria-labelledby]').first();
try {
  await dialog.waitFor({ timeout: 30_000, state: "visible" });
} catch {
  console.error(
    "ポスト作成モーダルが開けませんでした。セッションが切れている可能性があります。`npm run x:login` を再実行してください。",
  );
  await browser.close();
  process.exit(1);
}

const editor = dialog.locator('[data-testid="tweetTextarea_0"]').first();
await editor.waitFor({ timeout: 10_000 });
await editor.click();

// keyboard.type sends \n as Enter, producing real line breaks in X's contenteditable.
await page.keyboard.type(text, { delay: 8 });

console.log("");
console.log("--------------------------------------------------------------");
console.log("✅ 本文を入力しました。ブラウザで内容を確認してください。");
console.log("");
console.log("  - 問題なければ、ブラウザの『ポストする』ボタンを押してください。");
console.log("  - 編集したい場合はそのまま編集できます。");
console.log("  - このスクリプトはここで停止しています。");
console.log("  - 終了するにはこのターミナルで Ctrl+C を押すか、ブラウザを閉じてください。");
console.log("--------------------------------------------------------------");

// Exit cleanly if the user closes the browser window.
browser.on("disconnected", () => {
  console.log("ブラウザが閉じられたので終了します。");
  process.exit(0);
});

// Keep the script alive so the browser stays open.
await new Promise<void>(() => {});
