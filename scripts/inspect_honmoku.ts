import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const TARGET = "https://yokohama-fishingpiers.jp/honmoku/fishing-history";
const OUT_HTML = "data/snapshots/honmoku_rendered.html";
const OUT_TEXT = "data/snapshots/honmoku_text.txt";
const OUT_SUMMARY = "data/snapshots/honmoku_structure.json";

async function ensureDir(path: string) {
  await mkdir(dirname(path), { recursive: true });
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  locale: "ja-JP",
  timezoneId: "Asia/Tokyo",
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
});
const page = await ctx.newPage();

console.log(`Loading ${TARGET}`);
await page.goto(TARGET, { waitUntil: "networkidle", timeout: 60_000 });
await page.waitForTimeout(3000);

const title = await page.title();
const url = page.url();

const html = await page.content();
await ensureDir(OUT_HTML);
await writeFile(OUT_HTML, html, "utf8");

const bodyText = await page.evaluate(() => document.body.innerText);
await writeFile(OUT_TEXT, bodyText, "utf8");

const structure = await page.evaluate(() => {
  const summary: Record<string, unknown> = {};

  const tagCounts: Record<string, number> = {};
  document.querySelectorAll("*").forEach((el) => {
    const tag = el.tagName.toLowerCase();
    tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
  });
  summary.tagCounts = Object.fromEntries(
    Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
  );

  const classCounts: Record<string, number> = {};
  document.querySelectorAll("[class]").forEach((el) => {
    el.classList.forEach((c) => {
      classCounts[c] = (classCounts[c] ?? 0) + 1;
    });
  });
  summary.topClasses = Object.fromEntries(
    Object.entries(classCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
  );

  const candidates: { tag: string; cls: string; count: number; sample: string }[] = [];
  const seenSelectors = new Set<string>();
  document.querySelectorAll("[class]").forEach((el) => {
    el.classList.forEach((c) => {
      const sel = `${el.tagName.toLowerCase()}.${c}`;
      if (seenSelectors.has(sel)) return;
      seenSelectors.add(sel);
      const matched = document.querySelectorAll(sel);
      if (matched.length >= 3 && matched.length <= 100) {
        const sample = (matched[0].textContent ?? "").trim().slice(0, 200);
        if (sample.length > 0) {
          candidates.push({
            tag: el.tagName.toLowerCase(),
            cls: c,
            count: matched.length,
            sample,
          });
        }
      }
    });
  });
  summary.repeatedElementCandidates = candidates
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);

  const dateLike = Array.from(document.querySelectorAll("body *")).filter((el) => {
    const txt = (el.textContent ?? "").trim();
    return /^\d{4}[-./年]\d{1,2}[-./月]\d{1,2}/.test(txt) && txt.length < 100;
  });
  summary.dateLikeSamples = dateLike.slice(0, 10).map((el) => ({
    tag: el.tagName.toLowerCase(),
    cls: el.className,
    text: (el.textContent ?? "").trim().slice(0, 100),
  }));

  return summary;
});

await writeFile(OUT_SUMMARY, JSON.stringify({ title, url, ...structure }, null, 2), "utf8");

console.log(`title: ${title}`);
console.log(`final url: ${url}`);
console.log(`html bytes: ${html.length}`);
console.log(`body text bytes: ${bodyText.length}`);
console.log(`wrote: ${OUT_HTML}`);
console.log(`wrote: ${OUT_TEXT}`);
console.log(`wrote: ${OUT_SUMMARY}`);

await browser.close();
