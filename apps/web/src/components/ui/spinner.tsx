import * as stylex from "@stylexjs/stylex";
import { Loader2 } from "lucide-react";
import * as React from "react";
import { colors } from "@/styles/tokens.stylex";

const spinKeyframes = stylex.keyframes({
  from: { transform: "rotate(0deg)" },
  to: { transform: "rotate(360deg)" },
});

const styles = stylex.create({
  base: {
    display: "inline-block",
    color: colors.muted,
    animationName: spinKeyframes,
    animationDuration: "1s",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
});

const sizeMap = { sm: 14, md: 18, lg: 24 } as const;

export interface SpinnerProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "size"> {
  size?: keyof typeof sizeMap;
  /** Accessible label. Default: "Loading…" */
  label?: string;
}

export const Spinner = React.forwardRef<HTMLSpanElement, SpinnerProps>(
  ({ style, size = "md", label = "Loading…", ...props }, ref) => {
    const sx = stylex.props(styles.base);
    return (
      <span
        ref={ref}
        role="status"
        aria-label={label}
        {...props}
        className={sx.className}
        style={{ ...sx.style, ...style }}
      >
        <Loader2 size={sizeMap[size]} />
      </span>
    );
  },
);
Spinner.displayName = "Spinner";
