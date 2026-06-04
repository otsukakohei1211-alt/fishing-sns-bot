/**
 * data.ts — 魚種特集コンテンツ用データ集計
 *
 * - 魚種ローテーション管理（post_log から次の魚を決定）
 * - 直近4週間の釣果データ
 * - 仕掛け・エサ統計（fish_tactic_stats）
 * - 明日の海況（Open-Meteo）
 * - 一人当たり釣果・混雑予測
 */

import { getDb } from "../db/index.ts";
import type { ChartDataPoint } from "./chart.ts";
import { calcFes } from "./fes.ts";
import type { FesResult } from "./fes.ts";

export type TacticStat = {
  tactic_type: string;
  tactic_value: string;
  mention_count: number;
  co_catch_count: number;
  hit_rate_pct: number;
};

export type FishFeatureData = {
  fish: {
    id: number;
    name: string;
    name_kana: string | null;
    category: string | null;
    danger_level: number;
    danger_note: string | null;
    price_range: number;
    difficulty: number;
    taste_profile: { texture?: string; fat_content?: string; flavor?: string };
    best_season: string[];
  };
  facility: string;
  // 直近4週間
  recentDays: ChartDataPoint[];
  // 期間サマリー
  summary: {
    activeDays: number;
    totalDays: number;
    totalCatch: number;
    avgCatchPerDay: number;
    avgCatchPerPerson: number;
    maxCatch: number;
    maxCatchDate: string;
    trendDirection: "上昇" | "下降" | "横ばい";
    trendPrevAvg: number;    // 前半14日平均
    trendRecentAvg: number;  // 後半14日平均
    avgMaxSizeRecent: number; // 直近14日の平均最大サイズ
  };
  // 仕掛け・エサ統計（出現頻度上位）
  tactics: TacticStat[];
  // 季節トレンド（月別平均）
  monthlyAvg: Array<{ month: number; avg_catch: number; avg_per_person: number }>;
  // 明日の海況予報
  forecast: WeatherForecast | null;
  // FESスコア
  fes: FesResult;
  // 混雑予測
  crowdForecast: {
    expectedVisitors: number;
    level: "空いている" | "普通" | "混雑";
    catchPerPersonEstimate: number;
  } | null;
};

export type WeatherForecast = {
  date: string;
  weatherCode: number;
  weatherLabel: string;
  tempMax: number;
  tempMin: number;
  windSpeed: number;
  waveHeight: number | null;
  precipitationProb: number;
};

// ── 施設座標 ───────────────────────────────────────────────────────────────────

const FACILITY_COORDS: Record<string, { lat: number; lon: number }> = {
  honmoku: { lat: 35.4258, lon: 139.6547 },
  daikoku: { lat: 35.4697, lon: 139.6507 },
  isogo:   { lat: 35.3967, lon: 139.6361 },
};

// ── 天気コード変換 ─────────────────────────────────────────────────────────────

function weatherCodeLabel(code: number): string {
  if (code === 0) return "快晴";
  if (code <= 2) return "晴れ";
  if (code <= 3) return "曇り";
  if (code <= 48) return "霧";
  if (code <= 57) return "霧雨";
  if (code <= 67) return "雨";
  if (code <= 77) return "雪";
  if (code <= 82) return "にわか雨";
  if (code <= 99) return "雷雨";
  return "不明";
}

// ── 注目度スコアで次にフィーチャーする魚を選ぶ ────────────────────────────────
// 「今まさに上がっている or ピークに向かっている」魚を優先する

export function selectNextFish(facility: string): { id: number; name: string; score: number } {
  const db = getDb();
  const thisMonth = new Date().getMonth() + 1;
  const nextMonth = (thisMonth % 12) + 1;

  // 直近30投稿で使った魚は除外
  const lastPosted = db.prepare(`
    SELECT fish_id FROM post_log
    WHERE post_type = 'fish_feature' AND facility = ?
    ORDER BY posted_at DESC LIMIT 30
  `).all(facility) as Array<{ fish_id: number }>;
  const recentIds = new Set(lastPosted.map((r) => r.fish_id));
  const excludeClause = recentIds.size > 0 ? [...recentIds].join(",") : "0";

  // 候補魚種を全取得（年間30日以上出現）し、注目度スコアを計算
  const candidates = db.prepare(`
    WITH monthly AS (
      SELECT f.id, f.name,
        CAST(SUBSTR(dc.date,6,2) AS INTEGER) AS month,
        ROUND(AVG(CASE WHEN cr.count > 0 THEN cr.count END), 1) AS avg_catch
      FROM daily_conditions dc
      JOIN fish f ON f.name NOT IN ('釣果なし','無し')
      LEFT JOIN catch_records cr ON cr.date=dc.date AND cr.facility=dc.facility AND cr.fish_id=f.id
      WHERE dc.facility=? AND dc.visitors>0
      GROUP BY f.id, month
    ),
    trend AS (
      SELECT
        f.id, f.name,
        ROUND(AVG(CASE WHEN dc.date >= strftime('%Y/%m/%d',date('now','-14 days','localtime'))
                       THEN COALESCE(cr.count,0) END), 1) AS recent_avg,
        ROUND(AVG(CASE WHEN dc.date < strftime('%Y/%m/%d',date('now','-14 days','localtime'))
                       AND dc.date >= strftime('%Y/%m/%d',date('now','-28 days','localtime'))
                       THEN COALESCE(cr.count,0) END), 1) AS prev_avg
      FROM daily_conditions dc
      JOIN fish f ON f.name NOT IN ('釣果なし','無し')
      LEFT JOIN catch_records cr ON cr.date=dc.date AND cr.facility=dc.facility AND cr.fish_id=f.id
      WHERE dc.facility=?
        AND dc.date >= strftime('%Y/%m/%d',date('now','-28 days','localtime'))
      GROUP BY f.id
    )
    SELECT
      m_now.id,
      m_now.name,
      COALESCE(m_now.avg_catch, 0)  AS this_avg,
      COALESCE(m_next.avg_catch, 0) AS next_avg,
      COALESCE(m_peak.peak, 1)      AS peak_avg,
      COALESCE(t.recent_avg, 0)     AS recent_avg,
      COALESCE(t.prev_avg, 0)       AS prev_avg
    FROM (SELECT * FROM monthly WHERE month=?) m_now
    LEFT JOIN (SELECT * FROM monthly WHERE month=?) m_next ON m_next.id=m_now.id
    LEFT JOIN (SELECT id, MAX(avg_catch) AS peak FROM monthly GROUP BY id) m_peak ON m_peak.id=m_now.id
    LEFT JOIN trend t ON t.id=m_now.id
    WHERE m_now.id NOT IN (${excludeClause})
      AND COALESCE(m_now.avg_catch, 0) > 0
  `).all(facility, facility, thisMonth, nextMonth) as Array<{
    id: number; name: string;
    this_avg: number; next_avg: number; peak_avg: number;
    recent_avg: number; prev_avg: number;
  }>;

  if (candidates.length === 0) {
    // フォールバック: 全魚種リセット
    const fallback = db.prepare(`
      SELECT f.id, f.name FROM catch_records cr
      JOIN fish f ON f.id=cr.fish_id
      WHERE cr.facility=? AND cr.count>0 AND f.name NOT IN ('釣果なし','無し')
      GROUP BY f.id ORDER BY COUNT(*) DESC LIMIT 1
    `).get(facility) as { id: number; name: string };
    return { ...fallback, score: 0 };
  }

  // 注目度スコア計算
  const scored = candidates.map((c) => {
    // 1. トレンドスコア（直近2週間の上昇/下降）
    const trendRatio = c.prev_avg > 0 ? c.recent_avg / c.prev_avg : 1;
    const trendScore = trendRatio > 1.2 ? 3 : trendRatio > 0.9 ? 1 : -2;

    // 2. 来月上昇スコア（これから盛り上がるか）
    const momentumScore = c.next_avg > c.this_avg * 1.3 ? 3
      : c.next_avg > c.this_avg * 1.0 ? 1 : 0;

    // 3. 旬スコア（今月が年間ピーク付近か）
    const seasonRatio = c.peak_avg > 0 ? c.this_avg / c.peak_avg : 0;
    const seasonScore = seasonRatio > 0.8 ? 2 : seasonRatio > 0.5 ? 1 : 0;

    const total = trendScore + momentumScore + seasonScore;
    return { id: c.id, name: c.name, score: total };
  });

  // スコア最高の魚を返す
  scored.sort((a, b) => b.score - a.score);
  return scored[0];
}

// ── 直近4週間の日別釣果データ ────────────────────────────────────────────────

export function getRecentChartData(
  fishId: number,
  facility: string,
  days = 28,
): ChartDataPoint[] {
  const db = getDb();

  const fishMeta = db.prepare("SELECT size_reference FROM fish WHERE id = ?").get(fishId) as { size_reference: number | null } | undefined;
  const sizeRef = fishMeta?.size_reference ?? null;

  const rows = db.prepare(`
    WITH dates AS (
      SELECT date FROM daily_conditions
      WHERE facility = ?
      ORDER BY date DESC
      LIMIT ?
    )
    SELECT
      d.date,
      COALESCE(cr.count, 0) AS count,
      dc.water_temp AS waterTemp,
      dc.visitors,
      CASE WHEN cr.min_size > 0 AND cr.max_size > 0
        THEN (cr.min_size + cr.max_size) / 2.0
        ELSE NULL
      END AS avgSize
    FROM dates d
    JOIN daily_conditions dc ON dc.date = d.date AND dc.facility = ?
    LEFT JOIN catch_records cr
      ON cr.date = d.date AND cr.facility = ? AND cr.fish_id = ?
    ORDER BY d.date ASC
  `).all(facility, days, facility, facility, fishId) as Omit<ChartDataPoint, 'sizeReference'>[];

  return rows.map((r) => ({ ...r, sizeReference: sizeRef }));
}

// ── サマリー統計 ──────────────────────────────────────────────────────────────

export function getFishSummary(fishId: number, facility: string, days = 28) {
  const db = getDb();

  const r = db.prepare(`
    SELECT
      COUNT(DISTINCT CASE WHEN cr.count > 0 THEN cr.date END) AS active_days,
      COUNT(DISTINCT dc.date) AS total_days,
      COALESCE(SUM(cr.count), 0) AS total_catch,
      ROUND(COALESCE(SUM(cr.count), 0) * 1.0 / COUNT(DISTINCT dc.date), 1) AS avg_per_day,
      ROUND(
        COALESCE(SUM(cr.count), 0) * 1.0 / NULLIF(SUM(dc.visitors), 0), 2
      ) AS avg_per_person,
      MAX(cr.count) AS max_catch,
      ROUND(AVG(cr.max_size), 1) AS avg_max_size
    FROM daily_conditions dc
    LEFT JOIN catch_records cr
      ON cr.date = dc.date AND cr.facility = dc.facility AND cr.fish_id = ?
    WHERE dc.facility = ?
      AND dc.date >= strftime('%Y/%m/%d', date('now', '-' || ? || ' days', 'localtime'))
  `).get(fishId, facility, days) as {
    active_days: number; total_days: number; total_catch: number;
    avg_per_day: number; avg_per_person: number; max_catch: number;
    avg_max_size: number;
  };

  const maxDay = db.prepare(`
    SELECT date FROM catch_records
    WHERE fish_id = ? AND facility = ? AND count = ?
    ORDER BY date DESC LIMIT 1
  `).get(fishId, facility, r.max_catch) as { date: string } | undefined;

  // 前半14日 vs 後半14日のトレンド
  // dc.date は YYYY/MM/DD 形式なので strftime で合わせる
  const trend = db.prepare(`
    SELECT
      ROUND(AVG(CASE WHEN dc.date < strftime('%Y/%m/%d', date('now', '-14 days', 'localtime')) THEN COALESCE(cr.count,0) END), 1) AS avg_prev,
      ROUND(AVG(CASE WHEN dc.date >= strftime('%Y/%m/%d', date('now', '-14 days', 'localtime')) THEN COALESCE(cr.count,0) END), 1) AS avg_recent,
      ROUND(AVG(CASE WHEN dc.date >= strftime('%Y/%m/%d', date('now', '-14 days', 'localtime')) THEN cr.max_size END), 1) AS avg_max_size_recent
    FROM daily_conditions dc
    LEFT JOIN catch_records cr
      ON cr.date = dc.date AND cr.facility = dc.facility AND cr.fish_id = ?
    WHERE dc.facility = ?
      AND dc.date >= strftime('%Y/%m/%d', date('now', '-28 days', 'localtime'))
  `).get(fishId, facility) as {
    avg_prev: number; avg_recent: number; avg_max_size_recent: number;
  };

  return {
    ...r,
    max_catch_date: maxDay?.date ?? "",
    trend_prev_avg: trend.avg_prev,
    trend_recent_avg: trend.avg_recent,
    trend_direction: trend.avg_recent > trend.avg_prev * 1.1 ? "上昇" :
                     trend.avg_recent < trend.avg_prev * 0.9 ? "下降" : "横ばい",
    avg_max_size_recent: trend.avg_max_size_recent,
  };
}

// ── 仕掛け・エサ統計 ─────────────────────────────────────────────────────────

export function getFishTactics(fishId: number): TacticStat[] {
  const db = getDb();

  return db.prepare(`
    SELECT
      tactic_type,
      tactic_value,
      mention_count,
      co_catch_count,
      ROUND(100.0 * co_catch_count / mention_count, 0) AS hit_rate_pct
    FROM fish_tactic_stats
    WHERE fish_id = ?
    ORDER BY mention_count DESC
    LIMIT 8
  `).all(fishId) as TacticStat[];
}

// ── 月別平均釣果（季節性） ────────────────────────────────────────────────────

export function getMonthlyAvg(fishId: number, facility: string) {
  const db = getDb();

  return db.prepare(`
    SELECT
      CAST(SUBSTR(dc.date, 6, 2) AS INTEGER) AS month,
      -- 釣れた日だけの平均（記録なし日を0として含めない）
      ROUND(AVG(CASE WHEN cr.count > 0 THEN cr.count END), 1) AS avg_catch,
      ROUND(AVG(CASE WHEN cr.count > 0 THEN cr.count END) / NULLIF(AVG(CASE WHEN cr.count > 0 THEN dc.visitors END), 0), 2) AS avg_per_person,
      ROUND(AVG(CASE WHEN cr.max_size > 0 THEN cr.max_size END), 1) AS avg_max_size,
      -- 出現率: その月の日数のうち何%で釣れたか
      ROUND(100.0 * COUNT(CASE WHEN cr.count > 0 THEN 1 END) / COUNT(*), 0) AS appearance_pct
    FROM daily_conditions dc
    LEFT JOIN catch_records cr
      ON cr.date = dc.date AND cr.facility = dc.facility AND cr.fish_id = ?
    WHERE dc.facility = ? AND dc.visitors > 0
    GROUP BY month
    ORDER BY month
  `).all(fishId, facility) as Array<{ month: number; avg_catch: number | null; avg_per_person: number | null; avg_max_size: number | null; appearance_pct: number }>;
}

// ── Open-Meteo で明日の海況を取得 ─────────────────────────────────────────────

export async function fetchTomorrowForecast(facility: string): Promise<WeatherForecast | null> {
  const coords = FACILITY_COORDS[facility];
  if (!coords) return null;

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateStr = tomorrow.toISOString().slice(0, 10);

  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(coords.lat));
    url.searchParams.set("longitude", String(coords.lon));
    url.searchParams.set("daily", [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "wind_speed_10m_max",
      "precipitation_probability_max",
    ].join(","));
    url.searchParams.set("timezone", "Asia/Tokyo");
    url.searchParams.set("forecast_days", "2");

    const res = await fetch(url.toString());
    if (!res.ok) return null;

    const json = await res.json() as {
      daily: {
        time: string[];
        weather_code: number[];
        temperature_2m_max: number[];
        temperature_2m_min: number[];
        wind_speed_10m_max: number[];
        precipitation_probability_max: number[];
      };
    };

    const idx = json.daily.time.indexOf(dateStr);
    if (idx < 0) return null;

    return {
      date: dateStr,
      weatherCode: json.daily.weather_code[idx],
      weatherLabel: weatherCodeLabel(json.daily.weather_code[idx]),
      tempMax: json.daily.temperature_2m_max[idx],
      tempMin: json.daily.temperature_2m_min[idx],
      windSpeed: json.daily.wind_speed_10m_max[idx],
      waveHeight: null, // 無料プランでは波高なし
      precipitationProb: json.daily.precipitation_probability_max[idx],
    };
  } catch {
    return null;
  }
}

// ── 混雑予測 ─────────────────────────────────────────────────────────────────

export function estimateCrowd(facility: string): {
  expectedVisitors: number;
  level: "空いている" | "普通" | "混雑";
  catchPerPersonEstimate: number;
} | null {
  const db = getDb();

  // 明日の曜日（0=日, 1=月 ... 6=土）
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dow = tomorrow.getDay();
  const isWeekend = dow === 0 || dow === 6;
  const month = tomorrow.getMonth() + 1;

  // 同じ曜日区分 × 同じ月の過去平均来場者
  const r = db.prepare(`
    SELECT
      ROUND(AVG(visitors), 0) AS expected,
      ROUND(AVG(total_catch * 1.0 / visitors), 2) AS catch_per_person
    FROM daily_conditions dc
    JOIN (
      SELECT date, facility, SUM(count) AS total_catch
      FROM catch_records WHERE facility = ?
      GROUP BY date, facility
    ) cr ON cr.date = dc.date AND cr.facility = dc.facility
    WHERE dc.facility = ?
      AND CAST(SUBSTR(dc.date, 6, 2) AS INTEGER) = ?
      AND CASE
        WHEN strftime('%w', REPLACE(dc.date, '/', '-')) IN ('0','6') THEN 1
        ELSE 0
      END = ?
      AND dc.visitors > 0
  `).get(facility, facility, month, isWeekend ? 1 : 0) as {
    expected: number; catch_per_person: number;
  } | undefined;

  if (!r) return null;

  const level: "空いている" | "普通" | "混雑" =
    r.expected < 200 ? "空いている" :
    r.expected < 400 ? "普通" : "混雑";

  return {
    expectedVisitors: r.expected,
    level,
    catchPerPersonEstimate: r.catch_per_person,
  };
}

// ── 全データをまとめて取得 ────────────────────────────────────────────────────

export async function buildFishFeatureData(
  fishId: number,
  facility: string,
): Promise<FishFeatureData> {
  const db = getDb();

  const fishRow = db.prepare(`
    SELECT id, name, name_kana, category, danger_level, danger_note,
           price_range, difficulty, taste_profile, best_season
    FROM fish WHERE id = ?
  `).get(fishId) as {
    id: number; name: string; name_kana: string | null; category: string | null;
    danger_level: number; danger_note: string | null; price_range: number;
    difficulty: number; taste_profile: string; best_season: string;
  };

  const summary = getFishSummary(fishId, facility);
  const recentDays = getRecentChartData(fishId, facility);
  const tactics = getFishTactics(fishId);
  const monthlyAvg = getMonthlyAvg(fishId, facility);
  const forecast = await fetchTomorrowForecast(facility);
  const crowdForecast = estimateCrowd(facility);

  // 今日の条件を取得してFES計算
  const todayConditions = db.prepare(`
    SELECT water_temp, water_temp_change, tide, weather, pressure, wind_speed, moon_age
    FROM daily_conditions WHERE facility = ? ORDER BY date DESC LIMIT 1
  `).get(facility) as {
    water_temp: number | null; water_temp_change: number | null;
    tide: string | null; weather: string | null; pressure: number | null;
    wind_speed: number | null; moon_age: number | null;
  };
  const fes = calcFes(fishId, facility, forecast, todayConditions);

  return {
    fish: {
      ...fishRow,
      taste_profile: JSON.parse(fishRow.taste_profile || "{}"),
      best_season: JSON.parse(fishRow.best_season || "[]"),
    },
    facility,
    recentDays,
    summary: {
      activeDays: summary.active_days,
      totalDays: summary.total_days,
      totalCatch: summary.total_catch,
      avgCatchPerDay: summary.avg_per_day,
      avgCatchPerPerson: summary.avg_per_person,
      maxCatch: summary.max_catch,
      maxCatchDate: summary.max_catch_date,
      trendDirection: summary.trend_direction as "上昇" | "下降" | "横ばい",
      trendPrevAvg: summary.trend_prev_avg,
      trendRecentAvg: summary.trend_recent_avg,
      avgMaxSizeRecent: summary.avg_max_size_recent,
    },
    tactics,
    monthlyAvg,
    forecast,
    fes,
    crowdForecast,
  };
}
