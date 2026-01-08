/**
 * Qontinui Design System - Typography Tokens
 *
 * Font families, sizes, weights, and line heights for consistent typography.
 */

/**
 * Font families
 */
export const fontFamily = {
  /** Sans-serif for UI text */
  sans: "var(--font-geist-sans), system-ui, -apple-system, sans-serif",
  /** Monospace for code and data */
  mono: "var(--font-geist-mono), ui-monospace, monospace",
} as const;

/**
 * Font sizes (rem-based for accessibility)
 */
export const fontSize = {
  /** 12px - Extra small labels, badges */
  xs: "0.75rem",
  /** 14px - Small text, secondary content */
  sm: "0.875rem",
  /** 16px - Base body text */
  base: "1rem",
  /** 18px - Large body text */
  lg: "1.125rem",
  /** 20px - Section headings */
  xl: "1.25rem",
  /** 24px - Page headings */
  "2xl": "1.5rem",
  /** 30px - Major headings */
  "3xl": "1.875rem",
  /** 36px - Hero text */
  "4xl": "2.25rem",
} as const;

/**
 * Font weights
 */
export const fontWeight = {
  /** 400 - Normal body text */
  normal: "400",
  /** 500 - Medium emphasis */
  medium: "500",
  /** 600 - Semibold headings */
  semibold: "600",
  /** 700 - Bold emphasis */
  bold: "700",
} as const;

/**
 * Line heights
 */
export const lineHeight = {
  /** 1 - Tight, for headings */
  none: "1",
  /** 1.25 - Tight spacing */
  tight: "1.25",
  /** 1.375 - Snug spacing */
  snug: "1.375",
  /** 1.5 - Normal body text */
  normal: "1.5",
  /** 1.625 - Relaxed spacing */
  relaxed: "1.625",
  /** 2 - Loose spacing */
  loose: "2",
} as const;

/**
 * Letter spacing
 */
export const letterSpacing = {
  /** -0.05em - Tighter */
  tighter: "-0.05em",
  /** -0.025em - Tight */
  tight: "-0.025em",
  /** 0 - Normal */
  normal: "0",
  /** 0.025em - Wide */
  wide: "0.025em",
  /** 0.05em - Wider */
  wider: "0.05em",
  /** 0.1em - Widest */
  widest: "0.1em",
} as const;

/**
 * Pre-composed typography styles for common use cases
 */
export const textStyles = {
  /** Page titles */
  h1: {
    fontSize: fontSize["3xl"],
    fontWeight: fontWeight.bold,
    lineHeight: lineHeight.tight,
    letterSpacing: letterSpacing.tight,
  },
  /** Section headings */
  h2: {
    fontSize: fontSize["2xl"],
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.tight,
    letterSpacing: letterSpacing.tight,
  },
  /** Card/panel headings */
  h3: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.snug,
  },
  /** Subheadings */
  h4: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.medium,
    lineHeight: lineHeight.snug,
  },
  /** Body text */
  body: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.normal,
    lineHeight: lineHeight.normal,
  },
  /** Small body text */
  bodySm: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.normal,
    lineHeight: lineHeight.normal,
  },
  /** Labels and captions */
  caption: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    lineHeight: lineHeight.normal,
  },
  /** Code blocks */
  code: {
    fontFamily: fontFamily.mono,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.normal,
    lineHeight: lineHeight.relaxed,
  },
} as const;

/**
 * All typography tokens combined
 */
export const typography = {
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
  letterSpacing,
  textStyles,
} as const;

export type FontFamily = typeof fontFamily;
export type FontSize = typeof fontSize;
export type FontWeight = typeof fontWeight;
export type LineHeight = typeof lineHeight;
export type LetterSpacing = typeof letterSpacing;
export type TextStyles = typeof textStyles;
export type Typography = typeof typography;
