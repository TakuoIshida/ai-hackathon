import * as stylex from "@stylexjs/stylex";
import {
  ArrowLeft,
  Calendar as CalendarIcon,
  Clock,
  ExternalLink,
  Link2,
  Mail,
  User,
  Users as UsersIcon,
  Video,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { auth } from "@/auth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardBody,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ApiError, api } from "@/lib/api";
import { formatLocalDate, formatLocalTime } from "@/lib/local-date";
import type { BookingSummary } from "@/lib/types";
import { colors, radius, space, typography } from "@/styles/tokens.stylex";

/**
 * 〔予約調整〕詳細 page (ISH-248).
 *
 * SPIR design に揃えた Card section 構成:
 *  1. 基本情報 (日時 / 所要時間 / リンク)
 *  2. 主催者 (host avatar + name + email)
 *  3. 参加者 (guest avatar + name + email + メール link)
 *  4. 会議情報 (Meet URL + Calendar deeplink)
 *  5. アクション Footer (キャンセル / リスケ placeholder)
 *
 * `canceledAt` がある場合は上部に rose tone banner を出し、Footer は非表示。
 *
 * ISH-267: 主催者 Card は BE が返す `hostName` / `hostEmail` を使う
 * (denormalized bookings.host_user_id → common.users JOIN)。BookingSummary
 * の hostUserId / hostName / hostEmail を直接 render する。
 */

const styles = stylex.create({
  page: { display: "flex", flexDirection: "column", gap: space.lg, maxWidth: "48rem" },
  back: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    fontSize: typography.fontSizeSm,
    color: colors.ink500,
    textDecoration: "none",
    width: "fit-content",
  },
  pageHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: space.md,
  },
  headingGroup: { display: "flex", flexDirection: "column", gap: "0.25rem" },
  headingRow: { display: "flex", alignItems: "center", gap: space.sm },
  heading: {
    fontSize: typography.fontSize2xl,
    fontWeight: typography.fontWeightBold,
    color: colors.blue900,
    margin: 0,
  },
  sub: { fontSize: typography.fontSizeSm, color: colors.ink500, margin: 0 },
  // Cancel banner (rose tone)
  cancelBanner: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    paddingBlock: space.sm,
    paddingInline: space.md,
    backgroundColor: colors.rose100,
    color: colors.rose500,
    borderRadius: radius.md,
    border: `1px solid ${colors.rose500}`,
    fontSize: typography.fontSizeSm,
    fontWeight: typography.fontWeightMedium,
  },
  // generic field row
  fieldList: { display: "flex", flexDirection: "column", gap: space.md },
  fieldRow: { display: "flex", alignItems: "flex-start", gap: space.sm },
  fieldIcon: {
    color: colors.ink400,
    flexShrink: 0,
    marginTop: "0.125rem",
  },
  fieldLabel: { fontSize: typography.fontSizeXs, color: colors.ink500, marginBottom: "0.125rem" },
  fieldValue: { fontSize: typography.fontSizeSm, color: colors.ink900 },
  fieldValueStrong: {
    fontSize: typography.fontSizeSm,
    color: colors.blue900,
    fontWeight: typography.fontWeightMedium,
  },
  inlineLink: {
    color: colors.blue600,
    textDecoration: "none",
    fontSize: typography.fontSizeSm,
  },
  // person row (host / guest)
  personRow: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
  },
  personMeta: { display: "flex", flexDirection: "column", gap: "0.125rem" },
  personName: {
    fontSize: typography.fontSizeMd,
    fontWeight: typography.fontWeightBold,
    color: colors.blue900,
  },
  personEmail: { fontSize: typography.fontSizeXs, color: colors.ink500 },
  personActions: { marginInlineStart: "auto" },
  // Meet
  meetUrl: {
    fontFamily: typography.fontFamilyMono,
    fontSize: typography.fontSizeXs,
    wordBreak: "break-all",
    color: colors.ink700,
  },
  meetActions: { display: "flex", gap: space.sm, flexWrap: "wrap" },
  error: { color: colors.destructive, fontSize: typography.fontSizeSm, margin: 0 },
});

function browserTz(): string {
  if (typeof Intl === "undefined") return "Asia/Tokyo";
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function formatDuration(startAt: string, endAt: string): string {
  const ms = Date.parse(endAt) - Date.parse(startAt);
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const totalMin = Math.round(ms / 60000);
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  if (hours === 0) return `${minutes} 分`;
  if (minutes === 0) return `${hours} 時間`;
  return `${hours} 時間 ${minutes} 分`;
}

/**
 * Build a Google Calendar event-create deeplink. Best-effort — if the user
 * isn't signed into the matching Google account it'll just open the new event
 * dialog with the title prefilled. The booking already lives in their calendar
 * via Meet sync, so this is purely a convenience deep link.
 *
 * `dates` format: `YYYYMMDDTHHMMSSZ/YYYYMMDDTHHMMSSZ` (UTC, no separators).
 */
function googleCalendarDeeplink(b: BookingSummary): string {
  const fmt = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return (
      `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
      `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
    );
  };
  const dates = `${fmt(b.startAt)}/${fmt(b.endAt)}`;
  const params = new URLSearchParams({
    text: b.linkTitle,
    dates,
  });
  return `https://calendar.google.com/calendar/r/eventedit?${params.toString()}`;
}

function initial(name: string, fallback: string): string {
  const source = name.trim() || fallback;
  return source.charAt(0).toUpperCase();
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
  const isCanceled = b.status === "canceled";

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
        <ArrowLeft size={14} />
        予約一覧
      </Link>

      <header {...stylex.props(styles.pageHeader)}>
        <div {...stylex.props(styles.headingGroup)}>
          <div {...stylex.props(styles.headingRow)}>
            <h1 {...stylex.props(styles.heading)}>{b.linkTitle}</h1>
            <Badge variant={isCanceled ? "destructive" : "success"}>
              {isCanceled ? "キャンセル済" : "確定"}
            </Badge>
          </div>
          <p {...stylex.props(styles.sub)}>
            {formatLocalDate(b.startAt, tz)} {formatLocalTime(b.startAt, tz)}–
            {formatLocalTime(b.endAt, tz)}
          </p>
        </div>
      </header>

      {isCanceled && b.canceledAt && (
        <div {...stylex.props(styles.cancelBanner)} role="status">
          <XCircle size={16} aria-hidden />
          キャンセル済 · {formatLocalDate(b.canceledAt, tz)} {formatLocalTime(b.canceledAt, tz)}
        </div>
      )}

      {/* 1. 基本情報 */}
      <Card>
        <CardHeader>
          <CardTitle>基本情報</CardTitle>
        </CardHeader>
        <CardBody>
          <div {...stylex.props(styles.fieldList)}>
            <div {...stylex.props(styles.fieldRow)}>
              <span {...stylex.props(styles.fieldIcon)}>
                <CalendarIcon size={16} />
              </span>
              <div>
                <div {...stylex.props(styles.fieldLabel)}>日時</div>
                <div {...stylex.props(styles.fieldValueStrong)}>
                  {formatLocalDate(b.startAt, tz)} {formatLocalTime(b.startAt, tz)} –{" "}
                  {formatLocalTime(b.endAt, tz)} ({tz})
                </div>
              </div>
            </div>
            <div {...stylex.props(styles.fieldRow)}>
              <span {...stylex.props(styles.fieldIcon)}>
                <Clock size={16} />
              </span>
              <div>
                <div {...stylex.props(styles.fieldLabel)}>所要時間</div>
                <div {...stylex.props(styles.fieldValue)}>{formatDuration(b.startAt, b.endAt)}</div>
              </div>
            </div>
            <div {...stylex.props(styles.fieldRow)}>
              <span {...stylex.props(styles.fieldIcon)}>
                <Link2 size={16} />
              </span>
              <div>
                <div {...stylex.props(styles.fieldLabel)}>リンク</div>
                <div {...stylex.props(styles.fieldValue)}>
                  {b.linkId ? (
                    <Link
                      to={`/availability-sharings/${b.linkId}/edit`}
                      {...stylex.props(styles.inlineLink)}
                    >
                      {b.linkTitle}
                      {b.linkSlug ? ` (/${b.linkSlug})` : null}
                    </Link>
                  ) : (
                    b.linkTitle
                  )}
                </div>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* 2. 主催者 */}
      <Card>
        <CardHeader>
          <CardTitle>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
              <User size={16} aria-hidden />
              主催者
            </span>
          </CardTitle>
        </CardHeader>
        <CardBody>
          <div {...stylex.props(styles.personRow)}>
            <Avatar size="lg">
              <AvatarFallback>{initial(b.hostName, b.hostEmail)}</AvatarFallback>
            </Avatar>
            <div {...stylex.props(styles.personMeta)}>
              <span {...stylex.props(styles.personName)}>{b.hostName}</span>
              <span {...stylex.props(styles.personEmail)}>{b.hostEmail}</span>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* 3. 参加者 */}
      <Card>
        <CardHeader>
          <CardTitle>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
              <UsersIcon size={16} aria-hidden />
              参加者
            </span>
          </CardTitle>
        </CardHeader>
        <CardBody>
          <div {...stylex.props(styles.personRow)}>
            <Avatar size="lg">
              <AvatarFallback>{initial(b.guestName, b.guestEmail)}</AvatarFallback>
            </Avatar>
            <div {...stylex.props(styles.personMeta)}>
              <span {...stylex.props(styles.personName)}>{b.guestName}</span>
              <span {...stylex.props(styles.personEmail)}>{b.guestEmail}</span>
            </div>
            <div {...stylex.props(styles.personActions)}>
              <Button asChild variant="outline" size="sm" leftIcon={<Mail size={14} />}>
                <a href={`mailto:${b.guestEmail}`}>メールでメッセージ</a>
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* 4. 会議情報 */}
      <Card>
        <CardHeader>
          <CardTitle>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
              <Video size={16} aria-hidden />
              会議情報
            </span>
          </CardTitle>
        </CardHeader>
        <CardBody>
          {b.meetUrl ? (
            <div {...stylex.props(styles.fieldList)}>
              <div>
                <div {...stylex.props(styles.fieldLabel)}>Google Meet</div>
                <a
                  href={b.meetUrl}
                  target="_blank"
                  rel="noreferrer"
                  {...stylex.props(styles.meetUrl)}
                >
                  {b.meetUrl}
                </a>
              </div>
              <div {...stylex.props(styles.meetActions)}>
                <Button asChild leftIcon={<Video size={14} />}>
                  <a href={b.meetUrl} target="_blank" rel="noreferrer">
                    Meet を開く
                  </a>
                </Button>
                <Button asChild variant="outline" leftIcon={<ExternalLink size={14} />}>
                  <a href={googleCalendarDeeplink(b)} target="_blank" rel="noreferrer">
                    Google Calendar で開く
                  </a>
                </Button>
              </div>
            </div>
          ) : (
            <p {...stylex.props(styles.fieldValue)}>会議 URL は発行されていません。</p>
          )}
        </CardBody>
      </Card>

      {cancelError && <p {...stylex.props(styles.error)}>{cancelError}</p>}

      {/* 5. アクション Footer — キャンセル可能なときのみ */}
      {cancelable && (
        <Card>
          <CardFooter>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* span ラッパで disabled button にも tooltip を出せる */}
                  <span style={{ display: "inline-block" }}>
                    <Button variant="outline" disabled>
                      リスケ
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>近日対応</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Button variant="destructive" onClick={onCancel} disabled={canceling}>
              {canceling ? "キャンセル中..." : "予約をキャンセル"}
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}
