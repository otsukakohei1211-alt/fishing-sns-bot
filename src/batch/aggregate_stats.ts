/**
 * aggregate_stats.ts — fish_observations から fish_tactic_stats を集計する
 *
 * 実行: npx tsx src/batch/aggregate_stats.ts
 * - tackle / bait / spot / time の出現頻度をカウント
 * - co_catch_count: その仕掛けが言及された日に実際に釣れていた回数
 * - extract_observations の後に実行する（launchd でチェーン）
 */

import "dotenv/config";
import { getDb, closeDb } from "../db/index.ts";

export function runAggregateStats(): void {
  const db = getDb();

  console.log("=== aggregate_stats 開始 ===");

  // 既存の統計を全削除して再集計（完全上書き）
  db.prepare("DELETE FROM fish_tactic_stats").run();

  const tacticTypes = ["tackle", "bait", "spot_detail", "time_of_day"] as const;
  const typeLabels: Record<string, string> = {
    tackle: "tackle",
    bait: "bait",
    spot_detail: "spot",
    time_of_day: "time",
  };

  let totalRows = 0;

  for (const col of tacticTypes) {
    // 出現頻度のカウント
    const counts = db.prepare(`
      SELECT
        fish_id,
        fish_name,
        ${col} AS tactic_value,
        COUNT(*) AS mention_count,
        MAX(date) AS last_seen
      FROM fish_observations
      WHERE fish_id IS NOT NULL
        AND ${col} IS NOT NULL
        AND TRIM(${col}) != ''
      GROUP BY fish_id, ${col}
    `).all() as Array<{
      fish_id: number;
      fish_name: string;
      tactic_value: string;
      mention_count: number;
      last_seen: string;
    }>;

    const insert = db.prepare(`
      INSERT INTO fish_tactic_stats
        (fish_id, tactic_type, tactic_value, mention_count, co_catch_count, last_seen)
      VALUES
        (@fish_id, @tactic_type, @tactic_value, @mention_count, @co_catch_count, @last_seen)
      ON CONFLICT(fish_id, tactic_type, tactic_value) DO UPDATE SET
        mention_count  = excluded.mention_count,
        co_catch_count = excluded.co_catch_count,
        last_seen      = excluded.last_seen
    `);

    const batchInsert = db.transaction(
      (rows: typeof counts) => {
        for (const row of rows) {
          // co_catch_count: 同じ日・施設に実際の釣果レコードがある件数
          const co = db.prepare(`
            SELECT COUNT(DISTINCT fo.date || '|' || fo.facility) AS cnt
            FROM fish_observations fo
            JOIN catch_records cr
              ON cr.date = fo.date
             AND cr.facility = fo.facility
             AND cr.fish_id = fo.fish_id
             AND cr.count > 0
            WHERE fo.fish_id = ?
              AND fo.${col} = ?
          `).get(row.fish_id, row.tactic_value) as { cnt: number };

          insert.run({
            fish_id: row.fish_id,
            tactic_type: typeLabels[col],
            tactic_value: row.tactic_value,
            mention_count: row.mention_count,
            co_catch_count: co.cnt,
            last_seen: row.last_seen,
          });
        }
      },
    );

    batchInsert(counts);
    totalRows += counts.length;
    console.log(`  ${col}: ${counts.length} 行を集計`);
  }

  // 確認
  const topStats = db.prepare(`
    SELECT f.name, ts.tactic_type, ts.tactic_value,
           ts.mention_count, ts.co_catch_count,
           ROUND(100.0 * ts.co_catch_count / ts.mention_count, 1) AS hit_rate_pct
    FROM fish_tactic_stats ts
    JOIN fish f ON f.id = ts.fish_id
    ORDER BY ts.mention_count DESC
    LIMIT 10
  `).all();

  console.log("\n=== 出現頻度 TOP10 ===");
  topStats.forEach((r: unknown) => console.log(" ", JSON.stringify(r)));

  const total = db.prepare("SELECT COUNT(*) as c FROM fish_tactic_stats").get() as { c: number };
  console.log(`\nfish_tactic_stats 合計: ${total.c} 行 (今回集計: ${totalRows} 行)`);
  console.log("=== 完了 ===");
}

// ── standalone 実行 ────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  runAggregateStats();
  closeDb();
}
