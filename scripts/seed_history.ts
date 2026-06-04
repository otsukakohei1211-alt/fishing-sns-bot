/**
 * seed_history.ts — APIから全施設の全履歴データを取得し DB に UPSERT する
 *
 * 実行: npx tsx scripts/seed_history.ts
 * 初回は全件取得（数百件）、2回目以降は差分のみ更新される
 */

import "dotenv/config";
import { getDb, closeDb } from "../src/db/index.ts";
import type { Facility } from "../src/types.ts";

const GQL_ENDPOINT =
  "https://iqqdsybr6beovaix6btxwykuha.appsync-api.ap-northeast-1.amazonaws.com/graphql";
const API_KEY = "da2-of4bzmdi4vhjha5buiog37mki4";

const FACILITIES: Facility[] = ["honmoku", "daikoku", "isogo"];

// fish30 フィールドを動的に展開
const FISH_FIELDS = Array.from({ length: 30 }, (_, i) => i + 1)
  .map((n) => `fish${n}Name fish${n}MinSize fish${n}MaxSize fish${n}Unit fish${n}Count fish${n}Place`)
  .join("\n      ");

const QUERY = `query LastPostsByFacilityAndDate(
  $facility: String!
  $sortDirection: ModelSortDirection
  $limit: Int
  $nextToken: String
) {
  lastPostsByFacilityAndDate(
    facility: $facility
    sortDirection: $sortDirection
    limit: $limit
    nextToken: $nextToken
  ) {
    items {
      date facility sentence weather waterTemp tide visitors
      ${FISH_FIELDS}
    }
    nextToken
  }
}`;

type RawItem = {
  date: string;
  facility: string;
  sentence: string;
  weather: string;
  waterTemp: string;
  tide: string;
  visitors: number;
} & Record<string, string | number | string[] | null>;

async function fetchAllForFacility(facility: Facility): Promise<RawItem[]> {
  const all: RawItem[] = [];
  let nextToken: string | null = null;

  do {
    const variables: Record<string, unknown> = {
      facility,
      sortDirection: "ASC",
      limit: 500,
    };
    if (nextToken) variables.nextToken = nextToken;

    const res = await fetch(GQL_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": API_KEY },
      body: JSON.stringify({ query: QUERY, variables }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status} for ${facility}`);

    const json = (await res.json()) as {
      data?: { lastPostsByFacilityAndDate?: { items: RawItem[]; nextToken: string | null } };
      errors?: Array<{ message: string }>;
    };

    if (json.errors?.length) throw new Error(JSON.stringify(json.errors));

    const data = json.data?.lastPostsByFacilityAndDate;
    all.push(...(data?.items ?? []));
    nextToken = data?.nextToken ?? null;

    process.stdout.write(`  ${facility}: ${all.length} 件取得中...\r`);
  } while (nextToken);

  return all;
}

function upsertData(items: RawItem[]): { conditions: number; catches: number } {
  const db = getDb();

  const upsertCondition = db.prepare(`
    INSERT INTO daily_conditions (date, facility, weather, water_temp, tide, visitors, comment)
    VALUES (@date, @facility, @weather, @water_temp, @tide, @visitors, @comment)
    ON CONFLICT(date, facility) DO UPDATE SET
      weather    = excluded.weather,
      water_temp = excluded.water_temp,
      tide       = excluded.tide,
      visitors   = excluded.visitors,
      comment    = excluded.comment
  `);

  const upsertCatch = db.prepare(`
    INSERT INTO catch_records (date, facility, fish_name, count, min_size, max_size, unit, places)
    VALUES (@date, @facility, @fish_name, @count, @min_size, @max_size, @unit, @places)
    ON CONFLICT(date, facility, fish_name) DO UPDATE SET
      count    = excluded.count,
      min_size = excluded.min_size,
      max_size = excluded.max_size,
      unit     = excluded.unit,
      places   = excluded.places
  `);

  let conditions = 0;
  let catches = 0;

  const batchUpsert = db.transaction((batch: RawItem[]) => {
    for (const item of batch) {
      upsertCondition.run({
        date: item.date,
        facility: item.facility,
        weather: item.weather ?? null,
        water_temp: item.waterTemp ? parseFloat(item.waterTemp as string) : null,
        tide: item.tide ?? null,
        visitors: item.visitors ?? null,
        comment: item.sentence ?? null,
      });
      conditions++;

      for (let n = 1; n <= 30; n++) {
        const name = item[`fish${n}Name`] as string | null;
        if (!name) continue;
        const rawPlaces = item[`fish${n}Place`];
        const places = Array.isArray(rawPlaces) ? rawPlaces : [];

        upsertCatch.run({
          date: item.date,
          facility: item.facility,
          fish_name: name,
          count: (item[`fish${n}Count`] as number) ?? 0,
          min_size: (item[`fish${n}MinSize`] as number) ?? 0,
          max_size: (item[`fish${n}MaxSize`] as number) ?? 0,
          unit: (item[`fish${n}Unit`] as string) ?? "cm",
          places: JSON.stringify(places),
        });
        catches++;
      }
    }
  });

  batchUpsert(items);
  return { conditions, catches };
}

async function main() {
  console.log("=== seed_history 開始 ===");
  const db = getDb();

  const before = db
    .prepare("SELECT COUNT(*) as c FROM daily_conditions")
    .get() as { c: number };
  console.log(`現在の daily_conditions 件数: ${before.c}`);

  let totalConditions = 0;
  let totalCatches = 0;

  for (const facility of FACILITIES) {
    process.stdout.write(`\n[${facility}] 取得中...\n`);
    const items = await fetchAllForFacility(facility);
    console.log(`  → ${items.length} 日分を取得`);

    const { conditions, catches } = upsertData(items);
    totalConditions += conditions;
    totalCatches += catches;
    console.log(`  → UPSERT: 海況 ${conditions} 件, 釣果 ${catches} 件`);
  }

  // 集計
  const stats = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM daily_conditions) AS conditions,
      (SELECT COUNT(*) FROM catch_records)    AS catches,
      (SELECT COUNT(DISTINCT fish_name) FROM catch_records) AS unique_fish
  `).get() as { conditions: number; catches: number; unique_fish: number };

  console.log("\n=== 完了 ===");
  console.log(`daily_conditions : ${stats.conditions} 件`);
  console.log(`catch_records    : ${stats.catches} 件`);
  console.log(`ユニーク魚種      : ${stats.unique_fish} 種`);

  closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
