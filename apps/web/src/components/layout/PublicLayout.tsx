import * as stylex from "@stylexjs/stylex";
import { Outlet } from "react-router-dom";
import { colors, space } from "@/styles/tokens.stylex";

const styles = stylex.create({
  page: {
    minHeight: "100dvh",
    backgroundColor: colors.bg,
    color: colors.fg,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    paddingBlock: space.xl,
    paddingInline: space.md,
  },
  inner: {
    width: "100%",
    maxWidth: "48rem",
  },
});

export function PublicLayout() {
  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.inner)}>
        <Outlet />
      </div>
    </div>
  );
}
