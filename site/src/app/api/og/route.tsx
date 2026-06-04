import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const title = searchParams.get("title") ?? "本牧釣果レポート";
  const topFish = searchParams.get("fish") ?? "";
  const bakuchouRaw = searchParams.get("bakuchou");
  const date = searchParams.get("date") ?? "";

  const bakuchouNum = bakuchouRaw ? parseInt(bakuchouRaw, 10) : null;
  const isHot = bakuchouNum !== null && bakuchouNum >= 120;

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
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px", color: "#7dd3fc", fontSize: "22px" }}>
          <span>🐟 さかなりす</span>
          <span style={{ color: "#4b8fc2", fontSize: "18px" }}>｜ 東京湾釣りデータ</span>
        </div>

        <div style={{
          color: "white",
          fontSize: "46px",
          fontWeight: "bold",
          lineHeight: 1.35,
          flex: 1,
          display: "flex",
          alignItems: "center",
        }}>
          {title}
        </div>

        <div style={{ display: "flex", gap: "14px" }}>
          {bakuchouNum !== null && (
            <div style={{
              background: isHot ? "#dc2626" : "#64748b",
              color: "white",
              padding: "10px 26px",
              borderRadius: "999px",
              fontSize: "22px",
              fontWeight: "bold",
            }}>
              {`爆釣指数 ${bakuchouNum}%`}{isHot ? " 🔥" : ""}
            </div>
          )}
          {topFish && (
            <div style={{
              background: "rgba(255,255,255,0.15)",
              color: "white",
              padding: "10px 26px",
              borderRadius: "999px",
              fontSize: "22px",
            }}>
              {`🎣 ${topFish}`}
            </div>
          )}
          {date && (
            <div style={{
              background: "rgba(255,255,255,0.08)",
              color: "#94a3b8",
              padding: "10px 22px",
              borderRadius: "999px",
              fontSize: "18px",
            }}>
              {date}
            </div>
          )}
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
