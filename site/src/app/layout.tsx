import type { Metadata } from "next";
import { Noto_Sans_JP } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const noto = Noto_Sans_JP({ subsets: ["latin"], weight: ["400", "500", "700"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? "https://sakanalis.vercel.app"),
  title: "さかなりす | 東京湾釣り データ分析",
  description: "東京湾（神奈川エリア）の釣果データを分析。本牧・大黒・磯子海づり施設の釣果予測・魚種図鑑・季節情報をお届け。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className={`${noto.className} bg-slate-50 text-slate-800`}>
        <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
          <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
            <a href="/" className="flex items-center gap-2 font-bold text-lg text-blue-700">
              🐟 さかなりす
              <span className="text-xs font-normal text-slate-500">東京湾釣りデータ</span>
            </a>
            <nav className="flex gap-6 text-sm">
              <a href="/" className="hover:text-blue-600">ホーム</a>
              <a href="/reports" className="hover:text-blue-600">記事</a>
              <a href="/fish" className="hover:text-blue-600">魚種図鑑</a>
              <a href="/ranking" className="hover:text-blue-600">ランキング</a>
            </nav>
          </div>
        </header>
        <main className="max-w-5xl mx-auto px-4 py-8">{children}</main>
        <footer className="text-center text-xs text-slate-400 py-8 border-t border-slate-200 mt-12">
          データ出典: 横浜フィッシングピアーズ（本牧・大黒・磯子） ／ 統計分析: さかなりす
        </footer>
        <Analytics />
      </body>
    </html>
  );
}
