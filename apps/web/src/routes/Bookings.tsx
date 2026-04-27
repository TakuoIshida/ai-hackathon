import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { auth } from "@/auth";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, api } from "@/lib/api";
import { formatLocalDate, formatLocalTime } from "@/lib/local-date";
import type { BookingSummary } from "@/lib/types";
import { colors, space } from "@/styles/tokens.stylex";

const styles = stylex.create({
  page: { display: "flex", flexDirection: "column", gap: space.lg },
  heading: { fontSize: "1.5rem", fontWeight: 600, margin: 0 },
  tabs: { display: "flex", gap: space.sm },
  list: { display: "flex", flexDirection: "column", gap: space.sm },
  row: {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    gap: space.md,
    alignItems: "center",
    padding: space.md,
    border: `1px solid ${colors.border}`,
    borderRadius: "0.5rem",
    backgroundColor: colors.bg,
  },
  rowCanceled: { opacity: 0.6 },
  meta: { display: "flex", flexDirection: "column", gap: space.xs },
  title: { fontWeight: 600 },
  caption: { fontSize: "0.875rem", color: colors.muted },
  badge: {
    fontSize: "0.75rem",
    padding: "0.125rem 0.5rem",
    borderRadius: "999px",
    backgroundColor: colors.accent,
    color: colors.accentFg,
    marginLeft: space.xs,
  },
  badgeCanceled: { backgroundColor: colors.destructive, color: colors.destructiveFg },
  empty: { textAlign: "center", padding: space.xl, color: colors.muted },
  error: { color: colors.destructive, fontSize: "0.875rem" },
});

type Tab = "upcoming" | "past";

type LoadState =
  | { status: "loading" }
  | { status: "ok"; bookings: BookingSummary[] }
  | { status: "error"; message: string };

function browserTz(): string {
  if (typeof Intl === "undefined") return "Asia/Tokyo";
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export default function Bookings() {
  const { getToken } = auth.useAuth();
  const [tab, setTab] = useState<Tab>("upcoming");
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const tz = browserTz();

  const reload = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const { bookings } = await api.listBookings(() => getToken());
      setState({ status: "ok", bookings });
    } catch (err) {
      const message = err instanceof ApiError ? `${err.status} ${err.code}` : "failed to load";
      setState({ status: "error", message });
    }
  }, [getToken]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const filtered = useMemo(() => {
    if (state.status !== "ok") return [];
    const now = Date.now();
    return state.bookings.filter((b) => {
      const isFuture = Date.parse(b.startAt) >= now && b.status === "confirmed";
      return tab === "upcoming" ? isFuture : !isFuture;
    });
  }, [state, tab]);

  return (
    <div {...stylex.props(styles.page)}>
      <h1 {...stylex.props(styles.heading)}>予約</h1>

      <div {...stylex.props(styles.tabs)}>
        <Button
          variant={tab === "upcoming" ? "default" : "outline"}
          onClick={() => setTab("upcoming")}
        >
          未来
        </Button>
        <Button variant={tab === "past" ? "default" : "outline"} onClick={() => setTab("past")}>
          過去・キャンセル済
        </Button>
      </div>

      {state.status === "loading" && <p {...stylex.props(styles.empty)}>読み込み中...</p>}

      {state.status === "error" && (
        <Card>
          <CardHeader>
            <CardTitle>読み込みに失敗しました</CardTitle>
            <CardDescription>API への接続を確認してください。</CardDescription>
          </CardHeader>
          <CardBody>
            <p {...stylex.props(styles.error)}>{state.message}</p>
            <Button variant="outline" onClick={reload}>
              再試行
            </Button>
          </CardBody>
        </Card>
      )}

      {state.status === "ok" && filtered.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              {tab === "upcoming" ? "未来の予約はありません" : "過去の予約はありません"}
            </CardTitle>
            <CardDescription>リンクを公開してゲストからの予約を受け付けましょう。</CardDescription>
          </CardHeader>
        </Card>
      )}

      {state.status === "ok" && filtered.length > 0 && (
        <div {...stylex.props(styles.list)}>
          {filtered.map((b) => (
            <BookingRow key={b.id} booking={b} tz={tz} />
          ))}
        </div>
      )}
    </div>
  );
}

function BookingRow({ booking, tz }: { booking: BookingSummary; tz: string }) {
  const start = booking.startAt;
  return (
    <div {...stylex.props(styles.row, booking.status === "canceled" && styles.rowCanceled)}>
      <div {...stylex.props(styles.meta)}>
        <span {...stylex.props(styles.title)}>
          {booking.linkTitle}
          {booking.status === "canceled" && (
            <span {...stylex.props(styles.badge, styles.badgeCanceled)}>キャンセル済</span>
          )}
        </span>
        <span {...stylex.props(styles.caption)}>
          {formatLocalDate(start, tz)} {formatLocalTime(start, tz)} –{" "}
          {formatLocalTime(booking.endAt, tz)} ({tz})
        </span>
        <span {...stylex.props(styles.caption)}>
          {booking.guestName} &lt;{booking.guestEmail}&gt;
        </span>
      </div>
      <Button asChild variant="outline" size="sm">
        <Link to={`/dashboard/bookings/${booking.id}`}>詳細</Link>
      </Button>
    </div>
  );
}
