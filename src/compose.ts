/**
 * compose.ts — Claude CLI を使った投稿文生成
 *
 * `claude --print` を子プロセスで呼び出す。
 * ユーザーの Claude.ai Pro サブスクリプションを使うので追加課金なし。
 * run_daily.sh をログインシェル化したことで launchd 環境でも認証が通る。
 */

import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import type { DailyReport } from "./types.js";

// claude CLI のパス。PATH が通っていれば "claude" のみで動く。
// launchd など PATH が限られる環境向けに既知のパスもフォールバックとして持つ。
const CLAUDE_BIN =
  process.env.CLAUDE_BIN ??
  (process.env.HOME ? `${process.env.HOME}/.local/bin/claude` : "claude");

const PROMPT_TEMPLATE = `あなたは東京湾（神奈川エリア）の本牧海づり施設の釣果情報をチェックしている釣り好きです。以下の釣果情報を見た上での「感想・ひとこと」をXに投稿してください。

【絶対に守ること】
- **日本語130字以内**（ハッシュタグ・絵文字・改行を含む全文字）。最優先。
- 出力は投稿本文のみ。前置き・説明・引用符は一切不要。
- ハッシュタグは末尾に2〜4個（例: #本牧海づり施設 #釣り #東京湾釣り）。
- 絵文字は2〜4個まで。
- **釣れた匹数・来場者数などの集計数値をそのまま転記しない**。
- 魚種名・サイズ（cm/kg）・場所・釣り方は書いてOK。
- **公式情報の引用・転載にならないよう**、あくまで自分の感想・印象として書く。

【トーン・表現のヒント】
- カジュアル。釣り仲間に話しかけるノリ。
- 「〜が好調らしい！」「〜行ってみたくなった」「〜が熱そう」など感想口調でOK。
- 魚種・サイズ・場所・釣り方のヒントは感想として1〜2点触れてOK。
- 嘘・憶測は書かない。あくまで釣果情報を見た上での個人の感想。

【参考にする釣果情報（投稿に転記しないこと）】
{DATA}

投稿文:`;

function formatData(report: DailyReport): string {
  const catches = [...report.catches]
    .sort((a, b) => b.count - a.count)
    .map(
      (c) =>
        `  - ${c.name}: ${c.count}匹, ${c.minSize}〜${c.maxSize}${c.unit}, 場所: ${c.places.join("・")}`,
    )
    .join("\n");

  return `日付: ${report.date}
天気: ${report.weather} / 水温: ${report.waterTemp}℃ / 潮: ${report.tide} / 来場者: ${report.visitors}名

釣果:
${catches}

施設コメント（仕掛け・釣り方・状況・注意点）:
${report.comment}`;
}

function callClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // ANTHROPIC_API_KEY を除外して OAuth（Pro サブスクリプション）認証を使わせる
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    env.PATH = `${process.env.HOME}/.local/bin:${process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin"}`;

    const proc = spawn(CLAUDE_BIN, ["--print", "--output-format", "text"], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        // stdout も含めてエラー詳細を記録（"Not logged in" は stdout に出る）
        const detail = [stderr, stdout].map((s) => s.trim()).filter(Boolean).join(" / ");
        reject(new Error(`claude CLI がエラー終了 (code ${code}): ${detail.slice(0, 300)}`));
      }
    });

    proc.on("error", (err) => reject(err));

    // タイムアウト
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("claude CLI がタイムアウトしました (120s)"));
    }, 120_000);

    proc.on("close", () => clearTimeout(timer));

    proc.stdin.write(prompt, "utf8");
    proc.stdin.end();
  });
}

// ── 公開 API ──────────────────────────────────────────────────────────────────

/** 投稿文を生成する（opts は後方互換のため残しているが未使用） */
export async function composePost(
  reports: DailyReport[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  opts?: { strict?: boolean },
): Promise<string> {
  const data = formatData(reports[0]);
  const prompt = PROMPT_TEMPLATE.replace("{DATA}", data);
  return callClaude(prompt);
}

/** X の文字数カウント（近似）。
 *  - 改行 (\n)          → 1 weight
 *  - ASCII 印刷可能文字  → 1 weight
 *  - 全角・CJK・絵文字   → 2 weight
 *  上限 280 weight = 純日本語 140 文字
 */
export function xWeight(s: string): number {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x0a) w += 1;
    else if (cp >= 0x20 && cp <= 0x7e) w += 1;
    else w += 2;
  }
  return w;
}

// ── standalone 実行 (npm run compose) ────────────────────────────────────────

async function loadLatestSnapshot(): Promise<DailyReport[]> {
  const files = (await readdir("data/snapshots"))
    .filter((f) => /^honmoku_\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  if (files.length === 0) {
    throw new Error("スナップショットが見つかりません。先に `npm run scrape:honmoku` を実行してください。");
  }
  const buf = await readFile(`data/snapshots/${files[files.length - 1]}`, "utf8");
  return JSON.parse(buf) as DailyReport[];
}

async function main() {
  const reports = await loadLatestSnapshot();
  const post = await composePost(reports);
  const weight = xWeight(post);
  console.log(`---- post (X weight: ${weight}/280) ----`);
  console.log(post);
  console.log("---- end ----");
  if (weight > 280) {
    console.warn(`WARN: X weight ${weight} が 280 を超えています！`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
