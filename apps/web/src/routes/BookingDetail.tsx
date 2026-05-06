import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { auth } from "@/auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardBody,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ApiError, api } from "@/lib/api";
import { formatLocalDate, formatLocalTime } from "@/lib/local-date";
import type { BookingSummary } from "@/lib/types";
import { colors, space } from "@/styles/tokens.stylex";

const styles = stylex.create({
  page: { display: "flex", flexDirection: "column", gap: space.lg, maxWidth: "40rem" },
  back: { fontSize: "0.875rem", color: colors.muted, textDecoration: "none" },
  heading: { fontSize: "1.5rem", fontWeight: 600, margin: 0 },
  field: { display: "flex", flexDirection: "column", gap: space.xs },
  label: { fontSize: "0.75rem", color: colors.muted, textTransform: "uppercase" },
  value: { fontSize: "1rem" },
  meet: { fontFamily: "monospace", wordBreak: "break-all" },
  error: { color: colors.destructive, fontSize: "0.875rem" },
});

function browserTz(): string {
  if (typeof Intl === "undefined") return "Asia/Tokyo";
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

type LoadState =
  | { status: "loading" }
  | { status: "ok"; booking: BookingSummary }
  | { status: "not_found" }
  | { status: "error"; message: string };

export default function BookingDetail() {
  const { getToken } = auth.useAuth();
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [canceling, setCanceling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const tz = browserTz();

  const load = useCallback(async () => {
    if (!id) {
      setState({ status: "not_found" });
      return;
    }
    setState({ status: "loading" });
    try {
      // ISH-254: dedicated endpoint replaces the previous list+filter approach.
      const { booking } = await api.getBooking(id, () => getToken());
      setState({ status: "ok", booking });
    } catch (err) {
      // 404 (missing or foreign booking) → dedicated empty state. Other errors
      // bubble into the generic error view.
      if (err instanceof ApiError && err.status === 404) {
        setState({ status: "not_found" });
        return;
      }
      const message = err instanceof ApiError ? `${err.status} ${err.code}` : "failed to load";
      setState({ status: "error", message });
    }
  }, [getToken, id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status === "loading") return <p>読み込み中...</p>;
  if (state.status === "not_found") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>予約が見つかりません</CardTitle>
          <CardDescription>この予約は削除されたか、別のオーナーのものです。</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild variant="outline">
            <Link to="/confirmed-list">一覧に戻る</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }
  if (state.status === "error") {
    return <p {...stylex.props(styles.error)}>{state.message}</p>;
  }

  const b = state.booking;
  const isFuture = Date.parse(b.startAt) >= Date.now();
  const cancelable = b.status === "confirmed" && isFuture;

  const onCancel = async () => {
    if (
      !confirm("この予約をキャンセルします。よろしいですか？\nゲストにもキャンセル通知が届きます。")
    )
      return;
    setCancelError(null);
    setCanceling(true);
    try {
      await api.cancelBooking(b.id, () => getToken());
      await load();
    } catch (err) {
      setCancelError(err instanceof ApiError ? `${err.status} ${err.code}` : "失敗しました");
    } finally {
      setCanceling(false);
    }
  };

  return (
    <div {...stylex.props(styles.page)}>
      <Link to="/confirmed-list" {...stylex.props(styles.back)}>
        ← 予約一覧
      </Link>
      <h1 {...stylex.props(styles.heading)}>{b.linkTitle}</h1>

      <Card>
        <CardHeader>
          <CardTitle>予約詳細</CardTitle>
          <CardDescription>
            ステータス: {b.status === "confirmed" ? "確定" : "キャンセル済"}
          </CardDescription>
        </CardHeader>
        <CardBody>
          <div {...stylex.props(styles.field)}>
            <span {...stylex.props(styles.label)}>日時</span>
            <span {...stylex.props(styles.value)}>
              {formatLocalDate(b.startAt, tz)} {formatLocalTime(b.startAt, tz)} –{" "}
              {formatLocalTime(b.endAt, tz)} ({tz})
            </span>
          </div>
          <div {...stylex.props(styles.field)}>
            <span {...stylex.props(styles.label)}>ゲスト</span>
            <span {...stylex.props(styles.value)}>
              {b.guestName} &lt;{b.guestEmail}&gt;
            </span>
          </div>
          {b.meetUrl && (
            <div {...stylex.props(styles.field)}>
              <span {...stylex.props(styles.label)}>Google Meet</span>
              <a href={b.meetUrl} target="_blank" rel="noreferrer" {...stylex.props(styles.meet)}>
                {b.meetUrl}
              </a>
            </div>
          )}
          {b.canceledAt && (
            <div {...stylex.props(styles.field)}>
              <span {...stylex.props(styles.label)}>キャンセル日時</span>
              <span {...stylex.props(styles.value)}>
                {formatLocalDate(b.canceledAt, tz)} {formatLocalTime(b.canceledAt, tz)}
              </span>
            </div>
          )}
          {cancelError && <p {...stylex.props(styles.error)}>{cancelError}</p>}
        </CardBody>
        {cancelable && (
          <CardFooter>
            <Button variant="destructive" onClick={onCancel} disabled={canceling}>
              {canceling ? "キャンセル中..." : "予約をキャンセル"}
            </Button>
          </CardFooter>
        )}
      </Card>
    </div>
  );
}
