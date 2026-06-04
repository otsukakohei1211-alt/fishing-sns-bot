import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const TARGET = "https://yokohama-fishingpiers.jp/honmoku/fishing-history";
const OUT = "data/snapshots/honmoku_gql.json";

async function ensureDir(p: string) {
  await mkdir(dirname(p), { recursive: true });
}

type GqlRecord = {
  url: string;
  reqHeaders: Record<string, string>;
  postData: string | null;
  status: number;
  resHeaders: Record<string, string>;
  body: string;
};

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ locale: "ja-JP", timezoneId: "Asia/Tokyo" });
const page = await ctx.newPage();

const records: GqlRecord[] = [];

page.on("response", async (res) => {
  const req = res.request();
  if (!req.url().includes("appsync-api")) return;
  let body = "";
  try {
    body = await res.text();
  } catch {
    body = "";
  }
  records.push({
    url: req.url(),
    reqHeaders: req.headers(),
    postData: req.postData() ?? null,
    status: res.status(),
    resHeaders: res.headers(),
    body,
  });
});

console.log(`Loading ${TARGET}`);
await page.goto(TARGET, { waitUntil: "networkidle", timeout: 60_000 });

// Try clicking expansion panel(s) to trigger any lazy queries
const panels = page.locator(".v-expansion-panel-title");
const n = await panels.count();
for (let i = 0; i < Math.min(n, 5); i++) {
  try {
    await panels.nth(i).click({ timeout: 5_000 });
    await page.waitForTimeout(800);
  } catch {
    /* ignore */
  }
}
await page.waitForTimeout(2000);

await ensureDir(OUT);
await writeFile(OUT, JSON.stringify(records, null, 2), "utf8");
console.log(`captured ${records.length} graphql requests → ${OUT}`);

await browser.close();
