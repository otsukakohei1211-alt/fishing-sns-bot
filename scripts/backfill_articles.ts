/**
 * backfill_articles.ts — 既存DB データから過去日付の記事を一括生成
 *
 * 実行例: npx tsx scripts/backfill_articles.ts 2026/06/01 2026/06/02
 */

import "dotenv/config";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { getDb, closeDb } from "../src/db/index.ts";
import { composeArticle } from "../src/compose_article.ts";
import type { ComposeContext } from "../src/compose.ts";
import type { DailyReport } from "../src/types.ts";

function buildReport(facility: string, date: string): DailyReport | null {
  const db = getDb();

  const cond = db.prepare(
    "SELECT weather, water_temp, tide, visitors, comment FROM daily_conditions WHERE facility=? AND date=?"
  ).get(facility, date) as {
    weather: string; water_temp: number; tide: string;
    visitors: number; comment: string;
  } | undefined;

  if (!cond) return null;

  const rows = db.prepare(
    "SELECT fish_name, count, min_size, max_size, unit, places FROM catch_records WHERE facility=? AND date=? AND count>0 ORDER BY count DESC"
  ).all(facility, date) as Array<{
    fish_name: string; count: number; min_size: number;
    max_size: number; unit: string; places: string;
  }>;

  return {
    facility: facility as "honmoku",
    date,
    weather: cond.weather ?? "",
    waterTemp: String(cond.water_temp ?? ""),
    tide: cond.tide ?? "",
    visitors: cond.visitors ?? 0,
    comment: cond.comment ?? "",
    catches: rows.map((r) => ({
      name: r.fish_name,
      count: r.count,
      minSize: r.min_size,
      maxSize: r.max_size,
      unit: r.unit,
      places: JSON.parse(r.places ?? "[]") as string[],
    })),
    fetchedAt: new Date().toISOString(),
  };
}

function computeBakuchouIndex(totalToday: number, facility: string, date: string): number | undefined {
  if (totalToday === 0) return undefined;
  const db = getDb();
  const thisMonth = date.slice(0, 7); // "2026/06"
  const r = db.prepare(`
    SELECT ROUND(AVG(daily_total), 1) AS monthly_avg
    FROM (
      SELECT SUM(count) AS daily_total
      FROM catch_records
      WHERE facility=? AND SUBSTR(date,1,7)=?
      GROUP BY date
    )
  `).get(facility, thisMonth) as { monthly_avg: number } | undefined;
  if (!r?.monthly_avg) return undefined;
  return Math.round((totalToday / r.monthly_avg) * 100);
}

function getPrevWeekContext(facility: string, date: string): Pick<ComposeContext, "prevWeekWaterTemp" | "prevWeekTopCatches"> {
  const d = new Date(date.replace(/\//g, "-") + "T00:00:00+09:00");
  d.setDate(d.getDate() - 7);
  const pw = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}`;

  const db = getDb();
  const cond = db.prepare("SELECT water_temp FROM daily_conditions WHERE facility=? AND date=?").get(facility, pw) as { water_temp: number } | undefined;
  const catches = db.prepare("SELECT fish_name FROM catch_records WHERE facility=? AND date=? AND count>0 ORDER BY count DESC LIMIT 3").all(facility, pw) as Array<{ fish_name: string }>;
  return {
    prevWeekWaterTemp: cond?.water_temp != null ? String(cond.water_temp) : undefined,
    prevWeekTopCatches: catches.map((c) => c.fish_name),
  };
}

async function main() {
  const dates = process.argv.slice(2);
  if (dates.length === 0) {
    console.error("使用方法: npx tsx scripts/backfill_articles.ts 2026/06/01 2026/06/02");
    process.exit(1);
  }

  const reportsDir = "site/src/data/reports";
  await mkdir(reportsDir, { recursive: true });

  type IndexEntry = {
    slug: string; date: string; title: string; lead: string;
    topCatches: string[]; bakuchouIndex?: number;
  };

  let index: IndexEntry[] = [];
  const indexFile = `${reportsDir}/index.json`;
  if (existsSync(indexFile)) {
    index = JSON.parse(await readFile(indexFile, "utf8")) as IndexEntry[];
  }

  for (const date of dates) {
    console.log(`\n=== ${date} ===`);
    const report = buildReport("honmoku", date);
    if (!report) { console.log("  DBにデータなし、スキップ"); continue; }

    const totalToday = report.catches.reduce((s, c) => s + c.count, 0);
    const ctx: ComposeContext = {
      bakuchouIndex: computeBakuchouIndex(totalToday, "honmoku", date),
      ...getPrevWeekContext("honmoku", date),
    };

    console.log(`  爆釣指数: ${ctx.bakuchouIndex ?? "N/A"}%`);
    console.log(`  先週上位: ${ctx.prevWeekTopCatches?.join("、") ?? "なし"}`);
    console.log("  記事生成中 …");

    const article = await composeArticle([report], ctx);
    const articleFile = `${reportsDir}/${article.slug}.json`;
    await writeFile(articleFile, JSON.stringify(article, null, 2), "utf8");
    console.log(`  保存: ${articleFile}`);
    console.log(`  タイトル: ${article.title}`);

    index = index.filter((e) => e.slug !== article.slug);
    index.unshift({
      slug: article.slug, date: article.date, title: article.title,
      lead: article.lead, topCatches: article.topCatches,
      bakuchouIndex: article.bakuchouIndex,
    });
  }

  closeDb();
  index = index.slice(0, 50).sort((a, b) => b.date.localeCompare(a.date));
  await writeFile(indexFile, JSON.stringify(index, null, 2), "utf8");
  console.log(`\nindex.json 更新: ${index.length}件`);
}

main().catch((e) => { console.error(e); process.exit(1); });
