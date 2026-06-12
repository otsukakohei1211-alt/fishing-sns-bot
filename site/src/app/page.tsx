import { readFileSync } from "fs";
import { join } from "path";
import Image from "next/image";
import Link from "next/link";

type FishSummary = {
  id: number; name: string; name_kana: string; category: string;
  price_range: number; difficulty: number; danger_level: number;
  this_month_avg: number; bakuchou_index: number; appearance_pct: number;
  recent_avg: number; prev_avg: number; avg_max_size: number;
};

type LatestCatch = {
  date: string; weather: string; water_temp: number; tide: string;
  visitors: number; comment: string;
  catches: Array<{ id: number; name: string; count: number; min_size: number; max_size: number; unit: string }>;
};

type Summary = {
  total_species: number; total_days: number; latest_date: string;
};

type ReportEntry = {
  slug: string; date: string; title: string; lead: string;
  topCatches: string[]; bakuchouIndex?: number;
};

function readData<T>(path: string): T {
  const fullPath = join(process.cwd(), "src/data", path);
  return JSON.parse(readFileSync(fullPath, "utf8")) as T;
}

function priceLabel(n: number) {
  return ["", "安価", "普通", "高級", "超高級"][n] ?? "";
}

function trendBadge(recent: number, prev: number) {
  if (!prev) return null;
  const ratio = recent / prev;
  if (ratio > 1.3) return <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold">🔥 急上昇</span>;
  if (ratio > 1.0) return <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">↑ 上昇中</span>;
  if (ratio < 0.7) return <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">↓ 下降中</span>;
  return <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">→ 安定</span>;
}

export default function Home() {
  const summary = readData<Summary>("summary.json");
  const fishList = readData<FishSummary[]>("fish/index.json");
  const latest = readData<LatestCatch>("daily/latest.json");
  let reports: ReportEntry[] = [];
  try {
    reports = readData<ReportEntry[]>("reports/index.json").slice(0, 3);
  } catch {
    // 記事がまだない場合はセクションごと非表示
  }
  const latestReport = reports.find((r) => r.date === latest.date);

  // 注目魚種（急上昇 or 爆釣指数80%以上）
  const featured = fishList
    .filter(f => f.recent_avg > 0 && f.prev_avg > 0)
    .sort((a, b) => {
      const scoreA = (a.recent_avg / (a.prev_avg || 1)) * (a.bakuchou_index / 100);
      const scoreB = (b.recent_avg / (b.prev_avg || 1)) * (b.bakuchou_index / 100);
      return scoreB - scoreA;
    })
    .slice(0, 6);

  const latestDate = latest.date.replace(/\//g, "年").replace(/(\d+)$/, "$1日");

  return (
    <div className="space-y-10">
      {/* ヒーロー */}
      <section className="text-center py-8">
        <h1 className="text-3xl font-bold text-blue-800 mb-2">東京湾釣りデータ分析</h1>
        <p className="text-slate-500 text-sm">
          本牧・大黒・磯子の{summary.total_days}日分・{summary.total_species}魚種のデータを分析
        </p>
      </section>

      {/* 今日の釣果 */}
      <section>
        <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
          📊 最新釣果
          <span className="text-sm font-normal text-slate-500">（{latestDate}・本牧）</span>
        </h2>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex flex-wrap gap-4 text-sm text-slate-600 mb-4">
            <span>🌤 {latest.weather}</span>
            <span>🌡 水温 {latest.water_temp}℃</span>
            <span>🌊 {latest.tide}</span>
            <span>👤 {latest.visitors}人</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {latest.catches.slice(0, 8).map(c => (
              <Link key={c.name} href={`/fish/${c.id ?? ""}`}
                className="bg-blue-50 hover:bg-blue-100 rounded-lg p-3 text-center transition-colors">
                <div className="font-bold text-blue-800">{c.name}</div>
                <div className="text-xs text-slate-500">{c.min_size}〜{c.max_size}{c.unit}</div>
                <div className="text-sm font-bold text-blue-600">{c.count}匹</div>
              </Link>
            ))}
          </div>
          {latest.comment && (
            <p className="mt-4 text-sm text-slate-600 bg-slate-50 rounded-lg p-3 leading-relaxed">
              {latest.comment}
            </p>
          )}
          {latestReport && (
            <div className="mt-4 text-right">
              <Link href={`/reports/${latestReport.slug}`}
                className="text-sm text-blue-600 font-bold hover:underline">
                この日の詳細レポートを読む →
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* 最新レポート */}
      {reports.length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-4">📝 最新の釣果レポート</h2>
          <div className="grid gap-3">
            {reports.map((r) => (
              <Link key={r.slug} href={`/reports/${r.slug}`}
                className="bg-white rounded-xl border border-slate-200 hover:border-blue-300 hover:shadow-md p-4 transition-all block">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-bold text-slate-800 text-sm leading-snug flex-1">{r.title}</h3>
                  {r.bakuchouIndex !== undefined && (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-bold shrink-0 ${
                      r.bakuchouIndex >= 150 ? "bg-red-600 text-white"
                      : r.bakuchouIndex >= 120 ? "bg-orange-500 text-white"
                      : "bg-slate-100 text-slate-500"}`}>
                      {r.bakuchouIndex >= 150 ? "大爆釣🔥" : `${r.bakuchouIndex}%`}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-1 line-clamp-2">{r.lead}</p>
              </Link>
            ))}
          </div>
          <div className="mt-4 text-center">
            <Link href="/reports" className="text-sm text-blue-600 hover:underline">記事一覧を見る →</Link>
          </div>
        </section>
      )}

      {/* 注目魚種 */}
      <section>
        <h2 className="text-lg font-bold mb-4">🔥 今週の注目魚種</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {featured.map(f => (
            <Link key={f.name} href={`/fish/${f.id}`}
              className="bg-white rounded-xl border border-slate-200 hover:border-blue-300 hover:shadow-md p-4 transition-all">
              <div className="flex items-start justify-between mb-2">
                <span className="font-bold text-slate-800">{f.name}</span>
                {trendBadge(f.recent_avg, f.prev_avg)}
              </div>
              <div className="text-xs text-slate-500 space-y-1">
                <div>今月平均 <span className="font-bold text-slate-700">{f.this_month_avg}匹/日</span></div>
                <div>爆釣指数 <span className={`font-bold ${f.bakuchou_index >= 80 ? "text-red-600" : "text-slate-600"}`}>{f.bakuchou_index}%</span></div>
                {f.price_range >= 3 && <span className="bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded text-xs">{priceLabel(f.price_range)}</span>}
              </div>
            </Link>
          ))}
        </div>
        <div className="mt-4 text-center">
          <Link href="/fish" className="text-sm text-blue-600 hover:underline">全魚種を見る →</Link>
        </div>
      </section>

      {/* X誘導 */}
      <section className="bg-blue-50 rounded-xl p-6 text-center">
        <p className="text-sm text-slate-600 mb-3">毎日20:00に釣果まとめレポートを投稿中</p>
        <a href="https://x.com/MigakuZ80887" target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-2 bg-black text-white px-5 py-2.5 rounded-full text-sm font-bold hover:bg-slate-800 transition-colors">
          𝕏 @MigakuZ80887 をフォロー
        </a>
      </section>
    </div>
  );
}
