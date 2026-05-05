import * as stylex from "@stylexjs/stylex";

// ---------------------------------------------------------------------------
// colors
// ---------------------------------------------------------------------------

export const colors = stylex.defineVars({
  bg: "#ffffff",
  fg: "#0a0a0a",
  muted: "#737373",
  border: "#e5e5e5",
  primary: "#171717",
  primaryFg: "#fafafa",
  accent: "#f5f5f5",
  accentFg: "#171717",
  destructive: "#dc2626",
  destructiveFg: "#fafafa",
  ring: "#171717",
  // semantic additions (ISH-221)
  info: "#2563eb",
  infoFg: "#fafafa",
  success: "#16a34a",
  successFg: "#fafafa",
  warning: "#d97706",
  warningFg: "#fafafa",
});

// ---------------------------------------------------------------------------
// radius
// ---------------------------------------------------------------------------

export const radius = stylex.defineVars({
  sm: "0.25rem",
  md: "0.5rem",
  lg: "0.75rem",
  full: "9999px",
});

// ---------------------------------------------------------------------------
// space
// ---------------------------------------------------------------------------

export const space = stylex.defineVars({
  xs: "0.25rem",
  sm: "0.5rem",
  md: "1rem",
  lg: "1.5rem",
  xl: "2rem",
  xl2: "3rem",
});

// ---------------------------------------------------------------------------
// typography (ISH-221)
// ---------------------------------------------------------------------------

export const typography = stylex.defineVars({
  fontFamilySans:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans JP", sans-serif',
  fontFamilyMono:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  fontSizeXs: "0.75rem",
  fontSizeSm: "0.875rem",
  fontSizeMd: "1rem",
  fontSizeLg: "1.125rem",
  fontSizeXl: "1.25rem",
  fontSize2xl: "1.5rem",
  fontSize3xl: "1.875rem",
  fontWeightNormal: "400",
  fontWeightMedium: "500",
  fontWeightSemibold: "600",
  fontWeightBold: "700",
  lineHeightTight: "1.25",
  lineHeightNormal: "1.5",
  lineHeightRelaxed: "1.75",
});

// ---------------------------------------------------------------------------
// shadow (ISH-221)
// ---------------------------------------------------------------------------

export const shadow = stylex.defineVars({
  sm: "0 1px 2px rgba(0, 0, 0, 0.05)",
  md: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)",
  lg: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)",
});

// ---------------------------------------------------------------------------
// zIndex (ISH-221)
//
// 数値順に意味付け。各レイヤー間に余白を残してあるので、必要なら +1 / -1 で
// 微調整できる。
// ---------------------------------------------------------------------------

export const zIndex = stylex.defineVars({
  base: "0",
  dropdown: "1000",
  sticky: "1100",
  overlay: "1200",
  modal: "1300",
  toast: "1400",
});

// ---------------------------------------------------------------------------
// breakpoint (ISH-221)
//
// `defineVars` の CSS variable は `@media` の括弧内で展開できないため、
// breakpoint は plain TS const として export する。`@media (min-width: ...)`
// で文字列リテラルとして使う想定。
// ---------------------------------------------------------------------------

export const breakpoint = {
  sm: "640px",
  md: "768px",
  lg: "1024px",
} as const;
