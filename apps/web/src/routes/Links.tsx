import * as stylex from "@stylexjs/stylex";
import { Clock, Copy, Edit, Filter, MoreHorizontal, Plus, Search, Video } from "lucide-react";
import { Link } from "react-router-dom";
import type { AvatarStackMember } from "@/components/ui/avatar-stack";
import { AvatarStack } from "@/components/ui/avatar-stack";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api";
import { useLinksQuery } from "@/lib/queries";
import type { LinkSummary } from "@/lib/types";
import { colors, radius, space, typography } from "@/styles/tokens.stylex";

// ---------------------------------------------------------------------------
// Links 一覧画面 (ISH-237 / L-04)
//
// Spir 系 Artboard 1 (links-list) を Pastel Blue palette + 既存 component 群
// (AvatarStack / Button / Input / Badge / Card) で再構築する。
// Page header → Links table (Card 内 grid) という構成。
//
// Mock data 方針:
//   - links.length のみ実 API。
//   - 各 row の visits + members + meetType + candidates は MVP 用途のため
//     固定値か link.id の hash で導出 (deterministic で test しやすく、
//     デモでも見栄えする)。
//   - AvatarStack の members は link.id の seed から色 + initial を導出する
//     (実際の "共催者" 概念は MVP 未実装)。
//   - 更新の相対時刻は updatedAt から計算する (今日 / 昨日 / N日前 / 1週間前)。
// ---------------------------------------------------------------------------

const styles = stylex.create({
  page: {
    display: "flex",
    flexDirection: "column",
    gap: space.lg,
    fontFamily: typography.fontFamilySans,
  },
  // page header
  header: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    flexWrap: "wrap",
  },
  headerTextCol: {
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
    minWidth: 0,
  },
  title: {
    fontSize: typography.fontSize2xl,
    fontWeight: typography.fontWeightBold,
    color: colors.blue900,
    margin: 0,
    lineHeight: typography.lineHeightTight,
  },
  subtitle: {
    fontSize: typography.fontSizeSm,
    color: colors.ink500,
    margin: 0,
  },
  toolbar: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    flexWrap: "wrap",
  },
  searchWrap: {
    width: "15rem",
  },
  // table
  tableHeader: {
    display: "grid",
    gridTemplateColumns: "90px 1fr 200px 140px 120px 110px",
    padding: "12px 20px",
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
    gridTemplateColumns: "90px 1fr 200px 140px 120px 110px",
    padding: "16px 20px",
    alignItems: "center",
    backgroundColor: colors.bg,
    borderBottom: `1px solid ${colors.ink100}`,
  },
  tableRowLast: {
    borderBottom: "none",
  },
  durationBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
    paddingInline: space.sm,
    paddingBlock: "0.125rem",
    borderRadius: radius.full,
    backgroundColor: colors.blue100,
    color: colors.blue700,
    fontSize: typography.fontSizeXs,
    fontWeight: typography.fontWeightMedium,
    whiteSpace: "nowrap",
  },
  cellTitleCol: {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    minWidth: 0,
  },
  rowTitle: {
    fontSize: typography.fontSizeSm,
    fontWeight: typography.fontWeightBold,
    color: colors.blue900,
    margin: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  rowMeta: {
    fontSize: typography.fontSizeXs,
    color: colors.ink500,
    display: "flex",
    gap: "12px",
    alignItems: "center",
    flexWrap: "wrap",
  },
  metaInline: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
  },
  visitsValue: {
    fontSize: typography.fontSizeSm,
    fontWeight: typography.fontWeightBold,
    color: colors.blue900,
    lineHeight: typography.lineHeightTight,
  },
  visitsSub: {
    fontSize: typography.fontSizeXs,
    color: colors.ink500,
  },
  updated: {
    fontSize: typography.fontSizeXs,
    color: colors.ink500,
  },
  rowActions: {
    display: "flex",
    gap: "4px",
    justifyContent: "flex-end",
  },
  iconButton: {
    width: "2rem",
    height: "2rem",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: `1px solid ${colors.ink200}`,
    borderRadius: radius.md,
    backgroundColor: { default: colors.bg, ":hover": colors.bgSoft },
    color: colors.ink700,
    cursor: "pointer",
    transitionProperty: "background-color, color, border-color",
    transitionDuration: "120ms",
  },
  iconButtonPrimary: {
    color: colors.blue600,
  },
  // states
  errorMsg: {
    color: colors.destructive,
    fontSize: typography.fontSizeSm,
  },
  // skeleton
  skeletonRow: {
    display: "grid",
    gridTemplateColumns: "90px 1fr 200px 140px 120px 110px",
    padding: "16px 20px",
    alignItems: "center",
    gap: space.md,
    borderBottom: `1px solid ${colors.ink100}`,
    backgroundColor: colors.bg,
  },
});

// ---------------------------------------------------------------------------
// Mock data helpers
// ---------------------------------------------------------------------------

// Simple deterministic hash to derive demo values per link.id.
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h;
}

const MEMBER_PALETTE: ReadonlyArray<{ name: string; color: string }> = [
  { name: "I", color: "#4FB287" },
  { name: "T", color: "#4F92BE" },
  { name: "S", color: "#8B7AB8" },
  { name: "K", color: "#D9A040" },
  { name: "A", color: "#D9695F" },
];

function deriveMembers(linkId: string): AvatarStackMember[] {
  const seed = hashSeed(linkId);
  const count = (seed % 3) + 1; // 1〜3 members
  const start = seed % MEMBER_PALETTE.length;
  return Array.from({ length: count }, (_, i) => {
    const m = MEMBER_PALETTE[(start + i) % MEMBER_PALETTE.length];
    // Type system: bounded indexing means non-undefined, but TS can't see it.
    if (!m) throw new Error("unreachable: MEMBER_PALETTE has stable length");
    return { name: m.name, color: m.color };
  });
}

function deriveVisits(linkId: string): number {
  return (hashSeed(linkId) % 200) + 20; // 20〜219
}

function deriveCandidates(linkId: string): number {
  return (hashSeed(`${linkId}c`) % 18) + 3; // 3〜20
}

function relativeUpdated(iso: string, now: Date = new Date()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diffMs = now.getTime() - t;
  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.floor(diffMs / dayMs);
  if (days <= 0) return "今日";
  if (days === 1) return "昨日";
  if (days < 7) return `${days}日前`;
  if (days < 14) return "1週間前";
  if (days < 30) return `${Math.floor(days / 7)}週間前`;
  if (days < 365) return `${Math.floor(days / 30)}か月前`;
  return `${Math.floor(days / 365)}年前`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Links() {
  // ISH-226: lifted off useState+useEffect onto TanStack Query.
  const { data, isLoading, isError, error, refetch } = useLinksQuery();
  const links = data?.links ?? [];

  return (
    <div {...stylex.props(styles.page)}>
      <PageHeader />

      {isLoading && <LinksTableSkeleton />}

      {isError && (
        <Card style={{ borderColor: colors.ink200 }}>
          <CardHeader>
            <CardTitle>読み込みに失敗しました</CardTitle>
            <CardDescription>API への接続を確認してください。</CardDescription>
          </CardHeader>
          <CardBody>
            <p {...stylex.props(styles.errorMsg)}>
              {error instanceof ApiError ? `${error.status} ${error.code}` : "failed to load"}
            </p>
            <Button variant="outline" onClick={() => refetch()}>
              再試行
            </Button>
          </CardBody>
        </Card>
      )}

      {!isLoading && !isError && links.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>まだリンクがありません</CardTitle>
            <CardDescription>新規リンクを作って公開URLを発行できます。</CardDescription>
          </CardHeader>
          <CardBody>
            <Button asChild>
              <Link to="/availability-sharings/new">+ 空き時間リンクを作成</Link>
            </Button>
          </CardBody>
        </Card>
      )}

      {!isLoading && !isError && links.length > 0 && <LinksTable links={links} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page header (左: H1 + sub / 右: search + filter + Create primary)
// ---------------------------------------------------------------------------

function PageHeader() {
  return (
    <header {...stylex.props(styles.header)}>
      <div {...stylex.props(styles.headerTextCol)}>
        {/* H1 substring "リンク" は existing e2e (signin.spec.ts) が */}
        {/* getByRole("heading", name: "リンク") で検査するため必ず維持。 */}
        <h1 {...stylex.props(styles.title)}>空き時間リンク</h1>
        <p {...stylex.props(styles.subtitle)}>
          カレンダーから空き時間を共有して、相手に予約してもらいましょう
        </p>
      </div>
      <div {...stylex.props(styles.toolbar)}>
        <div {...stylex.props(styles.searchWrap)}>
          <Input
            size="sm"
            placeholder="リンクを検索"
            aria-label="リンクを検索"
            leftAddon={<Search size={14} />}
          />
        </div>
        <Button variant="outline" size="sm" leftIcon={<Filter size={14} />}>
          絞り込み
        </Button>
        <Button asChild size="md" leftIcon={<Plus size={16} />}>
          <Link to="/availability-sharings/new">空き時間リンクを作成</Link>
        </Button>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Links table
// ---------------------------------------------------------------------------

function LinksTable({ links }: { links: LinkSummary[] }) {
  return (
    <Card style={{ padding: 0, overflow: "hidden", borderColor: colors.ink200 }}>
      <div {...stylex.props(styles.tableHeader)}>
        <div>打合せ時間</div>
        <div>タイトル</div>
        <div>参加者</div>
        <div>アクセス</div>
        <div>更新</div>
        <div />
      </div>
      {links.map((link, i) => (
        <LinkRow key={link.id} link={link} isLast={i === links.length - 1} />
      ))}
    </Card>
  );
}

function LinkRow({ link, isLast }: { link: LinkSummary; isLast: boolean }) {
  const members = deriveMembers(link.id);
  const visits = deriveVisits(link.id);
  const candidates = deriveCandidates(link.id);
  const updatedLabel = relativeUpdated(link.updatedAt);

  const onCopy = () => {
    const publicUrl = `${window.location.origin}/${link.slug}`;
    void navigator.clipboard?.writeText(publicUrl);
  };

  const rowSx = stylex.props(styles.tableRow, isLast && styles.tableRowLast);
  return (
    <div className={rowSx.className} style={rowSx.style}>
      {/* 打合せ時間 */}
      <div>
        <span {...stylex.props(styles.durationBadge)}>
          <Clock size={12} />
          {link.durationMinutes}分
        </span>
      </div>
      {/* タイトル */}
      <div {...stylex.props(styles.cellTitleCol)}>
        <p {...stylex.props(styles.rowTitle)} title={link.title}>
          {link.title}
        </p>
        <div {...stylex.props(styles.rowMeta)}>
          <span {...stylex.props(styles.metaInline)}>
            <Video size={12} />
            Google Meet
          </span>
          <span>· /{link.slug}</span>
          <span>· 候補日{candidates}件</span>
        </div>
      </div>
      {/* 参加者 */}
      <div>
        <AvatarStack members={members} max={3} size="sm" />
      </div>
      {/* アクセス */}
      <div>
        <div {...stylex.props(styles.visitsValue)}>{visits}</div>
        <div {...stylex.props(styles.visitsSub)}>今週</div>
      </div>
      {/* 更新 */}
      <div {...stylex.props(styles.updated)}>{updatedLabel}</div>
      {/* 操作 */}
      <div {...stylex.props(styles.rowActions)}>
        <button
          type="button"
          aria-label="リンクをコピー"
          title="リンクをコピー"
          onClick={onCopy}
          {...stylex.props(styles.iconButton, styles.iconButtonPrimary)}
        >
          <Copy size={14} />
        </button>
        <Link
          to={`/availability-sharings/${link.id}/edit`}
          aria-label="編集"
          title="編集"
          {...stylex.props(styles.iconButton)}
        >
          <Edit size={14} />
        </Link>
        <button
          type="button"
          aria-label="その他の操作"
          title="その他の操作"
          {...stylex.props(styles.iconButton)}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton (loading state)
// ---------------------------------------------------------------------------

function LinksTableSkeleton() {
  return (
    <Card style={{ padding: 0, overflow: "hidden", borderColor: colors.ink200 }}>
      <div {...stylex.props(styles.tableHeader)} aria-hidden>
        <div>打合せ時間</div>
        <div>タイトル</div>
        <div>参加者</div>
        <div>アクセス</div>
        <div>更新</div>
        <div />
      </div>
      {[0, 1, 2].map((i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholder rows
          key={i}
          {...stylex.props(styles.skeletonRow)}
          aria-hidden
        >
          <Skeleton style={{ height: "1.25rem", width: "4rem" }} />
          <Skeleton style={{ height: "1.25rem", width: "60%" }} />
          <Skeleton style={{ height: "1.25rem", width: "8rem" }} />
          <Skeleton style={{ height: "1.25rem", width: "4rem" }} />
          <Skeleton style={{ height: "1rem", width: "3rem" }} />
          <Skeleton style={{ height: "1.5rem", width: "5rem" }} />
        </div>
      ))}
    </Card>
  );
}
