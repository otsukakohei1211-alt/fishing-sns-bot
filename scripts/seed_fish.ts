/**
 * seed_fish.ts — catch_records のユニーク魚名から fish マスターを生成する
 *
 * 実行: npx tsx scripts/seed_fish.ts
 * - 未登録の魚名のみ対象（既存レコードは更新しない）
 * - Claude API で 10 種ずつバッチ処理してメタデータを生成する
 */

import "dotenv/config";
import { spawn } from "node:child_process";
import { getDb, closeDb } from "../src/db/index.ts";

const CLAUDE_BIN =
  process.env.CLAUDE_BIN ??
  (process.env.HOME ? `${process.env.HOME}/.local/bin/claude` : "claude");

function callClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    env.PATH = `${process.env.HOME}/.local/bin:${process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin"}`;

    const proc = spawn(CLAUDE_BIN, ["--print", "--output-format", "text"], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => { proc.kill(); reject(new Error("claude CLI タイムアウト (120s)")); }, 120_000);
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`claude CLI エラー (code ${code}): ${[stderr, stdout].map(s => s.trim()).filter(Boolean).join(" / ").slice(0, 300)}`));
    });
    proc.on("error", (err) => { clearTimeout(timer); reject(err); });
    proc.stdin.write(prompt, "utf8");
    proc.stdin.end();
  });
}

type FishMeta = {
  name: string;
  name_kana: string;
  scientific_name: string | null;
  aliases: string[];
  category: string;
  typical_size_min: number;
  typical_size_max: number;
  size_unit: string;
  best_season: string[];
  habitat: string;
  danger_level: number;
  danger_note: string | null;
  price_range: number;
  difficulty: number;
  taste_profile: {
    texture: string;
    fat_content: string;
    flavor: string;
  };
};

const SYSTEM_PROMPT = `あなたは日本の釣り・水産に精通した専門家です。
与えられた魚種リストについて、指定のJSON形式でメタデータを返してください。
必ず有効なJSONのみを出力し、前置き・説明・コードブロック記号は一切不要です。`;

const USER_PROMPT_TEMPLATE = `以下の魚種それぞれについて JSON 配列で情報を返してください。

【魚種リスト】
{FISH_LIST}

【出力形式（JSON配列）】
[
  {
    "name": "魚の日本語名（入力のまま）",
    "name_kana": "カタカナ読み",
    "scientific_name": "学名（不明な場合 null）",
    "aliases": ["別名1", "別名2"],
    "category": "魚 or 甲殻類 or イカタコ or 貝類 or その他",
    "typical_size_min": 最小サイズ数値,
    "typical_size_max": 最大サイズ数値,
    "size_unit": "cm or kg",
    "best_season": ["spring","summer","autumn","winter" の組み合わせ],
    "habitat": "底物 or 表層 or 中層 or 回遊 or 岩礁 など",
    "danger_level": 0〜3の整数（0=無害 1=トゲ注意 2=毒トゲ 3=毒魚）,
    "danger_note": "具体的な注意点（危険がない場合 null）",
    "price_range": 1〜4の整数（1=安価 2=普通 3=高級 4=超高級）,
    "difficulty": 1〜5の整数（1=初心者OK 5=上級者向け）,
    "taste_profile": {
      "texture": "白身 or 赤身 or 青魚 or 軟体 など",
      "fat_content": "淡白 or 普通 or 脂のり",
      "flavor": "旨味が強い or 淡白 or 磯の風味 など"
    }
  }
]`;

async function generateFishMeta(names: string[]): Promise<FishMeta[]> {
  const userContent = USER_PROMPT_TEMPLATE.replace(
    "{FISH_LIST}",
    names.map((n, i) => `${i + 1}. ${n}`).join("\n"),
  );
  const prompt = `${SYSTEM_PROMPT}\n\n${userContent}`;
  const text = await callClaude(prompt);
  const cleaned = text.replace(/^```json\s*/i, "").replace(/\s*```\s*$/, "").trim();
  return JSON.parse(cleaned) as FishMeta[];
}

async function main() {
  console.log("=== seed_fish 開始 ===");
  const db = getDb();

  // メタデータ未生成（name_kana が NULL）の魚を対象にする
  const unregistered = db
    .prepare(`
      SELECT name AS fish_name FROM fish
      WHERE name_kana IS NULL
      ORDER BY name
    `)
    .all() as Array<{ fish_name: string }>;

  if (unregistered.length === 0) {
    console.log("メタデータ未生成の魚種はありません。");
    closeDb();
    return;
  }

  console.log(`メタデータ生成対象: ${unregistered.length} 種`);
  const names = unregistered.map((r) => r.fish_name);

  const insertFish = db.prepare(`
    INSERT INTO fish (
      name, name_kana, scientific_name, aliases, category,
      typical_size_min, typical_size_max, size_unit,
      best_season, habitat,
      danger_level, danger_note, price_range, difficulty, taste_profile
    ) VALUES (
      @name, @name_kana, @scientific_name, @aliases, @category,
      @typical_size_min, @typical_size_max, @size_unit,
      @best_season, @habitat,
      @danger_level, @danger_note, @price_range, @difficulty, @taste_profile
    )
    ON CONFLICT(name) DO UPDATE SET
      name_kana       = excluded.name_kana,
      scientific_name = excluded.scientific_name,
      aliases         = excluded.aliases,
      category        = excluded.category,
      typical_size_min = excluded.typical_size_min,
      typical_size_max = excluded.typical_size_max,
      size_unit       = excluded.size_unit,
      best_season     = excluded.best_season,
      habitat         = excluded.habitat,
      danger_level    = excluded.danger_level,
      danger_note     = excluded.danger_note,
      price_range     = excluded.price_range,
      difficulty      = excluded.difficulty,
      taste_profile   = excluded.taste_profile,
      updated_at      = datetime('now','localtime')
  `);

  // 10種ずつバッチ処理
  const BATCH_SIZE = 10;
  let inserted = 0;
  let failed = 0;

  for (let i = 0; i < names.length; i += BATCH_SIZE) {
    const batch = names.slice(i, i + BATCH_SIZE);
    process.stdout.write(`\n[${i + 1}〜${Math.min(i + BATCH_SIZE, names.length)}] ${batch.join(", ")} を生成中...`);

    try {
      const metas = await generateFishMeta(batch);

      const batchInsert = db.transaction((metaList: FishMeta[]) => {
        for (const m of metaList) {
          insertFish.run({
            name: m.name,
            name_kana: m.name_kana ?? null,
            scientific_name: m.scientific_name ?? null,
            aliases: JSON.stringify(m.aliases ?? []),
            category: m.category ?? null,
            typical_size_min: m.typical_size_min ?? null,
            typical_size_max: m.typical_size_max ?? null,
            size_unit: m.size_unit ?? "cm",
            best_season: JSON.stringify(m.best_season ?? []),
            habitat: m.habitat ?? null,
            danger_level: m.danger_level ?? 0,
            danger_note: m.danger_note ?? null,
            price_range: m.price_range ?? 2,
            difficulty: m.difficulty ?? 3,
            taste_profile: JSON.stringify(m.taste_profile ?? {}),
          });
          inserted++;
        }
      });
      batchInsert(metas);
      console.log(` → OK`);
    } catch (e) {
      console.error(` → 失敗: ${(e as Error).message}`);
      // フォールバック: 名前だけで登録
      const fallback = db.transaction((batchNames: string[]) => {
        for (const n of batchNames) {
          insertFish.run({
            name: n, name_kana: null, scientific_name: null,
            aliases: "[]", category: null,
            typical_size_min: null, typical_size_max: null, size_unit: "cm",
            best_season: "[]", habitat: null,
            danger_level: 0, danger_note: null,
            price_range: 2, difficulty: 3,
            taste_profile: "{}",
          });
          failed++;
        }
      });
      fallback(batch);
    }

    // API レート制限対策
    if (i + BATCH_SIZE < names.length) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  // fish_idをcatch_recordsに反映
  console.log("\ncatch_records の fish_id を更新中...");
  const updated = db.prepare(`
    UPDATE catch_records
    SET fish_id = (SELECT id FROM fish WHERE fish.name = catch_records.fish_name)
    WHERE fish_id IS NULL
  `).run();

  const total = db.prepare("SELECT COUNT(*) as c FROM fish").get() as { c: number };

  console.log("\n=== 完了 ===");
  console.log(`登録成功: ${inserted} 種 / フォールバック: ${failed} 種`);
  console.log(`fish テーブル合計: ${total.c} 種`);
  console.log(`catch_records 更新: ${updated.changes} 件`);

  closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
