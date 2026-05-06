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

  // Pastel Blue palette (ISH-229) — Spir 系デザインの基調色。
  // 既存の primary / accent / border 等は本 issue では値を維持する
  // (後続 issue で意味マッピングを切替予定)。
  blue50: "#F4F8FC",
  blue100: "#E8F1FB",
  blue150: "#DCE9F6",
  blue200: "#C7DCEF",
  blue300: "#A8C9E0",
  blue400: "#7FB0D1",
  blue500: "#4F92BE",
  blue600: "#2A6FA8",
  blue700: "#1F5A8E",
  blue800: "#164772",
  blue900: "#0E2F4D",
  // Soft accents
  mint100: "#E6F4EE",
  mint500: "#4FB287",
  rose100: "#FCEAE8",
  rose500: "#D9695F",
  amber100: "#FCF1DA",
  amber500: "#D9A040",
  lilac100: "#EFE9F7",
  lilac500: "#8B7AB8",
  // Ink scale (cool gray for text and borders)
  ink50: "#F6F9FC",
  ink100: "#ECF1F6",
  ink200: "#DDE4EC",
  ink300: "#B5C2D1",
  ink400: "#8294A8",
  ink500: "#5C7388",
  ink700: "#2C4258",
  ink900: "#0F2238",
  // Surfaces
  bgPage: "#F4F7FB",
  bgSoft: "#EDF3FA",
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
  // ISH-229: Pastel Blue 系の primary CTA に当てるソフトグロー。
  blueGlow: "0 6px 20px rgba(42, 111, 168, 0.18)",
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
