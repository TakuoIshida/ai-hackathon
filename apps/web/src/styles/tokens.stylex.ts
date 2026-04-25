import * as stylex from "@stylexjs/stylex";

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
});

export const radius = stylex.defineVars({
  sm: "0.25rem",
  md: "0.5rem",
  lg: "0.75rem",
});

export const space = stylex.defineVars({
  xs: "0.25rem",
  sm: "0.5rem",
  md: "1rem",
  lg: "1.5rem",
  xl: "2rem",
});
