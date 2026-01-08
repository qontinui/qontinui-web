/**
 * Qontinui Design System - Color Tokens
 *
 * Professional color palette - toned down from neon for a softer aesthetic
 * while maintaining visual hierarchy and brand recognition.
 */

/**
 * Brand colors - Primary palette
 */
export const brand = {
  /** Slate Blue - Primary actions, interactive elements */
  primary: "#4A90D9",
  /** Muted Violet - Secondary/build actions, accent */
  secondary: "#8B6BB5",
  /** Soft Teal - Success states, positive actions */
  success: "#4DB89D",
} as const;

/**
 * Surface colors - Backgrounds and containers
 */
export const surface = {
  /** Deep Gray - Main canvas/page background */
  canvas: "#111115",
  /** Card Gray - Cards, panels, elevated surfaces */
  raised: "#1E1E22",
  /** Lighter surface for hover states */
  hover: "#252529",
  /** Even lighter for active states */
  active: "#2C2C32",
  /** Overlay backgrounds */
  overlay: "rgba(0, 0, 0, 0.8)",
} as const;

/**
 * Border colors
 */
export const border = {
  /** Subtle borders - minimal contrast */
  subtle: "#2A2A30",
  /** Default borders - standard visibility */
  default: "#3A3A42",
  /** Strong borders - high contrast */
  strong: "#4A4A54",
  /** Interactive border - focus/hover states */
  interactive: "#5A5A66",
} as const;

/**
 * Text colors
 */
export const text = {
  /** Primary text - headings, important content */
  primary: "#FFFFFF",
  /** Secondary text - body content */
  secondary: "#E4E4E7",
  /** Tertiary text - less important content */
  tertiary: "#A1A1AA",
  /** Muted text - placeholders, hints */
  muted: "#71717A",
  /** Disabled text */
  disabled: "#52525B",
} as const;

/**
 * Semantic colors - Status and feedback
 */
export const semantic = {
  /** Success - confirmations, completed actions */
  success: {
    DEFAULT: "#4DB89D",
    light: "#5FCFB0",
    dark: "#3EA088",
    muted: "rgba(77, 184, 157, 0.15)",
  },
  /** Warning - caution, attention needed */
  warning: {
    DEFAULT: "#E5A853",
    light: "#F0B968",
    dark: "#C89440",
    muted: "rgba(229, 168, 83, 0.15)",
  },
  /** Error - destructive actions, errors */
  error: {
    DEFAULT: "#E5534B",
    light: "#F06960",
    dark: "#C43D35",
    muted: "rgba(229, 83, 75, 0.15)",
  },
  /** Info - informational messages */
  info: {
    DEFAULT: "#4A90D9",
    light: "#5DA3EC",
    dark: "#3A7BC4",
    muted: "rgba(74, 144, 217, 0.15)",
  },
} as const;

/**
 * Chart/data visualization colors
 */
export const chart = {
  blue: "#4A90D9",
  violet: "#8B6BB5",
  teal: "#4DB89D",
  amber: "#E5A853",
  rose: "#E5534B",
  cyan: "#48B5C4",
  orange: "#E07B39",
  purple: "#9B6FC5",
} as const;

/**
 * Glow effects - Subtle versions for shadows and highlights
 */
export const glow = {
  primary: "rgba(74, 144, 217, 0.2)",
  secondary: "rgba(139, 107, 181, 0.2)",
  success: "rgba(77, 184, 157, 0.2)",
} as const;

/**
 * All colors combined for export
 */
export const colors = {
  brand,
  surface,
  border,
  text,
  semantic,
  chart,
  glow,
} as const;

export type BrandColors = typeof brand;
export type SurfaceColors = typeof surface;
export type BorderColors = typeof border;
export type TextColors = typeof text;
export type SemanticColors = typeof semantic;
export type ChartColors = typeof chart;
export type GlowColors = typeof glow;
export type Colors = typeof colors;
