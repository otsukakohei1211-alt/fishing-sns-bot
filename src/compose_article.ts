/**
 * compose_article.ts — Claude CLI を使ったブログ記事（構造化JSON）生成
 */

import { spawn } from "node:child_process";
import type { DailyReport } from "./types.js";
import type { ComposeContext } from "./compose.js";
import { getAffiliateLinks, type AffiliateLink } from "./affiliate.js";
import { getDb } from "./db/index.js";

// ── 型定義 ────────────────────────────────────────────────────────────────────

export type ArticleSection = {
  heading: string;
  content: string; // 複数行は \n で区切る
};

export type ArticleCatch = {
  fishId: number | null;  // 魚種図鑑ページへのリンク用（fish テーブル）
  name: string;
  count: number;
  minSize: number;
  maxSize: number;
  unit: string;
  places: string[];
};

export type DailyArticle = {
  slug: string;           // "honmoku-2026-06-05"
  date: string;           // "2026/06/05"
  facility: string;       // "honmoku"
  title: string;
  lead: string;           // 1〜2行のリード文
  sections: ArticleSection[];
  topCatches: string[];   // 上位3魚種名
  waterTemp: string;
  weather: string;
  tide?: string;
  visitors?: number;
  bakuchouIndex?: number;
  catches?: ArticleCatch[]; // 釣果データ（テーブル表示用）
  affiliateLinks: AffiliateLink[];
  createdAt: string;      // ISO8601
};

// ── Claude CLI ────────────────────────────────────────────────────────────────

const CLAUDE_BIN =
  process.env.CLAUDE_BIN ??
  (process.env.HOME ? `${process.env.HOME}/.local/bin/claude` : "claude");

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
        const detail = [stderr, stdout].map((s) => s.trim()).filter(Boolean).join(" / ");
        reject(new Error(`claude CLI がエラー終了 (code ${code}): ${detail.slice(0, 300)}`));
      }
    });

    proc.on("error", (err) => reject(err));

    // タイムアウト
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("claude CLI がタイムアウトしました (300s)"));
    }, 300_000);

    proc.on("close", () => clearTimeout(timer));

    proc.stdin.write(prompt, "utf8");
    proc.stdin.end();
  });
}

// ── プロンプト ────────────────────────────────────────────────────────────────

const ARTICLE_PROMPT_TEMPLATE = `あなたは本牧海づり施設の釣果データを発信している釣りブログ「さかなりす」の中の人です。
以下の釣果データをもとに、ブログ記事のJSONを生成してください。

【読み手】
釣り好きのビジター（初心者〜中級者）

【タイトル形式】
「【本牧釣果 MM/DD（曜日）】〜」— SEO を意識した内容にする

【ルール】
- 施設コメントの文章をそのままコピーしない（自分の言葉で書く）
- 各セクションは200字程度
- 追加データ（爆釣指数・前週比）がある場合は必ず触れる
- データに基づいた事実のみ（憶測なし）
- 出力はJSONのみ（前置き・説明・コードブロック記法なし）

【出力形式（JSONのみ）】
{
  "title": "...",
  "lead": "...",
  "sections": [
    { "heading": "今日の釣果ハイライト", "content": "..." },
    { "heading": "爆釣指数・先週比", "content": "..." },
    { "heading": "魚種別ガイド", "content": "..." },
    { "heading": "今週の狙い目まとめ", "content": "..." },
    { "heading": "まとめ", "content": "..." }
  ]
}

【釣果データ】
{DATA}`;

// ── データ整形 ─────────────────────────────────────────────────────────────────

function formatArticleData(report: DailyReport, ctx?: ComposeContext): string {
  const catches = [...report.catches]
    .sort((a, b) => b.count - a.count)
    .map(
      (c) =>
        `  - ${c.name}: ${c.count}匹, ${c.minSize}〜${c.maxSize}${c.unit}, 場所: ${c.places.join("・")}`,
    )
    .join("\n");

  let text = `日付: ${report.date}
天気: ${report.weather} / 水温: ${report.waterTemp}℃ / 潮: ${report.tide}

釣果:
${catches}

施設コメント（仕掛け・釣り方・状況・注意点）:
${report.comment}`;

  if (ctx) {
    const extras: string[] = [];
    if (ctx.bakuchouIndex !== undefined) {
      const label =
        ctx.bakuchouIndex >= 150 ? "大爆釣" :
        ctx.bakuchouIndex >= 120 ? "好調" :
        ctx.bakuchouIndex >= 80 ? "平均的" : "やや渋め";
      extras.push(`爆釣指数: 今月日平均の${ctx.bakuchouIndex}%（${label}）`);
    }
    if (ctx.prevWeekWaterTemp) {
      extras.push(`先週同日の水温: ${ctx.prevWeekWaterTemp}℃`);
    }
    if (ctx.prevWeekTopCatches && ctx.prevWeekTopCatches.length > 0) {
      extras.push(`先週同日の上位魚種: ${ctx.prevWeekTopCatches.join("、")}`);
    }
    if (extras.length > 0) {
      text += "\n\n【追加データ】\n" + extras.join("\n");
    }
  }

  return text;
}

// ── slug・日付ヘルパー ─────────────────────────────────────────────────────────

function dateToSlug(date: string, facility: string): string {
  // "2026/06/05" → "honmoku-2026-06-05"
  return `${facility}-${date.replace(/\//g, "-")}`;
}

// ── 釣果データの整形（魚種図鑑リンク用に fish.id を引く）──────────────────────

export function buildArticleCatches(report: DailyReport): ArticleCatch[] {
  const db = getDb();
  const lookup = db.prepare("SELECT id FROM fish WHERE name = ?");
  return [...report.catches]
    .sort((a, b) => b.count - a.count)
    .map((c) => {
      const row = lookup.get(c.name) as { id: number } | undefined;
      return {
        fishId: row?.id ?? null,
        name: c.name,
        count: c.count,
        minSize: c.minSize,
        maxSize: c.maxSize,
        unit: c.unit,
        places: c.places,
      };
    });
}

// ── 公開 API ──────────────────────────────────────────────────────────────────

/** ブログ記事（構造化JSON）を生成する */
export async function composeArticle(
  reports: DailyReport[],
  ctx?: ComposeContext,
): Promise<DailyArticle> {
  const report = reports[0];
  const data = formatArticleData(report, ctx);
  const prompt = ARTICLE_PROMPT_TEMPLATE.replace("{DATA}", data);

  const raw = await callClaude(prompt);

  // JSON のみ抽出（コードブロックが含まれる場合に備えて）
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Claude の出力からJSONが見つかりませんでした: ${raw.slice(0, 200)}`);
  }

  const parsed = JSON.parse(jsonMatch[0]) as {
    title: string;
    lead: string;
    sections: ArticleSection[];
  };

  // 上位3魚種
  const topCatches = [...report.catches]
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((c) => c.name);

  // 当日の全魚種（匹数降順）に対応したリンクを並べ、不足分は定番ギアで10件まで補う
  const allFishNames = [...report.catches]
    .sort((a, b) => b.count - a.count)
    .map((c) => c.name);
  const affiliateLinks = getAffiliateLinks(allFishNames, 10);
  const slug = dateToSlug(report.date, report.facility);

  const article: DailyArticle = {
    slug,
    date: report.date,
    facility: report.facility,
    title: parsed.title,
    lead: parsed.lead,
    sections: parsed.sections,
    topCatches,
    waterTemp: report.waterTemp,
    weather: report.weather,
    tide: report.tide,
    visitors: report.visitors,
    bakuchouIndex: ctx?.bakuchouIndex,
    catches: buildArticleCatches(report),
    affiliateLinks,
    createdAt: new Date().toISOString(),
  };

  return article;
}
