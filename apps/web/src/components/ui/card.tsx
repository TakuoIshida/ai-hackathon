import * as stylex from "@stylexjs/stylex";
import * as React from "react";
import { colors, radius, shadow, space, typography } from "@/styles/tokens.stylex";

const styles = stylex.create({
  card: {
    backgroundColor: colors.bg,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.lg,
    padding: space.lg,
    display: "flex",
    flexDirection: "column",
    gap: space.md,
  },
  variantDefault: {},
  variantElevated: {
    boxShadow: shadow.md,
    borderColor: "transparent",
  },
  variantOutline: {
    backgroundColor: "transparent",
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: space.xs,
  },
  title: {
    fontSize: typography.fontSizeLg,
    fontWeight: typography.fontWeightSemibold,
    lineHeight: typography.lineHeightTight,
    margin: 0,
  },
  description: {
    fontSize: typography.fontSizeSm,
    color: colors.muted,
    margin: 0,
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: space.md,
  },
  footer: {
    display: "flex",
    gap: space.sm,
    justifyContent: "flex-end",
  },
});

const variantMap = {
  default: styles.variantDefault,
  elevated: styles.variantElevated,
  outline: styles.variantOutline,
} as const;

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Visual style. Default: default. */
  variant?: keyof typeof variantMap;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ style, variant = "default", ...props }, ref) => {
    const sx = stylex.props(styles.card, variantMap[variant]);
    return <div ref={ref} {...props} className={sx.className} style={{ ...sx.style, ...style }} />;
  },
);
Card.displayName = "Card";

export function CardHeader({ children }: { children: React.ReactNode }) {
  return <div {...stylex.props(styles.header)}>{children}</div>;
}

export function CardTitle({ children }: { children: React.ReactNode }) {
  return <h2 {...stylex.props(styles.title)}>{children}</h2>;
}

export function CardDescription({ children }: { children: React.ReactNode }) {
  return <p {...stylex.props(styles.description)}>{children}</p>;
}

export function CardBody({ children }: { children: React.ReactNode }) {
  return <div {...stylex.props(styles.body)}>{children}</div>;
}

export function CardFooter({ children }: { children: React.ReactNode }) {
  return <div {...stylex.props(styles.footer)}>{children}</div>;
}
