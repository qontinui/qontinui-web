/**
 * Qontinui Design System - Spacing Tokens
 *
 * Consistent spacing scale for margins, padding, and gaps.
 */

/**
 * Spacing scale (rem-based)
 * Based on a 4px base unit (0.25rem)
 */
export const space = {
  /** 0px */
  "0": "0",
  /** 1px */
  px: "1px",
  /** 2px - Tiny spacing */
  "0.5": "0.125rem",
  /** 4px - Extra small */
  "1": "0.25rem",
  /** 6px */
  "1.5": "0.375rem",
  /** 8px - Small */
  "2": "0.5rem",
  /** 10px */
  "2.5": "0.625rem",
  /** 12px */
  "3": "0.75rem",
  /** 14px */
  "3.5": "0.875rem",
  /** 16px - Base */
  "4": "1rem",
  /** 20px */
  "5": "1.25rem",
  /** 24px - Medium */
  "6": "1.5rem",
  /** 28px */
  "7": "1.75rem",
  /** 32px - Large */
  "8": "2rem",
  /** 36px */
  "9": "2.25rem",
  /** 40px */
  "10": "2.5rem",
  /** 44px */
  "11": "2.75rem",
  /** 48px - Extra large */
  "12": "3rem",
  /** 56px */
  "14": "3.5rem",
  /** 64px */
  "16": "4rem",
  /** 80px */
  "20": "5rem",
  /** 96px */
  "24": "6rem",
} as const;

/**
 * Semantic spacing for specific use cases
 */
export const semanticSpace = {
  /** Spacing between inline elements */
  inline: {
    xs: space["1"], // 4px
    sm: space["2"], // 8px
    md: space["3"], // 12px
    lg: space["4"], // 16px
  },
  /** Spacing between stacked elements */
  stack: {
    xs: space["2"], // 8px
    sm: space["3"], // 12px
    md: space["4"], // 16px
    lg: space["6"], // 24px
    xl: space["8"], // 32px
  },
  /** Container padding */
  padding: {
    xs: space["2"], // 8px
    sm: space["3"], // 12px
    md: space["4"], // 16px
    lg: space["6"], // 24px
    xl: space["8"], // 32px
  },
  /** Section margins */
  section: {
    sm: space["6"], // 24px
    md: space["8"], // 32px
    lg: space["12"], // 48px
  },
} as const;

/**
 * Component-specific sizing
 */
export const componentSize = {
  /** Button sizes */
  button: {
    sm: { height: "2rem", padding: space["3"] }, // 32px, 12px
    md: { height: "2.5rem", padding: space["4"] }, // 40px, 16px
    lg: { height: "3rem", padding: space["6"] }, // 48px, 24px
  },
  /** Input sizes */
  input: {
    sm: { height: "2rem", padding: space["2"] }, // 32px, 8px
    md: { height: "2.5rem", padding: space["3"] }, // 40px, 12px
    lg: { height: "3rem", padding: space["4"] }, // 48px, 16px
  },
  /** Icon sizes */
  icon: {
    xs: "0.75rem", // 12px
    sm: "1rem", // 16px
    md: "1.25rem", // 20px
    lg: "1.5rem", // 24px
    xl: "2rem", // 32px
  },
  /** Avatar sizes */
  avatar: {
    xs: "1.5rem", // 24px
    sm: "2rem", // 32px
    md: "2.5rem", // 40px
    lg: "3rem", // 48px
    xl: "4rem", // 64px
  },
} as const;

/**
 * Layout dimensions
 */
export const layout = {
  /** Sidebar widths */
  sidebar: {
    collapsed: "4rem", // 64px
    default: "16rem", // 256px
    expanded: "20rem", // 320px
  },
  /** Header/toolbar heights */
  header: {
    sm: "2.5rem", // 40px
    md: "3rem", // 48px
    lg: "4rem", // 64px
  },
  /** Max content widths */
  maxWidth: {
    sm: "40rem", // 640px
    md: "48rem", // 768px
    lg: "64rem", // 1024px
    xl: "80rem", // 1280px
    "2xl": "96rem", // 1536px
    full: "100%",
  },
} as const;

/**
 * Border radius
 */
export const radius = {
  /** 0px - No rounding */
  none: "0",
  /** 2px - Minimal */
  sm: "0.125rem",
  /** 4px - Small */
  DEFAULT: "0.25rem",
  /** 6px - Medium */
  md: "0.375rem",
  /** 8px - Default for cards */
  lg: "0.5rem",
  /** 12px - Large */
  xl: "0.75rem",
  /** 16px - Extra large */
  "2xl": "1rem",
  /** 24px */
  "3xl": "1.5rem",
  /** Full circle */
  full: "9999px",
} as const;

/**
 * All spacing tokens combined
 */
export const spacing = {
  space,
  semanticSpace,
  componentSize,
  layout,
  radius,
} as const;

export type Space = typeof space;
export type SemanticSpace = typeof semanticSpace;
export type ComponentSize = typeof componentSize;
export type Layout = typeof layout;
export type Radius = typeof radius;
export type Spacing = typeof spacing;
