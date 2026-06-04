import { readFileSync } from "fs";
import { join } from "path";
import Link from "next/link";

type FishSummary = {
  id: number; name: string; name_kana: string; category: string;
  price_range: number; difficulty: number; danger_level: number;
  this_month_avg: number; bakuchou_index: number; appearance_pct: number;
  recent_avg: number; prev_avg: number;
};

function readData<T>(path: string): T {
  return JSON.parse(readFileSync(join(process.cwd(), "src/data", path), "utf8")) as T;
}

const CATEGORY_ORDER = ["魚", "甲殻類", "イカタコ", "貝類", "その他"];
const difficultyLabel = (n: number) => ["", "★☆☆☆☆", "★★☆☆☆", "★★★☆☆", "★★★★☆", "★★★★★"][n] ?? "";
const priceLabel = (n: number) => ["", "¥", "¥¥", "¥¥¥", "¥¥¥¥"][n] ?? "";

export default function FishIndex() {
  const fishList = readData<FishSummary[]>("fish/index.json");

  const byCategory = CATEGORY_ORDER.reduce((acc, cat) => {
    acc[cat] = fishList.filter(f => (f.category || "その他") === cat);
    return acc;
  }, {} as Record<string, FishSummary[]>);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-bold text-blue-800 mb-1">魚種図鑑</h1>
        <p className="text-sm text-slate-500">東京湾（本牧）で釣れる{fishList.length}種のデータ</p>
      </div>

      {CATEGORY_ORDER.map(cat => {
        const fish = byCategory[cat];
        if (!fish?.length) return null;
        return (
          <section key={cat}>
            <h2 className="text-base font-bold text-slate-600 mb-3 border-b border-slate-200 pb-2">{cat}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {fish.map(f => (
                <Link key={f.name} href={`/fish/${f.id}`}
                  className="bg-white border border-slate-200 hover:border-blue-300 hover:shadow-sm rounded-xl p-4 transition-all">
                  <div className="font-bold text-slate-800 mb-1">{f.name}</div>
                  <div className="text-xs text-slate-400 mb-2">{f.name_kana}</div>
                  <div className="flex flex-wrap gap-1">
                    {f.bakuchou_index >= 70 && (
                      <span className="bg-red-50 text-red-600 text-xs px-1.5 py-0.5 rounded">爆釣{f.bakuchou_index}%</span>
                    )}
                    {f.price_range >= 3 && (
                      <span className="bg-amber-50 text-amber-600 text-xs px-1.5 py-0.5 rounded">{priceLabel(f.price_range)}</span>
                    )}
                    {f.danger_level >= 1 && (
                      <span className="bg-orange-50 text-orange-600 text-xs px-1.5 py-0.5 rounded">⚠</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 mt-2">{difficultyLabel(f.difficulty)}</div>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
