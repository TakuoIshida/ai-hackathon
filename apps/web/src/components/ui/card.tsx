import * as stylex from "@stylexjs/stylex";
import * as React from "react";
import { colors, radius, space, typography } from "@/styles/tokens.stylex";

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

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ style, ...props }, ref) => {
    const sx = stylex.props(styles.card);
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
