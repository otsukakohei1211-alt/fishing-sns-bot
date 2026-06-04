/**
 * batch_post.ts — 複数魚種を指定間隔で連続投稿する
 * 実行: npx tsx scripts/batch_post.ts ハゼ カサゴ メゴチ サバ
 */

import { execSync } from "node:child_process";

const INTERVAL_MIN = 60;
const fish = process.argv.slice(2);

if (fish.length === 0) {
  console.error("使い方: npx tsx scripts/batch_post.ts 魚名1 魚名2 ...");
  process.exit(1);
}

console.log(`=== バッチ投稿開始 ===`);
console.log(`対象: ${fish.join(" → ")}`);
console.log(`間隔: ${INTERVAL_MIN}分\n`);

for (let i = 0; i < fish.length; i++) {
  const name = fish[i];
  const now = new Date().toLocaleTimeString("ja-JP");

  if (i > 0) {
    console.log(`\n⏳ ${INTERVAL_MIN}分待機中... (${now})`);
    await new Promise((r) => setTimeout(r, INTERVAL_MIN * 60 * 1000));
  }

  console.log(`\n[${i + 1}/${fish.length}] ${name} を投稿中... (${new Date().toLocaleTimeString("ja-JP")})`);
  try {
    execSync(`FEATURE_FISH=${name} npm run run:feature`, {
      stdio: "inherit",
      cwd: "/Users/koheiotsuka/fishing-sns-bot",
    });
    console.log(`✅ ${name} 完了`);
  } catch (e) {
    console.error(`❌ ${name} 失敗:`, (e as Error).message.slice(0, 100));
  }
}

console.log(`\n=== 全 ${fish.length} 種の投稿完了 ===`);
