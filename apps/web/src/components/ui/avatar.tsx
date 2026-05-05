import * as AvatarPrimitive from "@radix-ui/react-avatar";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";
import { colors, radius, typography } from "@/styles/tokens.stylex";

const styles = stylex.create({
  root: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: colors.accent,
    borderRadius: radius.full,
    flexShrink: 0,
  },
  sizeSm: {
    width: "1.5rem",
    height: "1.5rem",
    fontSize: typography.fontSizeXs,
  },
  sizeMd: {
    width: "2rem",
    height: "2rem",
    fontSize: typography.fontSizeSm,
  },
  sizeLg: {
    width: "2.5rem",
    height: "2.5rem",
    fontSize: typography.fontSizeMd,
  },
  image: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },
  fallback: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    height: "100%",
    fontFamily: typography.fontFamilySans,
    fontWeight: typography.fontWeightMedium,
    color: colors.fg,
    backgroundColor: colors.accent,
  },
});

const sizeMap = {
  sm: styles.sizeSm,
  md: styles.sizeMd,
  lg: styles.sizeLg,
} as const;

export interface AvatarProps extends React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> {
  size?: keyof typeof sizeMap;
}

export const Avatar = React.forwardRef<React.ElementRef<typeof AvatarPrimitive.Root>, AvatarProps>(
  ({ style, size = "md", ...props }, ref) => {
    const sx = stylex.props(styles.root, sizeMap[size]);
    return (
      <AvatarPrimitive.Root
        ref={ref}
        {...props}
        className={sx.className}
        style={{ ...sx.style, ...style }}
      />
    );
  },
);
Avatar.displayName = "Avatar";

export const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ style, ...props }, ref) => {
  const sx = stylex.props(styles.image);
  return (
    <AvatarPrimitive.Image
      ref={ref}
      {...props}
      className={sx.className}
      style={{ ...sx.style, ...style }}
    />
  );
});
AvatarImage.displayName = "AvatarImage";

export const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ style, ...props }, ref) => {
  const sx = stylex.props(styles.fallback);
  return (
    <AvatarPrimitive.Fallback
      ref={ref}
      {...props}
      className={sx.className}
      style={{ ...sx.style, ...style }}
    />
  );
});
AvatarFallback.displayName = "AvatarFallback";
