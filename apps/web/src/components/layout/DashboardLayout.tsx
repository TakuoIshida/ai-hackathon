import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { auth } from "@/auth";
import { InviteMembersModal } from "@/components/team/InviteMembersModal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Logo } from "@/components/ui/logo";
import { colors, radius, space, typography } from "@/styles/tokens.stylex";

/**
 * Authenticated app shell with a top-tab navigation (ISH-227 / ISH-236).
 *
 * SPIR の vocabulary に揃え、`/dashboard` prefix は無し。
 * 上部に Logo + タブ + 右側 utilities (招待 / team picker / UserButton) を
 * 一列で配置し、本体はその下にスクロール。
 */

const styles = stylex.create({
  shell: {
    minHeight: "100dvh",
    display: "flex",
    flexDirection: "column",
    backgroundColor: colors.bg,
    color: colors.fg,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: space.lg,
    paddingInline: space.lg,
    paddingBlock: space.sm,
    borderBottom: `1px solid ${colors.border}`,
    backgroundColor: colors.bg,
    position: "sticky",
    top: 0,
    zIndex: 100,
  },
  brand: {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    margin: 0,
  },
  nav: {
    display: "flex",
    alignItems: "center",
    gap: space.xs,
    flex: 1,
    overflowX: "auto",
  },
  navLink: {
    display: "inline-flex",
    alignItems: "center",
    paddingInline: space.md,
    paddingBlock: space.sm,
    fontSize: typography.fontSizeSm,
    fontWeight: typography.fontWeightMedium,
    color: { default: colors.muted, ":hover": colors.fg },
    borderRadius: 0,
    borderBottom: "2px solid transparent",
    textDecoration: "none",
    whiteSpace: "nowrap",
    transitionProperty: "color, border-color",
    transitionDuration: "120ms",
  },
  navLinkActive: {
    color: colors.fg,
    borderBottomColor: colors.primary,
  },
  rightArea: {
    display: "flex",
    alignItems: "center",
    gap: space.xs,
    flexShrink: 0,
  },
  inviteButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    paddingInline: space.md,
    paddingBlock: space.xs,
    fontFamily: typography.fontFamilySans,
    fontSize: typography.fontSizeSm,
    fontWeight: typography.fontWeightMedium,
    color: colors.blue700,
    backgroundColor: { default: colors.blue100, ":hover": colors.blue150 },
    border: `1px solid ${colors.blue200}`,
    borderRadius: radius.full,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  teamPicker: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.sm,
    paddingBlock: space.xs,
    paddingInlineStart: space.xs,
    paddingInlineEnd: space.sm,
    backgroundColor: { default: "transparent", ":hover": colors.ink50 },
    border: `1px solid ${colors.ink200}`,
    borderRadius: radius.full,
    cursor: "pointer",
    fontFamily: typography.fontFamilySans,
  },
  teamAvatar: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "1.625rem",
    height: "1.625rem",
    fontSize: "0.6875rem",
    fontWeight: typography.fontWeightBold,
    color: colors.blue800,
    backgroundColor: colors.blue150,
    borderRadius: radius.full,
  },
  teamLabel: {
    display: "flex",
    flexDirection: "column",
    lineHeight: 1.1,
    textAlign: "start",
  },
  teamName: {
    fontSize: typography.fontSizeXs,
    fontWeight: typography.fontWeightBold,
    color: colors.fg,
  },
  teamSub: {
    fontSize: "0.625rem",
    color: colors.ink500,
  },
  main: {
    flex: 1,
    padding: space.xl,
    overflowY: "auto",
  },
});

const navItems: ReadonlyArray<{ to: string; label: string }> = [
  { to: "/availability-sharings", label: "空き時間リンク" },
  { to: "/confirmed-list", label: "確定済の予定" },
  { to: "/settings", label: "チーム設定" },
];

// Mock team picker data — 後続 issue で tenant 切替 API と連携する。
const mockTeams: ReadonlyArray<{ id: string; name: string; sub: string; initial: string }> = [
  { id: "team", name: "team", sub: "チームアカウント", initial: "T" },
];

const ICON_STROKE = 1.6;

function UserPlusIcon() {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={ICON_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6" />
      <path d="M19 8v6M16 11h6" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={ICON_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function DashboardLayout() {
  // 招待モーダル開閉。実体は InviteMembersModal (ISH-239) で実装済み。
  const [inviteOpen, setInviteOpen] = useState(false);
  const activeTeam = mockTeams[0];

  return (
    <div {...stylex.props(styles.shell)}>
      <header {...stylex.props(styles.header)}>
        <h1 {...stylex.props(styles.brand)}>
          <Logo size="md" />
        </h1>
        <nav {...stylex.props(styles.nav)}>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                stylex.props(styles.navLink, isActive && styles.navLinkActive).className ?? ""
              }
              style={({ isActive }) =>
                stylex.props(styles.navLink, isActive && styles.navLinkActive).style
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div {...stylex.props(styles.rightArea)}>
          <button
            type="button"
            data-testid="topnav-invite"
            onClick={() => setInviteOpen(true)}
            {...stylex.props(styles.inviteButton)}
          >
            <UserPlusIcon />
            招待
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-testid="topnav-team-picker"
                {...stylex.props(styles.teamPicker)}
              >
                <span {...stylex.props(styles.teamAvatar)}>{activeTeam?.initial ?? ""}</span>
                <span {...stylex.props(styles.teamLabel)}>
                  <span {...stylex.props(styles.teamName)}>{activeTeam?.name ?? ""}</span>
                  <span {...stylex.props(styles.teamSub)}>{activeTeam?.sub ?? ""}</span>
                </span>
                <ChevronDownIcon />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>チームを切り替え</DropdownMenuLabel>
              {mockTeams.map((team) => (
                <DropdownMenuItem key={team.id}>
                  {team.name} — {team.sub}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled>新しいチームを作成 (TODO)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <auth.UserButton />
        </div>
      </header>
      <main {...stylex.props(styles.main)}>
        <Outlet />
      </main>
      <InviteMembersModal
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        teamName={activeTeam?.name ?? ""}
      />
    </div>
  );
}
