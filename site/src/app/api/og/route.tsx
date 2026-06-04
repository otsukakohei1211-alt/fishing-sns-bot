import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

let cachedFont: ArrayBuffer | null = null;

async function loadFont(origin: string): Promise<ArrayBuffer> {
  if (cachedFont) return cachedFont;
  const res = await fetch(`${origin}/fonts/NotoSansJP-Bold.woff2`);
  cachedFont = await res.arrayBuffer();
  return cachedFont;
}

export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;
  const title = searchParams.get("title") ?? "本牧釣果レポート";
  const topFish = searchParams.get("fish") ?? "";
  const bakuchouRaw = searchParams.get("bakuchou");
  const date = searchParams.get("date") ?? "";

  const bakuchouNum = bakuchouRaw ? parseInt(bakuchouRaw, 10) : null;
  const isHot = bakuchouNum !== null && bakuchouNum >= 120;

  let fontData: ArrayBuffer;
  try {
    fontData = await loadFont(origin);
  } catch (e) {
    return new Response(`Font load error: ${e}`, { status: 500 });
  }

  try {
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
          fontFamily: "NotoSansJP, sans-serif",
        }}
      >
        <div style={{ display: "flex", color: "#7dd3fc", fontSize: "22px" }}>
          さかなりす | 東京湾釣りデータ
        </div>

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
              {isHot ? `爆釣指数 ${bakuchouNum}% 好調` : `爆釣指数 ${bakuchouNum}%`}
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
    {
      width: 1200,
      height: 630,
      fonts: [{ name: "NotoSansJP", data: fontData, weight: 700, style: "normal" }],
    },
  );
  } catch (e) {
    return new Response(`ImageResponse error: ${e}`, { status: 500 });
  }
}
