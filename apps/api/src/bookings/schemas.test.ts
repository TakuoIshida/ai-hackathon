import { describe, expect, test } from "bun:test";
import { bookingInputSchema, toConfirmBookingCommand } from "./schemas";

describe("bookingInputSchema", () => {
  const minimal = {
    startAt: "2026-12-14T05:00:00.000Z",
    guestName: "Guest",
    guestEmail: "guest@example.com",
  };

  test("accepts a minimal valid payload", () => {
    expect(() => bookingInputSchema.parse(minimal)).not.toThrow();
  });

  test("rejects non-ISO startAt", () => {
    expect(() => bookingInputSchema.parse({ ...minimal, startAt: "not-a-date" })).toThrow();
  });

  test("rejects missing email", () => {
    expect(() => bookingInputSchema.parse({ ...minimal, guestEmail: "not-an-email" })).toThrow();
  });
});

describe("toConfirmBookingCommand", () => {
  const validWire = {
    startAt: "2026-12-14T05:00:00.000Z",
    guestName: "Guest",
    guestEmail: "guest@example.com",
  };

  test("normalizes optional+nullable guestNote/guestTimeZone to null", () => {
    // Construct a parsed wire shape directly (Zod gives us {} for missing
    // optional fields, but the function only reads what's present, so this
    // mirrors what the route hands over after `c.req.valid("json")`).
    const cmd = toConfirmBookingCommand(bookingInputSchema.parse(validWire));
    expect(cmd).not.toBeNull();
    if (cmd) {
      expect(cmd.guestNote).toBeNull();
      expect(cmd.guestTimeZone).toBeNull();
    }
  });

  test("converts startAt ISO to startMs", () => {
    const cmd = toConfirmBookingCommand(bookingInputSchema.parse(validWire));
    expect(cmd?.startMs).toBe(Date.parse(validWire.startAt));
  });

  test("returns null when startAt parses to NaN", () => {
    // The Zod schema rejects malformed strings before we get here, so to
    // exercise the null branch we hand the mapper a synthetic input that
    // bypasses Zod. This pins the route's `invalid_start_at` 400 mapping.
    const cmd = toConfirmBookingCommand({
      startAt: "definitely-not-a-date",
      guestName: "G",
      guestEmail: "g@example.com",
      guestNote: undefined,
      guestTimeZone: undefined,
    });
    expect(cmd).toBeNull();
  });

  test("preserves explicit null on guestNote / guestTimeZone", () => {
    const cmd = toConfirmBookingCommand({
      ...validWire,
      guestNote: null,
      guestTimeZone: null,
    });
    expect(cmd?.guestNote).toBeNull();
    expect(cmd?.guestTimeZone).toBeNull();
  });

  test("forwards non-null guestNote / guestTimeZone unchanged", () => {
    const cmd = toConfirmBookingCommand({
      ...validWire,
      guestNote: "looking forward",
      guestTimeZone: "Asia/Tokyo",
    });
    expect(cmd?.guestNote).toBe("looking forward");
    expect(cmd?.guestTimeZone).toBe("Asia/Tokyo");
  });
});
