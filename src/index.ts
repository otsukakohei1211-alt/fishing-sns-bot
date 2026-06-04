import { writeFile, readFile, mkdir, access } from "node:fs/promises";
import "dotenv/config";
import { fetchRecentHonmoku } from "./scrapers/honmoku.js";
import { composePost, xWeight, type ComposeContext } from "./compose.js";
import { composeArticle } from "./compose_article.js";
import { sendPostNotification } from "./notify.js";
import { postToX } from "./x_post.js";
import { getDb, closeDb } from "./db/index.js";

// ── コンテキスト計算ヘルパー ──────────────────────────────────────────────────

function computeBakuchouIndex(totalToday: number, facility: string): number | undefined {
  if (totalToday === 0) return undefined;
  const db = getDb();
  const thisMonth = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 7).replace("-", "/");
  const r = db.prepare(`
    SELECT ROUND(AVG(daily_total), 1) AS monthly_avg
    FROM (
      SELECT SUM(count) AS daily_total
      FROM catch_records
      WHERE facility = ? AND SUBSTR(date, 1, 7) = ?
      GROUP BY date
    )
  `).get(facility, thisMonth) as { monthly_avg: number } | undefined;
  if (!r?.monthly_avg) return undefined;
  return Math.round((totalToday / r.monthly_avg) * 100);
}

function getLastWeekContext(facility: string, todayYmd: string): Pick<ComposeContext, "prevWeekWaterTemp" | "prevWeekTopCatches"> {
  const d = new Date(todayYmd.replace(/\//g, "-") + "T00:00:00+09:00");
  d.setDate(d.getDate() - 7);
  const lastWeekDate = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;

  const db = getDb();
  const cond = db.prepare(
    "SELECT water_temp FROM daily_conditions WHERE facility = ? AND date = ?"
  ).get(facility, lastWeekDate) as { water_temp: number } | undefined;

  const catches = db.prepare(`
    SELECT fish_name FROM catch_records
    WHERE facility = ? AND date = ? AND count > 0
    ORDER BY count DESC LIMIT 3
  `).all(facility, lastWeekDate) as Array<{ fish_name: string }>;

  return {
    prevWeekWaterTemp: cond?.water_temp != null ? String(cond.water_temp) : undefined,
    prevWeekTopCatches: catches.map((c) => c.fish_name),
  };
}

// ── JST の今日の日付 (YYYY/MM/DD) ────────────────────────────────────────────
function todayJst(): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const today = todayJst();
  const stamp = today.replace(/\//g, "-"); // YYYY-MM-DD（ファイル名用）

  await mkdir("data/snapshots", { recursive: true });

  // ── 二重実行ガード ────────────────────────────────────────────────────────
  const postFile = `data/snapshots/post_${stamp}.txt`;
  if (await fileExists(postFile)) {
    console.log(`本日(${today})はすでに実行済みです（${postFile} が存在）。スキップします。`);
    return;
  }

  // ── [1/5] データ取得 ──────────────────────────────────────────────────────
  console.log(`[1/5] 本牧釣果データを取得中 (対象: ${today}) …`);
  const reports = await fetchRecentHonmoku({ wantCount: 1, lookbackDays: 1 });

  if (reports.length === 0) {
    console.log(`本日(${today})のデータはまだ更新されていません。スキップします。`);
    return;
  }

  const report = reports[0];
  if (report.date !== today) {
    console.log(
      `最新データが ${report.date} のもので、本日(${today})分ではありません。スキップします。`,
    );
    return;
  }

  const snapshotFile = `data/snapshots/honmoku_${stamp}.json`;
  await writeFile(snapshotFile, JSON.stringify(reports, null, 2), "utf8");
  {
    const top = report.catches
      .slice()
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map((c) => `${c.name}${c.count}`)
      .join(" / ");
    console.log(
      `    ${report.date} ${report.weather} 水温${report.waterTemp}℃ ${report.tide}  top: ${top}`,
    );
  }

  const totalToday = report.catches.reduce((s, c) => s + c.count, 0);
  const ctx: ComposeContext = {
    bakuchouIndex: computeBakuchouIndex(totalToday, "honmoku"),
    ...getLastWeekContext("honmoku", report.date),
  };
  closeDb();

  if (ctx.bakuchouIndex !== undefined) console.log(`    爆釣指数: ${ctx.bakuchouIndex}%`);
  if (ctx.prevWeekTopCatches?.length) console.log(`    先週上位: ${ctx.prevWeekTopCatches.join("、")}`);

  // ── [2/5] ブログ記事生成 ──────────────────────────────────────────────────
  console.log("[2/5] ブログ記事を生成中 …");
  const article = await composeArticle(reports, ctx);

  const siteUrl = process.env.SITE_URL ?? "https://sakanalis.vercel.app";
  const articleUrl = `${siteUrl}/reports/${article.slug}`;

  // 記事JSONを保存
  const reportsDir = "site/src/data/reports";
  await mkdir(reportsDir, { recursive: true });
  const articleFile = `${reportsDir}/${article.slug}.json`;
  await writeFile(articleFile, JSON.stringify(article, null, 2), "utf8");
  console.log(`    保存: ${articleFile}`);

  // index.json を更新（先頭に追加、最大50件）
  const indexFile = `${reportsDir}/index.json`;
  let indexEntries: Array<{
    slug: string;
    date: string;
    title: string;
    lead: string;
    topCatches: string[];
    bakuchouIndex?: number;
  }> = [];
  try {
    const existing = await readFile(indexFile, "utf8");
    indexEntries = JSON.parse(existing);
  } catch {
    // ファイルが存在しない場合は空で始める
  }
  // 同一 slug のエントリを除去してから先頭に追加
  indexEntries = indexEntries.filter((e) => e.slug !== article.slug);
  indexEntries.unshift({
    slug: article.slug,
    date: article.date,
    title: article.title,
    lead: article.lead,
    topCatches: article.topCatches,
    bakuchouIndex: article.bakuchouIndex,
  });
  indexEntries = indexEntries.slice(0, 50);
  await writeFile(indexFile, JSON.stringify(indexEntries, null, 2), "utf8");
  console.log(`    index.json 更新: ${indexEntries.length}件`);

  // ── [3/5] X ティーザー生成 ───────────────────────────────────────────────
  console.log("[3/5] 投稿文を生成中 …");

  const post = await composePost(reports, ctx, articleUrl);
  const weight = xWeight(post);

  if (weight > 260) {
    console.log(`    note: X weight ${weight} (ブログ投稿として保存、X投稿は${weight > 280 ? "スキップ" : "OK"})`);
  }

  await writeFile(postFile, post, "utf8");
  console.log(`    保存: ${postFile} (X weight: ${weight}/280)`);
  console.log("---- post ----");
  console.log(post);
  console.log("---- end ----");

  // ── [4/5] X に投稿 ────────────────────────────────────────────────────────
  if (weight <= 280) {
    console.log("[4/5] X に投稿中 …");
    await postToX(post, report);
  } else {
    console.log(`[4/5] X 投稿スキップ (X weight ${weight} > 280)。ブログ用として保存済み。`);
  }

  // ── [5/5] メール通知 ──────────────────────────────────────────────────────
  console.log("[5/5] 通知メールを送信中 …");
  try {
    await sendPostNotification({ post, weight, reports, postFile });
    console.log(`    📧 ${process.env.NOTIFY_EMAIL} に送信しました`);
  } catch (e) {
    console.error("    メール送信失敗（X 投稿は完了済みです）:", (e as Error).message);
  }

  console.log("✅ 完了");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
