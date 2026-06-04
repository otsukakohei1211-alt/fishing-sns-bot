import { getDb, closeDb } from "../src/db/index.ts";
import { getMonthlyAvg } from "../src/fish_feature/data.ts";
import { generateMonthlyChart } from "../src/fish_feature/chart.ts";
import { mkdir } from "node:fs/promises";

const TARGET_MONTH = 6;
const db = getDb();

// 主要魚種（年間30日以上出現）の6月期待値を算出
const ranking = db.prepare(`
  WITH monthly AS (
    SELECT
      f.id, f.name, f.price_range, f.size_reference,
      CAST(SUBSTR(dc.date, 6, 2) AS INTEGER) AS month,
      ROUND(AVG(COALESCE(cr.count, 0)), 1) AS avg_catch,
      ROUND(AVG(COALESCE(cr.count, 0)) / NULLIF(AVG(dc.visitors), 0), 3) AS avg_per_person,
      ROUND(AVG(CASE WHEN cr.max_size > 0 THEN cr.max_size END), 1) AS avg_max_size
    FROM daily_conditions dc
    JOIN fish f ON f.name NOT IN ('釣果なし','無し')
    LEFT JOIN catch_records cr
      ON cr.date = dc.date AND cr.facility = dc.facility AND cr.fish_id = f.id
    WHERE dc.facility = 'honmoku' AND dc.visitors > 0
    GROUP BY f.id, month
  ),
  peak AS (
    SELECT id, MAX(avg_catch) AS peak_catch
    FROM monthly GROUP BY id
  ),
  target AS (
    SELECT * FROM monthly WHERE month = ?
  )
  SELECT
    t.id, t.name, t.price_range, t.size_reference,
    ROUND(t.avg_catch, 1) AS june_avg,
    ROUND(t.avg_per_person, 3) AS june_per_person,
    t.avg_max_size AS june_size,
    ROUND(t.avg_catch / NULLIF(p.peak_catch, 0) * 100, 0) AS bakuchou_index
  FROM target t
  JOIN peak p ON p.id = t.id
  WHERE t.avg_catch >= 1
  ORDER BY t.avg_per_person DESC
  LIMIT 20
`).all(TARGET_MONTH);

const priceLabel = (n: number) => ['','安価','普通','高級','超高級'][n as number] ?? '';

console.log(`=== ${TARGET_MONTH}月 期待値ランキング（本牧）===\n`);
console.log('順位 魚種          1人あたり 日平均  サイズ  爆釣指数 価格帯');
console.log('---- ------------ -------- ------- ------- ------- ------');

for (const [i, r] of (ranking as Array<Record<string, unknown>>).entries()) {
  console.log(
    `${String(i+1).padStart(3)}. ${(r.name as string).padEnd(12)} ` +
    `${String(r.june_per_person).padStart(5)}匹  ` +
    `${String(r.june_avg).padStart(5)}匹  ` +
    `${String(r.june_size ?? '-').padStart(5)}cm  ` +
    `${String(r.bakuchou_index).padStart(5)}%  ` +
    `${priceLabel(r.price_range as number)}`,
  );
}

// 上位10種の月別チャートを生成
console.log("\n=== 月別チャート生成中 ===");
await mkdir("data/charts/monthly", { recursive: true });

for (const r of (ranking as Array<Record<string, unknown>>).slice(0, 10)) {
  const monthly = getMonthlyAvg(r.id as number, "honmoku");
  await generateMonthlyChart(
    r.name as string,
    "honmoku",
    monthly,
    `data/charts/monthly/${r.name}.png`,
  );
  process.stdout.write(`  ${r.name} ✓`);
}
console.log("\n完了");

closeDb();
