import * as stylex from "@stylexjs/stylex";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buildMonthGrid, formatLocalDate, formatLocalTime } from "@/lib/local-date";
import {
  type ConfirmedBooking,
  fetchPublicLink,
  fetchPublicSlots,
  PublicApiError,
  type PublicLink as PublicLinkData,
  type PublicSlot,
  postPublicBooking,
} from "@/lib/public-api";
import { colors, space } from "@/styles/tokens.stylex";

type Step =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "error"; message: string }
  | { kind: "calendar" }
  | { kind: "form" }
  | { kind: "confirmed"; booking: ConfirmedBooking };

const styles = stylex.create({
  page: { display: "flex", flexDirection: "column", gap: space.lg },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    flexWrap: "wrap",
    gap: space.sm,
  },
  title: { fontSize: "1.75rem", fontWeight: 700, margin: 0 },
  subtitle: { color: colors.muted, margin: 0 },
  tz: { fontSize: "0.875rem", color: colors.muted },
  twoCol: { display: "grid", gridTemplateColumns: "1fr 16rem", gap: space.lg, alignItems: "start" },
  monthHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: space.sm,
  },
  grid: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "0.25rem" },
  dow: { textAlign: "center", fontSize: "0.75rem", color: colors.muted, padding: "0.25rem" },
  cell: {
    aspectRatio: "1 / 1",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: `1px solid ${colors.border}`,
    borderRadius: "0.375rem",
    fontSize: "0.875rem",
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
  cellAvailable: { borderColor: colors.primary, fontWeight: 600 },
  cellSelected: {
    backgroundColor: colors.primary,
    color: colors.primaryFg,
    borderColor: colors.primary,
  },
  slotList: {
    display: "flex",
    flexDirection: "column",
    gap: "0.375rem",
    maxHeight: "30rem",
    overflowY: "auto",
  },
  slotBtn: {
    border: `1px solid ${colors.border}`,
    borderRadius: "0.375rem",
    padding: "0.5rem 0.75rem",
    fontSize: "0.875rem",
    background: { default: colors.bg, ":hover": colors.accent },
    color: colors.fg,
    cursor: "pointer",
    textAlign: "left",
  },
  field: { display: "flex", flexDirection: "column", gap: space.xs },
  actions: { display: "flex", gap: space.sm, justifyContent: "flex-end" },
  error: { color: colors.destructive, fontSize: "0.875rem" },
  success: {
    border: `1px solid ${colors.primary}`,
    borderRadius: "0.5rem",
    padding: space.lg,
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
  },
  meet: { fontFamily: "monospace", wordBreak: "break-all" },
});

const DOW_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

function browserTimeZone(): string {
  if (typeof Intl === "undefined") return "Asia/Tokyo";
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export default function PublicLink() {
  const { slug = "" } = useParams<{ slug: string }>();
  const [step, setStep] = useState<Step>({ kind: "loading" });
  const [link, setLink] = useState<PublicLinkData | null>(null);
  const [tz, setTz] = useState<string>(browserTimeZone());
  const today = new Date();
  const [month, setMonth] = useState<{ year: number; month: number }>({
    year: today.getFullYear(),
    month: today.getMonth() + 1,
  });
  const [slots, setSlots] = useState<PublicSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<PublicSlot | null>(null);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestNote, setGuestNote] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 1) Fetch link metadata
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchPublicLink(slug);
        if (cancelled) return;
        setLink(data);
        setStep({ kind: "calendar" });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof PublicApiError && err.status === 404) {
          setStep({ kind: "not_found" });
        } else {
          setStep({ kind: "error", message: err instanceof Error ? err.message : "failed" });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // 2) Fetch slots for the visible month whenever month or tz changes
  useEffect(() => {
    if (!link) return;
    let cancelled = false;
    setSlotsLoading(true);
    void (async () => {
      const fromIso = new Date(month.year, month.month - 1, 1).toISOString();
      const toIso = new Date(month.year, month.month, 1).toISOString();
      try {
        const res = await fetchPublicSlots(slug, fromIso, toIso);
        if (cancelled) return;
        setSlots(res.slots);
      } catch {
        if (cancelled) return;
        setSlots([]);
      } finally {
        if (!cancelled) setSlotsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [link, slug, month]);

  const slotsByDate = useMemo(() => {
    const map = new Map<string, PublicSlot[]>();
    for (const s of slots) {
      const key = formatLocalDate(s.start, tz);
      const arr = map.get(key) ?? [];
      arr.push(s);
      map.set(key, arr);
    }
    return map;
  }, [slots, tz]);

  const grid = useMemo(() => buildMonthGrid(month.year, month.month), [month]);

  const slotsForSelected = selectedDate ? (slotsByDate.get(selectedDate) ?? []) : [];

  if (step.kind === "loading") {
    return <p>読み込み中...</p>;
  }

  if (step.kind === "not_found") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>リンクが見つかりません</CardTitle>
          <CardDescription>このURLは存在しないか、現在公開されていません。</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (step.kind === "error") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>読み込みに失敗しました</CardTitle>
          <CardDescription>{step.message}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (step.kind === "confirmed") {
    const start = new Date(step.booking.startAt);
    return (
      <div {...stylex.props(styles.page)}>
        <h1 {...stylex.props(styles.title)}>予約が確定しました</h1>
        <div {...stylex.props(styles.success)}>
          <p>
            <strong>{link?.title}</strong>
          </p>
          <p>
            {formatLocalDate(start, tz)} {formatLocalTime(start, tz)} ({tz})
          </p>
          {step.booking.meetUrl && (
            <p>
              Google Meet:{" "}
              <a
                href={step.booking.meetUrl}
                target="_blank"
                rel="noreferrer"
                {...stylex.props(styles.meet)}
              >
                {step.booking.meetUrl}
              </a>
            </p>
          )}
          <p {...stylex.props(styles.tz)}>
            キャンセルする場合: <code>/cancel/{step.booking.cancellationToken}</code>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.header)}>
        <div>
          <h1 {...stylex.props(styles.title)}>{link?.title}</h1>
          {link?.description && <p {...stylex.props(styles.subtitle)}>{link.description}</p>}
          <p {...stylex.props(styles.subtitle)}>
            {link?.durationMinutes} 分 · {tz}
          </p>
        </div>
        <div {...stylex.props(styles.field)} style={{ minWidth: "12rem" }}>
          <Label htmlFor="tz-select">タイムゾーン</Label>
          <Input id="tz-select" value={tz} onChange={(e) => setTz(e.target.value)} />
        </div>
      </div>

      {step.kind === "calendar" && (
        <div {...stylex.props(styles.twoCol)}>
          <Card>
            <CardHeader>
              <div {...stylex.props(styles.monthHeader)}>
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() =>
                    setMonth(({ year, month }) => ({
                      year: month === 1 ? year - 1 : year,
                      month: month === 1 ? 12 : month - 1,
                    }))
                  }
                >
                  ‹
                </Button>
                <CardTitle>
                  {month.year}年{month.month}月
                </CardTitle>
                <Button
                  variant="ghost"
                  type="button"
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
            </CardHeader>
            <CardBody>
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
              {slotsLoading && <p {...stylex.props(styles.tz)}>空き時間を取得中...</p>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{selectedDate ?? "日付を選択"}</CardTitle>
              <CardDescription>
                {selectedDate
                  ? `${slotsForSelected.length} 件の空き時間`
                  : "左のカレンダーから日付を選んでください。"}
              </CardDescription>
            </CardHeader>
            <CardBody>
              <div {...stylex.props(styles.slotList)}>
                {slotsForSelected.map((slot) => (
                  <button
                    type="button"
                    key={slot.start}
                    {...stylex.props(styles.slotBtn)}
                    onClick={() => {
                      setSelectedSlot(slot);
                      setStep({ kind: "form" });
                    }}
                  >
                    {formatLocalTime(slot.start, tz)} – {formatLocalTime(slot.end, tz)}
                  </button>
                ))}
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      {step.kind === "form" && selectedSlot && (
        <Card>
          <CardHeader>
            <CardTitle>あなたの情報</CardTitle>
            <CardDescription>
              {formatLocalDate(selectedSlot.start, tz)} {formatLocalTime(selectedSlot.start, tz)} –{" "}
              {formatLocalTime(selectedSlot.end, tz)} ({tz})
            </CardDescription>
          </CardHeader>
          <CardBody>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setSubmitError(null);
                setSubmitting(true);
                try {
                  const booking = await postPublicBooking(slug, {
                    startAt: selectedSlot.start,
                    guestName,
                    guestEmail,
                    guestNote: guestNote || undefined,
                    guestTimeZone: tz,
                  });
                  setStep({ kind: "confirmed", booking });
                } catch (err) {
                  if (err instanceof PublicApiError) {
                    if (err.status === 409) {
                      setSubmitError(
                        "この時間枠は別の方が予約済みです。別の時間を選んでください。",
                      );
                    } else if (err.status === 410) {
                      setSubmitError(
                        "この時間枠は受け付け終了になりました。別の時間を選んでください。",
                      );
                    } else {
                      setSubmitError(`送信に失敗しました（${err.code}）`);
                    }
                  } else {
                    setSubmitError("送信に失敗しました");
                  }
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              <div {...stylex.props(styles.field)}>
                <Label htmlFor="guest-name">お名前</Label>
                <Input
                  id="guest-name"
                  required
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                />
              </div>
              <div {...stylex.props(styles.field)}>
                <Label htmlFor="guest-email">メールアドレス</Label>
                <Input
                  id="guest-email"
                  type="email"
                  required
                  value={guestEmail}
                  onChange={(e) => setGuestEmail(e.target.value)}
                />
              </div>
              <div {...stylex.props(styles.field)}>
                <Label htmlFor="guest-note">メモ（任意）</Label>
                <Input
                  id="guest-note"
                  value={guestNote}
                  onChange={(e) => setGuestNote(e.target.value)}
                />
              </div>
              {submitError && <p {...stylex.props(styles.error)}>{submitError}</p>}
              <div {...stylex.props(styles.actions)}>
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => setStep({ kind: "calendar" })}
                >
                  戻る
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "送信中..." : "予約を確定"}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
