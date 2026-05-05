import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";
import { colors, radius, space, typography } from "@/styles/tokens.stylex";

/**
 * In-page tab switcher (Radix Tabs wrapper).
 *
 * URL ベースで切り替える「トップタブ navigation」は別途 NavLink ベースの専用
 * component を用意する (P1-2)。Tabs はあくまでページ内 tab 用。
 *
 * Active state: Radix が trigger に `data-state="active"` を設定するので
 * MutationObserver で監視し、active 用 style を inline で重ねる。StyleX は
 * data-attribute selector の取り扱いに難があるため、この差分のみ手動で扱う。
 */

const styles = stylex.create({
  list: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    borderBottom: `1px solid ${colors.border}`,
    paddingInline: 0,
    overflowX: "auto",
  },
  trigger: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    paddingInline: space.md,
    paddingBlock: space.sm,
    fontFamily: typography.fontFamilySans,
    fontSize: typography.fontSizeSm,
    fontWeight: typography.fontWeightMedium,
    color: { default: colors.muted, ":hover": colors.fg },
    backgroundColor: "transparent",
    border: "none",
    borderBottom: "2px solid transparent",
    borderRadius: 0,
    cursor: "pointer",
    whiteSpace: "nowrap",
    transitionProperty: "color, border-color",
    transitionDuration: "120ms",
    outline: "none",
  },
  content: {
    outline: "none",
    borderRadius: radius.md,
  },
});

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ style, ...props }, ref) => {
  const sx = stylex.props(styles.list);
  return (
    <TabsPrimitive.List
      ref={ref}
      {...props}
      className={sx.className}
      style={{ ...sx.style, ...style }}
    />
  );
});
TabsList.displayName = "TabsList";

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ style, ...props }, forwardedRef) => {
  const innerRef = React.useRef<HTMLButtonElement | null>(null);
  React.useImperativeHandle(forwardedRef, () => innerRef.current as HTMLButtonElement);
  const [active, setActive] = React.useState(false);

  React.useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const sync = () => setActive(el.getAttribute("data-state") === "active");
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(el, { attributes: true, attributeFilter: ["data-state"] });
    return () => observer.disconnect();
  }, []);

  const sx = stylex.props(styles.trigger);
  const activeStyle: React.CSSProperties = active
    ? { color: colors.fg, borderBottomColor: colors.primary }
    : {};

  return (
    <TabsPrimitive.Trigger
      ref={innerRef}
      {...props}
      className={sx.className}
      style={{ ...sx.style, ...activeStyle, ...style }}
    />
  );
});
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ style, ...props }, ref) => {
  const sx = stylex.props(styles.content);
  return (
    <TabsPrimitive.Content
      ref={ref}
      {...props}
      className={sx.className}
      style={{ ...sx.style, ...style }}
    />
  );
});
TabsContent.displayName = "TabsContent";
