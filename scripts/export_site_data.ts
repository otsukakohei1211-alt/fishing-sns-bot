/**
 * export_site_data.ts — SQLiteのデータをNext.jsサイト用JSONにエクスポート
 *
 * 実行: npx tsx scripts/export_site_data.ts
 * 出力先: site/src/data/
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import Database from "better-sqlite3";

const db = new Database("data/fishing.db");
const OUT = "site/src/data";

async function write(path: string, data: unknown) {
  await mkdir(join(OUT, path, ".."), { recursive: true });
  await writeFile(join(OUT, path), JSON.stringify(data, null, 2), "utf8");
}

// ── 1. サイト全体サマリー ─────────────────────────────────────────────────────

async function exportSummary() {
  const r = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM fish WHERE is_active=1) AS total_species,
      (SELECT COUNT(*) FROM daily_conditions WHERE facility='honmoku') AS total_days,
      (SELECT MAX(date) FROM daily_conditions WHERE facility='honmoku') AS latest_date,
      (SELECT MIN(date) FROM daily_conditions WHERE facility='honmoku') AS oldest_date
  `).get();
  await write("summary.json", r);
  console.log("  summary.json ✓");
}

// ── 2. 魚種一覧 ───────────────────────────────────────────────────────────────

async function exportFishIndex() {
  const fish = db.prepare(`
    SELECT
      f.id, f.name, f.name_kana, f.category,
      f.danger_level, f.price_range, f.difficulty,
      f.taste_profile, f.best_season, f.size_reference,
      f.typical_size_min, f.typical_size_max, f.size_unit,
      -- 今月の爆釣指数
      ROUND(m_now.avg_catch / NULLIF(m_peak.peak, 0) * 100, 0) AS bakuchou_index,
      ROUND(m_now.avg_catch, 1) AS this_month_avg,
      m_now.appearance_pct,
      -- 直近トレンド
      ROUND(t.recent_avg, 1) AS recent_avg,
      ROUND(t.prev_avg, 1) AS prev_avg
    FROM fish f
    LEFT JOIN (
      SELECT fish_id AS id,
        ROUND(AVG(CASE WHEN count > 0 THEN count END), 1) AS avg_catch,
        ROUND(100.0 * COUNT(CASE WHEN count > 0 THEN 1 END) / COUNT(*), 0) AS appearance_pct
      FROM catch_records
      WHERE facility='honmoku'
        AND CAST(SUBSTR(date,6,2) AS INTEGER) = CAST(strftime('%m','now') AS INTEGER)
      GROUP BY fish_id
    ) m_now ON m_now.id = f.id
    LEFT JOIN (
      SELECT fish_id AS id, MAX(avg_c) AS peak FROM (
        SELECT fish_id,
          CAST(SUBSTR(date,6,2) AS INTEGER) AS month,
          AVG(CASE WHEN count > 0 THEN count END) AS avg_c
        FROM catch_records WHERE facility='honmoku'
        GROUP BY fish_id, month
      ) GROUP BY fish_id
    ) m_peak ON m_peak.id = f.id
    LEFT JOIN (
      SELECT fish_id AS id,
        AVG(CASE WHEN date >= strftime('%Y/%m/%d', date('now','-14 days','localtime')) THEN count ELSE NULL END) AS recent_avg,
        AVG(CASE WHEN date < strftime('%Y/%m/%d', date('now','-14 days','localtime'))
                  AND date >= strftime('%Y/%m/%d', date('now','-28 days','localtime')) THEN count ELSE NULL END) AS prev_avg
      FROM catch_records WHERE facility='honmoku'
        AND date >= strftime('%Y/%m/%d', date('now','-28 days','localtime'))
      GROUP BY fish_id
    ) t ON t.id = f.id
    WHERE f.name NOT IN ('釣果なし', '無し')
      AND m_now.avg_catch IS NOT NULL
    ORDER BY COALESCE(m_now.avg_catch, 0) DESC
  `).all();

  const parsed = fish.map((f: Record<string, unknown>) => ({
    ...f,
    taste_profile: JSON.parse(f.taste_profile as string || "{}"),
    best_season: JSON.parse(f.best_season as string || "[]"),
  }));

  await write("fish/index.json", parsed);
  console.log(`  fish/index.json ✓ (${parsed.length}種)`);
  return parsed;
}

// ── 3. 魚種別詳細 ─────────────────────────────────────────────────────────────

async function exportFishDetail(fishId: number, fishName: string) {
  // 月別平均
  const monthly = db.prepare(`
    SELECT
      CAST(SUBSTR(dc.date,6,2) AS INTEGER) AS month,
      ROUND(AVG(CASE WHEN cr.count > 0 THEN cr.count END), 1) AS avg_catch,
      ROUND(AVG(CASE WHEN cr.count > 0 THEN cr.count END) / NULLIF(AVG(dc.visitors), 0), 2) AS avg_per_person,
      ROUND(AVG(CASE WHEN cr.max_size > 0 THEN cr.max_size END), 1) AS avg_max_size,
      ROUND(100.0 * COUNT(CASE WHEN cr.count > 0 THEN 1 END) / COUNT(*), 0) AS appearance_pct
    FROM daily_conditions dc
    LEFT JOIN catch_records cr ON cr.date=dc.date AND cr.facility=dc.facility AND cr.fish_id=?
    WHERE dc.facility='honmoku' AND dc.visitors>0
    GROUP BY month ORDER BY month
  `).all(fishId);

  // 直近28日
  const recent = db.prepare(`
    WITH dates AS (
      SELECT date FROM daily_conditions WHERE facility='honmoku' ORDER BY date DESC LIMIT 28
    )
    SELECT d.date, COALESCE(cr.count,0) AS count, dc.water_temp,
      CASE WHEN cr.min_size>0 AND cr.max_size>0 THEN (cr.min_size+cr.max_size)/2.0 ELSE NULL END AS avg_size
    FROM dates d
    JOIN daily_conditions dc ON dc.date=d.date AND dc.facility='honmoku'
    LEFT JOIN catch_records cr ON cr.date=d.date AND cr.facility='honmoku' AND cr.fish_id=?
    ORDER BY d.date ASC
  `).all(fishId);

  // 仕掛け統計
  const tactics = db.prepare(`
    SELECT tactic_type, tactic_value, mention_count, co_catch_count,
      ROUND(100.0*co_catch_count/mention_count, 0) AS hit_rate_pct
    FROM fish_tactic_stats WHERE fish_id=?
    ORDER BY mention_count DESC LIMIT 10
  `).all(fishId);

  await write(`fish/${fishName}.json`, { monthly, recent, tactics });
}

// ── 4. 今日の釣果 ─────────────────────────────────────────────────────────────

async function exportLatestCatch() {
  const latest = db.prepare(`
    SELECT dc.date, dc.facility, dc.weather, dc.water_temp, dc.tide,
           dc.visitors, dc.comment
    FROM daily_conditions dc
    WHERE facility='honmoku' ORDER BY date DESC LIMIT 1
  `).get() as Record<string, unknown>;

  if (!latest) return;

  const catches = db.prepare(`
    SELECT f.id, f.name, cr.count, cr.min_size, cr.max_size, cr.unit, cr.places
    FROM catch_records cr JOIN fish f ON f.id=cr.fish_id
    WHERE cr.date=? AND cr.facility='honmoku' AND cr.count>0
    ORDER BY cr.count DESC
  `).all(latest.date as string);

  const data = {
    ...latest,
    catches: catches.map((c: Record<string, unknown>) => ({
      ...c,
      places: JSON.parse(c.places as string || "[]"),
    })),
  };

  await write("daily/latest.json", data);
  console.log(`  daily/latest.json ✓ (${latest.date})`);
}

// ── 5. 月間ランキング ─────────────────────────────────────────────────────────

async function exportMonthlyRanking() {
  const ym = new Date().toISOString().slice(0, 7); // YYYY-MM
  const month = ym.slice(5, 7);
  const year = ym.slice(0, 4);

  const ranking = db.prepare(`
    SELECT f.id, f.name, f.price_range,
      ROUND(AVG(CASE WHEN cr.count > 0 THEN cr.count END), 1) AS avg_catch,
      ROUND(AVG(CASE WHEN cr.count > 0 THEN cr.count END) / NULLIF(AVG(dc.visitors), 0), 3) AS avg_per_person,
      ROUND(AVG(CASE WHEN cr.max_size > 0 THEN cr.max_size END), 1) AS avg_size,
      COUNT(CASE WHEN cr.count > 0 THEN 1 END) AS active_days,
      COUNT(*) AS total_days
    FROM daily_conditions dc
    JOIN fish f ON f.name NOT IN ('釣果なし','無し')
    LEFT JOIN catch_records cr ON cr.date=dc.date AND cr.facility=dc.facility AND cr.fish_id=f.id
    WHERE dc.facility='honmoku'
      AND SUBSTR(dc.date,1,4)=?
      AND CAST(SUBSTR(dc.date,6,2) AS INTEGER)=CAST(?  AS INTEGER)
    GROUP BY f.id
    HAVING avg_catch IS NOT NULL
    ORDER BY avg_per_person DESC
    LIMIT 20
  `).all(year, month);

  await write(`ranking/${ym}.json`, { year_month: ym, ranking });
  console.log(`  ranking/${ym}.json ✓`);
}

// ── メイン ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== export_site_data 開始 ===");

  await exportSummary();
  const fishList = await exportFishIndex();
  await exportLatestCatch();
  await exportMonthlyRanking();

  // 魚種別詳細（全種）
  console.log(`  魚種詳細 ${fishList.length}種...`);
  let done = 0;
  for (const f of fishList) {
    await exportFishDetail(f.id as number, f.name as string);
    done++;
    process.stdout.write(`\r  ${done}/${fishList.length} ${(f.name as string).padEnd(12)}`);
  }
  console.log("\n  魚種詳細 ✓");

  // 全魚種データを1つのTSファイルにバンドル（Vercelサーバーレス対応）
  console.log("  全データをTSモジュールに統合...");
  const allDetails: Record<number, unknown> = {};
  for (const f of fishList) {
    const detailPath = join(OUT, `fish/${f.name as string}.json`);
    const { readFileSync } = await import("node:fs");
    try {
      allDetails[f.id as number] = JSON.parse(readFileSync(detailPath, "utf8"));
    } catch { /* skip */ }
  }

  const bundleContent = `// Auto-generated by export_site_data.ts — DO NOT EDIT
export const fishIndex = ${JSON.stringify(fishList, null, 2)} as const;

export const fishDetails: Record<number, {
  monthly: Array<{ month: number; avg_catch: number | null; avg_per_person: number | null; avg_max_size: number | null; appearance_pct: number }>;
  recent: Array<{ date: string; count: number; water_temp: number | null; avg_size: number | null }>;
  tactics: Array<{ tactic_type: string; tactic_value: string; mention_count: number; co_catch_count: number; hit_rate_pct: number }>;
}> = ${JSON.stringify(allDetails, null, 2)};
`;

  await writeFile(join(OUT, "fish-bundle.ts"), bundleContent, "utf8");
  console.log("  fish-bundle.ts ✓");

  console.log("=== 完了 ===");
  db.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
