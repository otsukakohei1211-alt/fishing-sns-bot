import { getDb, closeDb } from "../src/db/index.ts";

const db = getDb();

const newCols = [
  "ALTER TABLE daily_conditions ADD COLUMN pressure REAL",
  "ALTER TABLE daily_conditions ADD COLUMN precipitation REAL",
  "ALTER TABLE daily_conditions ADD COLUMN temp_max REAL",
  "ALTER TABLE daily_conditions ADD COLUMN temp_min REAL",
  "ALTER TABLE daily_conditions ADD COLUMN moon_age REAL",
  "ALTER TABLE daily_conditions ADD COLUMN water_temp_change REAL",
];

for (const sql of newCols) {
  try {
    db.exec(sql);
    const col = sql.split(" ").slice(-2).join(" ");
    console.log("追加:", col);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("duplicate column")) {
      console.log("スキップ（既存）:", sql.split(" ").slice(-2).join(" "));
    } else {
      throw e;
    }
  }
}

// water_temp_change: 前日比を既存データから計算
const updated = db.prepare(`
  UPDATE daily_conditions
  SET water_temp_change = (
    SELECT daily_conditions.water_temp - prev.water_temp
    FROM daily_conditions prev
    WHERE prev.facility = daily_conditions.facility
      AND prev.date = (
        SELECT MAX(p2.date) FROM daily_conditions p2
        WHERE p2.facility = daily_conditions.facility
          AND p2.date < daily_conditions.date
      )
      AND prev.water_temp IS NOT NULL
      AND daily_conditions.water_temp IS NOT NULL
  )
  WHERE water_temp_change IS NULL
`).run();
console.log(`\nwater_temp_change 計算: ${updated.changes} 件`);

// moon_age: 既知の新月日を基準に計算
// 2000/01/06 が新月（ユリウス日を使った近似）
const rows = db.prepare("SELECT id, date FROM daily_conditions WHERE moon_age IS NULL").all() as Array<{ id: number; date: string }>;

const KNOWN_NEW_MOON = new Date("2000-01-06").getTime();
const LUNAR_CYCLE = 29.530588853;

const updateMoon = db.prepare("UPDATE daily_conditions SET moon_age = ? WHERE id = ?");
const moonBatch = db.transaction((items: typeof rows) => {
  for (const row of items) {
    const d = new Date(row.date.replace(/\//g, "-")).getTime();
    const daysSince = (d - KNOWN_NEW_MOON) / (1000 * 60 * 60 * 24);
    const moonAge = ((daysSince % LUNAR_CYCLE) + LUNAR_CYCLE) % LUNAR_CYCLE;
    updateMoon.run(Math.round(moonAge * 10) / 10, row.id);
  }
});
moonBatch(rows);
console.log(`moon_age 計算: ${rows.length} 件`);

const sample = db.prepare(`
  SELECT date, facility, water_temp, water_temp_change, moon_age
  FROM daily_conditions ORDER BY date DESC LIMIT 5
`).all();
console.log("\nサンプル:");
sample.forEach((r) => console.log(" ", JSON.stringify(r)));

closeDb();
