import { Resend } from "resend";
import type { DailyReport } from "./types.js";

export async function sendPostNotification(opts: {
  post: string;
  weight: number;
  reports: DailyReport[];
  postFile: string;
  /** X に実際に投稿できたか。false の場合は「未投稿」として通知する。 */
  posted: boolean;
  /** posted=false のときの理由（例: "X weight 283 > 280"）。 */
  skipReason?: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.NOTIFY_EMAIL;
  const from = process.env.NOTIFY_FROM ?? "Fishing Bot <onboarding@resend.dev>";

  if (!apiKey) throw new Error("RESEND_API_KEY is not set in .env");
  if (!to) throw new Error("NOTIFY_EMAIL is not set in .env");

  const resend = new Resend(apiKey);

  const sourceLines = opts.reports
    .map((r) => {
      const catches = r.catches
        .map(
          (c) =>
            `  ・${c.name}: ${c.count}匹  ${c.minSize}〜${c.maxSize}${c.unit}  (${c.places.join("・")})`,
        )
        .join("\n");
      return `■ ${r.date}  ${r.weather}  水温${r.waterTemp}℃  ${r.tide}  来場者${r.visitors}名\n${catches}`;
    })
    .join("\n\n");

  const today = new Date().toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" });

  const header = opts.posted
    ? "本牧海づり施設の釣果まとめを X に投稿しました ✅"
    : `⚠️ X には未投稿です（${opts.skipReason ?? "理由不明"}）。
ブログ記事は公開済みです。手動で投稿するには次を実行してください:
  npm run x:draft
（最新の投稿文がポスト画面に入るので、内容を整えて「ポストする」を押してください）`;

  const sourceLabel = opts.posted
    ? "【データソース（リプライに投稿済み）】"
    : "【データソース】";

  const text = `${header}

【投稿文】(X weight ${opts.weight}/280)
--------------------------------------------------
${opts.post}
--------------------------------------------------

${sourceLabel}
${sourceLines}

保存先: ${opts.postFile}
`;

  const subject = opts.posted
    ? `🎣 本牧釣果まとめ X投稿完了 (${today})`
    : `⚠️ 本牧釣果まとめ X未投稿 — 要手動対応 (${today})`;

  const { error } = await resend.emails.send({
    from,
    to: [to],
    subject,
    text,
  });

  if (error) {
    throw new Error(`Resend send error: ${JSON.stringify(error)}`);
  }
}

/** パイプライン失敗時の通知。どのステップで何が起きたかをメールで知らせる。 */
export async function sendFailureNotification(opts: {
  step: string;
  error: Error;
  hint?: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.NOTIFY_EMAIL;
  const from = process.env.NOTIFY_FROM ?? "Fishing Bot <onboarding@resend.dev>";

  if (!apiKey || !to) return; // 通知設定がなければ静かに諦める

  const resend = new Resend(apiKey);
  const today = new Date().toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" });

  const text = `本牧釣果まとめの自動実行が失敗しました ⚠️

【失敗ステップ】${opts.step}

【エラー】
${opts.error.message}
${opts.hint ? `\n【対処方法】\n${opts.hint}\n` : ""}
ログ: data/logs/ の最新 run_*.log を確認してください。
`;

  await resend.emails.send({
    from,
    to: [to],
    subject: `⚠️ 本牧釣果ボット 実行失敗 (${today}) — ${opts.step}`,
    text,
  });
}
