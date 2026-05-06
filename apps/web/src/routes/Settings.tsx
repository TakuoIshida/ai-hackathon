import * as stylex from "@stylexjs/stylex";
import { AlertTriangle, Mail, Search, UserPlus, Users } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatCard } from "@/components/ui/stat-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, api, googleConnectUrl } from "@/lib/api";
import type { GoogleCalendarSummary, GoogleConnection } from "@/lib/types";
import { colors, radius, space, typography } from "@/styles/tokens.stylex";

/**
 * チーム設定画面 (ISH-240 / M-03)。Artboard 5 に揃えた tabs 構造で、各タブを
 * 切り替えて表示する。
 *
 * - 基本情報 ... 既存の Google Workspace 連携 + プロフィール
 * - メンバー ... アクティブ/招待中/期限切れ stats + members table + 招待 button
 * - 招待 / 通知 / プラン ... 未実装 placeholder
 *
 * メンバー一覧の API は workspace-scoped (`api.listMembers`) のみ存在し、
 * tenant 単位の listing endpoint がまだ無いので本 issue では mock データ。
 * 実 API 連携は別 issue (TODO: tenant members listing endpoint + WorkspaceId
 * → activeTenantId の解決)。
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
  roleBadgeAdmin: {
    display: "inline-flex",
    alignItems: "center",
    paddingInline: "0.5rem",
    paddingBlock: "0.125rem",
    fontSize: typography.fontSizeXs,
    fontWeight: typography.fontWeightBold,
    borderRadius: radius.full,
    backgroundColor: colors.blue100,
    color: colors.blue700,
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
});

const TENANT_NAME = "team";

type MemberStatus = "active" | "pending" | "expired";

interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: "オーナー" | "管理者" | "メンバー";
  status: MemberStatus;
  color: string;
  joined: string;
  expiresIn?: string;
}

const MOCK_MEMBERS: MemberRow[] = [
  {
    id: "u1",
    name: "Ishida T",
    email: "ishida@team.example.com",
    role: "オーナー",
    status: "active",
    color: "#4FB287",
    joined: "2025/12/01",
  },
  {
    id: "u2",
    name: "T Ishida",
    email: "tishida@team.example.com",
    role: "管理者",
    status: "active",
    color: "#4F92BE",
    joined: "2026/01/15",
  },
  {
    id: "u3",
    name: "山田 太郎",
    email: "yamada@team.example.com",
    role: "メンバー",
    status: "active",
    color: "#8B7AB8",
    joined: "2026/02/03",
  },
  {
    id: "u4",
    name: "鈴木 花子",
    email: "suzuki@team.example.com",
    role: "メンバー",
    status: "pending",
    color: "#D9A040",
    joined: "—",
    expiresIn: "残り 18時間",
  },
  {
    id: "u5",
    name: "田中 健",
    email: "tanaka@team.example.com",
    role: "メンバー",
    status: "expired",
    color: "#B5C2D1",
    joined: "—",
  },
];

const PLAN_LIMIT = 10;

export default function Settings() {
  const [tab, setTab] = useState<string>("basic");
  const [inviteOpen, setInviteOpen] = useState(false);

  const stats = useMemo(() => {
    const active = MOCK_MEMBERS.filter((m) => m.status === "active").length;
    const pending = MOCK_MEMBERS.filter((m) => m.status === "pending").length;
    const expired = MOCK_MEMBERS.filter((m) => m.status === "expired").length;
    return { active, pending, expired };
  }, []);

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
            <MembersTab stats={stats} />
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

function MembersTab({ stats }: { stats: { active: number; pending: number; expired: number } }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | MemberStatus>("all");

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return MOCK_MEMBERS.filter((m) => {
      if (filter !== "all" && m.status !== filter) return false;
      if (!q) return true;
      return m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q);
    });
  }, [search, filter]);

  return (
    <>
      <div {...stylex.props(styles.statsGrid)}>
        <StatCard
          label="アクティブメンバー"
          value={stats.active}
          total={PLAN_LIMIT}
          sub={`プランの上限まであと ${PLAN_LIMIT - stats.active}名`}
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
            <Select value={filter} onValueChange={(v) => setFilter(v as "all" | MemberStatus)}>
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

        {filteredMembers.map((m) => (
          <MemberRowView key={m.id} member={m} />
        ))}

        {filteredMembers.length === 0 && (
          <div
            style={{
              padding: "2rem",
              textAlign: "center",
              color: colors.ink500,
              fontSize: typography.fontSizeSm,
            }}
          >
            該当するメンバーがいません
          </div>
        )}
      </Card>
    </>
  );
}

function MemberRowView({ member }: { member: MemberRow }) {
  const rowStyle = stylex.props(
    styles.membersTableRow,
    member.status === "expired" && styles.memberRowExpired,
  );
  return (
    <div className={rowStyle.className} style={rowStyle.style}>
      <div {...stylex.props(styles.memberMeta)}>
        <span {...stylex.props(styles.memberAvatar)} style={{ backgroundColor: member.color }}>
          {member.name.charAt(0)}
        </span>
        <div>
          <div {...stylex.props(styles.memberName)}>{member.name}</div>
          <div {...stylex.props(styles.memberEmail)}>{member.email}</div>
        </div>
      </div>
      <div>
        {member.role === "オーナー" && (
          <span {...stylex.props(styles.roleBadgeOwner)}>{member.role}</span>
        )}
        {member.role === "管理者" && (
          <span {...stylex.props(styles.roleBadgeAdmin)}>{member.role}</span>
        )}
        {member.role === "メンバー" && (
          <span {...stylex.props(styles.roleBadgeMember)}>{member.role}</span>
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
      <div {...stylex.props(styles.joinedCol)}>{member.joined}</div>
      <div {...stylex.props(styles.rowActions)}>
        {member.status !== "active" && (
          <Button variant="outline" size="sm">
            再送
          </Button>
        )}
      </div>
    </div>
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
