/**
 * repost_one.ts — 失敗した日の X 投稿をスナップショットから再投稿するワンオフ。
 *
 * 使い方: tsx scripts/repost_one.ts 2026-06-25
 *   - data/snapshots/post_<date>.txt        … メイン投稿文
 *   - data/snapshots/honmoku_<date>.json    … reports[]（データソースリプライ用）
 *   - site/src/data/reports/honmoku-<date>.json … topCatches（アフィリンク用）
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { postToX } from "../src/x_post.js";
import { formatAffiliateReply } from "../src/affiliate.js";
import type { DailyReport } from "../src/types.js";

async function main() {
  const date = process.argv[2];
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("使い方: tsx scripts/repost_one.ts YYYY-MM-DD");
    process.exit(1);
  }

  const post = (await readFile(`data/snapshots/post_${date}.txt`, "utf8")).trim();
  const reports = JSON.parse(
    await readFile(`data/snapshots/honmoku_${date}.json`, "utf8"),
  ) as DailyReport[];
  const report = reports[0];
  const article = JSON.parse(
    await readFile(`site/src/data/reports/honmoku-${date}.json`, "utf8"),
  ) as { topCatches: string[] };

  const affiliateReply = formatAffiliateReply(article.topCatches, 2) ?? undefined;

  console.log(`=== 再投稿: ${date} ===`);
  console.log("---- post ----");
  console.log(post);
  console.log("---- end ----");

  await postToX(post, report, undefined, undefined, affiliateReply);
  console.log("✅ 再投稿完了");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
