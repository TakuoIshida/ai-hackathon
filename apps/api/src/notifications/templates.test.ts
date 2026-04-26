import { describe, expect, test } from "bun:test";
import {
  type BookingNotificationContext,
  guestCancelEmail,
  guestConfirmEmail,
  ownerCancelEmail,
  ownerConfirmEmail,
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
