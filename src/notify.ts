import { Resend } from "resend";
import type { DailyReport } from "./types.js";

export async function sendPostNotification(opts: {
  post: string;
  weight: number;
  reports: DailyReport[];
  postFile: string;
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

  const text = `本牧海づり施設の釣果まとめを X に投稿しました ✅

【投稿文】(X weight ${opts.weight}/280)
--------------------------------------------------
${opts.post}
--------------------------------------------------

【データソース（リプライに投稿済み）】
${sourceLines}

保存先: ${opts.postFile}
`;

  const { error } = await resend.emails.send({
    from,
    to: [to],
    subject: `🎣 本牧釣果まとめ X投稿完了 (${today})`,
    text,
  });

  if (error) {
    throw new Error(`Resend send error: ${JSON.stringify(error)}`);
  }
}
