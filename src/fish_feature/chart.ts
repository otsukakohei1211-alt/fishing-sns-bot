/**
 * chart.ts — 魚種特集用グラフ画像を生成する
 *
 * レイアウト:
 * - 棒グラフ（青）: 日別釣果数
 * - 折れ線（赤）: 水温推移
 * - 🐟絵文字 + cmラベル: サイズに比例した大きさで棒の上に表示
 */

import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import type { ChartConfiguration, Plugin } from "chart.js";

const WIDTH = 900;
const HEIGHT = 520;

export type ChartDataPoint = {
  date: string;
  count: number;
  waterTemp: number | null;
  visitors: number;
  avgSize?: number | null;
  sizeReference?: number | null;
};

export async function generateFishChart(
  fishName: string,
  facility: string,
  data: ChartDataPoint[],
  outputPath: string,
  fesScore?: number,
  fesGrade?: string,
): Promise<void> {
  const labels = data.map((d) => d.date.slice(5));
  const counts = data.map((d) => d.count);
  const temps = data.map((d) => d.waterTemp ?? null);
  const sizeRef = data.find((d) => d.sizeReference)?.sizeReference ?? null;

  // 魚シルエット描画（中心 cx,cy、全長 size）
  function drawFish(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    size: number,
    fillColor: string,
  ) {
    const w = size * 1.7;
    const h = size * 0.75;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(-1, 1); // 左向きに反転
    ctx.fillStyle = fillColor;
    ctx.strokeStyle = fillColor.replace(/[\d.]+\)$/, "1)");
    ctx.lineWidth = 1;

    // 胴体（ベジェ曲線）
    ctx.beginPath();
    ctx.moveTo(-w / 2, 0);
    ctx.bezierCurveTo(-w / 2, -h / 2, w * 0.25, -h / 2, w / 2, 0);
    ctx.bezierCurveTo(w * 0.25, h / 2, -w / 2, h / 2, -w / 2, 0);
    ctx.fill();

    // 尾びれ
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 2, 0);
    ctx.lineTo(-w / 2 - h * 0.65, -h * 0.55);
    ctx.lineTo(-w / 2 - h * 0.15, 0);
    ctx.lineTo(-w / 2 - h * 0.65, h * 0.55);
    ctx.closePath();
    ctx.fill();

    // 目（白）
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.arc(w * 0.22, -h * 0.12, h * 0.14, 0, Math.PI * 2);
    ctx.fill();

    // 目（黒）
    ctx.fillStyle = "rgba(20,20,20,0.85)";
    ctx.beginPath();
    ctx.arc(w * 0.22, -h * 0.12, h * 0.07, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // 魚マーカープラグイン（インライン）
  const fishMarkerPlugin: Plugin<"bar"> = {
    id: "fishMarkers",
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx as unknown as CanvasRenderingContext2D;
      const meta = chart.getDatasetMeta(0);

      data.forEach((point, i) => {
        if (!point.count || !point.avgSize) return;
        const bar = meta.data[i] as unknown as { x: number; y: number };
        if (!bar) return;

        const { x, y } = bar;
        const ratio = sizeRef && sizeRef > 0 ? point.avgSize / sizeRef : 1.0;

        // サイズ比率で魚の大きさを変える（min 10 〜 max 30）
        const fishSize = Math.max(10, Math.min(30, Math.round(16 * Math.pow(ratio, 0.9))));
        const cmText = `${Math.round(point.avgSize)}cm`;

        // 色: 良型→濃青、普通→中青、小型→薄青
        const fillColor = ratio > 1.15
          ? "rgba(30, 100, 200, 0.85)"
          : ratio < 0.85
          ? "rgba(130, 185, 240, 0.75)"
          : "rgba(70, 140, 220, 0.8)";

        // 魚シルエット（棒の上）
        const fishCy = y - fishSize * 0.5 - 3;
        drawFish(ctx, x, fishCy, fishSize, fillColor);

        // cmラベル（魚の上）
        const labelSize = Math.max(8, fishSize - 7);
        ctx.save();
        ctx.font = `bold ${labelSize}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";

        const metrics = ctx.measureText(cmText);
        const lw = metrics.width + 5;
        const lh = labelSize + 2;
        const labelY = fishCy - fishSize * 0.45;

        ctx.fillStyle = "rgba(240, 248, 255, 0.88)";
        ctx.beginPath();
        (ctx as unknown as { roundRect: (x: number, y: number, w: number, h: number, r: number) => void })
          .roundRect(x - lw / 2, labelY - lh, lw, lh, 3);
        ctx.fill();

        ctx.fillStyle = "#1a3a6e";
        ctx.fillText(cmText, x, labelY);
        ctx.restore();
      });
    },
  };

  const renderer = new ChartJSNodeCanvas({
    width: WIDTH,
    height: HEIGHT,
    backgroundColour: "#ffffff",
  });

  const config: ChartConfiguration<"bar"> = {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "釣果数（匹）",
          data: counts,
          backgroundColor: "rgba(100, 160, 220, 0.55)",
          borderColor: "rgba(60, 120, 190, 0.8)",
          borderWidth: 1,
          yAxisID: "y",
        },
        {
          // @ts-expect-error mixed type
          type: "line",
          label: "水温（℃）",
          data: temps,
          borderColor: "rgba(210, 60, 50, 0.9)",
          backgroundColor: "rgba(210, 60, 50, 0.08)",
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: "rgba(210, 60, 50, 0.9)",
          fill: false,
          yAxisID: "y2",
          tension: 0.3,
          spanGaps: true,
        },
      ],
    },
    // @ts-expect-error inline plugin
    plugins: [fishMarkerPlugin],
    options: {
      responsive: false,
      animation: false,
      layout: { padding: { top: 30, right: 20, bottom: 10, left: 10 } },
      plugins: {
        title: {
          display: true,
          text: fesScore !== undefined
            ? `${fishName}（${facilityLabel(facility)}）直近4週間  |  FES: ${fesScore}/100 (${fesGrade})`
            : `${fishName}（${facilityLabel(facility)}）直近4週間の釣果推移`,
          font: { size: 15, weight: "bold" },
          color: "#222",
          padding: { bottom: 12 },
        },
        legend: {
          position: "top",
          labels: { font: { size: 11 }, color: "#444", usePointStyle: true, padding: 16 },
        },
      },
      scales: {
        x: {
          ticks: { font: { size: 10 }, color: "#555", maxRotation: 45 },
          grid: { color: "rgba(0,0,0,0.05)" },
        },
        y: {
          position: "left",
          beginAtZero: true,
          title: {
            display: true,
            text: "釣果数（匹）",
            font: { size: 11 },
            color: "#3c78be",
          },
          ticks: { color: "#3c78be", font: { size: 11 } },
          grid: { color: "rgba(0,0,0,0.06)" },
        },
        y2: {
          position: "right",
          title: {
            display: true,
            text: "水温（℃）",
            font: { size: 11 },
            color: "#d23c32",
          },
          ticks: { color: "#d23c32", font: { size: 11 } },
          grid: { drawOnChartArea: false },
        },
      },
    },
  };

  const buffer = await renderer.renderToBuffer(config);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(outputPath, buffer);
}

function facilityLabel(facility: string): string {
  const map: Record<string, string> = { honmoku: "本牧", daikoku: "大黒", isogo: "磯子" };
  return map[facility] ?? facility;
}

// ── 月別平均チャート ────────────────────────────────────────────────────────────

export type MonthlyDataPoint = {
  month: number;
  avg_catch: number | null;     // 釣れた日だけの平均釣果数
  avg_per_person: number | null;
  avg_max_size?: number | null;
  appearance_pct?: number;      // 出現率（%）
};

const MONTH_LABELS = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];

export async function generateMonthlyChart(
  fishName: string,
  facility: string,
  monthlyData: MonthlyDataPoint[],
  outputPath: string,
): Promise<void> {
  // 1〜12月を必ず並べる（データなし月は0）
  const filled = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const d = monthlyData.find((r) => r.month === m);
    return {
      avg_catch: d?.avg_catch ?? 0,
      avg_per_person: d?.avg_per_person ?? 0,
      avg_max_size: d?.avg_max_size ?? null,
      appearance_pct: d?.appearance_pct ?? 0,
    };
  });

  const catches = filled.map((d) => d.avg_catch != null ? Math.round(d.avg_catch * 10) / 10 : 0);
  const perPerson = filled.map((d) => d.avg_per_person != null ? Math.round(d.avg_per_person * 100) / 100 : 0);
  const sizes = filled.map((d) => d.avg_max_size);
  const appearances = filled.map((d) => d.appearance_pct ?? 0);

  const barColors = filled.map((d) =>
    d.avg_catch != null && d.avg_catch > 0
      ? "rgba(100, 160, 220, 0.55)"
      : "rgba(200, 210, 220, 0.25)",
  );

  // 魚シルエット描画（月別チャート用、小サイズ固定）
  function drawFishSmall(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    size: number,
    fillColor: string,
  ) {
    const w = size * 1.7;
    const h = size * 0.75;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(-1, 1);
    ctx.fillStyle = fillColor;
    ctx.beginPath();
    ctx.moveTo(-w / 2, 0);
    ctx.bezierCurveTo(-w / 2, -h / 2, w * 0.25, -h / 2, w / 2, 0);
    ctx.bezierCurveTo(w * 0.25, h / 2, -w / 2, h / 2, -w / 2, 0);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 2, 0);
    ctx.lineTo(-w / 2 - h * 0.65, -h * 0.55);
    ctx.lineTo(-w / 2 - h * 0.15, 0);
    ctx.lineTo(-w / 2 - h * 0.65, h * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.arc(w * 0.22, -h * 0.12, h * 0.14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(20,20,20,0.85)";
    ctx.beginPath();
    ctx.arc(w * 0.22, -h * 0.12, h * 0.07, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 月別サイズマーカープラグイン
  const monthlyFishPlugin: Plugin<"bar"> = {
    id: "monthlyFishMarkers",
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx as unknown as CanvasRenderingContext2D;
      const meta = chart.getDatasetMeta(0);

      filled.forEach((point, i) => {
        if (!catches[i] || !sizes[i]) return;
        const bar = meta.data[i] as unknown as { x: number; y: number };
        if (!bar) return;

        // （出現率はX軸ラベルで表示）

        const fishSize = 14;
        const fillColor = "rgba(60, 130, 200, 0.8)";

        drawFishSmall(ctx, bar.x, bar.y - fishSize * 0.5 - 2, fishSize, fillColor);

        // サイズ + 出現率ラベル
        const pct = appearances[i];
        const label = sizes[i]
          ? pct > 0 ? `${Math.round(sizes[i]!)}cm・出現${pct}%` : `${Math.round(sizes[i]!)}cm`
          : pct > 0 ? `出現${pct}%` : "";
        if (label) {
          ctx.save();
          ctx.font = "bold 8px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          const lw = ctx.measureText(label).width + 6;
          const labelY = bar.y - fishSize - 4;
          ctx.fillStyle = "rgba(240,248,255,0.9)";
          ctx.beginPath();
          (ctx as unknown as { roundRect: (x: number, y: number, w: number, h: number, r: number) => void })
            .roundRect(bar.x - lw / 2, labelY - 11, lw, 11, 2);
          ctx.fill();
          ctx.fillStyle = "#1a3a6e";
          ctx.fillText(label, bar.x, labelY);
          ctx.restore();
        }
      });
    },
  };

  const renderer2 = new ChartJSNodeCanvas({
    width: WIDTH,
    height: 430,
    backgroundColour: "#ffffff",
  });

  const config: ChartConfiguration<"bar"> = {
    type: "bar",
    data: {
      labels: MONTH_LABELS,
      datasets: [
        {
          label: "日平均釣果数（匹）",
          data: catches,
          backgroundColor: barColors,
          borderColor: barColors.map((c) => c.replace("0.55", "0.9").replace("0.85", "1").replace("0.3", "0.5")),
          borderWidth: 1,
          yAxisID: "y",
        },
        {
          // @ts-expect-error mixed type
          type: "line",
          label: "1人あたり平均（匹）",
          data: perPerson,
          borderColor: "rgba(80, 180, 100, 0.9)",
          backgroundColor: "rgba(80, 180, 100, 0.08)",
          borderWidth: 2,
          pointRadius: 4,
          pointBackgroundColor: "rgba(80, 180, 100, 0.9)",
          fill: false,
          yAxisID: "y2",
          tension: 0.3,
          spanGaps: true,
        },
      ],
    },
    // @ts-expect-error inline plugin
    plugins: [monthlyFishPlugin],
    options: {
      responsive: false,
      animation: false,
      layout: { padding: { top: 30, right: 20, bottom: 20, left: 10 } },
      plugins: {
        title: {
          display: true,
          text: `${fishName}（${facilityLabel(facility)}）月別平均釣果`,
          font: { size: 14, weight: "bold" },
          color: "#222",
          padding: { bottom: 12 },
        },
        legend: {
          position: "top",
          labels: { font: { size: 11 }, color: "#444", usePointStyle: true, padding: 16 },
        },
      },
      scales: {
        x: {
          ticks: {
            font: { size: 10 },
            color: "#444",
            font: { size: 11 }, color: "#444",
          },
          grid: { color: "rgba(0,0,0,0.05)" },
        },
        y: {
          position: "left",
          beginAtZero: true,
          title: { display: true, text: "日平均釣果（匹）", font: { size: 11 }, color: "#3c78be" },
          ticks: { color: "#3c78be", font: { size: 11 } },
          grid: { color: "rgba(0,0,0,0.06)" },
        },
        y2: {
          position: "right",
          beginAtZero: true,
          title: { display: true, text: "1人あたり（匹）", font: { size: 11 }, color: "#3ab464" },
          ticks: { color: "#3ab464", font: { size: 11 } },
          grid: { drawOnChartArea: false },
        },
      },
    },
  };

  const buffer = await renderer2.renderToBuffer(config);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(outputPath, buffer);
}
