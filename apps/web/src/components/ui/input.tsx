import * as stylex from "@stylexjs/stylex";
import * as React from "react";
import { colors, radius, space } from "@/styles/tokens.stylex";

const styles = stylex.create({
  base: {
    height: "2.5rem",
    width: "100%",
    paddingInline: space.md,
    fontSize: "0.875rem",
    backgroundColor: colors.bg,
    color: colors.fg,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    outline: "none",
    transitionProperty: "border-color, box-shadow",
    transitionDuration: "120ms",
    borderColor: { default: colors.border, ":focus": colors.ring },
    boxShadow: { default: "none", ":focus": `0 0 0 2px ${colors.ring}` },
  },
});

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ style, ...props }, ref) => {
  const sx = stylex.props(styles.base);
  return <input ref={ref} {...props} className={sx.className} style={{ ...sx.style, ...style }} />;
});
Input.displayName = "Input";
