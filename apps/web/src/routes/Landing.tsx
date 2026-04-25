import { SignedIn, SignedOut, SignInButton } from "@clerk/clerk-react";
import * as stylex from "@stylexjs/stylex";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { colors, space } from "@/styles/tokens.stylex";

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
});

export default function Landing() {
  return (
    <main {...stylex.props(styles.page)}>
      <h1 {...stylex.props(styles.title)}>SPIR 代替の社内日程調整</h1>
      <p {...stylex.props(styles.subtitle)}>
        Google Calendar と連携し、空き時間リンクで予約を受け付けます。Meet URL も自動発行。
      </p>
      <div {...stylex.props(styles.row)}>
        <SignedOut>
          <SignInButton mode="modal">
            <Button>サインイン</Button>
          </SignInButton>
        </SignedOut>
        <SignedIn>
          <Button asChild>
            <Link to="/dashboard">ダッシュボードへ</Link>
          </Button>
        </SignedIn>
      </div>
    </main>
  );
}
