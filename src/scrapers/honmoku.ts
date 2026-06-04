import { writeFile, mkdir } from "node:fs/promises";
import type { Catch, DailyReport, Facility } from "../types.js";

// AppSync endpoint and public API key — both are embedded in the public Vue bundle at
// https://yokohama-fishingpiers.jp/assets/index-*.js and are sent from every visitor's
// browser. Treat as public.
const GQL_ENDPOINT =
  "https://iqqdsybr6beovaix6btxwykuha.appsync-api.ap-northeast-1.amazonaws.com/graphql";
const API_KEY = "da2-of4bzmdi4vhjha5buiog37mki4";

const LAST_POSTS_QUERY = `query LastPostsByFacilityAndDate(
  $facility: String!
  $date: ModelStringKeyConditionInput
  $sortDirection: ModelSortDirection
  $filter: ModelLastPostFilterInput
  $limit: Int
  $nextToken: String
) {
  lastPostsByFacilityAndDate(
    facility: $facility
    date: $date
    sortDirection: $sortDirection
    filter: $filter
    limit: $limit
    nextToken: $nextToken
  ) {
    items {
      date
      facility
      sentence
      weather
      waterTemp
      tide
      visitors
      ${Array.from({ length: 30 }, (_, i) => i + 1)
        .map(
          (n) =>
            `fish${n}Name fish${n}MinSize fish${n}MaxSize fish${n}Unit fish${n}Count fish${n}Place`,
        )
        .join("\n      ")}
    }
    nextToken
  }
}`;

type LastPostItem = {
  date: string;
  facility: string;
  sentence: string;
  weather: string;
  waterTemp: string;
  tide: string;
  visitors: number;
} & Record<string, string | number | string[] | null>;

type GqlResponse = {
  data?: { lastPostsByFacilityAndDate?: { items: LastPostItem[] } };
  errors?: Array<{ message: string }>;
};

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

function jstDateOffset(daysAgo: number): Date {
  // Use JST (UTC+9). Compute "today" in JST, then subtract days.
  const nowUtc = new Date();
  const jstMs = nowUtc.getTime() + 9 * 60 * 60 * 1000;
  const jst = new Date(jstMs);
  jst.setUTCDate(jst.getUTCDate() - daysAgo);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()));
}

async function fetchOne(facility: Facility, date: string): Promise<LastPostItem | null> {
  const res = await fetch(GQL_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": API_KEY,
    },
    body: JSON.stringify({
      query: LAST_POSTS_QUERY,
      variables: { facility, date: { eq: date } },
    }),
  });
  if (!res.ok) {
    throw new Error(`GraphQL HTTP ${res.status} for ${facility} ${date}: ${await res.text()}`);
  }
  const json = (await res.json()) as GqlResponse;
  if (json.errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  const items = json.data?.lastPostsByFacilityAndDate?.items ?? [];
  return items[0] ?? null;
}

function toDailyReport(facility: Facility, item: LastPostItem): DailyReport {
  const catches: Catch[] = [];
  for (let n = 1; n <= 30; n++) {
    const name = item[`fish${n}Name`] as string | null;
    if (!name) continue;
    catches.push({
      name,
      minSize: (item[`fish${n}MinSize`] as number) ?? 0,
      maxSize: (item[`fish${n}MaxSize`] as number) ?? 0,
      unit: (item[`fish${n}Unit`] as string) ?? "",
      count: (item[`fish${n}Count`] as number) ?? 0,
      places: (item[`fish${n}Place`] as string[]) ?? [],
    });
  }
  return {
    facility,
    date: item.date,
    weather: item.weather,
    waterTemp: item.waterTemp,
    tide: item.tide,
    visitors: item.visitors,
    comment: item.sentence,
    catches,
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchRecentHonmoku(opts?: {
  wantCount?: number;
  lookbackDays?: number;
}): Promise<DailyReport[]> {
  const want = opts?.wantCount ?? 2;
  const lookback = opts?.lookbackDays ?? 7;

  const out: DailyReport[] = [];
  for (let i = 0; i < lookback && out.length < want; i++) {
    const date = ymd(jstDateOffset(i));
    const item = await fetchOne("honmoku", date);
    if (item) out.push(toDailyReport("honmoku", item));
  }
  return out;
}

async function main() {
  const reports = await fetchRecentHonmoku({ wantCount: 2, lookbackDays: 7 });
  await mkdir("data/snapshots", { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const file = `data/snapshots/honmoku_${stamp}.json`;
  await writeFile(file, JSON.stringify(reports, null, 2), "utf8");
  console.log(`fetched ${reports.length} day(s), wrote ${file}`);
  for (const r of reports) {
    const top = r.catches
      .slice()
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map((c) => `${c.name}${c.count}`)
      .join(" / ");
    console.log(`  ${r.date} ${r.weather} 水温${r.waterTemp}℃ ${r.tide}  top: ${top}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
