import { readFileSync, existsSync } from "fs";
import { join } from "path";
import Link from "next/link";

type IndexEntry = {
  slug: string;
  date: string;
  title: string;
  lead: string;
  topCatches: string[];
  bakuchouIndex?: number;
};

function readIndex(): IndexEntry[] {
  const p = join(process.cwd(), "src/data/reports/index.json");
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, "utf8")) as IndexEntry[];
}

function bakuchouBadge(index?: number) {
  if (!index) return null;
  if (index >= 150) return { label: "大爆釣🔥", cls: "bg-red-600 text-white" };
  if (index >= 120) return { label: `好調 ${index}%`, cls: "bg-orange-500 text-white" };
  if (index >= 80)  return { label: `${index}%`, cls: "bg-blue-100 text-blue-700" };
  return { label: `${index}%`, cls: "bg-slate-100 text-slate-500" };
}

function formatDate(ymd: string) {
  const [y, m, d] = ymd.split("/");
  const days = ["日","月","火","水","木","金","土"];
  const dow = days[new Date(`${y}-${m}-${d}`).getDay()];
  return `${y}年${m}月${d}日（${dow}）`;
}

export default function ReportsPage() {
  const entries = readIndex();

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-bold text-blue-900 mb-1">釣果レポート</h1>
        <p className="text-sm text-slate-500">本牧海づり施設の毎日の釣果をデータ解説付きでお届け</p>
      </section>

      {entries.length === 0 ? (
        <p className="text-slate-400 text-sm">まだ記事がありません。</p>
      ) : (
        <div className="grid gap-4">
          {entries.map((e) => {
            const badge = bakuchouBadge(e.bakuchouIndex);
            return (
              <Link
                key={e.slug}
                href={`/reports/${e.slug}`}
                className="bg-white rounded-xl border border-slate-200 hover:border-blue-300 hover:shadow-md p-5 transition-all block"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <h2 className="font-bold text-slate-800 text-base leading-snug flex-1">
                    {e.title}
                  </h2>
                  {badge && (
                    <span className={`text-xs px-2.5 py-1 rounded-full font-bold shrink-0 ${badge.cls}`}>
                      {badge.label}
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-500 mb-3 line-clamp-2">{e.lead}</p>
                <div className="flex items-center gap-3 text-xs text-slate-400">
                  <span>{formatDate(e.date)}</span>
                  {e.topCatches.length > 0 && (
                    <span className="flex gap-1">
                      {e.topCatches.map((f) => (
                        <span key={f} className="bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">
                          {f}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
