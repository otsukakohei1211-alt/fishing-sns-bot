import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/og": [
      "./node_modules/@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-700-normal.woff2",
      "./node_modules/@fontsource/noto-sans-jp/files/noto-sans-jp-latin-700-normal.woff2",
    ],
  },
};

export default nextConfig;
