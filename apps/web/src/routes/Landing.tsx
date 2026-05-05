import * as stylex from "@stylexjs/stylex";
import { Link } from "react-router-dom";
import { auth } from "@/auth";
import { Button } from "@/components/ui/button";
import { colors, space } from "@/styles/tokens.stylex";

const HAS_CLERK = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

const styles = stylex.create({
  page: {
    minHeight: "100dvh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: space.lg,
    padding: space.xl,
    textAlign: "center",
  },
  title: { fontSize: "2.5rem", fontWeight: 700, margin: 0 },
  subtitle: { color: colors.muted, margin: 0, maxWidth: "32rem" },
  row: { display: "flex", gap: space.sm },
  notice: {
    color: "#b45309",
    fontSize: "0.875rem",
    maxWidth: "32rem",
  },
});

export default function Landing() {
  return (
    <main {...stylex.props(styles.page)}>
      <h1 {...stylex.props(styles.title)}>SPIR 代替の社内日程調整</h1>
      <p {...stylex.props(styles.subtitle)}>
        Google Calendar と連携し、空き時間リンクで予約を受け付けます。Meet URL も自動発行。
      </p>
      {HAS_CLERK ? <AuthActions /> : <NoClerkNotice />}
    </main>
  );
}

function AuthActions() {
  return (
    <div {...stylex.props(styles.row)}>
      <auth.SignedOut>
        {/* ISH-55: navigate to dedicated /sign-in route instead of opening a
            modal so Clerk's nested flows (verification, factor-two, etc.)
            render inside the app shell. */}
        <Button asChild>
          <Link to="/sign-in">サインイン</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/sign-up">新規登録</Link>
        </Button>
      </auth.SignedOut>
      <auth.SignedIn>
        <Button asChild>
          <Link to="/availability-sharings">ダッシュボードへ</Link>
        </Button>
      </auth.SignedIn>
    </div>
  );
}

function NoClerkNotice() {
  return (
    <p {...stylex.props(styles.notice)}>
      <code>VITE_CLERK_PUBLISHABLE_KEY</code> が未設定です。
      <code>apps/web/.env</code> に追加して再起動するとサインインが有効になります。
    </p>
  );
}
