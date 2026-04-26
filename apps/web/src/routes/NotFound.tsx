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
    gap: space.md,
    padding: space.xl,
    textAlign: "center",
  },
  code: { fontSize: "4rem", fontWeight: 700, margin: 0, color: colors.muted },
  title: { fontSize: "1.25rem", margin: 0 },
});

export default function NotFound() {
  return (
    <main {...stylex.props(styles.page)}>
      <p {...stylex.props(styles.code)}>404</p>
      <h1 {...stylex.props(styles.title)}>ページが見つかりません</h1>
      <Button asChild variant="outline">
        <Link to="/">トップへ戻る</Link>
      </Button>
    </main>
  );
}
