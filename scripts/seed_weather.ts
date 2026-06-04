/**
 * seed_weather.ts — Open-Meteo historical API で過去気象データを取得しDBに保存
 *
 * 実行: npx tsx scripts/seed_weather.ts
 * - pressure / precipitation / temp_max / temp_min / wind_speed / wave_height を更新
 * - 1施設 = 1リクエスト（日付範囲まとめて取得）で効率的
 */

import "dotenv/config";
import { getDb, closeDb } from "../src/db/index.ts";

const FACILITY_COORDS: Record<string, { lat: number; lon: number }> = {
  honmoku: { lat: 35.4258, lon: 139.6547 },
  daikoku: { lat: 35.4697, lon: 139.6507 },
  isogo:   { lat: 35.3967, lon: 139.6361 },
};

type DayWeather = {
  date: string;       // YYYY-MM-DD
  pressure: number;
  precipitation: number;
  temp_max: number;
  temp_min: number;
  wind_speed: number;
};

async function fetchHistoricalWeather(
  facility: string,
  startDate: string,
  endDate: string,
): Promise<DayWeather[]> {
  const { lat, lon } = FACILITY_COORDS[facility];

  const url = new URL("https://archive-api.open-meteo.com/v1/archive");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);
  url.searchParams.set("daily", [
    "temperature_2m_max",
    "temperature_2m_min",
    "precipitation_sum",
    "wind_speed_10m_max",
    "surface_pressure_mean",
  ].join(","));
  url.searchParams.set("timezone", "Asia/Tokyo");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}: ${await res.text()}`);

  const json = await res.json() as {
    daily: {
      time: string[];
      temperature_2m_max: number[];
      temperature_2m_min: number[];
      precipitation_sum: number[];
      wind_speed_10m_max: number[];
      surface_pressure_mean: number[];
    };
  };

  return json.daily.time.map((date, i) => ({
    date,
    temp_max: json.daily.temperature_2m_max[i],
    temp_min: json.daily.temperature_2m_min[i],
    precipitation: json.daily.precipitation_sum[i],
    wind_speed: json.daily.wind_speed_10m_max[i],
    pressure: json.daily.surface_pressure_mean[i],
  }));
}

async function main() {
  console.log("=== seed_weather 開始 ===");
  const db = getDb();

  // 日付範囲を取得
  const range = db.prepare(`
    SELECT MIN(date) as start, MAX(date) as end FROM daily_conditions
  `).get() as { start: string; end: string };

  const startDate = range.start.replace(/\//g, "-");
  const endDate = range.end.replace(/\//g, "-");
  console.log(`対象期間: ${startDate} 〜 ${endDate}`);

  const updateWeather = db.prepare(`
    UPDATE daily_conditions
    SET pressure = @pressure,
        precipitation = @precipitation,
        temp_max = @temp_max,
        temp_min = @temp_min,
        wind_speed = @wind_speed
    WHERE date = @date AND facility = @facility
  `);

  let totalUpdated = 0;

  for (const facility of Object.keys(FACILITY_COORDS)) {
    process.stdout.write(`\n[${facility}] 取得中...`);

    try {
      const data = await fetchHistoricalWeather(facility, startDate, endDate);

      const batch = db.transaction((days: DayWeather[]) => {
        let count = 0;
        for (const d of days) {
          // YYYY-MM-DD → YYYY/MM/DD に変換してDBと合わせる
          const dbDate = d.date.replace(/-/g, "/");
          const result = updateWeather.run({
            date: dbDate,
            facility,
            pressure: d.pressure ?? null,
            precipitation: d.precipitation ?? null,
            temp_max: d.temp_max ?? null,
            temp_min: d.temp_min ?? null,
            wind_speed: d.wind_speed ?? null,
          });
          count += result.changes;
        }
        return count;
      });

      const updated = batch(data);
      totalUpdated += updated;
      console.log(` → ${data.length}日分取得、${updated}件更新`);
    } catch (e) {
      console.error(` → 失敗: ${(e as Error).message}`);
    }

    // レート制限対策
    await new Promise((r) => setTimeout(r, 1000));
  }

  // 確認
  const sample = db.prepare(`
    SELECT date, facility, water_temp, water_temp_change, pressure, wind_speed,
           temp_max, temp_min, precipitation, moon_age
    FROM daily_conditions
    WHERE pressure IS NOT NULL
    ORDER BY date DESC LIMIT 3
  `).all();

  console.log("\n=== サンプル ===");
  sample.forEach((r) => console.log(JSON.stringify(r)));

  const nullCount = db.prepare(
    "SELECT COUNT(*) as c FROM daily_conditions WHERE pressure IS NULL"
  ).get() as { c: number };
  console.log(`\n気圧未取得: ${nullCount.c} 件`);
  console.log(`合計更新: ${totalUpdated} 件`);
  console.log("=== 完了 ===");

  closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
