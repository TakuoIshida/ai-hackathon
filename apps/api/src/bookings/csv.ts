import type { OwnerBookingView } from "./usecase";

// ISH-271: CSV export utility for the「予約調整」一覧 page's CSV button.
//
// Format choices:
// - RFC 4180 style — fields containing `,` `"` or LF/CR get quoted; embedded
//   `"` becomes `""`. Line terminator is CRLF, again per RFC.
// - Headers in Japanese to match the dashboard column labels — Excel renders
//   them correctly when the BOM is present (see `formatBookingsCsv`).
// - Date fields are emitted as ISO 8601 (UTC) so spreadsheet apps can sort
//   them as text without locale ambiguity. Local-time formatting is left to
//   the consumer (Excel formula / pivot / etc).

/**
 * Quote a single CSV field per RFC 4180. Returns the input unchanged when no
 * special characters are present so output stays compact and diff-friendly.
 */
export function escapeCsvField(value: string): string {
  if (value === "") return "";
  // The RFC special-char set: comma, quote, CR, LF. Any of these forces
  // wrapping in double quotes; an embedded `"` doubles up to `""`.
  const needsQuote = /[",\r\n]/.test(value);
  if (!needsQuote) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

const HEADER_ROW: ReadonlyArray<string> = [
  "開始日時",
  "終了日時",
  "リンクタイトル",
  "主催者名",
  "主催者 email",
  "参加者名",
  "参加者 email",
  "ステータス",
  "作成日時",
];

/**
 * Convert a `confirmed | canceled` status string to its Japanese display
 * label so the CSV reads naturally without a separate mapping step in the
 * consumer's spreadsheet.
 */
function statusLabel(status: string): string {
  if (status === "confirmed") return "確定";
  if (status === "canceled") return "キャンセル済";
  return status;
}

function rowFor(b: OwnerBookingView): ReadonlyArray<string> {
  return [
    b.startAt.toISOString(),
    b.endAt.toISOString(),
    b.linkTitle,
    b.hostName,
    b.hostEmail,
    b.guestName,
    b.guestEmail,
    statusLabel(b.status),
    b.createdAt.toISOString(),
  ];
}

/**
 * Serialize a list of bookings to RFC 4180 CSV with a leading UTF-8 BOM.
 * The BOM (U+FEFF) prefix is the de-facto signal that lets Excel for Windows
 * decode the body as UTF-8 instead of the system code page — without it the
 * Japanese headers + values render as mojibake.
 *
 * Returns a single string. Caller is responsible for wrapping it in the
 * `text/csv` Content-Type / Content-Disposition headers.
 */
export function formatBookingsCsv(bookings: ReadonlyArray<OwnerBookingView>): string {
  const lines: string[] = [];
  lines.push(HEADER_ROW.map(escapeCsvField).join(","));
  for (const b of bookings) {
    lines.push(rowFor(b).map(escapeCsvField).join(","));
  }
  // RFC 4180: CRLF between records.
  return `﻿${lines.join("\r\n")}`;
}

/**
 * Build a `bookings-YYYYMMDD.csv` filename anchored on the supplied date.
 * Pure helper extracted so the route layer can be unit-tested with a fake
 * "now" instead of relying on the wall clock.
 */
export function buildBookingsCsvFilename(now: Date): string {
  const yyyy = now.getUTCFullYear().toString().padStart(4, "0");
  const mm = (now.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = now.getUTCDate().toString().padStart(2, "0");
  return `bookings-${yyyy}${mm}${dd}.csv`;
}
