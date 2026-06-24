import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";

type ArticleSection = { heading: string; content: string };
type AffiliateLink = { label: string; url: string };

type ArticleCatch = {
  fishId: number | null;
  name: string;
  count: number;
  minSize: number;
  maxSize: number;
  unit: string;
  places: string[];
};

type DailyArticle = {
  slug: string;
  date: string;
  facility: string;
  title: string;
  lead: string;
  sections: ArticleSection[];
  topCatches: string[];
  waterTemp: string;
  weather: string;
  tide?: string;
  visitors?: number;
  bakuchouIndex?: number;
  catches?: ArticleCatch[];
  affiliateLinks: AffiliateLink[];
  createdAt: string;
};

function readArticle(slug: string): DailyArticle | null {
  const p = join(process.cwd(), `src/data/reports/${slug}.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as DailyArticle;
}

function formatDate(ymd: string) {
  const [y, m, d] = ymd.split("/");
  const days = ["日","月","火","水","木","金","土"];
  const dow = days[new Date(`${y}-${m}-${d}`).getDay()];
  return `${y}年${m}月${d}日（${dow}）`;
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params;
  const article = readArticle(slug);
  if (!article) return {};

  const ogParams = new URLSearchParams({ title: article.title });
  if (article.topCatches[0]) ogParams.set("fish", article.topCatches[0]);
  if (article.bakuchouIndex) ogParams.set("bakuchou", String(article.bakuchouIndex));
  if (article.date) ogParams.set("date", article.date);

  return {
    title: `${article.title} | さかなりす`,
    description: article.lead,
    alternates: { canonical: `/reports/${slug}` },
    openGraph: {
      title: article.title,
      description: article.lead,
      images: [{ url: `/api/og?${ogParams}`, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: article.title,
      description: article.lead,
      images: [`/api/og?${ogParams}`],
    },
  };
}

export default async function ReportPage(
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const article = readArticle(slug);
  if (!article) notFound();

  const isHot = (article.bakuchouIndex ?? 0) >= 120;

  const baseUrl = process.env.SITE_URL ?? "https://sakanalis.vercel.app";
  const isoDate = article.date.replace(/\//g, "-");
  const ogParams = new URLSearchParams({ title: article.title });
  if (article.topCatches[0]) ogParams.set("fish", article.topCatches[0]);
  if (article.bakuchouIndex) ogParams.set("bakuchou", String(article.bakuchouIndex));
  if (article.date) ogParams.set("date", article.date);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: article.title,
    description: article.lead,
    image: [`${baseUrl}/api/og?${ogParams}`],
    datePublished: article.createdAt || isoDate,
    dateModified: article.createdAt || isoDate,
    author: { "@type": "Organization", name: "さかなりす", url: baseUrl },
    publisher: { "@type": "Organization", name: "さかなりす", url: baseUrl },
    mainEntityOfPage: { "@type": "WebPage", "@id": `${baseUrl}/reports/${article.slug}` },
    about: article.topCatches.map((name) => ({ "@type": "Thing", name })),
    keywords: ["本牧海づり施設", "釣果情報", "東京湾", ...article.topCatches].join(", "),
  };

  return (
    <article className="max-w-2xl mx-auto space-y-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* パンくず */}
      <nav className="text-xs text-slate-400 flex gap-1">
        <Link href="/" className="hover:text-blue-500">ホーム</Link>
        <span>/</span>
        <Link href="/reports" className="hover:text-blue-500">釣果レポート</Link>
        <span>/</span>
        <span className="text-slate-600">{article.date}</span>
      </nav>

      {/* メインビジュアル（OGP画像を流用） */}
      {(() => {
        const p = new URLSearchParams({ title: article.title });
        if (article.topCatches[0]) p.set("fish", article.topCatches[0]);
        if (article.bakuchouIndex) p.set("bakuchou", String(article.bakuchouIndex));
        if (article.date) p.set("date", article.date);
        return (
          <img
            src={`/api/og?${p}`}
            alt={article.title}
            width={1200}
            height={630}
            className="w-full rounded-xl"
            style={{ aspectRatio: "1200/630" }}
          />
        );
      })()}

      {/* ヘッダー */}
      <header className="space-y-4">
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="bg-blue-100 text-blue-700 px-2.5 py-1 rounded-full">本牧海づり施設</span>
          {article.bakuchouIndex !== undefined && (
            <span className={`px-2.5 py-1 rounded-full font-bold ${isHot ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"}`}>
              爆釣指数 {article.bakuchouIndex}%{isHot ? " 🔥" : ""}
            </span>
          )}
          <span className="text-slate-400">{formatDate(article.date)}</span>
        </div>
        <h1 className="text-2xl font-bold text-slate-900 leading-snug">{article.title}</h1>
        <p className="text-slate-600 leading-relaxed border-l-4 border-blue-200 pl-4">{article.lead}</p>

        {/* コンディション */}
        <div className="flex flex-wrap gap-3 text-sm text-slate-500 bg-slate-50 rounded-lg px-4 py-3">
          {article.weather && <span>🌤 {article.weather}</span>}
          {article.waterTemp && <span>🌡 水温 {article.waterTemp}℃</span>}
          {article.tide && <span>🌊 {article.tide}</span>}
          {article.visitors != null && article.visitors > 0 && <span>👤 来場 {article.visitors}人</span>}
          {article.topCatches.length > 0 && (
            <span>🎣 {article.topCatches.join("・")}</span>
          )}
        </div>
      </header>

      {/* 釣果データテーブル */}
      {article.catches && article.catches.length > 0 && (() => {
        const catches = article.catches;
        const maxCount = Math.max(...catches.map((c) => c.count));
        const total = catches.reduce((s, c) => s + c.count, 0);
        return (
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-slate-800 border-b border-slate-200 pb-1 flex items-baseline gap-2">
              この日の全釣果
              <span className="text-sm font-normal text-slate-400">
                {catches.length}魚種・計{total.toLocaleString()}匹
              </span>
            </h2>
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-xs">
                    <th className="text-left font-medium px-4 py-2">魚種</th>
                    <th className="text-right font-medium px-2 py-2 w-40 sm:w-56">匹数</th>
                    <th className="text-right font-medium px-3 py-2 whitespace-nowrap">サイズ</th>
                    <th className="text-left font-medium px-3 py-2 hidden sm:table-cell">釣れた場所</th>
                  </tr>
                </thead>
                <tbody>
                  {catches.map((c) => (
                    <tr key={c.name} className="border-t border-slate-100">
                      <td className="px-4 py-2 font-medium whitespace-nowrap">
                        {c.fishId ? (
                          <Link href={`/fish/${c.fishId}`} className="text-blue-700 hover:underline">
                            {c.name}
                          </Link>
                        ) : (
                          c.name
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-2 justify-end">
                          <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden max-w-32">
                            <div
                              className="bg-blue-500 h-full rounded-full"
                              style={{ width: `${Math.max(2, Math.round((c.count / maxCount) * 100))}%` }}
                            />
                          </div>
                          <span className="font-bold text-slate-700 tabular-nums w-14 text-right">
                            {c.count.toLocaleString()}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right text-slate-500 whitespace-nowrap tabular-nums">
                        {c.minSize}〜{c.maxSize}{c.unit}
                      </td>
                      <td className="px-3 py-2 text-slate-500 text-xs hidden sm:table-cell">
                        {c.places.join("・")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })()}

      {/* 本文セクション */}
      <div className="space-y-6">
        {article.sections.map((sec, i) => (
          <section key={i} className="space-y-3">
            <h2 className="text-lg font-bold text-slate-800 border-b border-slate-200 pb-1">
              {sec.heading}
            </h2>
            <div className="text-slate-700 leading-relaxed space-y-2">
              {sec.content.split("\n\n").map((para, j) => (
                <p key={j}>
                  {para.split("\n").map((line, k, arr) => (
                    <span key={k}>
                      {line}
                      {k < arr.length - 1 && <br />}
                    </span>
                  ))}
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* アフィリエイトリンク */}
      {article.affiliateLinks.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-800 border-b border-slate-200 pb-1">
            おすすめ装備・仕掛け
          </h2>
          <div className="space-y-2">
            {article.affiliateLinks.map((link, i) => (
              <a
                key={i}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer sponsored"
                className="flex items-center gap-3 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg px-4 py-3 transition-colors group"
              >
                <span className="text-xl">🛒</span>
                <span className="text-sm font-medium text-amber-900 group-hover:underline flex-1">
                  {link.label}
                </span>
                <span className="text-xs text-amber-600 shrink-0">Amazon →</span>
              </a>
            ))}
          </div>
          <p className="text-xs text-slate-400">
            ※ Amazonアソシエイト・プログラムの参加者として、当サイトは適格販売により収入を得ています。
          </p>
        </section>
      )}

      {/* フッター誘導 */}
      <div className="flex gap-4 text-sm pt-4 border-t border-slate-200">
        <Link href="/reports" className="text-blue-600 hover:underline">← 記事一覧</Link>
        <Link href="/" className="text-blue-600 hover:underline">ホームへ →</Link>
      </div>
    </article>
  );
}
