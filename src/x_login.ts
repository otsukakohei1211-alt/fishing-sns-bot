import { mkdir, writeFile } from "node:fs/promises";
import * as readline from "node:readline";

const STATE_FILE = "data/auth/x_state.json";

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

console.log("");
console.log("============================================================");
console.log("X 認証クッキー取り込み");
console.log("============================================================");
console.log("");
console.log("普段使っているブラウザで x.com にログイン済みの状態で、");
console.log("DevTools (Cmd+Option+I) → Application タブ → Cookies → https://x.com");
console.log("を開き、以下2つのクッキーの『Value』列を順にコピーして貼り付けてください。");
console.log("");
console.log("  1. auth_token   (HttpOnly。値は40文字前後の16進文字列)");
console.log("  2. ct0          (CSRFトークン。値は150文字前後)");
console.log("");
console.log("※ 拡張機能でエクスポートしたJSONを使いたい場合は");
console.log("   `npm run x:import <path.json>` を使ってください。");
console.log("");

const authToken = await prompt("auth_token を貼り付け → ");
if (!/^[0-9a-f]{20,}$/i.test(authToken)) {
  console.error(
    `auth_token の形式が想定外です (got: ${authToken.length} chars)。16進文字列を貼り付けてください。`,
  );
  process.exit(1);
}

const ct0 = await prompt("ct0 を貼り付け → ");
if (ct0.length < 32) {
  console.error(`ct0 の形式が想定外です (got: ${ct0.length} chars)。`);
  process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
const oneYear = now + 365 * 24 * 60 * 60;

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

const cookies: PWCookie[] = [
  {
    name: "auth_token",
    value: authToken,
    domain: ".x.com",
    path: "/",
    expires: oneYear,
    httpOnly: true,
    secure: true,
    sameSite: "None",
  },
  {
    name: "ct0",
    value: ct0,
    domain: ".x.com",
    path: "/",
    expires: oneYear,
    httpOnly: false,
    secure: true,
    sameSite: "Lax",
  },
];

const storageState = { cookies, origins: [] as unknown[] };

await mkdir("data/auth", { recursive: true });
await writeFile(STATE_FILE, JSON.stringify(storageState, null, 2), "utf8");

console.log("");
console.log(`✅ saved ${STATE_FILE}`);
console.log("次に: npm run x:draft で投稿手前まで開けるか確認してください。");
