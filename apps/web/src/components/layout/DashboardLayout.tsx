import { UserButton } from "@clerk/clerk-react";
import * as stylex from "@stylexjs/stylex";
import { NavLink, Outlet } from "react-router-dom";
import { colors, space } from "@/styles/tokens.stylex";

const styles = stylex.create({
  shell: {
    minHeight: "100dvh",
    display: "grid",
    gridTemplateColumns: "240px 1fr",
    backgroundColor: colors.bg,
    color: colors.fg,
  },
  sidebar: {
    borderRight: `1px solid ${colors.border}`,
    padding: space.lg,
    display: "flex",
    flexDirection: "column",
    gap: space.lg,
  },
  brand: {
    fontSize: "1rem",
    fontWeight: 600,
    margin: 0,
  },
  nav: {
    display: "flex",
    flexDirection: "column",
    gap: space.xs,
  },
  navLink: {
    display: "block",
    padding: `${space.sm} ${space.md}`,
    borderRadius: "0.5rem",
    fontSize: "0.875rem",
    color: colors.fg,
    textDecoration: "none",
    backgroundColor: { default: "transparent", ":hover": colors.accent },
  },
  navLinkActive: {
    backgroundColor: colors.accent,
    fontWeight: 600,
  },
  main: {
    padding: space.xl,
    overflowY: "auto",
  },
  footer: {
    marginTop: "auto",
    display: "flex",
    alignItems: "center",
    gap: space.sm,
  },
});

const navItems = [
  { to: "/dashboard", label: "ダッシュボード", end: true },
  { to: "/dashboard/links", label: "リンク" },
  { to: "/dashboard/bookings", label: "予約" },
  { to: "/dashboard/workspaces", label: "ワークスペース" },
  { to: "/dashboard/settings", label: "設定" },
];

export function DashboardLayout() {
  return (
    <div {...stylex.props(styles.shell)}>
      <aside {...stylex.props(styles.sidebar)}>
        <h1 {...stylex.props(styles.brand)}>AI Hackathon</h1>
        <nav {...stylex.props(styles.nav)}>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              {...({} as object)}
              className={({ isActive }) => {
                const sx = stylex.props(styles.navLink, isActive && styles.navLinkActive);
                return sx.className ?? "";
              }}
              style={({ isActive }) =>
                stylex.props(styles.navLink, isActive && styles.navLinkActive).style
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div {...stylex.props(styles.footer)}>
          <UserButton />
        </div>
      </aside>
      <main {...stylex.props(styles.main)}>
        <Outlet />
      </main>
    </div>
  );
}
