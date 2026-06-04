import { mkdir, readFile, writeFile } from "node:fs/promises";

const STATE_FILE = "data/auth/x_state.json";

const srcPath = process.argv[2];
if (!srcPath) {
  console.error("usage: npm run x:import -- <cookies.json>");
  console.error("");
  console.error("対応フォーマット:");
  console.error("  - Cookie-Editor 拡張 → Export → JSON 形式");
  console.error("  - EditThisCookie 拡張 → Export 形式");
  console.error("  - Playwright storageState 形式 (既存)");
  process.exit(1);
}

type RawCookie = {
  name?: string;
  value?: string;
  domain?: string;
  path?: string;
  expirationDate?: number; // Cookie-Editor / EditThisCookie
  expires?: number; // Playwright storageState
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
  hostOnly?: boolean;
};

type PWCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
};

function normalizeSameSite(s?: string): PWCookie["sameSite"] {
  if (!s) return "Lax";
  const v = s.toLowerCase();
  if (v === "strict") return "Strict";
  if (v === "none" || v === "no_restriction") return "None";
  if (v === "lax") return "Lax";
  if (v === "unspecified") return "Lax";
  return "Lax";
}

function normalize(raw: RawCookie): PWCookie | null {
  if (!raw.name || raw.value == null || !raw.domain) return null;
  const expires =
    typeof raw.expirationDate === "number"
      ? Math.floor(raw.expirationDate)
      : typeof raw.expires === "number"
        ? raw.expires
        : Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  return {
    name: raw.name,
    value: String(raw.value),
    domain: raw.domain,
    path: raw.path ?? "/",
    expires,
    httpOnly: !!raw.httpOnly,
    secure: !!raw.secure,
    sameSite: normalizeSameSite(raw.sameSite),
  };
}

const buf = await readFile(srcPath, "utf8");
const parsed: unknown = JSON.parse(buf);

let rawCookies: RawCookie[];
if (Array.isArray(parsed)) {
  // Cookie-Editor / EditThisCookie style: top-level array
  rawCookies = parsed as RawCookie[];
} else if (
  parsed &&
  typeof parsed === "object" &&
  Array.isArray((parsed as { cookies?: unknown }).cookies)
) {
  // Playwright storageState style
  rawCookies = (parsed as { cookies: RawCookie[] }).cookies;
} else {
  console.error("未対応のJSONフォーマットです。配列または { cookies: [...] } を想定。");
  process.exit(1);
}

const allCookies = rawCookies.map(normalize).filter((c): c is PWCookie => c !== null);

// Keep only X-related cookies, to avoid leaking unrelated session data.
const xCookies = allCookies.filter((c) => {
  const d = c.domain.toLowerCase().replace(/^\./, "");
  return d === "x.com" || d.endsWith(".x.com") || d === "twitter.com" || d.endsWith(".twitter.com");
});

const requiredNames = ["auth_token", "ct0"];
const missing = requiredNames.filter((n) => !xCookies.some((c) => c.name === n));
if (missing.length > 0) {
  console.error(`必須クッキーが見つかりません: ${missing.join(", ")}`);
  console.error("ブラウザで x.com にログイン中であることを確認し、改めてエクスポートしてください。");
  process.exit(1);
}

const storageState = { cookies: xCookies, origins: [] as unknown[] };

await mkdir("data/auth", { recursive: true });
await writeFile(STATE_FILE, JSON.stringify(storageState, null, 2), "utf8");

console.log(`✅ imported ${xCookies.length} cookie(s) for x.com / twitter.com → ${STATE_FILE}`);
console.log("含まれる主要クッキー:", xCookies.map((c) => c.name).slice(0, 20).join(", "));
console.log("次に: npm run x:draft で投稿手前まで開けるか確認してください。");
