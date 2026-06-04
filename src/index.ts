import { writeFile, mkdir, access } from "node:fs/promises";
import "dotenv/config";
import { fetchRecentHonmoku } from "./scrapers/honmoku.js";
import { composePost, xWeight } from "./compose.js";
import { sendPostNotification } from "./notify.js";
import { postToX } from "./x_post.js";

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

  // ── [1/4] データ取得 ──────────────────────────────────────────────────────
  console.log(`[1/4] 本牧釣果データを取得中 (対象: ${today}) …`);
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

  // ── [2/4] 投稿文生成 ──────────────────────────────────────────────────────
  console.log("[2/4] 投稿文を生成中 …");
  const post = await composePost(reports);
  const weight = xWeight(post);

  if (weight > 280) {
    throw new Error(
      `生成された投稿が X の文字数上限を超えています (X weight: ${weight}/280)。投稿を中止します。`,
    );
  }
  if (weight > 260) {
    console.log(`    note: X weight ${weight} は上限に近いです (280)`);
  }

  await writeFile(postFile, post, "utf8");
  console.log(`    保存: ${postFile} (X weight: ${weight}/280)`);
  console.log("---- post ----");
  console.log(post);
  console.log("---- end ----");

  // ── [3/4] X に投稿 ────────────────────────────────────────────────────────
  console.log("[3/4] X に投稿中 …");
  await postToX(post, report);

  // ── [4/4] メール通知 ──────────────────────────────────────────────────────
  console.log("[4/4] 通知メールを送信中 …");
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
