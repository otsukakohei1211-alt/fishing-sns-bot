import { readFileSync } from "fs";
import { join } from "path";
import Link from "next/link";

type RankingItem = {
  id: number; name: string; price_range: number;
  avg_catch: number; avg_per_person: number; avg_size: number;
  active_days: number; total_days: number;
};

function readData<T>(path: string): T {
  return JSON.parse(readFileSync(join(process.cwd(), "src/data", path), "utf8")) as T;
}

const priceLabel = (n: number) => ["", "安価", "普通", "高級", "超高級"][n] ?? "";

export default function Ranking() {
  const ym = new Date().toISOString().slice(0, 7);
  const data = readData<{ year_month: string; ranking: RankingItem[] }>(`ranking/${ym}.json`);
  const month = parseInt(ym.slice(5, 7));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-blue-800 mb-1">{month}月の釣果ランキング</h1>
        <p className="text-sm text-slate-500">本牧海づり施設・1人あたり平均釣果順</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs">
            <tr>
              <th className="text-left px-4 py-3">順位</th>
              <th className="text-left px-4 py-3">魚種</th>
              <th className="text-right px-4 py-3">1人あたり</th>
              <th className="text-right px-4 py-3">日平均</th>
              <th className="text-right px-4 py-3">平均サイズ</th>
              <th className="text-right px-4 py-3">出現率</th>
            </tr>
          </thead>
          <tbody>
            {data.ranking.map((r, i) => (
              <tr key={r.name} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3">
                  <span className={`font-bold ${i === 0 ? "text-yellow-500" : i === 1 ? "text-slate-400" : i === 2 ? "text-amber-600" : "text-slate-400"}`}>
                    {i < 3 ? ["🥇","🥈","🥉"][i] : i + 1}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/fish/${r.id}`} className="font-bold hover:text-blue-600">
                    {r.name}
                  </Link>
                  {r.price_range >= 3 && (
                    <span className="ml-2 text-xs bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded">{priceLabel(r.price_range)}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-bold text-blue-700">{r.avg_per_person ?? "-"}匹</td>
                <td className="px-4 py-3 text-right text-slate-600">{r.avg_catch ?? "-"}匹</td>
                <td className="px-4 py-3 text-right text-slate-500">{r.avg_size ? `${r.avg_size}cm` : "-"}</td>
                <td className="px-4 py-3 text-right text-slate-500">
                  {Math.round(r.active_days / r.total_days * 100)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
