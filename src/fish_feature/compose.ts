/**
 * compose.ts — 魚種特集投稿文を Claude CLI で生成する
 */

import { spawn } from "node:child_process";
import type { FishFeatureData } from "./data.ts";

const CLAUDE_BIN =
  process.env.CLAUDE_BIN ??
  (process.env.HOME ? `${process.env.HOME}/.local/bin/claude` : "claude");

function callClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    env.PATH = `${process.env.HOME}/.local/bin:${process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin"}`;

    const proc = spawn(CLAUDE_BIN, ["--print", "--output-format", "text"], {
      env, stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => { proc.kill(); reject(new Error("claude CLI タイムアウト (240s)")); }, 240_000);
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`claude CLI エラー (${code}): ${[stderr, stdout].map(s => s.trim()).filter(Boolean).join(" / ").slice(0, 300)}`));
    });
    proc.on("error", (err) => { clearTimeout(timer); reject(err); });
    proc.stdin.write(prompt, "utf8");
    proc.stdin.end();
  });
}

// ── プロンプト構築 ─────────────────────────────────────────────────────────────

function priceLabel(n: number): string {
  return ["", "手頃な価格", "一般的な価格帯", "高級魚", "超高級魚"][n] ?? "";
}

function difficultyLabel(n: number): string {
  return ["", "初心者でも釣りやすい", "比較的釣りやすい", "中級者向け", "やや難しい", "上級者向け"][n] ?? "";
}

function formatTactics(tactics: FishFeatureData["tactics"]): string {
  if (tactics.length === 0) return "（データ収集中）";

  const byType: Record<string, typeof tactics> = {};
  for (const t of tactics) {
    (byType[t.tactic_type] ??= []).push(t);
  }

  const lines: string[] = [];
  for (const [type, items] of Object.entries(byType)) {
    const label = { tackle: "仕掛け", bait: "エサ", spot: "場所", time: "時間帯" }[type] ?? type;
    const vals = items
      .slice(0, 3)
      .map((t) => `${t.tactic_value}(${t.mention_count}回言及・${t.hit_rate_pct}%実績)`)
      .join(" / ");
    lines.push(`  ${label}: ${vals}`);
  }
  return lines.join("\n");
}

// ── データを人間の言葉に変換する関数群 ─────────────────────────────────────────

function toSeasonalInsight(
  monthlyAvg: FishFeatureData["monthlyAvg"],
  fishName: string,
): string {
  const thisMonth = new Date().getMonth() + 1;
  const sorted = [...monthlyAvg].filter(m => m.avg_catch).sort((a, b) => (b.avg_catch ?? 0) - (a.avg_catch ?? 0));
  if (sorted.length === 0) return "";

  const rank = sorted.findIndex(m => m.month === thisMonth) + 1;
  const thisData = monthlyAvg.find(m => m.month === thisMonth);
  const nextData = monthlyAvg.find(m => m.month === (thisMonth % 12) + 1);
  const peakMonth = sorted[0]?.month;

  const parts: string[] = [];

  if (rank === 1) {
    parts.push(`${thisMonth}月は年間で最も${fishName}が釣れる月`);
  } else if (rank <= 3) {
    parts.push(`${thisMonth}月は年間でも上位の釣れやすい時期（${peakMonth}月がピーク）`);
  } else if (rank <= sorted.length / 2) {
    parts.push(`${thisMonth}月はそこそこ釣れる時期（${peakMonth}月がピーク）`);
  } else {
    parts.push(`${thisMonth}月は${fishName}の釣果は控えめな時期（${peakMonth}月がピーク）`);
  }

  if (thisData?.appearance_pct) {
    const pct = thisData.appearance_pct;
    if (pct >= 90) parts.push(`この月はほぼ毎日出現する安定感のある魚`);
    else if (pct >= 60) parts.push(`この月は${pct}日中約${Math.round(pct/100*30)}日程度出現`);
    else parts.push(`この月はたまにしか出ないレア寄り`);
  }

  if (nextData?.avg_catch && thisData?.avg_catch) {
    const diff = (nextData.avg_catch ?? 0) - (thisData.avg_catch ?? 0);
    if (diff > thisData.avg_catch * 0.3) parts.push(`来月はさらに上昇見込み`);
    else if (diff < -(thisData.avg_catch ?? 0) * 0.3) parts.push(`来月からは落ち着いてくる傾向`);
  }

  return parts.join("。");
}

function toTrendInsight(summary: FishFeatureData["summary"]): string {
  const { trendDirection, trendPrevAvg, trendRecentAvg, avgMaxSizeRecent } = summary;
  const parts: string[] = [];

  if (trendDirection === "上昇" && trendPrevAvg && trendRecentAvg > trendPrevAvg * 1.3) {
    parts.push("直近2週間で急増中");
  } else if (trendDirection === "上昇") {
    parts.push("直近2週間でじわじわ増加傾向");
  } else if (trendDirection === "下降" && trendPrevAvg && trendRecentAvg < trendPrevAvg * 0.5) {
    parts.push("直近2週間でかなり落ち着いてきた");
  } else if (trendDirection === "下降") {
    parts.push("直近2週間でやや落ち着き気味");
  } else {
    parts.push("直近2週間は安定したペース");
  }

  if (avgMaxSizeRecent) {
    const sizeRef = summary.avgCatchPerPerson; // proxy
    if (avgMaxSizeRecent > 25) parts.push(`最近は良型（${Math.round(avgMaxSizeRecent)}cm前後）が出ている`);
    else if (avgMaxSizeRecent < 15) parts.push("最近は小ぶりが多め");
    else parts.push(`サイズは${Math.round(avgMaxSizeRecent)}cm前後が中心`);
  }

  return parts.join("、");
}

function toTacticInsight(tactics: FishFeatureData["tactics"]): string {
  if (tactics.length === 0) return "";
  const top = tactics.slice(0, 2);
  return top.map(t => {
    const label = { tackle: "仕掛けは", bait: "エサは", spot: "場所は", time: "時間帯は" }[t.tactic_type] ?? "";
    const reliability = t.hit_rate_pct >= 90 ? "が実績トップ" : "が多い傾向";
    return `${label}${t.tactic_value}${reliability}`;
  }).join("、");
}

function toForecastInsight(
  forecast: FishFeatureData["forecast"],
  fes: FishFeatureData["fes"],
): string {
  if (!forecast) return "";
  const parts: string[] = [];

  if (forecast.precipitationProb >= 70) {
    parts.push(`明日は${forecast.weatherLabel}予報で釣行注意`);
  } else if (forecast.windSpeed > 30) {
    parts.push(`明日は風が強め（${Math.round(forecast.windSpeed)}km/h）、足元注意`);
  } else if (forecast.weatherLabel === "快晴" || forecast.weatherLabel === "晴れ") {
    parts.push(`明日は${forecast.weatherLabel}で絶好の釣り日和`);
  } else {
    parts.push(`明日は${forecast.weatherLabel}予報`);
  }

  if (fes.score >= 60) parts.push("過去の同条件では好釣果の日が多い");
  else if (fes.score <= 25) parts.push("過去データ的には厳しめのコンディション");

  return parts.join("、");
}

function buildThreadPrompt(d: FishFeatureData): string {
  const { fish, summary, tactics, monthlyAvg, forecast, crowdForecast } = d;

  const seasonalInsight = toSeasonalInsight(monthlyAvg, fish.name);
  const trendInsight    = toTrendInsight(summary);
  const forecastInsight = toForecastInsight(forecast, d.fes);
  const cookingHint     = `${fish.taste_profile.texture ?? ""}・${fish.taste_profile.flavor ?? ""}`;
  const priceNote       = fish.price_range >= 3 ? priceLabel(fish.price_range) : "";

  const tacticDetail = tactics.length > 0
    ? tactics.slice(0, 5).map(t => {
        const label = { tackle: "仕掛け", bait: "エサ", spot: "ポイント", time: "時間帯" }[t.tactic_type] ?? t.tactic_type;
        return `・${label}: ${t.tactic_value}（${t.mention_count}件の実績）`;
      }).join("\n")
    : "実績データ収集中";

  return `あなたは本牧海づり施設の釣果データを分析・発信する専門アカウントです。
「${fish.name}」についてXスレッド形式で4つの投稿を生成してください。

【共通ルール】
- 各投稿は日本語130字以内（ハッシュタグ・絵文字・改行を含む）
- 「爆釣指数」「FES」「出現率」などの内部用語は使わない
- データに基づく事実のみ（推測しない）
- 出力はJSON配列のみ、前置き不要

【構成】

投稿1（メイン）: データサマリー
- 「📊 ${fish.name}（本牧）」で始める
- 季節性・直近トレンドの核心を伝える
- ハッシュタグ3〜4個（#${fish.name} #本牧海づり施設 #東京湾釣り を含めること）

投稿2: 釣り方・仕掛け
- 「🎣 釣り方データ」で始める
- 施設コメントの実績データをもとに具体的な仕掛け・エサ・ポイントを列挙
- ハッシュタグなし

投稿3: 食べ方・料理
- 「🍳 食べ方」で始める
- 味の特徴・おすすめ調理法・下処理のコツ
- ハッシュタグなし

投稿4: 狙い目ガイド
- 「🎯 狙い目ガイド」で始める
- 週末に行く人向け：この魚が釣れやすい条件（潮・水温・天気）を過去データから解説
- 「○○の時に釣果が多い傾向」「水温○○℃台が実績豊富」など具体的に
- ハッシュタグなし

【分析データ】
▼ 季節性: ${seasonalInsight}
▼ 直近トレンド: ${trendInsight}
▼ 仕掛け実績:
${tacticDetail}
▼ 食べ方: ${fish.name}は${cookingHint}の魚${priceNote ? `（${priceNote}）` : ""}
${fish.danger_note ? `▼ 取り扱い注意: ${fish.danger_note}` : ""}
▼ 過去の好釣果日の条件（FES類似日より）:
${d.fes.similarDays
    .filter(s => s.catch > 0)
    .slice(0, 3)
    .map(s => `  ${s.date}: ${s.catch}匹 / ${s.water_temp}℃ / ${s.tide} / ${s.weather}`)
    .join("\n")}
▼ 混雑予測: ${crowdForecast ? `約${crowdForecast.expectedVisitors}人（${crowdForecast.level}）` : "データなし"}

出力: ["投稿1", "投稿2", "投稿3", "投稿4"]`;
}

// ── 公開 API ──────────────────────────────────────────────────────────────────

export type FishFeatureThread = {
  main: string;
  replies: string[];
};

export async function composeFishFeaturePost(data: FishFeatureData): Promise<FishFeatureThread> {
  const prompt = buildThreadPrompt(data);
  const raw = await callClaude(prompt);
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/\s*```\s*$/, "").trim();
  const posts = JSON.parse(cleaned) as string[];
  return {
    main: posts[0] ?? "",
    replies: posts.slice(1).filter(Boolean),
  };
}
