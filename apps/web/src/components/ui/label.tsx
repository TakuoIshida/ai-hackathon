import * as stylex from "@stylexjs/stylex";
import * as React from "react";
import { colors, space } from "@/styles/tokens.stylex";

const styles = stylex.create({
  base: {
    fontSize: "0.875rem",
    fontWeight: 500,
    color: colors.fg,
    display: "block",
    marginBottom: space.xs,
  },
});

export const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(({ style, ...props }, ref) => {
  const sx = stylex.props(styles.base);
  // biome-ignore lint/a11y/noLabelWithoutControl: htmlFor is supplied by callers; this is a primitive wrapper.
  return <label ref={ref} {...props} className={sx.className} style={{ ...sx.style, ...style }} />;
});
Label.displayName = "Label";
