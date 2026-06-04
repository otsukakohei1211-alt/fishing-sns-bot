import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const TARGET = "https://yokohama-fishingpiers.jp/honmoku/fishing-history";
const OUT_NET = "data/snapshots/honmoku_network.json";
const OUT_EXPANDED_HTML = "data/snapshots/honmoku_expanded.html";
const OUT_EXPANDED_TEXT = "data/snapshots/honmoku_expanded.txt";

async function ensureDir(p: string) {
  await mkdir(dirname(p), { recursive: true });
}

type RecordedReq = {
  url: string;
  method: string;
  resourceType: string;
  status?: number;
  contentType?: string;
  responseBytes?: number;
  bodySnippet?: string;
};

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  locale: "ja-JP",
  timezoneId: "Asia/Tokyo",
});
const page = await ctx.newPage();

const records: RecordedReq[] = [];

page.on("response", async (res) => {
  const req = res.request();
  const url = req.url();
  const rt = req.resourceType();
  if (rt === "image" || rt === "font" || rt === "stylesheet" || rt === "media") return;
  if (url.includes("yokohama-fishingpiers.jp") === false && url.startsWith("data:") === false) {
    // Only record same-origin / API endpoints — but keep external XHR (api may live elsewhere)
  }
  const ct = res.headers()["content-type"] ?? "";
  let bodySnippet: string | undefined;
  let bytes: number | undefined;
  if (ct.includes("json") || ct.includes("text")) {
    try {
      const body = await res.text();
      bytes = body.length;
      bodySnippet = body.slice(0, 600);
    } catch {
      /* noop */
    }
  }
  records.push({
    url,
    method: req.method(),
    resourceType: rt,
    status: res.status(),
    contentType: ct,
    responseBytes: bytes,
    bodySnippet,
  });
});

console.log(`Loading ${TARGET}`);
await page.goto(TARGET, { waitUntil: "networkidle", timeout: 60_000 });
await page.waitForTimeout(2000);

const panels = page.locator(".v-expansion-panel-title");
const panelCount = await panels.count();
console.log(`expansion panels: ${panelCount}`);

for (let i = 0; i < Math.min(panelCount, 8); i++) {
  try {
    await panels.nth(i).click({ timeout: 5_000 });
    await page.waitForTimeout(800);
  } catch (e) {
    console.log(`panel ${i} click failed:`, (e as Error).message);
  }
}
await page.waitForTimeout(1500);

const expandedHtml = await page.content();
await ensureDir(OUT_EXPANDED_HTML);
await writeFile(OUT_EXPANDED_HTML, expandedHtml, "utf8");

const expandedText = await page.evaluate(() => document.body.innerText);
await writeFile(OUT_EXPANDED_TEXT, expandedText, "utf8");

await writeFile(OUT_NET, JSON.stringify(records, null, 2), "utf8");

console.log(`expanded html bytes: ${expandedHtml.length}`);
console.log(`expanded text bytes: ${expandedText.length}`);
console.log(`network records: ${records.length}`);
console.log(`wrote ${OUT_NET}, ${OUT_EXPANDED_HTML}, ${OUT_EXPANDED_TEXT}`);

await browser.close();
