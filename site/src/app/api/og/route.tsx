import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";

export const runtime = "edge";

async function loadFont(): Promise<ArrayBuffer | null> {
  try {
    // Google Fonts CSS から woff2 URL を取得
    const css = await fetch(
      "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@700&display=swap",
      { headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" } },
    ).then((r) => r.text());
    const match = css.match(/src: url\(([^)]+)\) format\('woff2'\)/);
    if (!match) return null;
    return await fetch(match[1]).then((r) => r.arrayBuffer());
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const title = searchParams.get("title") ?? "本牧釣果レポート";
  const topFish = searchParams.get("fish") ?? "";
  const bakuchouRaw = searchParams.get("bakuchou");
  const date = searchParams.get("date") ?? "";

  const bakuchouNum = bakuchouRaw ? parseInt(bakuchouRaw, 10) : null;
  const isHot = bakuchouNum !== null && bakuchouNum >= 120;

  const fontData = await loadFont();
  const fonts = fontData
    ? [{ name: "NotoSansJP", data: fontData, weight: 700 as const, style: "normal" as const }]
    : [];

  return new ImageResponse(
    (
      <div
        style={{
          background: "linear-gradient(135deg, #0c2a4a 0%, #1a4068 60%, #0f3460 100%)",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "60px 72px",
          fontFamily: fonts.length > 0 ? "NotoSansJP, sans-serif" : "sans-serif",
        }}
      >
        {/* ヘッダー */}
        <div style={{ display: "flex", color: "#7dd3fc", fontSize: "22px" }}>
          さかなりす | 東京湾釣りデータ
        </div>

        {/* タイトル */}
        <div
          style={{
            color: "white",
            fontSize: "44px",
            fontWeight: "bold",
            lineHeight: 1.4,
            flex: 1,
            display: "flex",
            alignItems: "center",
          }}
        >
          {title}
        </div>

        {/* バッジ行 */}
        <div style={{ display: "flex", gap: "14px" }}>
          {bakuchouNum !== null ? (
            <div
              style={{
                background: isHot ? "#dc2626" : "#64748b",
                color: "white",
                padding: "10px 26px",
                borderRadius: "999px",
                fontSize: "22px",
                fontWeight: "bold",
              }}
            >
              {isHot
                ? `爆釣指数 ${bakuchouNum}% 好調`
                : `爆釣指数 ${bakuchouNum}%`}
            </div>
          ) : null}
          {topFish ? (
            <div
              style={{
                background: "rgba(255,255,255,0.15)",
                color: "white",
                padding: "10px 26px",
                borderRadius: "999px",
                fontSize: "22px",
              }}
            >
              {topFish}
            </div>
          ) : null}
          {date ? (
            <div
              style={{
                background: "rgba(255,255,255,0.08)",
                color: "#94a3b8",
                padding: "10px 22px",
                borderRadius: "999px",
                fontSize: "18px",
              }}
            >
              {date}
            </div>
          ) : null}
        </div>
      </div>
    ),
    { width: 1200, height: 630, fonts },
  );
}
