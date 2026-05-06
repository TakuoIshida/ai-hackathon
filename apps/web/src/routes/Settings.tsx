import * as stylex from "@stylexjs/stylex";
import { AlertTriangle, Mail, MoreHorizontal, Search, UserPlus, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { auth } from "@/auth";
import { InviteMembersModal } from "@/components/team/InviteMembersModal";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardBody,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { useToast } from "@/components/ui/toast";
import { ApiError, api, googleConnectUrl } from "@/lib/api";
import { useRemoveTenantMemberMutation, useTenantMembersQuery } from "@/lib/queries";
import type {
  GoogleCalendarSummary,
  GoogleConnection,
  TenantMemberStatus,
  TenantMemberView,
  WorkspaceRole,
} from "@/lib/types";
import { colors, radius, space, typography } from "@/styles/tokens.stylex";

/**
 * チーム設定画面 (ISH-240 / M-03)。Artboard 5 に揃えた tabs 構造で、各タブを
 * 切り替えて表示する。
 *
 * - 基本情報 ... 既存の Google Workspace 連携 + プロフィール
 * - メンバー ... アクティブ/招待中/期限切れ stats + members table + 招待 button
 * - 招待 / 通知 / プラン ... 未実装 placeholder
 *
 * メンバー一覧は ISH-253 で `useTenantMembersQuery()` (`GET /tenant/members`)
 * に結線済。BE が active members + open invitations を joined view として
 * 返すので、FE 側は status (`active` / `pending` / `expired`) で出し分け
 * するだけで良い。再送ボタンは P3-2 で結線予定。
 */

const styles = stylex.create({
  page: { display: "flex", flexDirection: "column", gap: space.lg },
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
  },
  sub: { fontSize: typography.fontSizeSm, color: colors.ink500, margin: 0 },
  tabs: { width: "100%" },
  panel: { paddingBlock: space.lg, display: "flex", flexDirection: "column", gap: space.lg },
  // Members tab
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: space.md,
  },
  membersToolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    paddingBlock: space.sm,
    paddingInline: space.md,
    borderBottom: `1px solid ${colors.ink100}`,
  },
  membersToolbarTitle: {
    fontSize: typography.fontSizeMd,
    fontWeight: typography.fontWeightBold,
    color: colors.blue900,
  },
  membersToolbarRight: { display: "flex", alignItems: "center", gap: space.sm },
  searchWrap: { position: "relative" },
  searchIcon: {
    position: "absolute",
    insetInlineStart: "0.625rem",
    top: "50%",
    transform: "translateY(-50%)",
    color: colors.ink400,
    pointerEvents: "none",
  },
  searchInput: { width: "14rem", paddingInlineStart: "2rem", height: "2.125rem" },
  membersTableHeader: {
    display: "grid",
    gridTemplateColumns: "1fr 12rem 12rem 10rem 5rem",
    paddingBlock: "0.625rem",
    paddingInline: space.md,
    backgroundColor: colors.bgSoft,
    fontSize: typography.fontSizeXs,
    fontWeight: typography.fontWeightBold,
    color: colors.ink500,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  membersTableRow: {
    display: "grid",
    gridTemplateColumns: "1fr 12rem 12rem 10rem 5rem",
    paddingBlock: "0.875rem",
    paddingInline: space.md,
    alignItems: "center",
    borderTop: `1px solid ${colors.ink100}`,
  },
  memberRowExpired: { opacity: 0.6 },
  memberMeta: { display: "flex", alignItems: "center", gap: "0.625rem" },
  memberAvatar: {
    width: "2.25rem",
    height: "2.25rem",
    borderRadius: "50%",
    color: colors.bg,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: typography.fontSizeXs,
    fontWeight: typography.fontWeightBold,
    flexShrink: 0,
  },
  memberName: {
    fontSize: typography.fontSizeSm,
    fontWeight: typography.fontWeightBold,
    color: colors.blue900,
  },
  memberEmail: { fontSize: typography.fontSizeXs, color: colors.ink500 },
  roleBadgeOwner: {
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
  roleBadgeMember: { fontSize: typography.fontSizeSm, color: colors.ink700 },
  statusActive: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.3125rem",
    fontSize: typography.fontSizeXs,
    color: colors.mint500,
  },
  statusActiveDot: {
    width: "0.4375rem",
    height: "0.4375rem",
    borderRadius: "50%",
    backgroundColor: colors.mint500,
  },
  statusPending: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.3125rem",
    fontSize: typography.fontSizeXs,
    color: colors.amber500,
    fontWeight: typography.fontWeightBold,
  },
  statusPendingSub: { fontSize: "0.6875rem", color: colors.ink500, marginTop: "0.125rem" },
  statusExpired: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.3125rem",
    fontSize: typography.fontSizeXs,
    color: colors.rose500,
  },
  joinedCol: { fontSize: typography.fontSizeSm, color: colors.ink700 },
  rowActions: { display: "flex", justifyContent: "flex-end", gap: space.xs },
  membersErrorMsg: {
    color: colors.destructive,
    fontSize: typography.fontSizeSm,
    margin: 0,
  },
  membersEmpty: {
    padding: "2rem",
    textAlign: "center",
    color: colors.ink500,
    fontSize: typography.fontSizeSm,
  },
  // Basic info — existing layout
  innerCard: { display: "flex", flexDirection: "column", gap: space.md, maxWidth: "40rem" },
  field: { display: "flex", flexDirection: "column", gap: space.xs },
  account: { fontSize: typography.fontSizeSm, color: colors.muted },
  list: { display: "flex", flexDirection: "column", gap: space.sm },
  row: {
    display: "grid",
    gridTemplateColumns: "1fr auto auto",
    gap: space.md,
    alignItems: "center",
    padding: space.sm,
    border: `1px solid ${colors.border}`,
    borderRadius: "0.375rem",
  },
  rowMeta: { display: "flex", flexDirection: "column", gap: "0.125rem" },
  rowTitle: { fontSize: typography.fontSizeSm, fontWeight: typography.fontWeightMedium },
  rowSub: { fontSize: typography.fontSizeXs, color: colors.muted },
  toggle: {
    display: "flex",
    alignItems: "center",
    gap: space.xs,
    fontSize: typography.fontSizeXs,
  },
  badge: {
    display: "inline-block",
    fontSize: "0.7rem",
    paddingInline: "0.4rem",
    paddingBlock: "0.125rem",
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    color: colors.accentFg,
    marginInlineStart: space.xs,
  },
  empty: { fontSize: typography.fontSizeSm, color: colors.muted },
  error: { color: colors.destructive, fontSize: typography.fontSizeSm },
  // Placeholder tabs
  placeholder: {
    padding: space.xl,
    backgroundColor: colors.bgSoft,
    borderRadius: radius.md,
    border: `1px solid ${colors.ink200}`,
    color: colors.ink500,
    fontSize: typography.fontSizeSm,
    textAlign: "center",
  },
  // Organization info form
  orgForm: { display: "flex", flexDirection: "column", gap: space.md },
  orgFooter: { display: "flex", gap: space.sm },
  requiredMark: {
    color: colors.destructive,
    marginInlineStart: "0.25rem",
    fontWeight: typography.fontWeightBold,
  },
  fieldError: {
    fontSize: typography.fontSizeXs,
    color: colors.destructive,
    marginTop: "0.125rem",
  },
});

const TENANT_NAME = "team";

const PLAN_LIMIT = 10;

// Stable color palette for member avatars. Hashing member.id -> palette index
// gives a deterministic color per member (matches Links 一覧の MEMBER_PALETTE
// 手法). Using member.id (not email) means pending invitations and active
// members keep the same color even after acceptance flips status.
const MEMBER_PALETTE: ReadonlyArray<string> = [
  "#4FB287",
  "#4F92BE",
  "#8B7AB8",
  "#D9A040",
  "#D9695F",
  "#5DADE2",
  "#B5C2D1",
];

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h;
}

function memberColor(id: string): string {
  const idx = hashSeed(id) % MEMBER_PALETTE.length;
  const c = MEMBER_PALETTE[idx];
  // Bounded indexing — TS can't see it.
  if (!c) throw new Error("unreachable: MEMBER_PALETTE has stable length");
  return c;
}

function memberInitial(member: TenantMemberView): string {
  const source = member.name?.trim() || member.email;
  return source.charAt(0).toUpperCase();
}

function memberDisplayName(member: TenantMemberView): string {
  return member.name?.trim() || member.email;
}

function formatJoinedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd}`;
}

export default function Settings() {
  const [tab, setTab] = useState<string>("basic");
  const [inviteOpen, setInviteOpen] = useState(false);

  // ISH-253: tenant-scoped member listing. We keep the hook at the root so
  // tab switches don't re-fire the query (TanStack Query also dedupes by
  // queryKey, but rendering the query in MembersTab only would still drop
  // the cache once the tab unmounts — fine for now, but root-level keeps
  // pending count visible across tabs).
  const { data, isLoading, isError, error, refetch } = useTenantMembersQuery();
  const members = data?.members ?? [];
  const callerRole = data?.callerRole;
  const callerUserId = data?.callerUserId;

  const stats = useMemo(() => {
    const active = members.filter((m) => m.status === "active").length;
    const pending = members.filter((m) => m.status === "pending").length;
    const expired = members.filter((m) => m.status === "expired").length;
    return { active, pending, expired };
  }, [members]);

  return (
    <div {...stylex.props(styles.page)}>
      <header {...stylex.props(styles.pageHeader)}>
        <div {...stylex.props(styles.headingGroup)}>
          <h1 {...stylex.props(styles.heading)}>チーム設定</h1>
          <p {...stylex.props(styles.sub)}>{TENANT_NAME} · チームアカウント</p>
        </div>
        <Button leftIcon={<UserPlus size={15} />} onClick={() => setInviteOpen(true)}>
          メンバーを招待
        </Button>
      </header>

      <Tabs value={tab} onValueChange={setTab} {...stylex.props(styles.tabs)}>
        <TabsList>
          <TabsTrigger value="basic">基本情報</TabsTrigger>
          <TabsTrigger value="members">メンバー</TabsTrigger>
          <TabsTrigger value="invitations">
            招待
            {stats.pending > 0 ? ` (${stats.pending})` : ""}
          </TabsTrigger>
          <TabsTrigger value="notifications">通知</TabsTrigger>
          <TabsTrigger value="plan">プラン</TabsTrigger>
        </TabsList>

        <TabsContent value="basic">
          <div {...stylex.props(styles.panel)}>
            <BasicInfoTab />
          </div>
        </TabsContent>

        <TabsContent value="members">
          <div {...stylex.props(styles.panel)}>
            <MembersTab
              members={members}
              stats={stats}
              isLoading={isLoading}
              isError={isError}
              error={error}
              onRetry={() => refetch()}
              callerRole={callerRole}
              callerUserId={callerUserId}
            />
          </div>
        </TabsContent>

        <TabsContent value="invitations">
          <div {...stylex.props(styles.panel)}>
            <p {...stylex.props(styles.placeholder)}>
              招待タブは未実装です ({stats.pending}件の応答待ち / {stats.expired}件の期限切れ)。
            </p>
          </div>
        </TabsContent>

        <TabsContent value="notifications">
          <div {...stylex.props(styles.panel)}>
            <p {...stylex.props(styles.placeholder)}>通知タブは未実装です。</p>
          </div>
        </TabsContent>

        <TabsContent value="plan">
          <div {...stylex.props(styles.panel)}>
            <p {...stylex.props(styles.placeholder)}>プランタブは未実装です。</p>
          </div>
        </TabsContent>
      </Tabs>

      <InviteMembersModal open={inviteOpen} onOpenChange={setInviteOpen} teamName={TENANT_NAME} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Members tab
// ---------------------------------------------------------------------------

export function MembersTab({
  members,
  stats,
  isLoading,
  isError,
  error,
  onRetry,
  callerRole,
  callerUserId,
}: {
  members: TenantMemberView[];
  stats: { active: number; pending: number; expired: number };
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  /** From `GET /tenant/members` response. Undefined while loading. */
  callerRole?: WorkspaceRole;
  /** From `GET /tenant/members` response. Undefined while loading. */
  callerUserId?: string;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | TenantMemberStatus>("all");

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return members.filter((m) => {
      if (filter !== "all" && m.status !== filter) return false;
      if (!q) return true;
      const name = (m.name ?? "").toLowerCase();
      return name.includes(q) || m.email.toLowerCase().includes(q);
    });
  }, [members, search, filter]);

  return (
    <>
      <div {...stylex.props(styles.statsGrid)}>
        <StatCard
          label="アクティブメンバー"
          value={stats.active}
          total={PLAN_LIMIT}
          sub={`プランの上限まであと ${Math.max(PLAN_LIMIT - stats.active, 0)}名`}
          icon={<Users size={20} />}
          tone="mint"
        />
        <StatCard
          label="招待中"
          value={stats.pending}
          sub="応答待ち"
          icon={<Mail size={20} />}
          tone="amber"
        />
        <StatCard
          label="期限切れ"
          value={stats.expired}
          sub="再送が可能です"
          icon={<AlertTriangle size={20} />}
          tone="rose"
        />
      </div>

      {isError && (
        <Card style={{ borderColor: colors.ink200 }}>
          <CardHeader>
            <CardTitle>メンバーの読み込みに失敗しました</CardTitle>
            <CardDescription>API への接続を確認してください。</CardDescription>
          </CardHeader>
          <CardBody>
            <p {...stylex.props(styles.membersErrorMsg)}>
              {error instanceof ApiError ? `${error.status} ${error.code}` : "failed to load"}
            </p>
          </CardBody>
          <CardFooter>
            <Button variant="outline" onClick={onRetry}>
              再試行
            </Button>
          </CardFooter>
        </Card>
      )}

      {!isError && (
        <Card style={{ padding: 0, overflow: "hidden", borderColor: colors.ink200 }}>
          <div {...stylex.props(styles.membersToolbar)}>
            <span {...stylex.props(styles.membersToolbarTitle)}>メンバー一覧</span>
            <div {...stylex.props(styles.membersToolbarRight)}>
              <div {...stylex.props(styles.searchWrap)}>
                <span {...stylex.props(styles.searchIcon)}>
                  <Search size={14} />
                </span>
                <Input
                  {...stylex.props(styles.searchInput)}
                  placeholder="メンバーを検索"
                  aria-label="メンバーを検索"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select
                value={filter}
                onValueChange={(v) => setFilter(v as "all" | TenantMemberStatus)}
              >
                <SelectTrigger style={{ width: "9rem", height: "2.125rem" }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">すべて</SelectItem>
                  <SelectItem value="active">アクティブ</SelectItem>
                  <SelectItem value="pending">招待中</SelectItem>
                  <SelectItem value="expired">期限切れ</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div {...stylex.props(styles.membersTableHeader)}>
            <div>名前 / メール</div>
            <div>権限</div>
            <div>ステータス</div>
            <div>追加日</div>
            <div />
          </div>

          {isLoading && <MembersTableSkeleton />}

          {!isLoading &&
            filteredMembers.map((m) => (
              <MemberRowView
                key={m.id}
                member={m}
                callerRole={callerRole}
                callerUserId={callerUserId}
              />
            ))}

          {!isLoading && filteredMembers.length === 0 && (
            <div {...stylex.props(styles.membersEmpty)}>
              {members.length === 0 ? "メンバーがいません" : "該当するメンバーがいません"}
            </div>
          )}
        </Card>
      )}
    </>
  );
}

function MembersTableSkeleton() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <div key={i} {...stylex.props(styles.membersTableRow)} aria-hidden>
          <div {...stylex.props(styles.memberMeta)}>
            <Skeleton style={{ height: "2.25rem", width: "2.25rem", borderRadius: "50%" }} />
            <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <Skeleton style={{ height: "1rem", width: "8rem" }} />
              <Skeleton style={{ height: "0.75rem", width: "12rem" }} />
            </div>
          </div>
          <Skeleton style={{ height: "1.25rem", width: "4rem" }} />
          <Skeleton style={{ height: "1rem", width: "5rem" }} />
          <Skeleton style={{ height: "1rem", width: "5rem" }} />
          <Skeleton style={{ height: "1.5rem", width: "3rem" }} />
        </div>
      ))}
    </>
  );
}

function MemberRowView({
  member,
  callerRole,
  callerUserId,
}: {
  member: TenantMemberView;
  callerRole?: WorkspaceRole;
  callerUserId?: string;
}) {
  const rowStyle = stylex.props(
    styles.membersTableRow,
    member.status === "expired" && styles.memberRowExpired,
  );
  const color = memberColor(member.id);
  const initial = memberInitial(member);
  const displayName = memberDisplayName(member);

  // ISH-251 ガード: BE は確実に弾くが UX として無駄なクリックを見せない。
  const canManage = callerRole === "owner";
  const isSelf = callerUserId !== undefined && member.userId === callerUserId;
  const showActiveMenu = canManage && !isSelf && member.status === "active";

  return (
    <div className={rowStyle.className} style={rowStyle.style}>
      <div {...stylex.props(styles.memberMeta)}>
        <span {...stylex.props(styles.memberAvatar)} style={{ backgroundColor: color }}>
          {initial}
        </span>
        <div>
          <div {...stylex.props(styles.memberName)}>{displayName}</div>
          <div {...stylex.props(styles.memberEmail)}>{member.email}</div>
        </div>
      </div>
      <div>
        {member.role === "owner" ? (
          <span {...stylex.props(styles.roleBadgeOwner)}>オーナー</span>
        ) : (
          <span {...stylex.props(styles.roleBadgeMember)}>メンバー</span>
        )}
      </div>
      <div>
        {member.status === "active" && (
          <span {...stylex.props(styles.statusActive)}>
            <span {...stylex.props(styles.statusActiveDot)} />
            アクティブ
          </span>
        )}
        {member.status === "pending" && (
          <div>
            <span {...stylex.props(styles.statusPending)}>
              <Mail size={12} />
              招待中
            </span>
            {member.expiresIn && (
              <div {...stylex.props(styles.statusPendingSub)}>{member.expiresIn}</div>
            )}
          </div>
        )}
        {member.status === "expired" && (
          <span {...stylex.props(styles.statusExpired)}>
            <AlertTriangle size={12} />
            期限切れ
          </span>
        )}
      </div>
      <div {...stylex.props(styles.joinedCol)}>
        {member.status === "active" ? formatJoinedAt(member.joinedAt) : "—"}
      </div>
      <div {...stylex.props(styles.rowActions)}>
        {member.status !== "active" && (
          <Button variant="outline" size="sm">
            再送
          </Button>
        )}
        {showActiveMenu && <RowActionMenu member={member} />}
      </div>
    </div>
  );
}

/**
 * ISH-251: row-level actions for an active member (owner caller, not self).
 *
 * 「権限を変更」 は近日対応 (placeholder)。「メンバーを削除」 は対象が
 * owner の場合 disabled + tooltip で抑制 — owner 委譲フローは別 issue。
 * BE が確実に弾くため UX 装飾としてのガード。
 */
function RowActionMenu({ member }: { member: TenantMemberView }) {
  const { toast } = useToast();
  const removeMutation = useRemoveTenantMemberMutation();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isOwnerTarget = member.role === "owner";
  const removeDisabledReason = isOwnerTarget ? "オーナーを削除するには委譲が必要です" : undefined;

  const targetName = member.name ?? member.email;

  const onConfirmDelete = () => {
    if (!member.userId) return;
    removeMutation.mutate(member.userId, {
      onSuccess: () => {
        toast({ title: "削除しました", variant: "success" });
        setConfirmOpen(false);
      },
      onError: (err) => {
        const message =
          err instanceof ApiError ? `${err.status} ${err.code}` : "削除に失敗しました";
        toast({ title: "削除に失敗しました", description: message, variant: "destructive" });
      },
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            aria-label={`${targetName} のアクション`}
            data-testid={`member-row-actions-${member.email}`}
          >
            <MoreHorizontal size={14} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled>権限を変更 (近日対応)</DropdownMenuItem>
          <DropdownMenuItem
            variant="danger"
            disabled={isOwnerTarget}
            title={removeDisabledReason}
            onSelect={(e) => {
              if (isOwnerTarget) {
                e.preventDefault();
                return;
              }
              // Defer dialog open so the menu's close transition completes
              // first; otherwise focus management collides.
              setTimeout(() => setConfirmOpen(true), 0);
            }}
          >
            メンバーを削除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => !removeMutation.isPending && setConfirmOpen(open)}
      >
        <DialogContent aria-describedby="member-remove-desc" style={{ maxWidth: "28rem" }}>
          <DialogTitle>メンバーを削除</DialogTitle>
          <DialogDescription id="member-remove-desc">
            {targetName} をワークスペースから削除します。元に戻せません。
          </DialogDescription>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={removeMutation.isPending}
            >
              キャンセル
            </Button>
            <Button
              variant="destructive"
              onClick={onConfirmDelete}
              disabled={removeMutation.isPending}
            >
              {removeMutation.isPending ? "削除中..." : "削除する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Organization info form (ISH-249)
// ---------------------------------------------------------------------------

interface OrgInfo {
  companyName: string;
  teamName: string;
  contactName: string;
  phoneNumber: string;
}

const INITIAL_ORG_INFO: OrgInfo = {
  companyName: "",
  teamName: TENANT_NAME,
  contactName: "",
  phoneNumber: "",
};

const PHONE_REGEX = /^[0-9-]+$/;

type OrgErrors = Partial<Record<keyof OrgInfo, string>>;

function validateOrg(values: OrgInfo): OrgErrors {
  const errors: OrgErrors = {};
  if (!values.teamName.trim()) errors.teamName = "チーム名を入力してください";
  if (!values.contactName.trim()) errors.contactName = "担当者名を入力してください";
  if (!values.phoneNumber.trim()) {
    errors.phoneNumber = "電話番号を入力してください";
  } else if (!PHONE_REGEX.test(values.phoneNumber.trim())) {
    errors.phoneNumber = "半角数字とハイフンのみで入力してください";
  }
  return errors;
}

function OrganizationInfoCard() {
  const { toast } = useToast();
  const [initial, setInitial] = useState<OrgInfo>(INITIAL_ORG_INFO);
  const [values, setValues] = useState<OrgInfo>(INITIAL_ORG_INFO);
  const [errors, setErrors] = useState<OrgErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const dirty = useMemo(
    () =>
      values.companyName !== initial.companyName ||
      values.teamName !== initial.teamName ||
      values.contactName !== initial.contactName ||
      values.phoneNumber !== initial.phoneNumber,
    [values, initial],
  );

  const setField = <K extends keyof OrgInfo>(key: K, v: string) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const onReset = () => {
    setValues(initial);
    setErrors({});
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next = validateOrg(values);
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setSubmitting(true);
    // BE 側 PATCH /tenant 未実装。FE のみで Toast を出して保存済み扱いにする。
    console.warn("TODO: PATCH /tenant — payload:", values);
    await new Promise((r) => setTimeout(r, 500));
    setInitial(values);
    setSubmitting(false);
    toast({ title: "保存しました", variant: "success" });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>組織情報</CardTitle>
        <CardDescription>請求書 / お問い合わせに使用される情報です。</CardDescription>
      </CardHeader>
      <CardBody>
        <form id="org-info-form" onSubmit={onSubmit} noValidate {...stylex.props(styles.orgForm)}>
          <div {...stylex.props(styles.field)}>
            <Label htmlFor="org-company-name">会社名 (任意)</Label>
            <Input
              id="org-company-name"
              value={values.companyName}
              placeholder="e.g. Acme Inc."
              onChange={(e) => setField("companyName", e.target.value)}
              disabled={submitting}
            />
          </div>
          <div {...stylex.props(styles.field)}>
            <Label htmlFor="org-team-name">
              チーム名<span {...stylex.props(styles.requiredMark)}>*</span>
            </Label>
            <Input
              id="org-team-name"
              value={values.teamName}
              required
              error={Boolean(errors.teamName)}
              aria-describedby={errors.teamName ? "org-team-name-error" : undefined}
              onChange={(e) => setField("teamName", e.target.value)}
              disabled={submitting}
            />
            {errors.teamName && (
              <span id="org-team-name-error" role="alert" {...stylex.props(styles.fieldError)}>
                {errors.teamName}
              </span>
            )}
          </div>
          <div {...stylex.props(styles.field)}>
            <Label htmlFor="org-contact-name">
              担当者名<span {...stylex.props(styles.requiredMark)}>*</span>
            </Label>
            <Input
              id="org-contact-name"
              value={values.contactName}
              required
              error={Boolean(errors.contactName)}
              aria-describedby={errors.contactName ? "org-contact-name-error" : undefined}
              onChange={(e) => setField("contactName", e.target.value)}
              disabled={submitting}
            />
            {errors.contactName && (
              <span id="org-contact-name-error" role="alert" {...stylex.props(styles.fieldError)}>
                {errors.contactName}
              </span>
            )}
          </div>
          <div {...stylex.props(styles.field)}>
            <Label htmlFor="org-phone-number">
              電話番号<span {...stylex.props(styles.requiredMark)}>*</span>
            </Label>
            <Input
              id="org-phone-number"
              type="tel"
              value={values.phoneNumber}
              placeholder="03-1234-5678"
              required
              error={Boolean(errors.phoneNumber)}
              aria-describedby={errors.phoneNumber ? "org-phone-number-error" : undefined}
              onChange={(e) => setField("phoneNumber", e.target.value)}
              disabled={submitting}
            />
            {errors.phoneNumber && (
              <span id="org-phone-number-error" role="alert" {...stylex.props(styles.fieldError)}>
                {errors.phoneNumber}
              </span>
            )}
          </div>
        </form>
      </CardBody>
      <CardFooter>
        <div {...stylex.props(styles.orgFooter)}>
          <Button type="submit" form="org-info-form" disabled={!dirty || submitting}>
            {submitting ? "保存中..." : "保存"}
          </Button>
          <Button type="button" variant="outline" onClick={onReset} disabled={!dirty || submitting}>
            変更を破棄
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Basic info tab — existing Google connection + profile placeholders
// ---------------------------------------------------------------------------

function BasicInfoTab() {
  const { getToken } = auth.useAuth();
  const [conn, setConn] = useState<GoogleConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [savingCalendarId, setSavingCalendarId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getGoogleConnection(() => getToken());
      setConn(data);
    } catch (err) {
      setError(err instanceof ApiError ? `${err.status} ${err.code}` : "failed to load");
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    void load();
    if (new URLSearchParams(window.location.search).get("google_connected") === "1") {
      const url = new URL(window.location.href);
      url.searchParams.delete("google_connected");
      window.history.replaceState({}, "", url.toString());
    }
  }, [load]);

  const onDisconnect = async () => {
    if (!confirm("Google アカウントとの連携を解除します。よろしいですか？")) return;
    setDisconnecting(true);
    setError(null);
    try {
      await api.disconnectGoogle(() => getToken());
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? `${err.status} ${err.code}` : "failed");
    } finally {
      setDisconnecting(false);
    }
  };

  const onChangeFlag = async (
    calendar: GoogleCalendarSummary,
    field: "usedForBusy" | "usedForWrites",
    next: boolean,
  ) => {
    setSavingCalendarId(calendar.id);
    setError(null);
    try {
      await api.updateCalendarFlags(calendar.id, { [field]: next }, () => getToken());
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? `${err.status} ${err.code}` : "failed");
    } finally {
      setSavingCalendarId(null);
    }
  };

  return (
    <div {...stylex.props(styles.innerCard)}>
      <OrganizationInfoCard />
      <Card>
        <CardHeader>
          <CardTitle>Google Workspace 連携</CardTitle>
          <CardDescription>
            空き時間計算と Meet URL 自動発行に使う Google アカウントを連携します。
          </CardDescription>
        </CardHeader>
        <CardBody>
          {loading && <p {...stylex.props(styles.empty)}>読み込み中...</p>}
          {error && <p {...stylex.props(styles.error)}>{error}</p>}

          {!loading && !error && conn && !conn.connected && (
            <Button asChild variant="outline">
              <a href={googleConnectUrl}>Google アカウントを連携</a>
            </Button>
          )}

          {!loading && !error && conn?.connected && (
            <>
              <p {...stylex.props(styles.account)}>
                連携中: <strong>{conn.accountEmail}</strong>
              </p>
              <CardSection title="同期されたカレンダー">
                {conn.calendars.length === 0 ? (
                  <p {...stylex.props(styles.empty)}>カレンダーが見つかりません。</p>
                ) : (
                  <div {...stylex.props(styles.list)}>
                    {conn.calendars.map((cal) => {
                      const saving = savingCalendarId === cal.id;
                      return (
                        <div key={cal.id} {...stylex.props(styles.row)}>
                          <div {...stylex.props(styles.rowMeta)}>
                            <span {...stylex.props(styles.rowTitle)}>
                              {cal.summary ?? cal.googleCalendarId}
                              {cal.isPrimary && (
                                <span {...stylex.props(styles.badge)}>primary</span>
                              )}
                            </span>
                            <span {...stylex.props(styles.rowSub)}>{cal.googleCalendarId}</span>
                          </div>
                          <label {...stylex.props(styles.toggle)}>
                            <input
                              type="checkbox"
                              checked={cal.usedForBusy}
                              disabled={saving}
                              onChange={(e) => onChangeFlag(cal, "usedForBusy", e.target.checked)}
                            />
                            空き判定
                          </label>
                          <label {...stylex.props(styles.toggle)}>
                            <input
                              type="radio"
                              name="usedForWrites"
                              checked={cal.usedForWrites}
                              disabled={saving}
                              onChange={(e) => onChangeFlag(cal, "usedForWrites", e.target.checked)}
                            />
                            書込先
                          </label>
                        </div>
                      );
                    })}
                  </div>
                )}
                <p {...stylex.props(styles.empty)}>
                  「空き判定」のオンになっているカレンダーの予定が busy として参照されます。
                  「書込先」は 確定イベントの作成先（1 つだけ選択可）。
                </p>
              </CardSection>
            </>
          )}
        </CardBody>
        {conn?.connected && (
          <CardFooter>
            <Button variant="destructive" onClick={onDisconnect} disabled={disconnecting}>
              {disconnecting ? "解除中..." : "連携を解除"}
            </Button>
          </CardFooter>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>プロフィール</CardTitle>
        </CardHeader>
        <CardBody>
          <div {...stylex.props(styles.field)}>
            <Label htmlFor="tz">タイムゾーン</Label>
            <Input id="tz" defaultValue="Asia/Tokyo" />
          </div>
          <p {...stylex.props(styles.empty)}>※ 現在は表示のみ。保存は v1.5 で対応予定 (ISH-57)。</p>
        </CardBody>
      </Card>
    </div>
  );
}

function CardSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div {...stylex.props(styles.field)}>
      <span style={{ fontWeight: 600, marginTop: "0.5rem" }}>{title}</span>
      {children}
    </div>
  );
}
