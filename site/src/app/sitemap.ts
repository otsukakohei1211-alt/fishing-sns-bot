import type { MetadataRoute } from "next";
import { readFileSync } from "fs";
import { join } from "path";
import { fishIndex } from "@/data/fish-bundle";

const BASE_URL = process.env.SITE_URL ?? "https://sakanalis.vercel.app";

type IndexEntry = { slug: string; date: string };

function readReports(): IndexEntry[] {
  const p = join(process.cwd(), "src/data/reports/index.json");
  return JSON.parse(readFileSync(p, "utf8")) as IndexEntry[];
}

/** "2026/06/23" → Date */
function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("/").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export default function sitemap(): MetadataRoute.Sitemap {
  const reports = readReports();
  const latest = reports[0] ? parseYmd(reports[0].date) : new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${BASE_URL}/`, lastModified: latest, changeFrequency: "daily", priority: 1 },
    { url: `${BASE_URL}/reports`, lastModified: latest, changeFrequency: "daily", priority: 0.9 },
    { url: `${BASE_URL}/ranking`, lastModified: latest, changeFrequency: "weekly", priority: 0.7 },
    { url: `${BASE_URL}/fish`, lastModified: latest, changeFrequency: "weekly", priority: 0.7 },
  ];

  const reportRoutes: MetadataRoute.Sitemap = reports.map((r) => ({
    url: `${BASE_URL}/reports/${r.slug}`,
    lastModified: parseYmd(r.date),
    changeFrequency: "monthly",
    priority: 0.8,
  }));

  const fishRoutes: MetadataRoute.Sitemap = fishIndex.map((f) => ({
    url: `${BASE_URL}/fish/${f.id}`,
    lastModified: latest,
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  return [...staticRoutes, ...reportRoutes, ...fishRoutes];
}
