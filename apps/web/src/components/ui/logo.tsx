import * as stylex from "@stylexjs/stylex";
import * as React from "react";
import { colors } from "@/styles/tokens.stylex";

const styles = stylex.create({
  base: {
    display: "inline-block",
    fontFamily: '"Times New Roman", "Hiragino Mincho ProN", serif',
    fontWeight: 700,
    fontStyle: "italic",
    letterSpacing: "-0.01em",
    color: colors.blue900,
    lineHeight: 1,
  },
  iWrap: {
    position: "relative",
    display: "inline-block",
  },
  dot: {
    position: "absolute",
    display: "inline-block",
    borderRadius: "50%",
    backgroundImage: `linear-gradient(135deg, ${colors.blue400}, ${colors.rose500} 70%)`,
  },
});

const sizeMap = { sm: 18, md: 26, lg: 32 } as const;

export interface LogoProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: keyof typeof sizeMap;
}

export const Logo = React.forwardRef<HTMLSpanElement, LogoProps>(
  ({ style, size = "md", "aria-label": ariaLabel = "Rips", ...props }, ref) => {
    const fs = sizeMap[size];
    const dotSize = fs * 0.34;
    const sx = stylex.props(styles.base);
    const iWrapSx = stylex.props(styles.iWrap);
    const dotSx = stylex.props(styles.dot);
    return (
      <span
        ref={ref}
        role="img"
        aria-label={ariaLabel}
        data-testid="logo"
        data-size={size}
        {...props}
        className={sx.className}
        style={{ ...sx.style, fontSize: `${fs}px`, ...style }}
      >
        <span aria-hidden="true">R</span>
        <span aria-hidden="true" className={iWrapSx.className} style={iWrapSx.style}>
          i
          <span
            data-testid="logo-dot"
            className={dotSx.className}
            style={{
              ...dotSx.style,
              top: `${-fs * 0.18}px`,
              left: `${fs * 0.08}px`,
              width: `${dotSize}px`,
              height: `${dotSize}px`,
            }}
          />
        </span>
        <span aria-hidden="true">ps</span>
      </span>
    );
  },
);
Logo.displayName = "Logo";
