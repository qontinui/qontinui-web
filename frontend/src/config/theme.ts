/**
 * Qontinui Theme Configuration
 *
 * Centralized theme tokens for consistent styling across the application.
 * Updated to professional palette - softer than neon while maintaining hierarchy.
 *
 * Migration Guide:
 * - Replace `colors.cyan` with `colors.brand.primary`
 * - Replace `colors.purple` with `colors.brand.secondary`
 * - Replace `colors.green` with `colors.brand.success`
 * - Replace `colors.canvas` with `colors.surface.canvas`
 * - Replace `colors.panel` with `colors.surface.raised`
 * - Replace `styles.button.cyan` with `styles.button.primary`
 */

// Re-export from design system for gradual migration
export { colors as designColors } from "@/design-system/tokens";

/**
 * Core color palette - Professional colors
 */
export const colors = {
  // Brand colors
  brand: {
    primary: "#4A90D9", // Slate Blue - primary actions
    secondary: "#8B6BB5", // Muted Violet - secondary/build
    success: "#4DB89D", // Soft Teal - success states
  },

  // Surface colors
  surface: {
    canvas: "#111115", // Deep Gray - main background
    raised: "#1E1E22", // Card Gray - elevated surfaces
    hover: "#252529", // Hover state
    active: "#2C2C32", // Active state
    overlay: "rgba(0, 0, 0, 0.8)",
  },

  // Border colors
  border: {
    subtle: "#2A2A30",
    default: "#3A3A42",
    strong: "#4A4A54",
    interactive: "#5A5A66",
  },

  // Text colors
  text: {
    primary: "#FFFFFF",
    secondary: "#E4E4E7",
    tertiary: "#A1A1AA",
    muted: "#71717A",
    disabled: "#52525B",
  },

  // Semantic colors
  semantic: {
    success: "#4DB89D",
    warning: "#E5A853",
    error: "#E5534B",
    info: "#4A90D9",
  },

  // Glow effects (softer)
  glow: {
    primary: "rgba(74, 144, 217, 0.2)",
    secondary: "rgba(139, 107, 181, 0.2)",
    success: "rgba(77, 184, 157, 0.2)",
  },

  // Legacy colors (for backward compatibility during migration)
  /** @deprecated Use colors.surface.canvas */
  canvas: "#111115",
  /** @deprecated Use colors.surface.raised */
  panel: "#1E1E22",
  /** @deprecated Use colors.brand.primary */
  cyan: "#4A90D9",
  /** @deprecated Use colors.brand.success */
  green: "#4DB89D",
  /** @deprecated Use colors.brand.secondary */
  purple: "#8B6BB5",
  /** @deprecated Use colors.border.subtle */
  borderDark: "#2A2A30",
  /** @deprecated Use colors.border.default */
  borderMedium: "#3A3A42",
  /** @deprecated */
  dotPattern: "#3A3A42",
  /** @deprecated Use colors.text.primary */
  textPrimary: "#FFFFFF",
  /** @deprecated Use colors.text.secondary */
  textSecondary: "#E4E4E7",
  /** @deprecated Use colors.text.tertiary */
  textTertiary: "#A1A1AA",
  /** @deprecated Use colors.text.muted */
  textMuted: "#71717A",
} as const;

/**
 * Semantic color tokens
 */
export const semanticColors = {
  background: {
    primary: colors.surface.canvas,
    secondary: colors.surface.raised,
    hover: colors.surface.hover,
    active: colors.surface.active,
  },
  border: {
    default: colors.border.default,
    subtle: colors.border.subtle,
    strong: colors.border.strong,
  },
  text: {
    primary: colors.text.primary,
    secondary: colors.text.secondary,
    tertiary: colors.text.tertiary,
    muted: colors.text.muted,
  },
  action: {
    primary: colors.brand.primary,
    success: colors.brand.success,
    secondary: colors.brand.secondary,
  },
  accent: {
    primary: colors.brand.primary,
    secondary: colors.brand.secondary,
    success: colors.brand.success,
  },
} as const;

/**
 * Tailwind utility class combinations
 */
export const styles = {
  // Canvas and containers
  canvas: "bg-surface-canvas",
  panel: "bg-surface-raised",

  // Headers and toolbars
  header: "bg-surface-raised border-b border-border-subtle",
  toolbar: "bg-surface-raised border-b border-border-subtle",

  // Sidebars
  sidebar: "bg-surface-raised/50 border-r border-border-subtle",

  // Cards and panels
  card: "bg-surface-raised border border-border-default rounded-lg",
  cardHover:
    "bg-surface-raised border border-border-default rounded-lg hover:border-border-strong",
  cardSelected:
    "bg-surface-raised border border-brand-primary rounded-lg ring-1 ring-brand-primary",

  // Buttons
  button: {
    primary:
      "bg-brand-primary text-white font-medium hover:bg-brand-primary/90",
    secondary:
      "bg-brand-secondary text-white font-medium hover:bg-brand-secondary/90",
    success:
      "bg-brand-success text-white font-medium hover:bg-brand-success/90",
    ghost:
      "bg-transparent hover:bg-surface-hover text-gray-300 hover:text-white",
    destructive: "bg-error text-white font-medium hover:bg-error/90",
    // Legacy aliases
    /** @deprecated Use button.primary */
    cyan: "bg-brand-primary text-white font-medium hover:bg-brand-primary/90",
    /** @deprecated Use button.success */
    green: "bg-brand-success text-white font-medium hover:bg-brand-success/90",
    /** @deprecated Use button.secondary */
    purple:
      "bg-brand-secondary text-white font-medium hover:bg-brand-secondary/90",
  },

  // Inputs
  input:
    "bg-surface-canvas border border-border-default text-white placeholder:text-muted-foreground focus:border-brand-primary focus:ring-1 focus:ring-brand-primary rounded-md",
  select:
    "bg-surface-canvas border border-border-default text-white focus:border-brand-primary focus:ring-1 focus:ring-brand-primary rounded-md",

  // Text
  text: {
    primary: "text-white",
    secondary: "text-gray-200",
    tertiary: "text-gray-400",
    muted: "text-gray-500",
  },

  // Dialogs and modals
  dialog: "bg-surface-raised border border-border-default rounded-lg",
  dialogOverlay: "bg-black/80",

  // Dividers
  divider: "border-border-subtle",

  // Focus states
  focus:
    "focus:outline-none focus:ring-2 focus:ring-brand-primary focus:ring-offset-2 focus:ring-offset-surface-canvas",
} as const;

/**
 * ReactFlow configuration
 */
export const reactFlow = {
  background: {
    variant: "dots" as const,
    gap: 20,
    size: 1,
    color: colors.border.default,
  },
} as const;

/**
 * Spacing and sizing tokens
 */
export const spacing = {
  toolbar: {
    height: "3rem",
  },
  sidebar: {
    width: "16rem",
    widthCollapsed: "4rem",
    widthExpanded: "20rem",
  },
  card: {
    padding: "1rem",
  },
  header: {
    height: "3rem",
  },
} as const;

/**
 * Animation and transition tokens
 */
export const animation = {
  duration: {
    fast: "150ms",
    normal: "200ms",
    slow: "300ms",
  },
  easing: {
    default: "cubic-bezier(0.4, 0, 0.2, 1)",
    in: "cubic-bezier(0.4, 0, 1, 1)",
    out: "cubic-bezier(0, 0, 0.2, 1)",
  },
} as const;

/**
 * Shadow effects (softer than neon)
 */
export const shadows = {
  glow: {
    primary: `0 0 12px ${colors.glow.primary}`,
    secondary: `0 0 12px ${colors.glow.secondary}`,
    success: `0 0 12px ${colors.glow.success}`,
  },
  elevation: {
    sm: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
    md: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
    lg: "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
  },
} as const;

/**
 * Type exports
 */
export type ThemeColors = typeof colors;
export type SemanticColors = typeof semanticColors;
export type ThemeStyles = typeof styles;
export type ThemeSpacing = typeof spacing;
export type ThemeAnimation = typeof animation;
export type ThemeShadows = typeof shadows;
