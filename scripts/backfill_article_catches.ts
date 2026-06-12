/**
 * backfill_article_catches.ts — 既存の記事JSONに釣果データ（catches/tide/visitors）を
 * DB から補完する。catches が既にある記事はスキップ。
 *
 * 実行: npx tsx scripts/backfill_article_catches.ts
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import "dotenv/config";
import { getDb, closeDb } from "../src/db/index.ts";

const REPORTS_DIR = "site/src/data/reports";

function main() {
  const db = getDb();
  const fishLookup = db.prepare("SELECT id FROM fish WHERE name = ?");
  const condLookup = db.prepare(
    "SELECT tide, visitors FROM daily_conditions WHERE facility = ? AND date = ?",
  );
  const catchLookup = db.prepare(`
    SELECT fish_name, count, min_size, max_size, unit, places
    FROM catch_records
    WHERE facility = ? AND date = ? AND count > 0
    ORDER BY count DESC
  `);

  const files = readdirSync(REPORTS_DIR).filter(
    (f) => f.endsWith(".json") && f !== "index.json",
  );

  let updated = 0;
  for (const file of files) {
    const path = join(REPORTS_DIR, file);
    const article = JSON.parse(readFileSync(path, "utf8"));
    if (article.catches?.length) {
      console.log(`  skip (補完済み): ${file}`);
      continue;
    }

    const date = article.date as string;
    const facility = (article.facility as string) ?? "honmoku";

    const rows = catchLookup.all(facility, date) as Array<{
      fish_name: string; count: number; min_size: number;
      max_size: number; unit: string; places: string;
    }>;
    if (rows.length === 0) {
      console.log(`  ⚠️ DBに釣果なし: ${file} (${date})`);
      continue;
    }

    article.catches = rows.map((r) => {
      const fish = fishLookup.get(r.fish_name) as { id: number } | undefined;
      return {
        fishId: fish?.id ?? null,
        name: r.fish_name,
        count: r.count,
        minSize: r.min_size,
        maxSize: r.max_size,
        unit: r.unit,
        places: JSON.parse(r.places || "[]"),
      };
    });

    const cond = condLookup.get(facility, date) as
      | { tide: string | null; visitors: number | null }
      | undefined;
    if (cond) {
      if (article.tide === undefined && cond.tide) article.tide = cond.tide;
      if (article.visitors === undefined && cond.visitors != null) article.visitors = cond.visitors;
    }

    writeFileSync(path, JSON.stringify(article, null, 2) + "\n", "utf8");
    console.log(`  ✅ ${file}: ${article.catches.length} 魚種を補完`);
    updated++;
  }

  console.log(`完了: ${updated}/${files.length} 件を更新`);
  closeDb();
}

main();
