import * as stylex from "@stylexjs/stylex";
import * as React from "react";
import { colors, radius } from "@/styles/tokens.stylex";

const pulseKeyframes = stylex.keyframes({
  "0%, 100%": { opacity: 1 },
  "50%": { opacity: 0.5 },
});

const styles = stylex.create({
  base: {
    display: "block",
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    animationName: pulseKeyframes,
    animationDuration: "2s",
    animationIterationCount: "infinite",
  },
});

export const Skeleton = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  ({ style, ...props }, ref) => {
    const sx = stylex.props(styles.base);
    return (
      <span
        ref={ref}
        aria-hidden="true"
        {...props}
        className={sx.className}
        style={{ ...sx.style, ...style }}
      />
    );
  },
);
Skeleton.displayName = "Skeleton";
