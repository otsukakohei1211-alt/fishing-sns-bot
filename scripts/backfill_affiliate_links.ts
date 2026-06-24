/**
 * backfill_affiliate_links.ts — 既存レポート JSON の affiliateLinks を現行ロジックで再計算する。
 *
 * 記事本文（lead/sections 等）には触れず、affiliateLinks フィールドだけを
 * getAffiliateLinks() の最新出力で上書きする。LLM 再生成は不要。
 *
 * 実行: npx tsx scripts/backfill_affiliate_links.ts
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getAffiliateLinks, type AffiliateLink } from "../src/affiliate.ts";

const REPORTS_DIR = "site/src/data/reports";

type ReportCatch = { name: string; count: number };
type Report = { slug: string; catches?: ReportCatch[]; affiliateLinks: AffiliateLink[] };

function main() {
  const files = readdirSync(REPORTS_DIR).filter(
    (f) => f.endsWith(".json") && f !== "index.json",
  );

  let changed = 0;
  for (const file of files) {
    const path = join(REPORTS_DIR, file);
    const report = JSON.parse(readFileSync(path, "utf8")) as Report;

    const fishNames = [...(report.catches ?? [])]
      .sort((a, b) => b.count - a.count)
      .map((c) => c.name);

    const next = getAffiliateLinks(fishNames, 10, { maxSpecies: 5 });
    const before = JSON.stringify(report.affiliateLinks);
    report.affiliateLinks = next;
    const after = JSON.stringify(next);

    if (before !== after) {
      writeFileSync(path, JSON.stringify(report, null, 2), "utf8");
      const productCount = next.filter((l) => l.url.includes("/dp/")).length;
      console.log(`  更新: ${file}  (商品リンク ${productCount}/${next.length})`);
      changed++;
    }
  }

  console.log(`\n完了: ${files.length} 件中 ${changed} 件を更新しました。`);
}

main();
