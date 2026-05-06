import { describe, expect, test } from "bun:test";
import {
  type BookingNotificationContext,
  guestCancelEmail,
  guestConfirmEmail,
  guestReminderEmail,
  ownerCancelEmail,
  ownerConfirmEmail,
  ownerReminderEmail,
  workspaceInviteEmail,
} from "./templates";

const baseCtx: BookingNotificationContext = {
  linkTitle: "30 min meet",
  linkDescription: "intro",
  startAt: new Date("2026-12-14T05:00:00Z"),
  endAt: new Date("2026-12-14T05:30:00Z"),
  ownerEmail: "owner@example.com",
  ownerName: "Owner Name",
  guestEmail: "guest@example.com",
  guestName: "Guest <Hacker>", // contains chars to escape
  guestNote: "looking forward",
  guestTimeZone: "Asia/Tokyo",
  ownerTimeZone: "Asia/Tokyo",
  meetUrl: "https://meet.google.com/abc",
  cancelUrl: "https://app.example.com/cancel/token-1",
};

describe("ownerConfirmEmail", () => {
  test("addressed to owner with subject including link title", () => {
    const m = ownerConfirmEmail(baseCtx);
    expect(m.to).toBe("owner@example.com");
    expect(m.subject).toContain("30 min meet");
    expect(m.subject).toContain("予約確定");
  });
  test("includes guest line, meet URL, and cancel URL in text + html", () => {
    const m = ownerConfirmEmail(baseCtx);
    expect(m.text).toContain("guest@example.com");
    expect(m.text).toContain("Google Meet:");
    expect(m.text).toContain("https://meet.google.com/abc");
    expect(m.text).toContain(baseCtx.cancelUrl);
    expect(m.html).toContain("https://meet.google.com/abc");
  });
  test("escapes html-unsafe characters in user input", () => {
    const m = ownerConfirmEmail(baseCtx);
    // Guest name "Guest <Hacker>" must not appear unescaped in HTML
    expect(m.html).not.toContain("<Hacker>");
    expect(m.html).toContain("&lt;Hacker&gt;");
  });
  test("omits meet line when no Meet URL", () => {
    const m = ownerConfirmEmail({ ...baseCtx, meetUrl: null });
    expect(m.text).not.toContain("Meet:");
    expect(m.html).not.toContain("meet.google.com");
  });
});

describe("guestConfirmEmail", () => {
  test("addressed to guest, subject in guest TZ", () => {
    const m = guestConfirmEmail(baseCtx);
    expect(m.to).toBe("guest@example.com");
    expect(m.subject).toContain("予約完了");
  });
  test("falls back to owner TZ when guest TZ is missing", () => {
    const m = guestConfirmEmail({ ...baseCtx, guestTimeZone: null });
    // 2026-12-14T05:00 UTC → 14:00 JST → present in subject formatted via owner TZ
    expect(m.subject).toContain("14");
  });
  test("includes Meet URL in body", () => {
    const m = guestConfirmEmail(baseCtx);
    expect(m.text).toContain("https://meet.google.com/abc");
  });
});

describe("ownerCancelEmail / guestCancelEmail", () => {
  test("owner-side describes who canceled", () => {
    const ownerCanceled = ownerCancelEmail({ ...baseCtx, canceledBy: "owner" });
    const guestCanceled = ownerCancelEmail({ ...baseCtx, canceledBy: "guest" });
    expect(ownerCanceled.text).toContain("あなた が予約をキャンセル");
    expect(guestCanceled.text).toContain("ゲスト が予約をキャンセル");
  });
  test("guest-side mirrors the actor", () => {
    const guestCanceled = guestCancelEmail({ ...baseCtx, canceledBy: "guest" });
    const ownerCanceled = guestCancelEmail({ ...baseCtx, canceledBy: "owner" });
    expect(guestCanceled.text).toContain("あなた が予約をキャンセル");
    expect(ownerCanceled.text).toContain("主催者 が予約をキャンセル");
  });
});

describe("ownerReminderEmail (ISH-95)", () => {
  test("addressed to owner with subject in owner timezone + リマインド prefix", () => {
    const m = ownerReminderEmail(baseCtx);
    expect(m.to).toBe("owner@example.com");
    expect(m.subject).toContain("リマインド");
    expect(m.subject).toContain("30 min meet");
    // owner TZ = Asia/Tokyo → 14:00 JST
    expect(m.subject).toContain("14:00");
  });
  test("body includes guest line, meet URL, and cancel URL", () => {
    const m = ownerReminderEmail(baseCtx);
    expect(m.text).toContain("guest@example.com");
    expect(m.text).toContain("Guest <Hacker>");
    expect(m.text).toContain("Google Meet:");
    expect(m.text).toContain("https://meet.google.com/abc");
    expect(m.text).toContain(baseCtx.cancelUrl);
  });
  test("escapes guestName in html (XSS guard)", () => {
    const m = ownerReminderEmail(baseCtx);
    expect(m.html).toContain("Guest &lt;Hacker&gt;");
    expect(m.html).not.toContain("<Hacker>");
  });
  test("omits Meet line when meetUrl is null", () => {
    const m = ownerReminderEmail({ ...baseCtx, meetUrl: null });
    expect(m.text).not.toContain("Google Meet:");
    expect(m.html).not.toContain("Google Meet:");
  });
});

describe("guestReminderEmail (ISH-95)", () => {
  test("addressed to guest, subject formatted in guest timezone", () => {
    // guest in NY: 2026-12-14T05:00:00Z = 00:00 EST
    const m = guestReminderEmail({ ...baseCtx, guestTimeZone: "America/New_York" });
    expect(m.to).toBe("guest@example.com");
    expect(m.subject).toContain("リマインド");
    expect(m.subject).toContain("00:00");
  });
  test("falls back to owner TZ when guestTimeZone is null", () => {
    const m = guestReminderEmail({ ...baseCtx, guestTimeZone: null });
    // owner TZ JST → 14:00
    expect(m.subject).toContain("14:00");
  });
  test("counterpart line shows organizer name when present, else email only", () => {
    const withName = guestReminderEmail(baseCtx);
    expect(withName.text).toContain("主催者: Owner Name <owner@example.com>");
    const withoutName = guestReminderEmail({ ...baseCtx, ownerName: null });
    expect(withoutName.text).toContain("主催者: owner@example.com");
    expect(withoutName.text).not.toContain("主催者: Owner Name");
  });
  test("includes Meet URL and cancel URL", () => {
    const m = guestReminderEmail(baseCtx);
    expect(m.text).toContain("https://meet.google.com/abc");
    expect(m.text).toContain(baseCtx.cancelUrl);
  });
});

describe("workspaceInviteEmail (ISH-243)", () => {
  const inviteCtx = {
    to: "invitee@example.com",
    workspaceName: "team",
    acceptUrl: "https://app.example.com/invite/a8f3-token-e2c1",
    expiresAt: new Date("2026-05-07T15:20:00Z"), // 2026/05/08 00:20 JST
    inviterName: "Ishida T",
  } as const;

  test("addressed to invitee with branded subject", () => {
    const m = workspaceInviteEmail(inviteCtx);
    expect(m.to).toBe("invitee@example.com");
    expect(m.subject).toContain("Rips");
    expect(m.subject).toContain("team");
    expect(m.subject).toContain("招待");
  });

  test("html includes inviter, team name, and CTA URL", () => {
    const m = workspaceInviteEmail(inviteCtx);
    expect(m.html).toContain("Ishida T");
    expect(m.html).toContain("team");
    expect(m.html).toContain(inviteCtx.acceptUrl);
    expect(m.html).toContain("招待を受諾する");
  });

  test("html includes 24h expiry callout with formatted JST timestamp", () => {
    const m = workspaceInviteEmail(inviteCtx);
    expect(m.html).toContain("24時間有効");
    // 2026-05-07T15:20Z → 2026/05/08 00:20 JST → contains 00:20 in JST
    expect(m.html).toContain("00:20");
  });

  test("html includes 'このあとの流れ' 3-step list", () => {
    const m = workspaceInviteEmail(inviteCtx);
    expect(m.html).toContain("このあとの流れ");
    expect(m.html).toContain("Googleアカウントでログイン");
    expect(m.html).toContain("Googleカレンダーへのアクセスを許可");
    expect(m.html).toContain("セットアップ完了");
  });

  test("html renders gradient circle + inline SVG logo", () => {
    const m = workspaceInviteEmail(inviteCtx);
    // Gradient circle bg + the inline SVG mark
    expect(m.html).toContain("linear-gradient(135deg,#C7DCEF 0%,#4F92BE 60%,#D9695F 130%)");
    expect(m.html).toContain("<svg");
    expect(m.html).toContain('aria-label="Rips"');
  });

  test("html includes plain-text fallback URL", () => {
    const m = workspaceInviteEmail(inviteCtx);
    // The accept URL appears at least twice: once in the CTA href, once in fallback span.
    const occurrences = m.html.split(inviteCtx.acceptUrl).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  test("escapes html-unsafe characters in workspace + inviter names", () => {
    const m = workspaceInviteEmail({
      ...inviteCtx,
      workspaceName: "team <Hacker>",
      inviterName: "Ishida <T>",
    });
    expect(m.html).not.toContain("team <Hacker>");
    expect(m.html).not.toContain("Ishida <T>");
    expect(m.html).toContain("team &lt;Hacker&gt;");
    expect(m.html).toContain("Ishida &lt;T&gt;");
  });

  test("falls back to generic copy when inviterName is missing", () => {
    const m = workspaceInviteEmail({ ...inviteCtx, inviterName: undefined });
    // Generic lead does not embed an inviter name, but team name + CTA still present.
    expect(m.html).toContain("team");
    expect(m.text).toContain("team");
    expect(m.text).toContain(inviteCtx.acceptUrl);
    expect(m.text).not.toContain("Ishida T");
  });

  test("plain text alternative carries the same key information", () => {
    const m = workspaceInviteEmail(inviteCtx);
    expect(m.text).toContain("team");
    expect(m.text).toContain("Ishida T");
    expect(m.text).toContain(inviteCtx.acceptUrl);
    expect(m.text).toContain("24時間有効");
    expect(m.text).toContain("Googleアカウントでログイン");
    expect(m.text).toContain("Googleカレンダーへのアクセスを許可");
    expect(m.text).toContain("セットアップ完了");
  });
});
