import * as stylex from "@stylexjs/stylex";
import { NavLink, Outlet } from "react-router-dom";
import { auth } from "@/auth";
import { colors, space, typography } from "@/styles/tokens.stylex";

/**
 * Authenticated app shell with a top-tab navigation (ISH-227).
 *
 * SPIR の vocabulary に揃え、`/dashboard` prefix は無し。
 * 上部にブランド + タブ + UserButton を一列で配置し、本体はその下にスクロール。
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
    fontSize: typography.fontSizeMd,
    fontWeight: typography.fontWeightSemibold,
    margin: 0,
    flexShrink: 0,
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
  userArea: {
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
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
  { to: "/settings", label: "設定" },
];

export function DashboardLayout() {
  return (
    <div {...stylex.props(styles.shell)}>
      <header {...stylex.props(styles.header)}>
        <h1 {...stylex.props(styles.brand)}>AI Hackathon</h1>
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
        <div {...stylex.props(styles.userArea)}>
          <auth.UserButton />
        </div>
      </header>
      <main {...stylex.props(styles.main)}>
        <Outlet />
      </main>
    </div>
  );
}
