/**
 * extract_observations.ts — 施設コメントから魚種別観察記録を抽出する
 *
 * 実行: npx tsx src/batch/extract_observations.ts
 * - daily_conditions.comment を Claude CLI で解析
 * - tackle / bait / spot / time 等を fish_observations に保存
 * - 処理済み（fish_observations が既存）の日付はスキップ
 * - 週3回の launchd バッチで差分のみ処理
 */

import "dotenv/config";
import { spawn } from "node:child_process";
import { getDb, closeDb } from "../db/index.ts";

const CLAUDE_BIN =
  process.env.CLAUDE_BIN ??
  (process.env.HOME ? `${process.env.HOME}/.local/bin/claude` : "claude");

const BATCH_SIZE = 5; // 1回の Claude 呼び出しでまとめるコメント数

// ── Claude CLI 呼び出し ────────────────────────────────────────────────────────

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

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("claude CLI タイムアウト (120s)"));
    }, 120_000);

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`claude CLI エラー (${code}): ${[stderr, stdout].map(s => s.trim()).filter(Boolean).join(" / ").slice(0, 200)}`));
    });
    proc.on("error", (err) => { clearTimeout(timer); reject(err); });

    proc.stdin.write(prompt, "utf8");
    proc.stdin.end();
  });
}

// ── 型定義 ────────────────────────────────────────────────────────────────────

type CommentRecord = {
  date: string;
  facility: string;
  comment: string;
};

type RawObservation = {
  fish_name: string;
  raw_text: string | null;
  tackle: string | null;
  bait: string | null;
  spot_detail: string | null;
  time_of_day: string | null;
  water_depth: string | null;
  notes: string | null;
};

type ExtractedResult = {
  date: string;
  facility: string;
  observations: RawObservation[];
};

// ── プロンプト ─────────────────────────────────────────────────────────────────

function buildPrompt(records: CommentRecord[]): string {
  const entries = records
    .map((r, i) =>
      `--- [${i + 1}] date="${r.date}" facility="${r.facility}" ---\n${r.comment}`,
    )
    .join("\n\n");

  return `あなたは釣り情報の構造化アシスタントです。
以下は日本の海釣り施設が毎日掲載している釣果コメントです。
各コメントから魚ごとの釣り情報を抽出し、JSON配列で返してください。
有効なJSONのみ出力し、前置き・コードブロック記号は不要です。

【抽出対象コメント】
${entries}

【出力形式】
[
  {
    "date": "コメントのdate値をそのまま",
    "facility": "コメントのfacility値をそのまま",
    "observations": [
      {
        "fish_name": "魚名（コメントに登場する魚名のみ）",
        "raw_text": "その魚について言及している原文箇所",
        "tackle": "仕掛け種別（ぶっこみ/サビキ/ウキ釣り/ルアー/テンヤ/落とし込み 等、言及なければ null）",
        "bait": "エサ（アオイソメ/ジャリメ/コマセ/アミエビ/虫エサ 等、言及なければ null）",
        "spot_detail": "釣れた場所（外側/内側/手前/奥/岸壁 等、言及なければ null）",
        "time_of_day": "時間帯（朝/昼/夕/夜/終日 等、言及なければ null）",
        "water_depth": "水深（言及があれば記載、なければ null）",
        "notes": "その他特記事項（好調/不調/サイズ言及/釣り方のコツ等、なければ null）"
      }
    ]
  }
]

※ 魚が1匹も言及されていないコメントは observations を空配列にしてください
※ 同じ魚が複数の仕掛けで言及されている場合は別々のオブジェクトにしてください`;
}

// ── メイン処理 ────────────────────────────────────────────────────────────────

async function extractBatch(records: CommentRecord[]): Promise<ExtractedResult[]> {
  const prompt = buildPrompt(records);
  const text = await callClaude(prompt);
  const cleaned = text.replace(/^```json\s*/i, "").replace(/\s*```\s*$/, "").trim();
  return JSON.parse(cleaned) as ExtractedResult[];
}

export async function runExtractObservations(opts?: { limit?: number }): Promise<void> {
  const db = getDb();

  // 処理済み（fish_observations が存在する）date+facility を取得
  const processed = new Set<string>(
    (db.prepare("SELECT DISTINCT date || '|' || facility AS key FROM fish_observations").all() as Array<{ key: string }>)
      .map((r) => r.key),
  );

  // コメントが存在しかつ未処理のレコードを取得
  let query = `
    SELECT date, facility, comment
    FROM daily_conditions
    WHERE comment IS NOT NULL AND TRIM(comment) != ''
    AND (date || '|' || facility) NOT IN (
      SELECT DISTINCT date || '|' || facility FROM fish_observations
    )
    ORDER BY date ASC, facility ASC
  `;
  if (opts?.limit) query += ` LIMIT ${opts.limit}`;

  const targets = db.prepare(query).all() as CommentRecord[];

  if (targets.length === 0) {
    console.log("処理対象なし（すべて処理済みまたはコメントなし）");
    return;
  }

  console.log(`処理対象: ${targets.length} 件 (処理済み: ${processed.size} 件)`);

  // fish 名前→id のマップ
  const fishMap = new Map<string, number>(
    (db.prepare("SELECT id, name FROM fish").all() as Array<{ id: number; name: string }>)
      .map((f) => [f.name, f.id]),
  );

  const insertObs = db.prepare(`
    INSERT INTO fish_observations
      (date, facility, fish_id, fish_name, raw_text, tackle, bait,
       spot_detail, time_of_day, water_depth, notes, extracted_by)
    VALUES
      (@date, @facility, @fish_id, @fish_name, @raw_text, @tackle, @bait,
       @spot_detail, @time_of_day, @water_depth, @notes, 'claude')
  `);

  let totalObs = 0;
  let batchErrors = 0;

  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE);
    const progress = `[${i + 1}〜${Math.min(i + BATCH_SIZE, targets.length)}/${targets.length}]`;
    process.stdout.write(`${progress} 抽出中...`);

    try {
      const results = await extractBatch(batch);

      const saveAll = db.transaction((extracted: ExtractedResult[]) => {
        let count = 0;
        for (const result of extracted) {
          for (const obs of result.observations) {
            if (!obs.fish_name) continue;
            insertObs.run({
              date: result.date,
              facility: result.facility,
              fish_id: fishMap.get(obs.fish_name) ?? null,
              fish_name: obs.fish_name,
              raw_text: obs.raw_text ?? null,
              tackle: obs.tackle ?? null,
              bait: obs.bait ?? null,
              spot_detail: obs.spot_detail ?? null,
              time_of_day: obs.time_of_day ?? null,
              water_depth: obs.water_depth ?? null,
              notes: obs.notes ?? null,
            });
            count++;
          }
        }
        return count;
      });

      const saved = saveAll(results);
      totalObs += saved;
      console.log(` → ${saved} 件の観察記録を保存`);
    } catch (e) {
      console.error(` → 失敗: ${(e as Error).message.slice(0, 100)}`);
      batchErrors++;
    }

    // レート制限対策
    if (i + BATCH_SIZE < targets.length) {
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  const total = db.prepare("SELECT COUNT(*) as c FROM fish_observations").get() as { c: number };
  console.log(`\n=== 完了 ===`);
  console.log(`今回保存: ${totalObs} 件 / エラーバッチ: ${batchErrors}`);
  console.log(`fish_observations 合計: ${total.c} 件`);
}

// ── standalone 実行 ────────────────────────────────────────────────────────────

async function main() {
  console.log("=== extract_observations 開始 ===");

  // 初回は全件、以降は差分のみ自動判別
  await runExtractObservations();

  closeDb();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    closeDb();
    process.exit(1);
  });
}
