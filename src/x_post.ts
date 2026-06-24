/**
 * x_post.ts — Playwright で X に自動投稿する。
 *
 * 1. メインツイートを投稿（ポストボタンを自動クリック）
 * 2. そのツイートへのリプライとして、当日のデータソースを投稿
 *    （文字数が 275 weight を超える場合はチャンク分割して連続リプライ）
 */

import { chromium, type Page, type Response } from "playwright";
import { existsSync } from "node:fs";
import type { DailyReport } from "./types.js";
import { xWeight } from "./compose.js";

const STATE_FILE = "data/auth/x_state.json";
const MAX_WEIGHT = 275; // 280 以内で少し余裕を持たせる

/** セッション失効による失敗。再ログインが必要なことを通知で区別できるようにする。 */
export class SessionExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionExpiredError";
  }
}

// ── データソースリプライ文の生成 ──────────────────────────────────────────────

export function formatDataSourceReply(report: DailyReport): string {
  const catchLines = report.catches.map(
    (c) =>
      `  ・${c.name}: ${c.count}匹  ${c.minSize}〜${c.maxSize}${c.unit}  (${c.places.join("・")})`,
  );
  return [
    `■ ${report.date}`,
    `天候: ${report.weather}`,
    `水温: ${report.waterTemp}℃`,
    `潮: ${report.tide}`,
    `来場者: ${report.visitors}名`,
    `釣果:`,
    ...catchLines,
  ].join("\n");
}

/** 行単位で 280 weight に収まるようにチャンク分割する */
function splitForX(text: string): string[] {
  const lines = text.split("\n");
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    const next = current.length > 0 ? `${current}\n${line}` : line;
    if (xWeight(next) <= MAX_WEIGHT) {
      current = next;
    } else {
      if (current) chunks.push(current);
      current = line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// ── GraphQL レスポンスからツイート ID を抽出 ─────────────────────────────────

async function extractTweetId(response: Response): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = (await response.json()) as any;
    return json?.data?.create_tweet?.tweet_results?.result?.rest_id ?? null;
  } catch {
    return null;
  }
}

// ── Playwright ヘルパー ───────────────────────────────────────────────────────

/** リプライダイアログを開き、テキストを入力して投稿する。投稿したツイート ID を返す。 */
async function postReply(
  page: Page,
  parentTweetId: string,
  text: string,
  label: string,
  imagePaths?: string[],
): Promise<string | null> {
  console.log(`  ${label}: ツイートページへ移動 …`);
  await page.goto(`https://x.com/i/web/status/${parentTweetId}`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });

  // リプライボタンをクリック
  const replyBtn = page.locator('[data-testid="reply"]').first();
  await replyBtn.waitFor({ timeout: 20_000, state: "visible" });
  await replyBtn.click();

  // リプライ用コンポーズダイアログが開く
  const dialog = page.locator('[role="dialog"][aria-labelledby]').first();
  await dialog.waitFor({ timeout: 15_000, state: "visible" });

  // リプライ用テキストエリア（最後の tweetTextarea_ = 入力欄）
  const editor = dialog.locator('[data-testid^="tweetTextarea_"]').last();
  await editor.waitFor({ timeout: 10_000, state: "visible" });
  await editor.click();
  await page.keyboard.type(text, { delay: 8 });

  // 画像添付（ダイアログ内）
  if (imagePaths && imagePaths.length > 0) {
    try {
      const fileInput = dialog.locator('input[data-testid="fileInput"]').first();
      await fileInput.setInputFiles(imagePaths);
      await dialog.locator('[data-testid="attachments"]').waitFor({ timeout: 20_000, state: "visible" });
      await page.waitForTimeout(800);
    } catch (e) {
      console.warn(`  ${label}: 画像添付失敗（テキストのみ続行）`);
    }
  }

  // 投稿ボタン（ダイアログ内）
  const postBtn = dialog
    .locator('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]')
    .first();
  await postBtn.waitFor({ timeout: 10_000 });

  // 投稿 & CreateTweet レスポンスを同時待ち
  const [, tweetRes] = await Promise.all([
    postBtn.click(),
    page.waitForResponse(
      (res) => res.url().includes("/CreateTweet") && res.status() === 200,
      { timeout: 30_000 },
    ),
  ]);

  await dialog.waitFor({ timeout: 20_000, state: "hidden" });

  const newId = await extractTweetId(tweetRes);
  console.log(`  ${label}: ✅ 投稿完了 (ID: ${newId ?? "unknown"})`);
  return newId;
}

// ── メイン公開 API ────────────────────────────────────────────────────────────

export async function postToX(
  mainPost: string,
  report: DailyReport,
  imagePaths?: string[],
  threadReplies?: Array<{ text: string; images?: string[] }>,
  affiliateReply?: string,
): Promise<void> {
  if (!existsSync(STATE_FILE)) {
    throw new Error(
      `${STATE_FILE} が見つかりません。先に \`npm run x:login\` で初回ログインしてください。`,
    );
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
      permissions: ["clipboard-read", "clipboard-write"],
    });

    // webdriver フラグを消してボット検知を回避
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    const page = await ctx.newPage();

    // ── ネットワークリクエスト監視（デバッグ用）────────────────────────────────
    const apiCalls: string[] = [];
    page.on("response", (res) => {
      const url = res.url();
      if (url.includes("/i/api/") || url.includes("graphql") || url.includes("twitter.com")) {
        const entry = `${res.status()} ${url.replace(/^https?:\/\/[^/]+/, "").slice(0, 100)}`;
        apiCalls.push(entry);
        // CreateTweet 関連はリアルタイムで出力
        if (url.includes("CreateTweet") || url.includes("create_tweet")) {
          console.log(`  X: [API] ${entry}`);
        }
      }
    });

    // ── 1. メインツイートを投稿 ───────────────────────────────────────────────
    console.log("  X: コンポーズ画面を開いています …");
    await page.goto("https://x.com/compose/post", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    // ボット検知回避: ページ読み込み後 5 秒待機してから操作開始
    console.log("  X: 5秒待機中 …");
    await page.waitForTimeout(5_000);

    // セッション失効チェック: ログイン画面へリダイレクトされていないか
    if (/login|logout|onboarding|flow/.test(page.url())) {
      await page.screenshot({ path: "data/logs/debug_session_expired.png" }).catch(() => {});
      throw new SessionExpiredError(
        `X セッションが失効しています (リダイレクト先: ${page.url()})。` +
          "`npm run x:login` で再ログインしてください。",
      );
    }

    // dialog に限定せずページ直接で取得（dialog locator がズレるケース対策）
    const editor = page.locator('[data-testid="tweetTextarea_0"]').first();
    try {
      await editor.waitFor({ timeout: 30_000, state: "visible" });
    } catch (e) {
      await page.screenshot({ path: "data/logs/debug_compose_timeout.png" }).catch(() => {});
      if (/login|logout|onboarding|flow/.test(page.url())) {
        throw new SessionExpiredError(
          `X セッションが失効しています (リダイレクト先: ${page.url()})。` +
            "`npm run x:login` で再ログインしてください。",
        );
      }
      console.log(`  X: コンポーズ画面が開けません (URL: ${page.url()})`);
      console.log("  X: スクリーンショット: data/logs/debug_compose_timeout.png");
      throw e;
    }
    await editor.click();

    // ── テキスト入力（クリップボード経由）──────────────────────────────────
    await page.evaluate((text) => navigator.clipboard.writeText(text), mainPost);
    await page.keyboard.press("Meta+v");
    await page.waitForTimeout(800);

    const afterPaste = await editor.innerText();
    console.log(`  X: エディタ内容 (${afterPaste.length}文字): "${afterPaste.slice(0, 40)}…"`);

    if (afterPaste.trim().length === 0) {
      console.log("  X: クリップボード失敗、pressSequentially でリトライ …");
      await editor.pressSequentially(mainPost, { delay: 40 });
      await page.waitForTimeout(800);
    }

    // ── 画像添付 ────────────────────────────────────────────────────────────
    if (imagePaths && imagePaths.length > 0) {
      console.log(`  X: 画像を添付中 (${imagePaths.length}枚) …`);
      try {
        // X の隠し file input を探して直接ファイルをセット
        const fileInput = page.locator('input[data-testid="fileInput"]').first();
        await fileInput.setInputFiles(imagePaths);

        // 画像プレビューが現れるまで待機（最大20秒）
        await page.locator('[data-testid="attachments"]').waitFor({
          timeout: 20_000,
          state: "visible",
        });
        console.log("  X: 画像アップロード完了");
        await page.waitForTimeout(1_000);
      } catch (e) {
        console.warn(`  X: 画像添付失敗（テキストのみで続行）: ${(e as Error).message.slice(0, 100)}`);
      }
    }

    // デバッグ用スクリーンショット
    await page.screenshot({ path: "data/logs/debug_before_post.png" });

    // 投稿ボタン（ページ直接）
    const postBtn = page
      .locator('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]')
      .first();
    await postBtn.waitFor({ timeout: 15_000, state: "visible" });

    const btnDisabled = await postBtn.getAttribute("aria-disabled");
    console.log(`  X: 投稿ボタン aria-disabled="${btnDisabled}"`);

    // aria-disabled が外れるまで最大 10s 待機
    await page
      .waitForFunction(
        () => {
          const btn =
            document.querySelector('[data-testid="tweetButton"]') ??
            document.querySelector('[data-testid="tweetButtonInline"]');
          if (!btn) return false;
          return (
            !(btn as HTMLButtonElement).disabled &&
            btn.getAttribute("aria-disabled") !== "true"
          );
        },
        { timeout: 10_000 },
      )
      .catch(() => { /* タイムアウトしてもそのまま進む */ });

    console.log("  X: メインツイートを投稿中 …");
    // 即 .catch(() => null) を付けて unhandled rejection を防ぐ
    const mainTweetResPromise = page
      .waitForResponse(
        (res) => res.url().includes("/CreateTweet"),
        { timeout: 30_000 },
      )
      .catch(() => null);

    // JS 直接クリック（Playwright click が遮蔽される場合のフォールバック）
    await page.evaluate(() => {
      const btn =
        (document.querySelector('[data-testid="tweetButton"]') ??
         document.querySelector('[data-testid="tweetButtonInline"]')) as HTMLElement | null;
      if (btn) btn.click();
    });
    // Playwright click も念のため
    await postBtn.click({ force: true }).catch(() => { /* ignore */ });

    const mainTweetRes = await mainTweetResPromise;
    if (!mainTweetRes) {
      // タイムアウト — デバッグ情報を出力してから失敗
      await page.screenshot({ path: "data/logs/debug_after_click.png" }).catch(() => {});
      console.log(`  X: CreateTweet 未着。クリック後 API コール (${apiCalls.length}件):`);
      apiCalls.slice(-30).forEach((c) => console.log(`    ${c}`));
      throw new Error("CreateTweet レスポンスが 30s 以内に受信できませんでした");
    }
    console.log(`  X: CreateTweet レスポンス status=${mainTweetRes.status()}`);

    // ダイアログが閉じるのを待つ（閉じなくても継続）
    await page
      .locator('[role="dialog"][aria-labelledby]')
      .first()
      .waitFor({ timeout: 20_000, state: "hidden" })
      .catch(() => { /* タイムアウトは無視 */ });

    const mainTweetId = await extractTweetId(mainTweetRes);
    if (!mainTweetId) {
      console.warn("  ⚠️  メインツイートの ID が取得できませんでした。リプライをスキップします。");
      return;
    }
    console.log(`  ✅ メインツイート投稿完了 (ID: ${mainTweetId})`);

    // ── 2. スレッドリプライ（fish_feature 用）または データソースリプライ ────────
    let parentId = mainTweetId;

    if (threadReplies && threadReplies.length > 0) {
      // スレッド形式のリプライ
      for (let i = 0; i < threadReplies.length; i++) {
        const { text, images } = threadReplies[i];
        const label = `スレッド ${i + 1}/${threadReplies.length}`;
        const newId = await postReply(page, parentId, text, label, images);
        if (!newId) {
          console.warn(`  ⚠️  ${label} の ID 取得失敗。残りをスキップします。`);
          break;
        }
        parentId = newId;
      }
    } else {
      // 従来のデータソースリプライ
      const replyText = formatDataSourceReply(report);
      const chunks = splitForX(replyText);
      console.log(`  データソースリプライ: ${chunks.length} チャンク`);

      for (let i = 0; i < chunks.length; i++) {
        const label = `リプライ ${i + 1}/${chunks.length}`;
        const newId = await postReply(page, parentId, chunks[i], label);
        if (!newId) {
          if (i < chunks.length - 1) {
            console.warn(`  ⚠️  ${label} の ID 取得失敗。残りチャンクをスキップします。`);
          }
          break;
        }
        parentId = newId;
      }
    }

    // ── 3. アフィリエイトリンクをスレッド末尾にぶら下げる ──────────────────────
    if (affiliateReply && parentId) {
      await postReply(page, parentId, affiliateReply, "アフィリンク").catch((e) => {
        // アフィリンク失敗は本投稿の成否に影響させない
        console.warn(`  アフィリンク: 投稿失敗（続行）: ${(e as Error).message.slice(0, 100)}`);
        return null;
      });
    }
  } finally {
    await browser.close();
  }
}
