/**
 * Qontinui Theme Configuration
 *
 * Centralized theme tokens for consistent styling across the application.
 * Based on the State Structure interface dark theme aesthetic.
 */

/**
 * Core color palette using hex values
 */
export const colors = {
  // Canvas and backgrounds
  canvas: '#0A0A0B',           // Very dark grey/black - main canvas background
  panel: '#27272A',            // Dark grey - panels and cards
  panelTransparent: '#27272A', // Dark grey with 50% opacity (applied via Tailwind)

  // Accent colors
  cyan: '#00D9FF',             // Cyan - primary actions, highlights
  green: '#00FF88',            // Green - success, create actions
  purple: '#BD00FF',           // Purple - develop, state actions

  // Borders
  borderDark: '#1F1F23',       // Darker border (gray-800)
  borderMedium: '#3F3F46',     // Medium border (gray-700)

  // Dot pattern
  dotPattern: '#333333',       // ReactFlow background dots

  // Text colors (from Tailwind gray scale)
  textPrimary: '#FFFFFF',      // White - headings
  textSecondary: '#D4D4D8',    // gray-300 - body text
  textTertiary: '#A1A1AA',     // gray-400 - secondary text
  textMuted: '#71717A',        // gray-500 - muted text
} as const;

/**
 * Semantic color tokens
 * Maps intention to specific colors
 */
export const semanticColors = {
  // Backgrounds
  background: {
    primary: colors.canvas,
    secondary: colors.panel,
    secondaryTransparent: colors.panelTransparent,
  },

  // Borders
  border: {
    default: colors.borderMedium,
    strong: colors.borderDark,
  },

  // Text
  text: {
    primary: colors.textPrimary,
    secondary: colors.textSecondary,
    tertiary: colors.textTertiary,
    muted: colors.textMuted,
  },

  // Actions
  action: {
    primary: colors.cyan,
    success: colors.green,
    develop: colors.purple,
  },

  // Accents
  accent: {
    cyan: colors.cyan,
    green: colors.green,
    purple: colors.purple,
  },
} as const;

/**
 * Tailwind utility class combinations for common use cases
 */
export const styles = {
  // Canvas and containers
  canvas: 'bg-[#0A0A0B]',
  panel: 'bg-[#27272A]',
  panelTransparent: 'bg-[#27272A]/50',

  // Headers and toolbars
  header: 'bg-[#27272A] border-b border-gray-800',
  toolbar: 'bg-[#27272A] border-b border-gray-800',

  // Sidebars
  sidebar: 'bg-[#27272A]/50 border-r border-gray-800',

  // Cards and panels
  card: 'bg-[#27272A] border border-gray-700',
  cardHover: 'bg-[#27272A] border border-gray-700 hover:border-gray-600',
  cardSelected: 'bg-[#27272A] border border-[#00D9FF] ring-1 ring-[#00D9FF]',

  // Buttons
  button: {
    cyan: 'bg-[#00D9FF] text-black font-medium hover:bg-[#00D9FF]/90',
    green: 'bg-[#00FF88] text-black font-medium hover:bg-[#00FF88]/90',
    purple: 'bg-[#BD00FF] text-white font-medium hover:bg-[#BD00FF]/90',
    ghost: 'bg-transparent hover:bg-[#27272A] text-gray-300 hover:text-white',
  },

  // Inputs
  input: 'bg-[#0A0A0B] border border-gray-700 text-white placeholder:text-gray-500 focus:border-[#00D9FF] focus:ring-1 focus:ring-[#00D9FF]',
  select: 'bg-[#0A0A0B] border border-gray-700 text-white focus:border-[#00D9FF] focus:ring-1 focus:ring-[#00D9FF]',

  // Text
  text: {
    primary: 'text-white',
    secondary: 'text-gray-300',
    tertiary: 'text-gray-400',
    muted: 'text-gray-500',
  },

  // Dialogs and modals
  dialog: 'bg-[#27272A] border border-gray-700',
  dialogOverlay: 'bg-black/80',

  // Dividers
  divider: 'border-gray-800',
} as const;

/**
 * ReactFlow specific configuration
 */
export const reactFlow = {
  background: {
    variant: 'dots' as const,
    gap: 20,
    size: 1,
    color: colors.dotPattern,
  },
} as const;

/**
 * Spacing and sizing tokens
 */
export const spacing = {
  toolbar: {
    height: '3rem',
  },
  sidebar: {
    width: '16rem',
    widthExpanded: '20rem',
  },
  card: {
    padding: '1rem',
  },
} as const;

/**
 * Animation and transition tokens
 */
export const animation = {
  duration: {
    fast: '150ms',
    normal: '200ms',
    slow: '300ms',
  },
  easing: {
    default: 'cubic-bezier(0.4, 0, 0.2, 1)',
    in: 'cubic-bezier(0.4, 0, 1, 1)',
    out: 'cubic-bezier(0, 0, 0.2, 1)',
  },
} as const;

/**
 * Type exports for TypeScript support
 */
export type ThemeColors = typeof colors;
export type SemanticColors = typeof semanticColors;
export type ThemeStyles = typeof styles;
