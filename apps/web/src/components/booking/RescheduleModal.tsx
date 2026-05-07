import * as stylex from "@stylexjs/stylex";
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { buildMonthGrid, formatLocalDate, formatLocalTime } from "@/lib/local-date";
import { fetchPublicSlots, PublicApiError, type PublicSlot } from "@/lib/public-api";
import { colors, radius, space, typography } from "@/styles/tokens.stylex";

/**
 * RescheduleModal (ISH-270).
 *
 * Owner-side reschedule slot picker. Re-uses the public slots endpoint
 * (`GET /public/links/:slug/slots`) since reschedule is constrained by the
 * link's availability rules — same shape PublicLink.tsx already consumes for
 * guest-side booking. The only differences are the action target (POST
 * /bookings/:id/reschedule) and the surrounding modal chrome.
 *
 * Props:
 * - `bookingId` / `linkSlug`: identify what's being moved + which link to ask
 *   for slots.
 * - `currentStartAt`: ISO string of the currently-confirmed slot. Surfaced in
 *   the header copy so the user can compare old vs new at a glance.
 * - `onConfirm`: parent supplies the API-call (so the modal stays oblivious to
 *   the auth + mutation hook). It receives `{ startAt, endAt }` ISO strings.
 */

const styles = stylex.create({
  body: {
    display: "flex",
    flexDirection: "column",
    gap: space.md,
  },
  twoCol: {
    display: "grid",
    gridTemplateColumns: "1fr 14rem",
    gap: space.md,
    alignItems: "start",
  },
  monthHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: space.sm,
    marginBottom: space.sm,
  },
  monthLabel: {
    fontSize: typography.fontSizeSm,
    fontWeight: typography.fontWeightSemibold,
    color: colors.fg,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    gap: "0.25rem",
  },
  dow: {
    textAlign: "center",
    fontSize: typography.fontSizeXs,
    color: colors.muted,
    padding: "0.25rem",
  },
  cell: {
    aspectRatio: "1 / 1",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    fontSize: typography.fontSizeSm,
    background: { default: colors.bg, ":hover": colors.accent },
    cursor: { default: "pointer", ":disabled": "not-allowed" },
    color: colors.fg,
  },
  cellMuted: { color: colors.muted, background: "transparent" },
  cellDisabled: {
    color: colors.muted,
    background: "transparent",
    cursor: "not-allowed",
    borderColor: "transparent",
  },
  cellAvailable: { borderColor: colors.primary, fontWeight: typography.fontWeightSemibold },
  cellSelected: {
    backgroundColor: colors.primary,
    color: colors.primaryFg,
    borderColor: colors.primary,
  },
  slotPanel: {
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
  },
  slotPanelHeader: {
    fontSize: typography.fontSizeSm,
    fontWeight: typography.fontWeightSemibold,
    color: colors.fg,
  },
  slotList: {
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
    maxHeight: "16rem",
    overflowY: "auto",
  },
  slotBtn: {
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    padding: "0.4rem 0.6rem",
    fontSize: typography.fontSizeSm,
    background: { default: colors.bg, ":hover": colors.accent },
    color: colors.fg,
    cursor: "pointer",
    textAlign: "left",
  },
  slotBtnSelected: {
    backgroundColor: colors.primary,
    color: colors.primaryFg,
    borderColor: colors.primary,
  },
  emptyHint: {
    fontSize: typography.fontSizeXs,
    color: colors.muted,
    margin: 0,
  },
  selectedSummary: {
    fontSize: typography.fontSizeSm,
    color: colors.fg,
    backgroundColor: colors.accent,
    padding: space.sm,
    borderRadius: radius.sm,
  },
  selectedSummaryStrong: {
    fontWeight: typography.fontWeightSemibold,
  },
  error: {
    color: colors.destructive,
    fontSize: typography.fontSizeSm,
    margin: 0,
  },
});

const DOW_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

function browserTimeZone(): string {
  if (typeof Intl === "undefined") return "Asia/Tokyo";
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export type RescheduleModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  linkSlug: string;
  currentStartAt: string;
  currentEndAt: string;
  onConfirm: (input: { startAt: string; endAt: string }) => Promise<void>;
  /** Optional override for the timezone used when rendering slot labels. */
  timeZone?: string;
};

export function RescheduleModal({
  open,
  onOpenChange,
  linkSlug,
  currentStartAt,
  currentEndAt,
  onConfirm,
  timeZone,
}: RescheduleModalProps) {
  const tz = timeZone ?? browserTimeZone();
  const today = React.useMemo(() => new Date(), []);
  const [month, setMonth] = React.useState<{ year: number; month: number }>({
    year: today.getFullYear(),
    month: today.getMonth() + 1,
  });
  const [slots, setSlots] = React.useState<PublicSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = React.useState(false);
  const [selectedDate, setSelectedDate] = React.useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = React.useState<PublicSlot | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Reset state whenever the modal closes so a re-open starts clean.
  React.useEffect(() => {
    if (!open) {
      setSelectedDate(null);
      setSelectedSlot(null);
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  // Fetch slots whenever the visible month changes (and the modal is open).
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSlotsLoading(true);
    void (async () => {
      // Pull a generous window so transitions across month boundaries don't
      // leave the right column empty until the next prefetch.
      const fromIso = new Date(month.year, month.month - 1, 1).toISOString();
      const toIso = new Date(month.year, month.month, 1).toISOString();
      try {
        const res = await fetchPublicSlots(linkSlug, fromIso, toIso);
        if (cancelled) return;
        setSlots(res.slots);
      } catch (err) {
        if (cancelled) return;
        // 404 fallback: link became unpublished while user was idle. Surface
        // the empty grid rather than a hard error so the modal stays usable.
        if (err instanceof PublicApiError && err.status === 404) {
          setSlots([]);
        } else {
          setSlots([]);
          setError("空き時間の取得に失敗しました。");
        }
      } finally {
        if (!cancelled) setSlotsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, linkSlug, month]);

  const slotsByDate = React.useMemo(() => {
    const map = new Map<string, PublicSlot[]>();
    for (const s of slots) {
      const key = formatLocalDate(s.start, tz);
      const arr = map.get(key) ?? [];
      arr.push(s);
      map.set(key, arr);
    }
    return map;
  }, [slots, tz]);

  const grid = React.useMemo(() => buildMonthGrid(month.year, month.month), [month]);
  const slotsForSelected = selectedDate ? (slotsByDate.get(selectedDate) ?? []) : [];

  const currentSlotLabel = `${formatLocalDate(currentStartAt, tz)} ${formatLocalTime(currentStartAt, tz)} – ${formatLocalTime(currentEndAt, tz)}`;

  const handleConfirm = async () => {
    if (!selectedSlot) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm({ startAt: selectedSlot.start, endAt: selectedSlot.end });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "再調整に失敗しました。");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby="reschedule-desc"
        data-testid="reschedule-modal"
        style={{ maxWidth: "44rem" }}
      >
        <DialogTitle>予約をリスケジュール</DialogTitle>
        <DialogDescription id="reschedule-desc">
          現在の予定: <strong>{currentSlotLabel}</strong> ({tz})
        </DialogDescription>

        <div {...stylex.props(styles.body)}>
          <div {...stylex.props(styles.twoCol)}>
            <div>
              <div {...stylex.props(styles.monthHeader)}>
                <Button
                  variant="ghost"
                  type="button"
                  size="sm"
                  onClick={() =>
                    setMonth(({ year, month }) => ({
                      year: month === 1 ? year - 1 : year,
                      month: month === 1 ? 12 : month - 1,
                    }))
                  }
                >
                  ‹
                </Button>
                <span {...stylex.props(styles.monthLabel)}>
                  {month.year}年{month.month}月
                </span>
                <Button
                  variant="ghost"
                  type="button"
                  size="sm"
                  onClick={() =>
                    setMonth(({ year, month }) => ({
                      year: month === 12 ? year + 1 : year,
                      month: month === 12 ? 1 : month + 1,
                    }))
                  }
                >
                  ›
                </Button>
              </div>
              <div {...stylex.props(styles.grid)}>
                {DOW_LABELS.map((d) => (
                  <div key={d} {...stylex.props(styles.dow)}>
                    {d}
                  </div>
                ))}
                {grid.map((cell) => {
                  const inMonth = cell.month === month.month;
                  const has = slotsByDate.get(cell.date)?.length ?? 0;
                  const isSelected = selectedDate === cell.date;
                  return (
                    <button
                      type="button"
                      key={cell.date}
                      onClick={() => has > 0 && setSelectedDate(cell.date)}
                      disabled={!inMonth || has === 0}
                      {...stylex.props(
                        styles.cell,
                        !inMonth && styles.cellMuted,
                        inMonth && has === 0 && styles.cellDisabled,
                        inMonth && has > 0 && styles.cellAvailable,
                        isSelected && styles.cellSelected,
                      )}
                    >
                      {cell.day}
                    </button>
                  );
                })}
              </div>
              {slotsLoading && <p {...stylex.props(styles.emptyHint)}>空き時間を取得中...</p>}
            </div>

            <div {...stylex.props(styles.slotPanel)}>
              <div {...stylex.props(styles.slotPanelHeader)}>{selectedDate ?? "日付を選択"}</div>
              {selectedDate && slotsForSelected.length === 0 && (
                <p {...stylex.props(styles.emptyHint)}>この日の空き時間はありません。</p>
              )}
              {!selectedDate && (
                <p {...stylex.props(styles.emptyHint)}>
                  左のカレンダーから日付を選択してください。
                </p>
              )}
              <div {...stylex.props(styles.slotList)}>
                {slotsForSelected.map((slot) => {
                  const selected =
                    selectedSlot?.start === slot.start && selectedSlot?.end === slot.end;
                  return (
                    <button
                      type="button"
                      key={slot.start}
                      onClick={() => setSelectedSlot(slot)}
                      {...stylex.props(styles.slotBtn, selected && styles.slotBtnSelected)}
                    >
                      {formatLocalTime(slot.start, tz)} – {formatLocalTime(slot.end, tz)}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {selectedSlot && (
            <div {...stylex.props(styles.selectedSummary)}>
              新しい予定:{" "}
              <span {...stylex.props(styles.selectedSummaryStrong)}>
                {formatLocalDate(selectedSlot.start, tz)} {formatLocalTime(selectedSlot.start, tz)}{" "}
                – {formatLocalTime(selectedSlot.end, tz)}
              </span>{" "}
              ({tz})
            </div>
          )}

          {error && <p {...stylex.props(styles.error)}>{error}</p>}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" type="button" disabled={submitting}>
              キャンセル
            </Button>
          </DialogClose>
          <Button type="button" onClick={handleConfirm} disabled={!selectedSlot || submitting}>
            {submitting ? "送信中..." : "リスケを確定"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
