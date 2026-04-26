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
