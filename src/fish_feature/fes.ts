/**
 * fes.ts — Fishing Expectation Score（釣果期待スコア）エンジン
 *
 * 類似条件日参照型:
 * 1. 明日の条件ベクトルを構築
 * 2. 過去1439日の中から条件の近い日を検索（加重距離）
 * 3. 類似日の実績から魚種別スコア(0-100)と根拠を返す
 */

import { getDb } from "../db/index.ts";
import type { WeatherForecast } from "./data.ts";

// ── 型定義 ────────────────────────────────────────────────────────────────────

export type FesResult = {
  score: number;                  // 0〜100（サイズ補正済み・季節内正規化）
  grade: "S" | "A" | "B" | "C" | "D";
  similarDays: SimilarDay[];      // 根拠となった類似日
  avgCatch: number;               // 類似日の平均生釣果数
  avgQualityPerPerson: number;    // 類似日の平均サイズ補正一人当たり釣果
  sampleSize: number;             // 比較対象日数
  peakCatch: number;              // 類似日の最高釣果
  sizeReference: number | null;   // 種の参照サイズ
  conditions: ConditionSummary;
};

export type SimilarDay = {
  date: string;
  similarity: number;  // 0〜1（1が完全一致）
  catch: number;
  catchPerPerson: number;
  water_temp: number;
  tide: string;
  weather: string;
};

export type ConditionSummary = {
  water_temp: number | null;
  water_temp_change: number | null;
  tide: string | null;
  weather: string | null;
  pressure: number | null;
  wind_speed: number | null;
  moon_age: number | null;
  moon_phase: string;
};

// ── 月齢フェーズ変換 ──────────────────────────────────────────────────────────

function moonPhase(age: number | null): string {
  if (age === null) return "不明";
  if (age < 2 || age > 28) return "新月";
  if (age < 8) return "三日月";
  if (age < 10) return "上弦";
  if (age < 16) return "十三夜";
  if (age < 17) return "満月";
  if (age < 23) return "十六夜";
  if (age < 25) return "下弦";
  return "晦日";
}

// ── 潮汐グループ（大潮系/中潮系/小潮系） ────────────────────────────────────

function tideGroup(tide: string | null): string {
  if (!tide) return "unknown";
  if (tide.includes("大潮")) return "大潮";
  if (tide.includes("中潮")) return "中潮";
  if (tide.includes("小潮") || tide.includes("長潮") || tide.includes("若潮")) return "小潮系";
  return "other";
}

// ── 天気グループ ─────────────────────────────────────────────────────────────

function weatherGroup(weather: string | null): string {
  if (!weather) return "unknown";
  if (weather.includes("晴")) return "晴";
  if (weather.includes("雨") || weather.includes("雷")) return "雨";
  return "曇";
}

// ── 条件ベクトルの加重距離を計算（0=完全一致, 大きいほど遠い） ──────────────

type ConditionVector = {
  water_temp: number | null;
  water_temp_change: number | null;
  tide_group: string;
  weather_group: string;
  pressure: number | null;
  wind_speed: number | null;
  moon_age: number | null;
  month: number;
};

function weightedDistance(a: ConditionVector, b: ConditionVector): number {
  let dist = 0;
  let totalWeight = 0;

  // 水温: ±5℃以内を有効範囲とし正規化
  if (a.water_temp !== null && b.water_temp !== null) {
    const diff = Math.abs(a.water_temp - b.water_temp);
    dist += (Math.min(diff, 5) / 5) * 3.0;
    totalWeight += 3.0;
  }

  // 水温変化率: ±2℃以内
  if (a.water_temp_change !== null && b.water_temp_change !== null) {
    const diff = Math.abs(a.water_temp_change - b.water_temp_change);
    dist += (Math.min(diff, 2) / 2) * 1.5;
    totalWeight += 1.5;
  }

  // 潮汐グループ: 一致/不一致
  if (a.tide_group !== "unknown" && b.tide_group !== "unknown") {
    dist += a.tide_group === b.tide_group ? 0 : 2.0;
    totalWeight += 2.0;
  }

  // 天気グループ: 一致/不一致
  if (a.weather_group !== "unknown" && b.weather_group !== "unknown") {
    dist += a.weather_group === b.weather_group ? 0 : 1.0;
    totalWeight += 1.0;
  }

  // 気圧: ±20hPa以内
  if (a.pressure !== null && b.pressure !== null) {
    const diff = Math.abs(a.pressure - b.pressure);
    dist += (Math.min(diff, 20) / 20) * 1.5;
    totalWeight += 1.5;
  }

  // 風速: ±20km/h以内
  if (a.wind_speed !== null && b.wind_speed !== null) {
    const diff = Math.abs(a.wind_speed - b.wind_speed);
    dist += (Math.min(diff, 20) / 20) * 1.0;
    totalWeight += 1.0;
  }

  // 月齢: 29.5日周期での最短距離
  if (a.moon_age !== null && b.moon_age !== null) {
    const diff = Math.abs(a.moon_age - b.moon_age);
    const circular = Math.min(diff, 29.5 - diff);
    dist += (Math.min(circular, 7) / 7) * 0.8;
    totalWeight += 0.8;
  }

  // 季節（月）: 同月±1を近いとみなす
  const monthDiff = Math.min(
    Math.abs(a.month - b.month),
    12 - Math.abs(a.month - b.month),
  );
  dist += (Math.min(monthDiff, 3) / 3) * 2.0;
  totalWeight += 2.0;

  return totalWeight > 0 ? dist / totalWeight : 1;
}

// ── FESを計算 ────────────────────────────────────────────────────────────────

export function calcFes(
  fishId: number,
  facility: string,
  forecast: WeatherForecast | null,
  currentConditions: {
    water_temp: number | null;
    water_temp_change: number | null;
    tide: string | null;
    weather: string | null;
    pressure: number | null;
    wind_speed: number | null;
    moon_age: number | null;
  },
): FesResult {
  const db = getDb();

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowMonth = tomorrow.getMonth() + 1;

  // 明日の予報を条件ベクトルに変換
  const targetVec: ConditionVector = {
    water_temp: currentConditions.water_temp,
    water_temp_change: currentConditions.water_temp_change,
    tide_group: tideGroup(currentConditions.tide),
    weather_group: forecast
      ? weatherGroup(forecast.weatherLabel)
      : weatherGroup(currentConditions.weather),
    pressure: forecast?.windSpeed
      ? currentConditions.pressure  // 今日の気圧を暫定使用
      : currentConditions.pressure,
    wind_speed: forecast?.windSpeed ?? currentConditions.wind_speed,
    moon_age: currentConditions.moon_age !== null
      ? (currentConditions.moon_age + 1) % 29.5  // 明日の月齢
      : null,
    month: tomorrowMonth,
  };

  // 魚種の参照サイズを取得
  const fishMeta = db.prepare(
    "SELECT size_reference FROM fish WHERE id = ?"
  ).get(fishId) as { size_reference: number | null };
  const sizeRef = fishMeta?.size_reference ?? null;

  // 過去データを全件取得（当日を除く）
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "/");
  const historicalRows = db.prepare(`
    SELECT
      dc.date, dc.water_temp, dc.water_temp_change, dc.tide, dc.weather,
      dc.pressure, dc.wind_speed, dc.moon_age,
      CAST(SUBSTR(dc.date, 6, 2) AS INTEGER) AS month,
      COALESCE(cr.count, 0) AS catch_count,
      CASE
        WHEN cr.min_size > 0 AND cr.max_size > 0
        THEN (cr.min_size + cr.max_size) / 2.0
        ELSE NULL
      END AS avg_size_proxy,
      dc.visitors
    FROM daily_conditions dc
    LEFT JOIN catch_records cr
      ON cr.date = dc.date AND cr.facility = dc.facility AND cr.fish_id = ?
    WHERE dc.facility = ?
      AND dc.date < ?
      AND dc.water_temp IS NOT NULL
    ORDER BY dc.date DESC
  `).all(fishId, facility, today) as Array<{
    date: string; water_temp: number; water_temp_change: number | null;
    tide: string | null; weather: string | null; pressure: number | null;
    wind_speed: number | null; moon_age: number | null; month: number;
    catch_count: number; avg_size_proxy: number | null; visitors: number | null;
  }>;

  // quality_catch = count × (avg_size / size_reference)^1.5
  // size_reference がない or サイズデータなし の場合は count そのまま使用
  function qualityCatch(count: number, avgSizeProxy: number | null): number {
    if (!sizeRef || sizeRef <= 0 || avgSizeProxy === null || avgSizeProxy <= 0) {
      return count;
    }
    const sizeFactor = Math.pow(avgSizeProxy / sizeRef, 1.5);
    return count * sizeFactor;
  }

  // 各日との距離を計算
  const withDistance = historicalRows.map((row) => {
    const vec: ConditionVector = {
      water_temp: row.water_temp,
      water_temp_change: row.water_temp_change,
      tide_group: tideGroup(row.tide),
      weather_group: weatherGroup(row.weather),
      pressure: row.pressure,
      wind_speed: row.wind_speed,
      moon_age: row.moon_age,
      month: row.month,
    };
    const dist = weightedDistance(targetVec, vec);
    const similarity = Math.max(0, 1 - dist);
    const qCatch = qualityCatch(row.catch_count, row.avg_size_proxy);
    const catchPerPerson = row.visitors && row.visitors > 0
      ? Math.round((row.catch_count / row.visitors) * 100) / 100
      : 0;
    const qualityPerPerson = row.visitors && row.visitors > 0
      ? Math.round((qCatch / row.visitors) * 100) / 100
      : 0;
    return { ...row, similarity, catchPerPerson, qCatch, qualityPerPerson };
  });

  // 類似度上位20件を取得
  const TOP_N = 20;
  const topSimilar = withDistance
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, TOP_N);

  // 加重平均（類似度で重み付け）
  const totalSimilarity = topSimilar.reduce((s, d) => s + d.similarity, 0);
  const weightedAvgQuality = totalSimilarity > 0
    ? topSimilar.reduce((s, d) => s + d.qCatch * d.similarity, 0) / totalSimilarity
    : 0;
  const weightedAvgCatch = totalSimilarity > 0
    ? topSimilar.reduce((s, d) => s + d.catch_count * d.similarity, 0) / totalSimilarity
    : 0;
  const weightedAvgPerPerson = totalSimilarity > 0
    ? topSimilar.reduce((s, d) => s + d.qualityPerPerson * d.similarity, 0) / totalSimilarity
    : 0;
  const peakCatch = Math.max(...topSimilar.map((d) => d.catch_count));

  // 正規化: 同月の過去quality_catch の95パーセンタイルを基準にする
  // → 季節感を保ちつつ、コアジ大量釣れ日は適切に低評価
  const monthlyQuality = historicalRows
    .filter((r) => r.month === tomorrowMonth)
    .map((r) => qualityCatch(r.catch_count, r.avg_size_proxy))
    .sort((a, b) => a - b);

  const p95idx = Math.floor(monthlyQuality.length * 0.95);
  const p95Quality = monthlyQuality[p95idx] ?? 1;

  // スコア計算（0-100）
  const normalizedCatch = p95Quality > 0 ? weightedAvgQuality / p95Quality : 0;
  const rawScore = Math.min(100, Math.round(normalizedCatch * 100));

  // グレード付け
  const grade =
    rawScore >= 80 ? "S" :
    rawScore >= 60 ? "A" :
    rawScore >= 40 ? "B" :
    rawScore >= 20 ? "C" : "D";

  const similarDays: SimilarDay[] = topSimilar.slice(0, 5).map((d) => ({
    date: d.date,
    similarity: Math.round(d.similarity * 100) / 100,
    catch: d.catch_count,
    catchPerPerson: d.catchPerPerson,
    water_temp: d.water_temp,
    tide: d.tide ?? "",
    weather: d.weather ?? "",
  }));

  const conditions: ConditionSummary = {
    water_temp: currentConditions.water_temp,
    water_temp_change: currentConditions.water_temp_change,
    tide: currentConditions.tide,
    weather: forecast?.weatherLabel ?? currentConditions.weather,
    pressure: currentConditions.pressure,
    wind_speed: forecast?.windSpeed ?? currentConditions.wind_speed,
    moon_age: currentConditions.moon_age,
    moon_phase: moonPhase(currentConditions.moon_age),
  };

  return {
    score: rawScore,
    grade,
    similarDays,
    avgCatch: Math.round(weightedAvgCatch),
    avgQualityPerPerson: Math.round(weightedAvgPerPerson * 100) / 100,
    sampleSize: topSimilar.length,
    peakCatch,
    sizeReference: sizeRef,
    conditions,
  };
}
