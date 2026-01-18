/**
 * Qontinui Theme Configuration
 *
 * Centralized theme tokens for consistent styling across the application.
 * These are VALUES that need programmatic JavaScript access (charts, canvas, ReactFlow, etc.)
 *
 * For CSS-based component styling, use the CSS classes in:
 *   src/styles/components.css
 *
 * Available CSS classes include:
 * - Typography: .text-h1, .text-body, .text-label, etc.
 * - Buttons: .btn-primary, .btn-secondary, .btn-success, .btn-ghost
 * - Cards: .card, .card-hover, .card-selected
 * - Explorer panels: .explorer-panel, .explorer-panel-primary, etc.
 * - Form elements: .input, .select, .form-group, .form-label
 * - Badges: .badge, .badge-success, .badge-warning, etc.
 */

// Re-export from design system for gradual migration
export { colors as designColors } from "@/design-system/tokens";

/**
 * Core color palette - Professional colors
 * Use these for programmatic color access (charts, canvas, etc.)
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
} as const;

/**
 * Semantic color tokens
 * Useful for mapping colors to semantic meanings
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
 * ReactFlow configuration
 * Used for workflow/state diagram backgrounds
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
 * Used for consistent layout calculations
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
 * Used for consistent animation timing
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
 * Shadow effects
 * Used for programmatic shadow application (e.g., in style props)
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
export type ThemeSpacing = typeof spacing;
export type ThemeAnimation = typeof animation;
export type ThemeShadows = typeof shadows;
