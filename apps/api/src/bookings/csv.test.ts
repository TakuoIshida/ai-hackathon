import { describe, expect, test } from "bun:test";
import { buildBookingsCsvFilename, escapeCsvField, formatBookingsCsv } from "./csv";
import type { OwnerBookingView } from "./usecase";

function fakeBooking(overrides: Partial<OwnerBookingView> = {}): OwnerBookingView {
  return {
    id: "b1",
    linkId: "l1",
    linkSlug: "intro",
    linkTitle: "30 minute intro",
    hostUserId: "u-host",
    hostName: "Host",
    hostEmail: "host@example.com",
    startAt: new Date("2026-12-14T05:00:00.000Z"),
    endAt: new Date("2026-12-14T05:30:00.000Z"),
    guestName: "Guest",
    guestEmail: "guest@example.com",
    status: "confirmed",
    meetUrl: null,
    googleEventId: null,
    googleHtmlLink: null,
    canceledAt: null,
    createdAt: new Date("2026-12-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("escapeCsvField", () => {
  test("returns plain values unchanged", () => {
    expect(escapeCsvField("Alice")).toBe("Alice");
    expect(escapeCsvField("alice@example.com")).toBe("alice@example.com");
    expect(escapeCsvField("")).toBe("");
  });

  test("quotes fields containing a comma", () => {
    expect(escapeCsvField("a, b")).toBe('"a, b"');
  });

  test("quotes fields containing a double quote and doubles the quote", () => {
    expect(escapeCsvField('she said "hi"')).toBe('"she said ""hi"""');
  });

  test("quotes fields containing CR or LF", () => {
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsvField("line1\r\nline2")).toBe('"line1\r\nline2"');
  });
});

describe("formatBookingsCsv", () => {
  test("emits header row + UTF-8 BOM even for empty input", () => {
    const csv = formatBookingsCsv([]);
    // BOM (U+FEFF) followed by the header row.
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const body = csv.slice(1);
    expect(body.split("\r\n").length).toBe(1);
    expect(body).toContain("開始日時");
    expect(body).toContain("ステータス");
  });

  test("emits one row per booking with ISO-8601 timestamps and the JP status label", () => {
    const csv = formatBookingsCsv([fakeBooking()]);
    const lines = csv.slice(1).split("\r\n");
    expect(lines.length).toBe(2);
    const dataRow = lines[1] ?? "";
    expect(dataRow).toContain("2026-12-14T05:00:00.000Z");
    expect(dataRow).toContain("2026-12-14T05:30:00.000Z");
    expect(dataRow).toContain("30 minute intro");
    expect(dataRow).toContain("Host");
    expect(dataRow).toContain("host@example.com");
    expect(dataRow).toContain("Guest");
    expect(dataRow).toContain("guest@example.com");
    // confirmed → 確定
    expect(dataRow).toContain("確定");
  });

  test("canceled status renders as キャンセル済", () => {
    const csv = formatBookingsCsv([fakeBooking({ status: "canceled" })]);
    expect(csv).toContain("キャンセル済");
  });

  test("escapes commas, quotes and newlines inside guest fields", () => {
    const csv = formatBookingsCsv([
      fakeBooking({
        guestName: 'Alice "Quoted", Bob',
        linkTitle: "Title with\ntwo lines",
      }),
    ]);
    // Comma + quote are wrapped + doubled per RFC 4180.
    expect(csv).toContain('"Alice ""Quoted"", Bob"');
    expect(csv).toContain('"Title with\ntwo lines"');
  });

  test("rows are CRLF-terminated between records", () => {
    const csv = formatBookingsCsv([fakeBooking(), fakeBooking({ id: "b2" })]);
    // 2 rows + 1 header = 3 total, joined by 2 separators.
    const body = csv.slice(1);
    expect(body.split("\r\n").length).toBe(3);
  });
});

describe("buildBookingsCsvFilename", () => {
  test("formats UTC date as bookings-YYYYMMDD.csv", () => {
    expect(buildBookingsCsvFilename(new Date("2026-05-07T12:34:56.000Z"))).toBe(
      "bookings-20260507.csv",
    );
    expect(buildBookingsCsvFilename(new Date("2026-01-09T00:00:00.000Z"))).toBe(
      "bookings-20260109.csv",
    );
  });
});
