import * as SeparatorPrimitive from "@radix-ui/react-separator";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";
import { colors } from "@/styles/tokens.stylex";

const styles = stylex.create({
  root: {
    backgroundColor: colors.border,
    border: "none",
  },
  horizontal: {
    width: "100%",
    height: "1px",
  },
  vertical: {
    width: "1px",
    height: "100%",
  },
});

export const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(({ style, orientation = "horizontal", decorative = true, ...props }, ref) => {
  const sx = stylex.props(
    styles.root,
    orientation === "vertical" ? styles.vertical : styles.horizontal,
  );
  return (
    <SeparatorPrimitive.Root
      ref={ref}
      orientation={orientation}
      decorative={decorative}
      {...props}
      className={sx.className}
      style={{ ...sx.style, ...style }}
    />
  );
});
Separator.displayName = "Separator";
