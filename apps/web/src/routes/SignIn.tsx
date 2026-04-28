import * as stylex from "@stylexjs/stylex";
import { Navigate } from "react-router-dom";
import { auth } from "@/auth";
import { colors, space } from "@/styles/tokens.stylex";

const HAS_CLERK = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

const styles = stylex.create({
  page: {
    minHeight: "100dvh",
    backgroundColor: colors.bg,
    color: colors.fg,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    paddingBlock: space.xl,
    paddingInline: space.md,
    gap: space.lg,
  },
  heading: {
    margin: 0,
    fontSize: "1.5rem",
    fontWeight: 600,
    textAlign: "center",
  },
  subhead: {
    margin: 0,
    color: colors.muted,
    fontSize: "0.95rem",
    textAlign: "center",
  },
  intro: {
    display: "flex",
    flexDirection: "column",
    gap: space.xs,
  },
});

/**
 * `/sign-in` route. Renders Clerk's hosted-style component inline so
 * `<Navigate to="/sign-in" />` (App.tsx ProtectedDashboard) lands users in our own
 * shell instead of bouncing out to Clerk's domain. The Clerk component handles
 * its own subpaths (e.g. `/sign-in/factor-one`) — `App.tsx` mounts the route
 * with a wildcard so those nested URLs reach this component.
 */
export default function SignInPage() {
  if (!HAS_CLERK) return <Navigate to="/" replace />;
  return (
    <main {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.intro)}>
        <h1 {...stylex.props(styles.heading)}>サインイン</h1>
        <p {...stylex.props(styles.subhead)}>アカウントにアクセスして日程調整を続けます。</p>
      </div>
      <auth.SignInPage />
    </main>
  );
}
