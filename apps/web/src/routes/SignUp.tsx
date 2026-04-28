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
 * `/sign-up` route. Mirrors `SignInPage` — renders Clerk's `<SignUp />`
 * component inside the app shell. Clerk's nested subpaths (e.g. email
 * verification) ride the wildcard mount in `App.tsx`.
 */
export default function SignUpPage() {
  if (!HAS_CLERK) return <Navigate to="/" replace />;
  return (
    <main {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.intro)}>
        <h1 {...stylex.props(styles.heading)}>サインアップ</h1>
        <p {...stylex.props(styles.subhead)}>新しいアカウントを作成してください。</p>
      </div>
      <auth.SignUpPage />
    </main>
  );
}
