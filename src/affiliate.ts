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

/**
 * 釣果魚種に依存しない、堤防・海づり施設の定番ギア（リスト穴埋め用）。
 * asin を入れると個別商品リンク（高CV）、未指定なら keyword の検索リンクに
 * 自動フォールバックする。ASIN は1件ずつ実機確認してから埋めること。
 */
type GearItem = { label: string; keyword: string; asin?: string };
const GENERAL_GEAR: GearItem[] = [
  // 本牧の主役はアジ・コノシロのサビキ釣り。定番セットを先頭に置く
  { label: "サビキ仕掛けセット", keyword: "サビキ仕掛けセット 海釣り", asin: "B0D9B2YPKX" },
  { label: "釣り用クーラーボックス", keyword: "釣り クーラーボックス", asin: "B09RQJF9WP" },
  { label: "自動膨張式ライフジャケット", keyword: "ライフジャケット 釣り 自動膨張", asin: "B07YWD7YDG" },
  { label: "万能の堤防釣りロッド＆リールセット", keyword: "堤防 釣り竿 リール セット", asin: "B089FDPFZ4" },
  { label: "タモ網・玉の柄", keyword: "釣り タモ網 玉の柄" },
  { label: "フィッシュグリップ", keyword: "フィッシュグリップ" },
  { label: "偏光サングラス", keyword: "偏光サングラス 釣り" },
  { label: "水汲みバケツ", keyword: "釣り 水汲みバケツ" },
  { label: "フィッシングプライヤー・ハサミ", keyword: "釣り プライヤー ハサミ" },
  { label: "仕掛け収納ケース", keyword: "釣り 仕掛け ケース" },
  { label: "釣り用グローブ", keyword: "釣り グローブ" },
  { label: "LEDヘッドライト", keyword: "釣り ヘッドライト", asin: "B07Y21GMKQ" },
  { label: "撒き餌・コマセセット", keyword: "アミエビ コマセ 釣り" },
];

function getKeyword(fishName: string): string {
  for (const [pattern, keyword] of FISH_KEYWORD_MAP) {
    if (pattern.test(fishName)) return keyword;
  }
  return DEFAULT_KEYWORD;
}

function buildAmazonUrl(keyword: string): string {
  return `https://www.amazon.co.jp/s?k=${encodeURIComponent(keyword)}&tag=${TRACKING_ID}`;
}

/** 個別商品（ASIN）への直リンク。検索リンクより CV が高い。 */
function buildAmazonProductUrl(asin: string): string {
  return `https://www.amazon.co.jp/dp/${asin}?tag=${TRACKING_ID}`;
}

/** 魚種名リストを検索キーワード単位に重複除外して返す（順序維持） */
function dedupeSpecies(fishNames: string[]): Array<{ name: string; keyword: string }> {
  const seen = new Set<string>();
  const out: Array<{ name: string; keyword: string }> = [];
  for (const name of fishNames) {
    const keyword = getKeyword(name);
    if (seen.has(keyword)) continue;
    seen.add(keyword);
    out.push({ name, keyword });
  }
  return out;
}

/**
 * 魚種名リストからアフィリエイトリンクを生成する。
 * まず当日の釣果魚種に対応した仕掛け・タックルを並べ、
 * 不足分は堤防釣りの定番ギアで count 件まで補う。
 */
export function getAffiliateLinks(fishNames: string[], count = 10): AffiliateLink[] {
  const links: AffiliateLink[] = [];
  const usedKeywords = new Set<string>();

  // 1) 当日の釣果魚種に対応した仕掛け・タックル
  for (const { name, keyword } of dedupeSpecies(fishNames)) {
    if (links.length >= count) break;
    usedKeywords.add(keyword);
    links.push({
      label: `${name}釣りの仕掛け・タックルをAmazonで見る`,
      url: buildAmazonUrl(keyword),
    });
  }

  // 2) 不足分は堤防・海づり施設の定番ギアで補う
  //    asin があれば商品リンク、無ければ keyword の検索リンクにフォールバック
  for (const { label, keyword, asin } of GENERAL_GEAR) {
    if (links.length >= count) break;
    if (usedKeywords.has(keyword)) continue;
    usedKeywords.add(keyword);
    links.push({
      label: `${label}をAmazonで見る`,
      url: asin ? buildAmazonProductUrl(asin) : buildAmazonUrl(keyword),
    });
  }

  return links;
}

/**
 * X 投稿のリプライにぶら下げるアフィリエイト文を生成する。
 * 当日の上位魚種に合わせたタックルを max 件。釣果が少なければ定番ギアで補う。
 * ステマ規制対応として末尾に #PR を付ける。
 */
export function formatAffiliateReply(fishNames: string[], max = 2): string | null {
  const picks = getAffiliateLinks(fishNames, max);
  if (picks.length === 0) return null;

  const body = picks
    .map((l) => `▼ ${l.label.replace(/をAmazonで見る$/, "")}\n${l.url}`)
    .join("\n\n");

  return `🎣 今日の釣果に合わせたおすすめタックル\n\n${body}\n\n※ Amazonアソシエイトのリンクを含みます #PR`;
}
