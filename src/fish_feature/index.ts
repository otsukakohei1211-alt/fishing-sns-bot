/**
 * fish_feature/index.ts — 魚種特集投稿のオーケストレーター
 *
 * 実行: npx tsx src/fish_feature/index.ts
 * 1. 次の魚種を選択（ローテーション）
 * 2. データ集計 + FES計算
 * 3. グラフ画像2枚生成（直近4週 + 月別年間）
 * 4. 投稿文生成
 * 5. X に投稿（画像付き）
 * 6. post_log に記録
 */

import { mkdir } from "node:fs/promises";
import "dotenv/config";
import { getDb, closeDb } from "../db/index.ts";
import { selectNextFish, buildFishFeatureData, getMonthlyAvg } from "./data.ts";
import { generateFishChart, generateMonthlyChart } from "./chart.ts";
import { composeFishFeaturePost } from "./compose.ts";
import { postToX } from "../x_post.ts";
import { sendPostNotification } from "../notify.ts";
import { xWeight } from "../compose.ts";
import type { DailyReport } from "../types.ts";

const FACILITY = process.env.FEATURE_FACILITY ?? "honmoku";
const DRY_RUN = process.env.DRY_RUN === "1";

async function main() {
  console.log(`=== fish_feature 開始 (${FACILITY})${DRY_RUN ? " [DRY_RUN]" : ""} ===`);
  const db = getDb();

  await mkdir("data/charts", { recursive: true });

  // ── [1/5] 魚種選択 ──────────────────────────────────────────────────────────
  // FEATURE_FISH 環境変数で魚種を直接指定可能（例: FEATURE_FISH=ウミタナゴ）
  let fish = selectNextFish(FACILITY);
  const overrideName = process.env.FEATURE_FISH;
  if (overrideName) {
    const overrideRow = db.prepare("SELECT id, name FROM fish WHERE name = ?").get(overrideName) as { id: number; name: string } | undefined;
    if (overrideRow) {
      fish = { ...overrideRow, score: -1 };
      console.log(`[1/5] 魚種指定（FEATURE_FISH）: ${fish.name}`);
    } else {
      console.warn(`[1/5] FEATURE_FISH="${overrideName}" が見つかりません。自動選択に切り替え。`);
    }
  } else {
    console.log(`[1/5] 対象魚種: ${fish.name} (id: ${fish.id}, 注目度スコア: ${fish.score})`);
  };

  // ── [2/5] データ集計 ─────────────────────────────────────────────────────────
  console.log("[2/5] データ集計中...");
  const data = await buildFishFeatureData(fish.id, FACILITY);
  console.log(`    直近: ${data.summary.trendDirection} (${data.summary.trendPrevAvg}→${data.summary.trendRecentAvg}匹/日)`);
  console.log(`    FES: ${data.fes.score}/100 (${data.fes.grade})`);
  console.log(`    仕掛け統計: ${data.tactics.length}件`);

  // ── [3/5] グラフ画像生成（2枚）──────────────────────────────────────────────
  console.log("[3/5] グラフ生成中...");
  const today = new Date().toISOString().slice(0, 10);
  const chartPath    = `data/charts/feature_${FACILITY}_${fish.name}_${today}.png`;
  const monthlyPath  = `data/charts/feature_monthly_${FACILITY}_${fish.name}_${today}.png`;

  await generateFishChart(
    fish.name, FACILITY, data.recentDays, chartPath,
    data.fes.score, data.fes.grade,
  );
  console.log(`    直近4週: ${chartPath}`);

  const monthlyData = getMonthlyAvg(fish.id, FACILITY);
  await generateMonthlyChart(fish.name, FACILITY, monthlyData, monthlyPath);
  console.log(`    月別年間: ${monthlyPath}`);

  // ── [4/5] 投稿文生成（スレッド形式） ────────────────────────────────────────
  console.log("[4/5] 投稿文生成中（スレッド4ツイート）...");
  const thread = await composeFishFeaturePost(data);
  const mainWeight = xWeight(thread.main);

  if (mainWeight > 280) {
    throw new Error(`メイン投稿が文字数超過 (${mainWeight}/280)。中止します。`);
  }

  console.log(`    メイン: ${mainWeight}/280`);
  thread.replies.forEach((r, i) => {
    console.log(`    リプライ${i + 1}: ${xWeight(r)}/280`);
  });
  console.log("---- スレッド ----");
  console.log("[メイン]");
  console.log(thread.main);
  thread.replies.forEach((r, i) => {
    console.log(`\n[リプライ${i + 1}]`);
    console.log(r);
  });
  console.log("---- end ----");

  if (DRY_RUN) {
    db.prepare(`
      INSERT INTO post_log (post_type, fish_id, facility, content_text, status)
      VALUES ('fish_feature', ?, ?, ?, 'dry_run')
    `).run(fish.id, FACILITY, thread.main);
    console.log("✅ DRY_RUN 完了（X投稿スキップ）");
    closeDb();
    return;
  }

  // ── [5/5] X に投稿（画像2枚 + スレッド） ─────────────────────────────────────
  console.log("[5/5] X に投稿中...");

  const dummyReport: DailyReport = {
    facility: FACILITY as "honmoku" | "daikoku" | "isogo",
    date: today.replace(/-/g, "/"),
    weather: "", waterTemp: "", tide: "", visitors: 0, comment: "", catches: [],
    fetchedAt: new Date().toISOString(),
  };

  // メインツイート: 月別グラフ（大局）
  // リプライ1: 釣り方 + 直近4週グラフ
  // リプライ2〜3: テキストのみ
  const threadReplies = thread.replies.map((text, i) => ({
    text,
    images: i === 0 ? [chartPath] : undefined,  // リプライ1に直近4週グラフ
  }));

  await postToX(thread.main, dummyReport, [monthlyPath], threadReplies);

  // post_log に記録
  db.prepare(`
    INSERT INTO post_log (post_type, fish_id, facility, content_text, status)
    VALUES ('fish_feature', ?, ?, ?, 'success')
  `).run(fish.id, FACILITY, thread.main);

  // メール通知
  try {
    await sendPostNotification({
      post: thread.main,
      weight: mainWeight,
      reports: [],
      postFile: chartPath,
    });
  } catch (e) {
    console.warn("  メール通知失敗:", (e as Error).message);
  }

  console.log("✅ 完了");
  closeDb();
}

main().catch((e) => {
  console.error(e);
  closeDb();
  process.exit(1);
});
