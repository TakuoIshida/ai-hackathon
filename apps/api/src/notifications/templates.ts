import type { EmailMessage } from "./types";

export type BookingNotificationContext = {
  linkTitle: string;
  linkDescription?: string | null;
  startAt: Date;
  endAt: Date;
  ownerEmail: string;
  ownerName?: string | null;
  guestEmail: string;
  guestName: string;
  guestNote?: string | null;
  guestTimeZone?: string | null;
  ownerTimeZone: string;
  meetUrl: string | null;
  cancelUrl: string;
};

function fmt(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  }).format(date);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function ownerConfirmEmail(ctx: BookingNotificationContext): EmailMessage {
  const when = fmt(ctx.startAt, ctx.ownerTimeZone);
  const guestLine = `${ctx.guestName} <${ctx.guestEmail}>`;
  const note = ctx.guestNote?.trim();

  const text = [
    `新しい予約が確定しました — ${ctx.linkTitle}`,
    "",
    `日時: ${when} (${ctx.ownerTimeZone})`,
    `ゲスト: ${guestLine}`,
    note ? `メモ: ${note}` : null,
    ctx.meetUrl ? `Google Meet: ${ctx.meetUrl}` : null,
    "",
    `キャンセル: ${ctx.cancelUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  const html = `<!doctype html><html><body style="font-family:sans-serif">
<h1 style="font-size:1.25rem">新しい予約が確定しました</h1>
<p><strong>${escapeHtml(ctx.linkTitle)}</strong></p>
<p>日時: ${escapeHtml(when)} (${escapeHtml(ctx.ownerTimeZone)})</p>
<p>ゲスト: ${escapeHtml(guestLine)}</p>
${note ? `<p>メモ: ${escapeHtml(note)}</p>` : ""}
${ctx.meetUrl ? `<p>Google Meet: <a href="${escapeHtml(ctx.meetUrl)}">${escapeHtml(ctx.meetUrl)}</a></p>` : ""}
<p style="font-size:0.875rem;color:#666">キャンセル: <a href="${escapeHtml(ctx.cancelUrl)}">${escapeHtml(ctx.cancelUrl)}</a></p>
</body></html>`;

  return {
    to: ctx.ownerEmail,
    subject: `[予約確定] ${ctx.linkTitle} — ${when}`,
    text,
    html,
  };
}

export function guestConfirmEmail(ctx: BookingNotificationContext): EmailMessage {
  const tz = ctx.guestTimeZone ?? ctx.ownerTimeZone;
  const when = fmt(ctx.startAt, tz);
  const ownerLine = ctx.ownerName ? `${ctx.ownerName} <${ctx.ownerEmail}>` : ctx.ownerEmail;

  const text = [
    `予約が確定しました — ${ctx.linkTitle}`,
    "",
    `日時: ${when} (${tz})`,
    `主催者: ${ownerLine}`,
    ctx.meetUrl ? `Google Meet: ${ctx.meetUrl}` : null,
    "",
    `予約をキャンセルする場合: ${ctx.cancelUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  const html = `<!doctype html><html><body style="font-family:sans-serif">
<h1 style="font-size:1.25rem">予約が確定しました</h1>
<p><strong>${escapeHtml(ctx.linkTitle)}</strong></p>
<p>日時: ${escapeHtml(when)} (${escapeHtml(tz)})</p>
<p>主催者: ${escapeHtml(ownerLine)}</p>
${ctx.meetUrl ? `<p>Google Meet: <a href="${escapeHtml(ctx.meetUrl)}">${escapeHtml(ctx.meetUrl)}</a></p>` : ""}
<p style="font-size:0.875rem;color:#666">キャンセル: <a href="${escapeHtml(ctx.cancelUrl)}">${escapeHtml(ctx.cancelUrl)}</a></p>
</body></html>`;

  return {
    to: ctx.guestEmail,
    subject: `[予約完了] ${ctx.linkTitle} — ${when}`,
    text,
    html,
  };
}

export type CancelNotificationContext = BookingNotificationContext & {
  canceledBy: "owner" | "guest";
  reason?: string;
};

// ISH-270: reschedule notification context. Carries the *previous* start/end so
// the templates can render "旧 → 新" lines. The booking-side fields (`startAt`
// / `endAt`) reflect the NEW slot.
export type RescheduleNotificationContext = BookingNotificationContext & {
  previousStartAt: Date;
  previousEndAt: Date;
};

export function ownerCancelEmail(ctx: CancelNotificationContext): EmailMessage {
  const when = fmt(ctx.startAt, ctx.ownerTimeZone);
  const actor = ctx.canceledBy === "owner" ? "あなた" : "ゲスト";
  return {
    to: ctx.ownerEmail,
    subject: `[予約キャンセル] ${ctx.linkTitle} — ${when}`,
    text: `${actor} が予約をキャンセルしました。\n\n${ctx.linkTitle}\n${when} (${ctx.ownerTimeZone})\nゲスト: ${ctx.guestName} <${ctx.guestEmail}>`,
    html: `<p>${escapeHtml(actor)} が予約をキャンセルしました。</p><p><strong>${escapeHtml(ctx.linkTitle)}</strong><br/>${escapeHtml(when)} (${escapeHtml(ctx.ownerTimeZone)})<br/>ゲスト: ${escapeHtml(ctx.guestName)} &lt;${escapeHtml(ctx.guestEmail)}&gt;</p>`,
  };
}

export function guestCancelEmail(ctx: CancelNotificationContext): EmailMessage {
  const tz = ctx.guestTimeZone ?? ctx.ownerTimeZone;
  const when = fmt(ctx.startAt, tz);
  const actor = ctx.canceledBy === "guest" ? "あなた" : "主催者";
  return {
    to: ctx.guestEmail,
    subject: `[予約キャンセル] ${ctx.linkTitle} — ${when}`,
    text: `${actor} が予約をキャンセルしました。\n\n${ctx.linkTitle}\n${when} (${tz})`,
    html: `<p>${escapeHtml(actor)} が予約をキャンセルしました。</p><p><strong>${escapeHtml(ctx.linkTitle)}</strong><br/>${escapeHtml(when)} (${escapeHtml(tz)})</p>`,
  };
}

// ISH-270: reschedule emails — fired by `rescheduleBooking` after the start/end
// move. We render the previous and new slot side by side so the recipient can
// see what changed without comparing two separate mails.

export function ownerRescheduleEmail(ctx: RescheduleNotificationContext): EmailMessage {
  const newWhen = fmt(ctx.startAt, ctx.ownerTimeZone);
  const oldWhen = fmt(ctx.previousStartAt, ctx.ownerTimeZone);
  const guestLine = `${ctx.guestName} <${ctx.guestEmail}>`;
  const text = [
    `予約が変更されました — ${ctx.linkTitle}`,
    "",
    `旧日時: ${oldWhen} (${ctx.ownerTimeZone})`,
    `新日時: ${newWhen} (${ctx.ownerTimeZone})`,
    `ゲスト: ${guestLine}`,
    ctx.meetUrl ? `Google Meet: ${ctx.meetUrl}` : null,
    "",
    `キャンセル: ${ctx.cancelUrl}`,
  ]
    .filter(Boolean)
    .join("\n");
  const html = `<!doctype html><html><body style="font-family:sans-serif">
<h1 style="font-size:1.25rem">予約が変更されました</h1>
<p><strong>${escapeHtml(ctx.linkTitle)}</strong></p>
<p>旧日時: ${escapeHtml(oldWhen)} (${escapeHtml(ctx.ownerTimeZone)})</p>
<p>新日時: ${escapeHtml(newWhen)} (${escapeHtml(ctx.ownerTimeZone)})</p>
<p>ゲスト: ${escapeHtml(guestLine)}</p>
${ctx.meetUrl ? `<p>Google Meet: <a href="${escapeHtml(ctx.meetUrl)}">${escapeHtml(ctx.meetUrl)}</a></p>` : ""}
<p style="font-size:0.875rem;color:#666">キャンセル: <a href="${escapeHtml(ctx.cancelUrl)}">${escapeHtml(ctx.cancelUrl)}</a></p>
</body></html>`;
  return {
    to: ctx.ownerEmail,
    subject: `[予約変更] ${ctx.linkTitle} — ${newWhen}`,
    text,
    html,
  };
}

export function guestRescheduleEmail(ctx: RescheduleNotificationContext): EmailMessage {
  const tz = ctx.guestTimeZone ?? ctx.ownerTimeZone;
  const newWhen = fmt(ctx.startAt, tz);
  const oldWhen = fmt(ctx.previousStartAt, tz);
  const ownerLine = ctx.ownerName ? `${ctx.ownerName} <${ctx.ownerEmail}>` : ctx.ownerEmail;
  const text = [
    `予約が変更されました — ${ctx.linkTitle}`,
    "",
    `旧日時: ${oldWhen} (${tz})`,
    `新日時: ${newWhen} (${tz})`,
    `主催者: ${ownerLine}`,
    ctx.meetUrl ? `Google Meet: ${ctx.meetUrl}` : null,
    "",
    `キャンセルする場合: ${ctx.cancelUrl}`,
  ]
    .filter(Boolean)
    .join("\n");
  const html = `<!doctype html><html><body style="font-family:sans-serif">
<h1 style="font-size:1.25rem">予約が変更されました</h1>
<p><strong>${escapeHtml(ctx.linkTitle)}</strong></p>
<p>旧日時: ${escapeHtml(oldWhen)} (${escapeHtml(tz)})</p>
<p>新日時: ${escapeHtml(newWhen)} (${escapeHtml(tz)})</p>
<p>主催者: ${escapeHtml(ownerLine)}</p>
${ctx.meetUrl ? `<p>Google Meet: <a href="${escapeHtml(ctx.meetUrl)}">${escapeHtml(ctx.meetUrl)}</a></p>` : ""}
<p style="font-size:0.875rem;color:#666">キャンセル: <a href="${escapeHtml(ctx.cancelUrl)}">${escapeHtml(ctx.cancelUrl)}</a></p>
</body></html>`;
  return {
    to: ctx.guestEmail,
    subject: `[予約変更] ${ctx.linkTitle} — ${newWhen}`,
    text,
    html,
  };
}

// ISH-95: reminder emails sent X hours before a confirmed booking.
//
// Uses the same context shape as confirm/cancel so the cron job can hand the
// existing notification context straight through. We do NOT include guestNote
// here (reminders are operational, not editorial).

function reminderText(
  ctx: BookingNotificationContext,
  opts: { audience: "owner" | "guest" },
): string {
  const tz =
    opts.audience === "owner" ? ctx.ownerTimeZone : (ctx.guestTimeZone ?? ctx.ownerTimeZone);
  const when = fmt(ctx.startAt, tz);
  const counterpart =
    opts.audience === "owner"
      ? `ゲスト: ${ctx.guestName} <${ctx.guestEmail}>`
      : ctx.ownerName
        ? `主催者: ${ctx.ownerName} <${ctx.ownerEmail}>`
        : `主催者: ${ctx.ownerEmail}`;
  return [
    `まもなく予約のお時間です — ${ctx.linkTitle}`,
    "",
    `日時: ${when} (${tz})`,
    counterpart,
    ctx.meetUrl ? `Google Meet: ${ctx.meetUrl}` : null,
    "",
    `キャンセル: ${ctx.cancelUrl}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function reminderHtml(
  ctx: BookingNotificationContext,
  opts: { audience: "owner" | "guest" },
): string {
  const tz =
    opts.audience === "owner" ? ctx.ownerTimeZone : (ctx.guestTimeZone ?? ctx.ownerTimeZone);
  const when = fmt(ctx.startAt, tz);
  const counterpart =
    opts.audience === "owner"
      ? `ゲスト: ${escapeHtml(ctx.guestName)} &lt;${escapeHtml(ctx.guestEmail)}&gt;`
      : ctx.ownerName
        ? `主催者: ${escapeHtml(ctx.ownerName)} &lt;${escapeHtml(ctx.ownerEmail)}&gt;`
        : `主催者: ${escapeHtml(ctx.ownerEmail)}`;
  return `<!doctype html><html><body style="font-family:sans-serif">
<h1 style="font-size:1.25rem">まもなく予約のお時間です</h1>
<p><strong>${escapeHtml(ctx.linkTitle)}</strong></p>
<p>日時: ${escapeHtml(when)} (${escapeHtml(tz)})</p>
<p>${counterpart}</p>
${ctx.meetUrl ? `<p>Google Meet: <a href="${escapeHtml(ctx.meetUrl)}">${escapeHtml(ctx.meetUrl)}</a></p>` : ""}
<p style="font-size:0.875rem;color:#666">キャンセル: <a href="${escapeHtml(ctx.cancelUrl)}">${escapeHtml(ctx.cancelUrl)}</a></p>
</body></html>`;
}

export function ownerReminderEmail(ctx: BookingNotificationContext): EmailMessage {
  const when = fmt(ctx.startAt, ctx.ownerTimeZone);
  return {
    to: ctx.ownerEmail,
    subject: `[リマインド] ${ctx.linkTitle} — ${when}`,
    text: reminderText(ctx, { audience: "owner" }),
    html: reminderHtml(ctx, { audience: "owner" }),
  };
}

export function guestReminderEmail(ctx: BookingNotificationContext): EmailMessage {
  const tz = ctx.guestTimeZone ?? ctx.ownerTimeZone;
  const when = fmt(ctx.startAt, tz);
  return {
    to: ctx.guestEmail,
    subject: `[リマインド] ${ctx.linkTitle} — ${when}`,
    text: reminderText(ctx, { audience: "guest" }),
    html: reminderHtml(ctx, { audience: "guest" }),
  };
}

// ISH-108 / ISH-243: workspace invitation email.
//
// The HTML body follows Artboard 6 (`/tmp/spir-design/artboards/invite-email.jsx`):
// gradient circle with the Rips logo, headline, CTA button, expiry callout, and
// "このあとの流れ" 3-step list. The layout uses tables + inline styles for
// broad email-client compatibility (Gmail, Outlook, Apple Mail).
export type WorkspaceInviteContext = {
  to: string;
  workspaceName: string;
  acceptUrl: string;
  expiresAt: Date;
  /** Display name of the inviter (e.g. "Ishida T"). Optional — falls back to
   * a generic line when omitted so older callers stay valid. */
  inviterName?: string | null;
};

const INVITE_NEXT_STEPS: ReadonlyArray<readonly [string, string]> = [
  ["Googleアカウントでログイン", "招待されたメールアドレスでログインしてください"],
  ["Googleカレンダーへのアクセスを許可", "予定の表示と編集権限が必要です"],
  ["セットアップ完了", "ワークスペースのメンバーとして空き時間調整を始められます"],
] as const;

/**
 * Inline SVG for the Rips wordmark used inside the gradient circle.
 * Mail clients vary in SVG support, so we only rely on it as a decorative
 * accent on top of the gradient — the heading + body copy carry the actual
 * branding when SVG is stripped.
 */
function inviteLogoSvg(): string {
  // 38px tall mark — fits inside the 84px gradient circle with comfortable padding.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="38" viewBox="0 0 60 38" role="img" aria-label="Rips" style="display:block">
  <text x="0" y="30" font-family="Times New Roman, Hiragino Mincho ProN, serif" font-style="italic" font-weight="700" font-size="32" fill="#FFFFFF">Rips</text>
</svg>`;
}

export function workspaceInviteEmail(ctx: WorkspaceInviteContext): EmailMessage {
  const expires = fmt(ctx.expiresAt, "Asia/Tokyo");
  const inviter = ctx.inviterName?.trim() || null;
  const lead = inviter
    ? `${inviter} 様から、${ctx.workspaceName} に招待されました。下のボタンから招待を受諾し、Ripsの利用を開始してください。`
    : `${ctx.workspaceName} に招待されました。下のボタンから招待を受諾し、Ripsの利用を開始してください。`;

  const text = [
    `【Rips】${ctx.workspaceName} に招待されました`,
    "",
    lead,
    "",
    `招待を受諾する: ${ctx.acceptUrl}`,
    "",
    `この招待リンクは 24時間有効です (${expires} JST まで)。`,
    "期限切れの場合は、招待元の方に再送をご依頼ください。",
    "",
    "このあとの流れ:",
    ...INVITE_NEXT_STEPS.map(([t, d], i) => `  ${i + 1}. ${t} — ${d}`),
    "",
    "ボタンが反応しない場合は、こちらの URL をブラウザに貼り付けてください:",
    ctx.acceptUrl,
    "",
    "このメールアドレスは送信専用のため、返信できませんのでご了承ください。",
  ].join("\n");

  const stepRows = INVITE_NEXT_STEPS.map(
    ([t, d], i) => `
              <tr>
                <td valign="top" width="34" style="padding-bottom:10px">
                  <div style="width:22px;height:22px;border-radius:50%;background:#2A6FA8;color:#FFFFFF;font:700 11px/22px sans-serif;text-align:center">${i + 1}</div>
                </td>
                <td valign="top" style="padding:0 0 10px 0">
                  <div style="font:700 13px/1.4 sans-serif;color:#0E2F4D">${escapeHtml(t)}</div>
                  <div style="font:400 12px/1.5 sans-serif;color:#5C7388;margin-top:2px">${escapeHtml(d)}</div>
                </td>
              </tr>`,
  ).join("");

  const html = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(ctx.workspaceName)} に招待されました</title>
  </head>
  <body style="margin:0;padding:0;background:#F5F5F4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans JP',sans-serif;color:#3C4043">
    <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#F5F5F4">
      ${escapeHtml(ctx.workspaceName)} に招待されました — 招待を受諾して Rips を始めましょう。
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F5F4">
      <tr>
        <td align="center" style="padding:24px 12px">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:12px;box-shadow:0 6px 20px rgba(42,111,168,0.08);overflow:hidden">
            <tr>
              <td style="padding:32px 40px 40px 40px">
                <!-- Logo gradient circle -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td align="center" style="padding-bottom:24px">
                      <div style="display:inline-block;width:84px;height:84px;border-radius:50%;background:linear-gradient(135deg,#C7DCEF 0%,#4F92BE 60%,#D9695F 130%);text-align:center;line-height:84px;box-shadow:0 6px 20px rgba(42,111,168,0.25)">
                        <span style="display:inline-block;vertical-align:middle;line-height:1">${inviteLogoSvg()}</span>
                      </div>
                    </td>
                  </tr>
                </table>

                <!-- Headline -->
                <h1 style="margin:0 0 8px 0;font:700 22px/1.4 sans-serif;color:#0E2F4D;text-align:center">
                  ${escapeHtml(ctx.workspaceName)} に招待されました
                </h1>
                <p style="margin:0 0 28px 0;font:400 14px/1.7 sans-serif;color:#2C4258;text-align:center">
                  ${
                    inviter
                      ? `<strong>${escapeHtml(inviter)}</strong> 様から、<strong>${escapeHtml(ctx.workspaceName)}</strong> に招待されました。<br/>下のボタンから招待を受諾し、Ripsの利用を開始してください。`
                      : `<strong>${escapeHtml(ctx.workspaceName)}</strong> に招待されました。<br/>下のボタンから招待を受諾し、Ripsの利用を開始してください。`
                  }
                </p>

                <!-- CTA -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td align="center" style="padding-bottom:24px">
                      <a href="${escapeHtml(ctx.acceptUrl)}" style="display:inline-block;padding:14px 36px;border-radius:10px;background:#2A6FA8;color:#FFFFFF;font:700 15px/1 sans-serif;text-decoration:none;box-shadow:0 6px 20px rgba(42,111,168,0.35)">
                        招待を受諾する
                      </a>
                    </td>
                  </tr>
                </table>

                <!-- Expiry callout -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F4F8FC;border:1px solid #DCE9F6;border-radius:10px;margin-bottom:20px">
                  <tr>
                    <td style="padding:14px 18px;font:400 13px/1.6 sans-serif;color:#0E2F4D">
                      この招待リンクは <strong>24時間有効</strong> です (${escapeHtml(expires)} JST まで)。<br/>
                      <span style="color:#2C4258;font-size:12px">期限切れの場合は、招待元の方に再送をご依頼ください。</span>
                    </td>
                  </tr>
                </table>

                <!-- Next steps -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAFBFD;border:1px solid #DDE4EC;border-radius:10px;margin-bottom:20px">
                  <tr>
                    <td style="padding:16px 20px">
                      <div style="font:700 12px/1 sans-serif;color:#2C4258;margin-bottom:12px">このあとの流れ</div>
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${stepRows}
                      </table>
                    </td>
                  </tr>
                </table>

                <!-- Fallback URL -->
                <p style="margin:0 0 20px 0;font:400 12px/1.6 sans-serif;color:#5C7388;text-align:center">
                  ボタンが反応しない場合は、こちらの URL をブラウザに貼り付けてください<br/>
                  <span style="color:#2A6FA8;word-break:break-all">${escapeHtml(ctx.acceptUrl)}</span>
                </p>

                <!-- Footer -->
                <div style="border-top:1px solid #ECF1F6;padding-top:16px;font:400 11px/1.6 sans-serif;color:#8294A8;text-align:center">
                  Rips · このメールアドレスは送信専用のため、返信できませんのでご了承ください。
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return {
    to: ctx.to,
    subject: `【Rips】${ctx.workspaceName} に招待されました`,
    text,
    html,
  };
}
