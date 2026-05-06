import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { auth } from "@/auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Logo } from "@/components/ui/logo";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { colors, radius, space, typography } from "@/styles/tokens.stylex";

/**
 * Authenticated app shell with a top-tab navigation (ISH-227 / ISH-236).
 *
 * SPIR の vocabulary に揃え、`/dashboard` prefix は無し。
 * 上部に Logo + タブ + 右側 utilities (help / feedback / 招待 / team picker /
 * UserButton) を一列で配置し、本体はその下にスクロール。
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
  iconButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "2rem",
    height: "2rem",
    padding: 0,
    color: { default: colors.ink500, ":hover": colors.fg },
    backgroundColor: { default: "transparent", ":hover": colors.ink100 },
    border: "none",
    borderRadius: radius.full,
    cursor: "pointer",
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
  inviteModalBackdrop: {
    position: "fixed",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15, 34, 56, 0.4)",
    zIndex: 1300,
  },
  inviteModal: {
    minWidth: "20rem",
    padding: space.xl,
    backgroundColor: colors.bg,
    borderRadius: radius.lg,
    border: `1px solid ${colors.border}`,
    fontFamily: typography.fontFamilySans,
  },
  inviteModalTitle: {
    margin: 0,
    fontSize: typography.fontSizeLg,
    fontWeight: typography.fontWeightSemibold,
    color: colors.fg,
  },
  inviteModalBody: {
    marginTop: space.md,
    fontSize: typography.fontSizeSm,
    color: colors.muted,
  },
  inviteModalActions: {
    marginTop: space.lg,
    display: "flex",
    justifyContent: "flex-end",
  },
  inviteModalClose: {
    paddingInline: space.md,
    paddingBlock: space.xs,
    fontSize: typography.fontSizeSm,
    fontWeight: typography.fontWeightMedium,
    color: colors.fg,
    backgroundColor: { default: colors.ink100, ":hover": colors.ink200 },
    border: `1px solid ${colors.ink200}`,
    borderRadius: radius.md,
    cursor: "pointer",
  },
  main: {
    flex: 1,
    padding: space.xl,
    overflowY: "auto",
  },
});

const navItems: ReadonlyArray<{ to: string; label: string }> = [
  { to: "/availability-sharings", label: "空き時間リンク" },
  { to: "/calendar", label: "カレンダー" },
  { to: "/unconfirmed-list", label: "未確定の調整" },
  { to: "/confirmed-list", label: "確定済の予定" },
  { to: "/forms", label: "フォーム" },
  { to: "/settings", label: "チーム設定" },
];

// Mock team picker data — 後続 issue で tenant 切替 API と連携する。
const mockTeams: ReadonlyArray<{ id: string; name: string; sub: string; initial: string }> = [
  { id: "team", name: "team", sub: "チームアカウント", initial: "T" },
];

const ICON_STROKE = 1.6;

function HelpIcon() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={ICON_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 3.5" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={ICON_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a8 8 0 0 1-12 7l-5 1 1-5a8 8 0 1 1 16-3Z" />
    </svg>
  );
}

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
  // 招待モーダル開閉。実体は M-02 (ISH-239) で実装する。本 issue では
  // trigger の wire up と placeholder のみ。
  const [inviteOpen, setInviteOpen] = useState(false);
  const activeTeam = mockTeams[0];

  return (
    <TooltipProvider delayDuration={200}>
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
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="ヘルプ"
                  data-testid="topnav-help"
                  {...stylex.props(styles.iconButton)}
                >
                  <HelpIcon />
                </button>
              </TooltipTrigger>
              <TooltipContent>ヘルプ</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="フィードバック"
                  data-testid="topnav-feedback"
                  {...stylex.props(styles.iconButton)}
                >
                  <CommentIcon />
                </button>
              </TooltipTrigger>
              <TooltipContent>フィードバック</TooltipContent>
            </Tooltip>
            <button
              type="button"
              data-testid="topnav-invite"
              // TODO(ISH-239 / M-02): wire up to invite modal.
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
        {inviteOpen ? (
          <div
            data-testid="invite-modal-placeholder"
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-modal-title"
            {...stylex.props(styles.inviteModalBackdrop)}
          >
            <div {...stylex.props(styles.inviteModal)}>
              <h2 id="invite-modal-title" {...stylex.props(styles.inviteModalTitle)}>
                招待モーダル (TODO: ISH-239)
              </h2>
              <p {...stylex.props(styles.inviteModalBody)}>
                M-02 で本実装予定。今は trigger の wire up のみ。
              </p>
              <div {...stylex.props(styles.inviteModalActions)}>
                <button
                  type="button"
                  onClick={() => setInviteOpen(false)}
                  {...stylex.props(styles.inviteModalClose)}
                >
                  閉じる
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </TooltipProvider>
  );
}
