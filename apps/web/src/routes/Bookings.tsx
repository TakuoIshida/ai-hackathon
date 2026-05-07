import * as stylex from "@stylexjs/stylex";
import {
  CalendarCheck,
  CalendarX,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { auth } from "@/auth";
import type { AvatarStackMember } from "@/components/ui/avatar-stack";
import { AvatarStack } from "@/components/ui/avatar-stack";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, api } from "@/lib/api";
import { formatLocalDate, formatLocalTime } from "@/lib/local-date";
import type { BookingSummary } from "@/lib/types";
import { colors, radius, space, typography } from "@/styles/tokens.stylex";

// ---------------------------------------------------------------------------
// 〔予約調整〕一覧 page (ISH-246 / ISH-247)
//
// Spir 系 design の構成:
//   H1 + sub + 右肩 CSV エクスポート
//     → Stats row 3 枚 (mint / blue / rose)
//     → Tabs (今後の予定 / 過去 / キャンセル済)
//     → Toolbar (search + status filter)
//     → grid-based table (Settings.tsx の MembersTab pattern 踏襲)
//     → Pagination (page size 25 固定; 25 件以下では非表示)
//     → Empty state (illustration + CTA)
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;

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
  // toolbar — Settings.tsx の membersToolbar pattern を踏襲
  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    paddingBlock: space.sm,
    paddingInline: space.md,
    borderBottom: `1px solid ${colors.ink100}`,
  },
  toolbarTitle: {
    fontSize: typography.fontSizeMd,
    fontWeight: typography.fontWeightBold,
    color: colors.blue900,
  },
  toolbarRight: { display: "flex", alignItems: "center", gap: space.sm },
  searchWrap: { position: "relative" },
  searchIcon: {
    position: "absolute",
    insetInlineStart: "0.625rem",
    top: "50%",
    transform: "translateY(-50%)",
    color: colors.ink400,
    pointerEvents: "none",
  },
  searchInput: { width: "16rem", paddingInlineStart: "2rem", height: "2.125rem" },
  // table — grid-based, Settings.tsx MembersTab pattern を踏襲
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
  // pagination
  paginationBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBlock: space.sm,
    paddingInline: space.md,
    borderTop: `1px solid ${colors.ink100}`,
    backgroundColor: colors.bg,
    fontSize: typography.fontSizeSm,
    color: colors.ink500,
  },
  paginationInfo: { fontVariantNumeric: "tabular-nums" },
  paginationControls: { display: "flex", alignItems: "center", gap: space.xs },
  // states
  errorMsg: { color: colors.destructive, fontSize: typography.fontSizeSm, margin: 0 },
  // empty state — illustration 風
  emptyCard: {
    padding: 0,
    overflow: "hidden",
    borderColor: colors.ink200,
  },
  emptyState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.sm,
    paddingBlock: "3rem",
    paddingInline: space.lg,
    textAlign: "center",
  },
  emptyIconCircle: {
    width: "3.5rem",
    height: "3.5rem",
    borderRadius: radius.full,
    backgroundColor: colors.blue50,
    color: colors.blue700,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    marginBlockEnd: "0.25rem",
  },
  emptyHeading: {
    margin: 0,
    fontSize: typography.fontSizeMd,
    fontWeight: typography.fontWeightBold,
    color: colors.blue900,
  },
  emptySub: {
    margin: 0,
    maxWidth: "28rem",
    fontSize: typography.fontSizeSm,
    color: colors.ink500,
  },
  emptyCta: { marginBlockStart: space.sm },
});

type Tab = "upcoming" | "past" | "canceled";
type StatusFilter = "all" | "confirmed" | "canceled";

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

function matchesSearch(b: BookingSummary, q: string): boolean {
  if (!q) return true;
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return (
    b.guestName.toLowerCase().includes(needle) ||
    b.guestEmail.toLowerCase().includes(needle) ||
    b.linkTitle.toLowerCase().includes(needle)
  );
}

export default function Bookings() {
  const { getToken } = auth.useAuth();
  const [tab, setTab] = useState<Tab>("upcoming");
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
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

  // Tab で絞り込んだ行 (search/filter 適用前)。これが空なら「データ無し」相当。
  const tabBookings = useMemo(() => {
    if (state.status !== "ok") return [];
    const now = Date.now();
    return state.bookings.filter((b) => {
      if (tab === "canceled") return b.status === "canceled";
      const isFuture = Date.parse(b.startAt) >= now && b.status === "confirmed";
      if (tab === "upcoming") return isFuture;
      // past: confirmed but already started
      return b.status === "confirmed" && Date.parse(b.startAt) < now;
    });
  }, [state, tab]);

  // search + status filter 適用後の行。
  const filtered = useMemo(() => {
    return tabBookings.filter((b) => {
      if (statusFilter !== "all" && b.status !== statusFilter) return false;
      return matchesSearch(b, search);
    });
  }, [tabBookings, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageEnd = Math.min(pageStart + PAGE_SIZE, filtered.length);
  const pageRows = filtered.slice(pageStart, pageEnd);
  const showPagination = filtered.length > PAGE_SIZE;

  // tab / search / filter が変わったら page を 1 に戻す。
  // (state.status が ok に切り替わった瞬間も該当するため state.status を依存に
  // 含めると無限ループになる — 値依存だけに抑える)
  // biome-ignore lint/correctness/useExhaustiveDependencies: page reset trigger
  useEffect(() => {
    setPage(1);
  }, [tab, search, statusFilter]);

  const isSearchActive = search.trim().length > 0 || statusFilter !== "all";

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

      {state.status === "loading" ? (
        <BookingsLoadingSkeleton />
      ) : (
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
      )}

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
              {state.status === "loading" && <BookingsTableSkeleton />}

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

              {state.status === "ok" && (
                <Card style={{ padding: 0, overflow: "hidden", borderColor: colors.ink200 }}>
                  <BookingsToolbar
                    search={search}
                    onSearchChange={setSearch}
                    statusFilter={statusFilter}
                    onStatusFilterChange={setStatusFilter}
                  />

                  {filtered.length === 0 ? (
                    <BookingsEmptyState
                      mode={
                        tabBookings.length === 0
                          ? "no-data"
                          : isSearchActive
                            ? "search-miss"
                            : "no-data"
                      }
                      tab={tab}
                    />
                  ) : (
                    <>
                      <BookingsTableHeader />
                      {pageRows.map((b) => (
                        <BookingRow key={b.id} booking={b} tz={tz} />
                      ))}
                      {showPagination && (
                        <PaginationBar
                          page={safePage}
                          totalPages={totalPages}
                          pageStart={pageStart}
                          pageEnd={pageEnd}
                          total={filtered.length}
                          onPrev={() => setPage((p) => Math.max(1, p - 1))}
                          onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
                        />
                      )}
                    </>
                  )}
                </Card>
              )}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function BookingsToolbar({
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (v: StatusFilter) => void;
}) {
  return (
    <div {...stylex.props(styles.toolbar)}>
      <span {...stylex.props(styles.toolbarTitle)}>予約一覧</span>
      <div {...stylex.props(styles.toolbarRight)}>
        <div {...stylex.props(styles.searchWrap)}>
          <span {...stylex.props(styles.searchIcon)}>
            <Search size={14} />
          </span>
          <Input
            {...stylex.props(styles.searchInput)}
            placeholder="ゲスト名 / メール / タイトルで検索"
            aria-label="予約を検索"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => onStatusFilterChange(v as StatusFilter)}>
          <SelectTrigger
            aria-label="ステータスで絞り込み"
            style={{ width: "9rem", height: "2.125rem" }}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">すべて</SelectItem>
            <SelectItem value="confirmed">確定</SelectItem>
            <SelectItem value="canceled">キャンセル済</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function BookingsTableHeader() {
  return (
    <div {...stylex.props(styles.tableHeader)}>
      <div>日時</div>
      <div>タイトル</div>
      <div>主催者</div>
      <div>参加者</div>
      <div>ステータス</div>
      <div />
    </div>
  );
}

function BookingsEmptyState({ mode, tab }: { mode: "no-data" | "search-miss"; tab: Tab }) {
  if (mode === "search-miss") {
    return (
      <div {...stylex.props(styles.emptyState)} data-testid="bookings-empty-search">
        <span {...stylex.props(styles.emptyIconCircle)} aria-hidden>
          <Search size={22} />
        </span>
        <h2 {...stylex.props(styles.emptyHeading)}>該当する予約がありません</h2>
        <p {...stylex.props(styles.emptySub)}>検索条件やステータス絞り込みを見直してください。</p>
      </div>
    );
  }

  return (
    <div {...stylex.props(styles.emptyState)} data-testid="bookings-empty-no-data">
      <span {...stylex.props(styles.emptyIconCircle)} aria-hidden>
        <CalendarX size={22} />
      </span>
      <h2 {...stylex.props(styles.emptyHeading)}>{emptyTitleFor(tab)}</h2>
      <p {...stylex.props(styles.emptySub)}>リンクを公開してゲストからの予約を受け付けましょう。</p>
      <div {...stylex.props(styles.emptyCta)}>
        <Button asChild>
          <Link to="/availability-sharings">リンクを作成</Link>
        </Button>
      </div>
    </div>
  );
}

function emptyTitleFor(tab: Tab): string {
  if (tab === "upcoming") return "予約はまだありません";
  if (tab === "past") return "過去の予定はありません";
  return "キャンセル済の予定はありません";
}

function PaginationBar({
  page,
  totalPages,
  pageStart,
  pageEnd,
  total,
  onPrev,
  onNext,
}: {
  page: number;
  totalPages: number;
  pageStart: number;
  pageEnd: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div {...stylex.props(styles.paginationBar)} data-testid="bookings-pagination">
      <span {...stylex.props(styles.paginationInfo)}>
        全 {total} 件中 {pageStart + 1}–{pageEnd} 件
      </span>
      <div {...stylex.props(styles.paginationControls)}>
        <Button
          variant="outline"
          size="sm"
          onClick={onPrev}
          disabled={page <= 1}
          aria-label="前のページ"
          leftIcon={<ChevronLeft size={14} />}
        >
          前へ
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onNext}
          disabled={page >= totalPages}
          aria-label="次のページ"
          rightIcon={<ChevronRight size={14} />}
        >
          次へ
        </Button>
      </div>
    </div>
  );
}

function BookingsLoadingSkeleton() {
  return (
    <div {...stylex.props(styles.statsGrid)} role="status" aria-label="読み込み中">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} style={{ height: "5.5rem", borderRadius: "0.75rem" }} />
      ))}
    </div>
  );
}

function BookingsTableSkeleton() {
  return (
    <Card
      style={{ padding: 0, overflow: "hidden", borderColor: colors.ink200 }}
      data-testid="bookings-table-skeleton"
    >
      <div {...stylex.props(styles.toolbar)}>
        <Skeleton style={{ height: "1rem", width: "6rem" }} />
        <div {...stylex.props(styles.toolbarRight)}>
          <Skeleton style={{ height: "2.125rem", width: "16rem" }} />
          <Skeleton style={{ height: "2.125rem", width: "9rem" }} />
        </div>
      </div>
      <BookingsTableHeader />
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} {...stylex.props(styles.tableRow)} aria-hidden>
          <div {...stylex.props(styles.dateCol)}>
            <Skeleton style={{ height: "0.875rem", width: "8rem" }} />
            <Skeleton style={{ height: "0.75rem", width: "10rem" }} />
          </div>
          <Skeleton style={{ height: "0.875rem", width: "12rem" }} />
          <Skeleton style={{ height: "1rem", width: "8rem" }} />
          <Skeleton style={{ height: "1.5rem", width: "5rem" }} />
          <Skeleton style={{ height: "1.25rem", width: "3rem" }} />
          <Skeleton style={{ height: "1.75rem", width: "3rem" }} />
        </div>
      ))}
    </Card>
  );
}

function BookingRow({ booking, tz }: { booking: BookingSummary; tz: string }) {
  const start = booking.startAt;
  const end = booking.endAt;
  const rowSx = stylex.props(styles.tableRow, booking.status === "canceled" && styles.rowCanceled);

  // ISH-267: host info now comes from the BE per-booking (denormalized
  // bookings.host_user_id JOIN common.users). Falls back to "(不明)" defensively
  // — the BE always returns a non-empty name (email local-part if name is
  // null), so this branch is only for malformed payloads.
  const hostName = booking.hostName || "(不明)";
  const hostColor = guestColor(booking.hostEmail || hostName);

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
