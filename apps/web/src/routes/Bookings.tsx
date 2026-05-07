import * as stylex from "@stylexjs/stylex";
import { CalendarCheck, CalendarX, Clock, Download } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { auth } from "@/auth";
import type { AvatarStackMember } from "@/components/ui/avatar-stack";
import { AvatarStack } from "@/components/ui/avatar-stack";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, api } from "@/lib/api";
import { formatLocalDate, formatLocalTime } from "@/lib/local-date";
import type { BookingSummary } from "@/lib/types";
import { colors, radius, space, typography } from "@/styles/tokens.stylex";

// ---------------------------------------------------------------------------
// 〔予約調整〕一覧 page (ISH-246 / B-04)
//
// Spir 系 design に揃えた構成: H1 + sub + 右肩 CSV エクスポート → Stats row 3
// 枚 (mint / blue / rose) → 3-state Tabs (今後の予定 / 過去 / キャンセル済) →
// grid-based table (Settings.tsx の MembersTab pattern 踏襲)。
//
// 検索 / filter / pagination / 詳細 page はこの issue では実装しない。
// ---------------------------------------------------------------------------

const styles = stylex.create({
  page: {
    display: "flex",
    flexDirection: "column",
    gap: space.lg,
    fontFamily: typography.fontFamilySans,
  },
  // page header
  pageHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: space.md,
  },
  headingGroup: { display: "flex", flexDirection: "column", gap: "0.25rem" },
  heading: {
    fontSize: typography.fontSize2xl,
    fontWeight: typography.fontWeightBold,
    color: colors.blue900,
    margin: 0,
    lineHeight: typography.lineHeightTight,
  },
  sub: { fontSize: typography.fontSizeSm, color: colors.ink500, margin: 0 },
  // stats
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: space.md,
    "@media (max-width: 768px)": {
      gridTemplateColumns: "1fr",
    },
  },
  // tabs (use the in-page Tabs primitive)
  tabs: { width: "100%" },
  panel: { paddingBlock: space.lg, display: "flex", flexDirection: "column", gap: space.md },
  // table — grid-based, Settings.tsx MembersTab pattern を踏襲
  tableCard: {
    padding: 0,
    overflow: "hidden",
    borderColor: colors.ink200,
  },
  tableHeader: {
    display: "grid",
    gridTemplateColumns: "16rem 1fr 12rem 8rem 7rem 5rem",
    paddingBlock: "0.625rem",
    paddingInline: space.md,
    backgroundColor: colors.bgSoft,
    borderBottom: `1px solid ${colors.ink200}`,
    fontSize: typography.fontSizeXs,
    fontWeight: typography.fontWeightBold,
    color: colors.ink500,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  tableRow: {
    display: "grid",
    gridTemplateColumns: "16rem 1fr 12rem 8rem 7rem 5rem",
    paddingBlock: "0.875rem",
    paddingInline: space.md,
    alignItems: "center",
    borderTop: `1px solid ${colors.ink100}`,
    backgroundColor: colors.bg,
  },
  rowCanceled: { opacity: 0.6 },
  // 日時 col
  dateCol: { display: "flex", flexDirection: "column", gap: "0.125rem" },
  dateMain: {
    fontSize: typography.fontSizeSm,
    fontWeight: typography.fontWeightBold,
    color: colors.blue900,
  },
  dateSub: { fontSize: typography.fontSizeXs, color: colors.ink500 },
  // タイトル col
  titleCol: { display: "flex", flexDirection: "column", gap: "0.125rem", minWidth: 0 },
  titleMain: {
    fontSize: typography.fontSizeSm,
    fontWeight: typography.fontWeightBold,
    color: colors.blue900,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  titleSub: { fontSize: typography.fontSizeXs, color: colors.ink500 },
  // 主催者 col
  hostCol: { display: "flex", alignItems: "center", gap: "0.5rem" },
  hostAvatar: {
    width: "1.875rem",
    height: "1.875rem",
    borderRadius: radius.full,
    color: colors.bg,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.75rem",
    fontWeight: typography.fontWeightBold,
    flexShrink: 0,
  },
  hostName: {
    fontSize: typography.fontSizeSm,
    color: colors.ink700,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  // ステータス badge — Settings.tsx の roleBadgeOwner / Admin pattern を流用
  badgeConfirmed: {
    display: "inline-flex",
    alignItems: "center",
    paddingInline: "0.5rem",
    paddingBlock: "0.125rem",
    fontSize: typography.fontSizeXs,
    fontWeight: typography.fontWeightBold,
    borderRadius: radius.full,
    backgroundColor: colors.mint100,
    color: colors.mint500,
  },
  badgeCanceled: {
    display: "inline-flex",
    alignItems: "center",
    paddingInline: "0.5rem",
    paddingBlock: "0.125rem",
    fontSize: typography.fontSizeXs,
    fontWeight: typography.fontWeightBold,
    borderRadius: radius.full,
    backgroundColor: colors.rose100,
    color: colors.rose500,
  },
  rowActions: { display: "flex", justifyContent: "flex-end" },
  // states
  errorMsg: { color: colors.destructive, fontSize: typography.fontSizeSm, margin: 0 },
  empty: {
    padding: "2rem",
    textAlign: "center",
    color: colors.ink500,
    fontSize: typography.fontSizeSm,
  },
});

type Tab = "upcoming" | "past" | "canceled";

type LoadState =
  | { status: "loading" }
  | { status: "ok"; bookings: BookingSummary[] }
  | { status: "error"; message: string };

function browserTz(): string {
  if (typeof Intl === "undefined") return "Asia/Tokyo";
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// Stable color palette for guest avatars (Links 一覧 / Settings.tsx と同じ手法)。
const GUEST_PALETTE: ReadonlyArray<string> = [
  "#4FB287",
  "#4F92BE",
  "#8B7AB8",
  "#D9A040",
  "#D9695F",
];

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h;
}

function guestColor(seed: string): string {
  const idx = hashSeed(seed) % GUEST_PALETTE.length;
  const c = GUEST_PALETTE[idx];
  if (!c) throw new Error("unreachable: GUEST_PALETTE has stable length");
  return c;
}

function initial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return Array.from(trimmed)[0]?.toUpperCase() ?? "?";
}

function isCurrentMonth(iso: string, now: Date): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
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

  // Stats — 3 値: 今後の予定 / 今月の確定 / キャンセル (今月)。
  // BookingSummary に createdAt はあるので「今月の確定」は createdAt 当月で集計
  // し、キャンセルは startAt で当月扱い (canceledAt は status filter のため使用)。
  const stats = useMemo(() => {
    if (state.status !== "ok") return { upcoming: 0, thisMonthConfirmed: 0, canceled: 0 };
    const now = new Date();
    const nowMs = now.getTime();
    let upcoming = 0;
    let thisMonthConfirmed = 0;
    let canceled = 0;
    for (const b of state.bookings) {
      if (b.status === "confirmed" && Date.parse(b.startAt) >= nowMs) upcoming += 1;
      if (b.status === "confirmed" && isCurrentMonth(b.createdAt, now)) thisMonthConfirmed += 1;
      if (b.status === "canceled" && isCurrentMonth(b.startAt, now)) canceled += 1;
    }
    return { upcoming, thisMonthConfirmed, canceled };
  }, [state]);

  const filtered = useMemo(() => {
    if (state.status !== "ok") return [];
    const now = Date.now();
    return state.bookings.filter((b) => {
      if (tab === "canceled") return b.status === "canceled";
      const isFuture = Date.parse(b.startAt) >= now && b.status === "confirmed";
      if (tab === "upcoming") return isFuture;
      // past: confirmed but already started OR not future and not canceled
      return b.status === "confirmed" && Date.parse(b.startAt) < now;
    });
  }, [state, tab]);

  return (
    <div {...stylex.props(styles.page)}>
      <header {...stylex.props(styles.pageHeader)}>
        <div {...stylex.props(styles.headingGroup)}>
          <h1 {...stylex.props(styles.heading)}>確定済の予定</h1>
          <p {...stylex.props(styles.sub)}>確定した予約を一覧で確認できます</p>
        </div>
        <Button variant="outline" leftIcon={<Download size={15} />} disabled>
          CSV エクスポート
        </Button>
      </header>

      <div {...stylex.props(styles.statsGrid)}>
        <StatCard
          label="今後の予定"
          value={stats.upcoming}
          icon={<CalendarCheck size={18} />}
          tone="mint"
        />
        <StatCard
          label="今月の確定"
          value={stats.thisMonthConfirmed}
          icon={<Clock size={18} />}
          tone="blue"
        />
        <StatCard
          label="キャンセル"
          value={stats.canceled}
          sub="今月"
          icon={<CalendarX size={18} />}
          tone="rose"
        />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} {...stylex.props(styles.tabs)}>
        <TabsList>
          <TabsTrigger value="upcoming">今後の予定</TabsTrigger>
          <TabsTrigger value="past">過去</TabsTrigger>
          <TabsTrigger value="canceled">キャンセル済</TabsTrigger>
        </TabsList>

        {/* Content is identical across all tabs (filtered list); reuse the */}
        {/* same panel by mounting it once per value — Radix only renders the */}
        {/* active one, so there's no duplicated DOM. */}
        {(["upcoming", "past", "canceled"] as Tab[]).map((value) => (
          <TabsContent key={value} value={value}>
            <div {...stylex.props(styles.panel)}>
              {state.status === "loading" && (
                <div {...stylex.props(styles.empty)}>読み込み中...</div>
              )}

              {state.status === "error" && (
                <Card>
                  <CardHeader>
                    <CardTitle>読み込みに失敗しました</CardTitle>
                    <CardDescription>API への接続を確認してください。</CardDescription>
                  </CardHeader>
                  <CardBody>
                    <p {...stylex.props(styles.errorMsg)}>{state.message}</p>
                    <Button variant="outline" onClick={reload}>
                      再試行
                    </Button>
                  </CardBody>
                </Card>
              )}

              {state.status === "ok" && filtered.length === 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>{emptyTitleFor(tab)}</CardTitle>
                    <CardDescription>
                      リンクを公開してゲストからの予約を受け付けましょう。
                    </CardDescription>
                  </CardHeader>
                </Card>
              )}

              {state.status === "ok" && filtered.length > 0 && (
                <BookingsTable bookings={filtered} tz={tz} />
              )}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function emptyTitleFor(tab: Tab): string {
  if (tab === "upcoming") return "今後の予定はありません";
  if (tab === "past") return "過去の予定はありません";
  return "キャンセル済の予定はありません";
}

function BookingsTable({ bookings, tz }: { bookings: BookingSummary[]; tz: string }) {
  return (
    <Card style={{ padding: 0, overflow: "hidden", borderColor: colors.ink200 }}>
      <div {...stylex.props(styles.tableHeader)}>
        <div>日時</div>
        <div>タイトル</div>
        <div>主催者</div>
        <div>参加者</div>
        <div>ステータス</div>
        <div />
      </div>
      {bookings.map((b) => (
        <BookingRow key={b.id} booking={b} tz={tz} />
      ))}
    </Card>
  );
}

function BookingRow({ booking, tz }: { booking: BookingSummary; tz: string }) {
  const start = booking.startAt;
  const end = booking.endAt;
  const rowSx = stylex.props(styles.tableRow, booking.status === "canceled" && styles.rowCanceled);

  // 主催者は login user 固定 (auth adapter に useUser() が無いので display 名は
  // placeholder。実 user 情報の取得は別 issue で対応)。
  const hostName = "あなた";
  const hostColor = guestColor(hostName);

  const guestMembers: AvatarStackMember[] = [
    {
      name: booking.guestName,
      color: guestColor(booking.guestEmail || booking.guestName),
    },
  ];

  // 詳細 page link は /confirmed-list/:id 経由 (現状の routing 踏襲)。
  // 行全体を clickable にせず、cell-level の「詳細」 link で遷移する
  // (a11y rule との衝突回避; semantic <tr> も grid-table では使えないため)。
  return (
    <div className={rowSx.className} style={rowSx.style}>
      {/* 日時 */}
      <div {...stylex.props(styles.dateCol)}>
        <span {...stylex.props(styles.dateMain)}>{formatLocalDate(start, tz)}</span>
        <span {...stylex.props(styles.dateSub)}>
          {formatLocalTime(start, tz)} – {formatLocalTime(end, tz)} ({tz})
        </span>
      </div>
      {/* タイトル */}
      <div {...stylex.props(styles.titleCol)}>
        <span {...stylex.props(styles.titleMain)} title={booking.linkTitle}>
          {booking.linkTitle}
        </span>
        {booking.linkSlug && <span {...stylex.props(styles.titleSub)}>/{booking.linkSlug}</span>}
      </div>
      {/* 主催者 */}
      <div {...stylex.props(styles.hostCol)}>
        <span
          {...stylex.props(styles.hostAvatar)}
          style={{ backgroundColor: hostColor }}
          aria-hidden
        >
          {initial(hostName)}
        </span>
        <span {...stylex.props(styles.hostName)}>{hostName}</span>
      </div>
      {/* 参加者 */}
      <div>
        <AvatarStack members={guestMembers} max={3} size="sm" showCount={false} />
      </div>
      {/* ステータス */}
      <div>
        {booking.status === "confirmed" ? (
          <span {...stylex.props(styles.badgeConfirmed)}>確定</span>
        ) : (
          <span {...stylex.props(styles.badgeCanceled)}>キャンセル済</span>
        )}
      </div>
      {/* アクション */}
      <div {...stylex.props(styles.rowActions)}>
        <Button asChild variant="outline" size="sm">
          <Link to={`/confirmed-list/${booking.id}`}>詳細</Link>
        </Button>
      </div>
    </div>
  );
}
