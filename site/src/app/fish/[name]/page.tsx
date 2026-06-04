import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";

type FishMeta = {
  id: number; name: string; name_kana: string; category: string;
  price_range: number; difficulty: number; danger_level: number; danger_note: string;
  taste_profile: { texture: string; fat_content: string; flavor: string };
  best_season: string[]; typical_size_min: number; typical_size_max: number; size_unit: string;
  this_month_avg: number; bakuchou_index: number; appearance_pct: number;
  recent_avg: number; prev_avg: number;
};

type FishDetail = {
  monthly: Array<{ month: number; avg_catch: number; avg_per_person: number; avg_max_size: number; appearance_pct: number }>;
  recent: Array<{ date: string; count: number; water_temp: number; avg_size: number }>;
  tactics: Array<{ tactic_type: string; tactic_value: string; mention_count: number; hit_rate_pct: number }>;
};

function readData<T>(path: string): T | null {
  const fullPath = join(process.cwd(), "src/data", path);
  if (!existsSync(fullPath)) return null;
  return JSON.parse(readFileSync(fullPath, "utf8")) as T;
}

const MONTH_LABELS = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];
const priceLabel = (n: number) => ["", "安価", "普通", "高級", "超高級"][n] ?? "";
const difficultyLabel = (n: number) => ["", "初心者OK", "やさしめ", "中級者", "やや難しい", "上級者"][n] ?? "";
const tacticTypeLabel = (t: string) => ({ tackle: "🎣 仕掛け", bait: "🪱 エサ", spot: "📍 ポイント", time: "⏰ 時間帯" }[t] ?? t);

export async function generateStaticParams() {
  const fishList = readData<FishMeta[]>("fish/index.json") ?? [];
  return fishList.map(f => ({ name: encodeURIComponent(f.name) }));
}

export default async function FishPage({ params }: { params: Promise<{ name: string }> }) {
  const { name: encodedName } = await params;
  const fishName = decodeURIComponent(encodedName);

  const fishList = readData<FishMeta[]>("fish/index.json") ?? [];
  const fish = fishList.find(f => f.name === fishName);
  if (!fish) notFound();

  const detail = readData<FishDetail>(`fish/${fishName}.json`);
  if (!detail) notFound();

  const thisMonth = new Date().getMonth() + 1;
  const chartPath = `/charts/monthly_${fishName}.png`;
  const hasChart = existsSync(join(process.cwd(), "..", "data/charts/monthly", `${fishName}.png`));

  // 最高爆釣月
  const peakMonth = detail.monthly.reduce((best, m) =>
    (m.avg_catch ?? 0) > (best.avg_catch ?? 0) ? m : best,
    detail.monthly[0]
  );

  return (
    <div className="space-y-8">
      {/* ヘッダー */}
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm text-slate-500 mb-1">
            <Link href="/fish" className="hover:underline">魚種図鑑</Link> / {fishName}
          </div>
          <h1 className="text-3xl font-bold text-slate-800">{fishName}</h1>
          <p className="text-slate-500">{fish.name_kana} ／ {fish.category}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {fish.bakuchou_index >= 70 && (
            <span className="bg-red-100 text-red-700 px-3 py-1 rounded-full text-sm font-bold">🔥 爆釣{fish.bakuchou_index}%</span>
          )}
          {fish.price_range >= 3 && (
            <span className="bg-amber-100 text-amber-700 px-3 py-1 rounded-full text-sm">{priceLabel(fish.price_range)}</span>
          )}
          {fish.danger_level >= 1 && (
            <span className="bg-orange-100 text-orange-700 px-3 py-1 rounded-full text-sm">⚠ {fish.danger_note}</span>
          )}
        </div>
      </div>

      {/* 基本情報 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "標準サイズ", value: `${fish.typical_size_min}〜${fish.typical_size_max}${fish.size_unit}` },
          { label: "釣り難易度", value: difficultyLabel(fish.difficulty) },
          { label: "今月平均", value: `${fish.this_month_avg ?? 0}匹/日` },
          { label: "今月出現率", value: `${fish.appearance_pct ?? 0}%` },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white border border-slate-200 rounded-xl p-4 text-center">
            <div className="text-xs text-slate-500 mb-1">{label}</div>
            <div className="font-bold text-slate-800">{value}</div>
          </div>
        ))}
      </div>

      {/* 月別グラフ */}
      <section>
        <h2 className="text-lg font-bold mb-3">📅 月別釣果データ</h2>
        <div className="bg-white border border-slate-200 rounded-xl p-4 overflow-x-auto">
          <div className="flex gap-1 items-end min-w-max h-40">
            {detail.monthly.map(m => {
              const maxVal = Math.max(...detail.monthly.map(x => x.avg_catch ?? 0));
              const height = maxVal > 0 ? Math.round(((m.avg_catch ?? 0) / maxVal) * 120) : 0;
              const isThisMonth = m.month === thisMonth;
              const isPeak = m.month === peakMonth?.month;
              return (
                <div key={m.month} className="flex flex-col items-center gap-1 w-12">
                  <div className="text-xs text-slate-500">{m.avg_catch ?? "-"}</div>
                  <div
                    className={`w-10 rounded-t transition-all ${
                      isThisMonth ? "bg-orange-400" : isPeak ? "bg-blue-600" : "bg-blue-300"
                    }`}
                    style={{ height: `${height}px` }}
                  />
                  <div className={`text-xs ${isThisMonth ? "font-bold text-orange-600" : "text-slate-500"}`}>
                    {MONTH_LABELS[m.month - 1]}
                  </div>
                  {m.appearance_pct && <div className="text-xs text-slate-400">{m.appearance_pct}%</div>}
                </div>
              );
            })}
          </div>
          <div className="text-xs text-slate-400 mt-2 flex gap-4">
            <span><span className="inline-block w-3 h-3 bg-orange-400 rounded mr-1"/>今月</span>
            <span><span className="inline-block w-3 h-3 bg-blue-600 rounded mr-1"/>ピーク月</span>
            <span>棒グラフの下の%は出現率</span>
          </div>
        </div>
      </section>

      {/* 仕掛け実績 */}
      {detail.tactics.length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-3">🎣 釣り方データ（施設コメント実績）</h2>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs">
                <tr>
                  <th className="text-left px-4 py-2">種別</th>
                  <th className="text-left px-4 py-2">内容</th>
                  <th className="text-right px-4 py-2">言及数</th>
                  <th className="text-right px-4 py-2">実績率</th>
                </tr>
              </thead>
              <tbody>
                {detail.tactics.map((t, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-4 py-2 text-slate-500">{tacticTypeLabel(t.tactic_type)}</td>
                    <td className="px-4 py-2 font-medium">{t.tactic_value}</td>
                    <td className="px-4 py-2 text-right text-slate-500">{t.mention_count}件</td>
                    <td className={`px-4 py-2 text-right font-bold ${t.hit_rate_pct >= 90 ? "text-green-600" : "text-slate-600"}`}>
                      {t.hit_rate_pct}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 味の特徴 */}
      {fish.taste_profile && (
        <section>
          <h2 className="text-lg font-bold mb-3">🍳 食べ方・味の特徴</h2>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex flex-wrap gap-2">
              {Object.entries(fish.taste_profile).map(([k, v]) => v && (
                <span key={k} className="bg-green-50 text-green-700 px-3 py-1 rounded-full text-sm">{v}</span>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* X誘導 */}
      <div className="bg-blue-50 rounded-xl p-4 text-sm text-slate-600">
        最新の{fishName}の釣果情報は
        <a href={`https://x.com/search?q=%23${fishName}%20%40MigakuZ80887`}
          target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline mx-1">
          Xの@MigakuZ80887
        </a>
        で毎日更新中
      </div>
    </div>
  );
}
