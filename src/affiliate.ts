/**
 * affiliate.ts — Amazon アソシエイトリンク生成ヘルパー
 *
 * トラッキングID: 11221121-22
 */

export type AffiliateLink = {
  label: string;
  url: string;
};

const TRACKING_ID = "11221121-22";

/** 魚種名 → Amazon 検索キーワードのマッピング */
const FISH_KEYWORD_MAP: Array<[RegExp, string]> = [
  [/ハゼ/, "ハゼ 釣り仕掛け"],
  [/クロダイ|チヌ/, "クロダイ フカセ釣り 仕掛け"],
  [/メジナ|グレ/, "メジナ フカセ釣り 仕掛け"],
  [/カサゴ|ガシラ/, "カサゴ 胴突き仕掛け"],
  [/アジ/, "アジ サビキ仕掛け"],
  [/イワシ|コノシロ|サッパ/, "サビキ仕掛け セット"],
  [/シロギス|キス/, "シロギス 投げ釣り 仕掛け"],
  [/カレイ/, "カレイ 投げ釣り 仕掛け"],
  [/スズキ|セイゴ|フッコ/, "シーバス ルアー セット"],
  [/メバル/, "メバル 仕掛け"],
  [/カワハギ/, "カワハギ 仕掛け"],
  [/タコ/, "タコ タコエギ"],
];

const DEFAULT_KEYWORD = "釣り 仕掛けセット 初心者";

function getKeyword(fishName: string): string {
  for (const [pattern, keyword] of FISH_KEYWORD_MAP) {
    if (pattern.test(fishName)) return keyword;
  }
  return DEFAULT_KEYWORD;
}

function buildAmazonUrl(keyword: string): string {
  return `https://www.amazon.co.jp/s?k=${encodeURIComponent(keyword)}&tag=${TRACKING_ID}`;
}

/**
 * 魚種名リストからアフィリエイトリンクを生成する。
 * 上位3魚種まで、重複除外。
 */
export function getAffiliateLinks(fishNames: string[]): AffiliateLink[] {
  const seen = new Set<string>();
  const links: AffiliateLink[] = [];

  for (const name of fishNames) {
    if (links.length >= 3) break;
    const keyword = getKeyword(name);
    if (seen.has(keyword)) continue;
    seen.add(keyword);
    links.push({
      label: `${name}釣りの仕掛け・タックルをAmazonで見る`,
      url: buildAmazonUrl(keyword),
    });
  }

  return links;
}
