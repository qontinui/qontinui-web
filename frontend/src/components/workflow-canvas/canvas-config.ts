/**
 * Canvas configuration - colors, dimensions, and visual settings
 *
 * Centralized configuration for the workflow canvas appearance and behavior.
 */

import { ActionCategory, ACTION_TYPE_TO_CATEGORY } from "./canvas-types";
import type { ActionType } from "@/lib/action-schema/action-types";

// ============================================================================
// Color Palette
// ============================================================================

/**
 * Base color palette for the canvas
 */
export const COLORS = {
  // Primary brand colors
  primary: "#00D9FF",
  primaryDark: "#00B8D4",
  primaryLight: "#4DFFFF",

  // Secondary colors
  secondary: "#BD00FF",
  secondaryDark: "#9D00D4",
  secondaryLight: "#D44DFF",

  // Accent colors
  accent: "#00FF88",
  accentDark: "#00D46E",
  accentLight: "#4DFFA4",

  // Node category colors
  find: "#00D9FF", // Cyan
  mouse: "#00FF88", // Green
  keyboard: "#BD00FF", // Purple
  controlFlow: "#FF9D00", // Orange
  data: "#0088FF", // Blue
  state: "#FF0080", // Pink

  // Connection type colors
  main: "#00D9FF", // Cyan - normal flow
  error: "#FF4444", // Red - error handling
  success: "#00FF88", // Green - success condition

  // State colors
  idle: "#666666",
  running: "#00D9FF",
  successState: "#00FF88",
  errorState: "#FF4444",
  warning: "#FFB800",

  // UI colors
  background: "#18181B",
  backgroundLight: "#27272A",
  border: "#3F3F46",
  borderLight: "#52525B",
  text: "#FAFAFA",
  textMuted: "#A1A1AA",
  textDark: "#71717A",

  // Selection colors
  selection: "#00D9FF",
  selectionBorder: "#00D9FF",
  selectionFill: "rgba(0, 217, 255, 0.1)",

  // Grid colors
  gridDot: "#3F3F46",
  gridLine: "#27272A",
} as const;

// ============================================================================
// Node Colors by Category
// ============================================================================

/**
 * Get color for an action category
 */
export function getCategoryColor(category: ActionCategory): string {
  const colorMap: Record<ActionCategory, string> = {
    [ActionCategory.FIND]: COLORS.find,
    [ActionCategory.MOUSE]: COLORS.mouse,
    [ActionCategory.KEYBOARD]: COLORS.keyboard,
    [ActionCategory.CONTROL_FLOW]: COLORS.controlFlow,
    [ActionCategory.DATA]: COLORS.data,
    [ActionCategory.STATE]: COLORS.state,
  };

  return colorMap[category] || COLORS.primary;
}

/**
 * Get color for an action type
 */
export function getActionTypeColor(actionType: ActionType): string {
  const category = ACTION_TYPE_TO_CATEGORY[actionType];
  return getCategoryColor(category);
}

/**
 * Get the number of output handles for an action type
 * Most actions have 1 output, but control flow actions may have multiple
 */
export function getActionOutputCount(
  actionType: ActionType,
  config?: unknown
): number {
  switch (actionType) {
    case "IF":
      // IF has 2 outputs: true and false
      return 2;

    case "SWITCH":
      // SWITCH has multiple outputs based on cases
      // Default to 3 if config not provided (case 1, case 2, default)
      return (config as { cases?: unknown[] } | undefined)?.cases?.length
        ? (config as { cases: unknown[] }).cases.length + 1
        : 3;

    case "TRY_CATCH":
      // TRY_CATCH has 2 outputs: success and error
      return 2;

    default:
      // All other actions have 1 output
      return 1;
  }
}

/**
 * Get darker shade of a color (for borders, hover states)
 */
export function getDarkerColor(color: string, amount: number = 0.2): string {
  // Simple darkening - multiply RGB values
  if (color.startsWith("#")) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);

    const newR = Math.floor(r * (1 - amount));
    const newG = Math.floor(g * (1 - amount));
    const newB = Math.floor(b * (1 - amount));

    return `#${newR.toString(16).padStart(2, "0")}${newG.toString(16).padStart(2, "0")}${newB.toString(16).padStart(2, "0")}`;
  }

  return color;
}

/**
 * Get lighter shade of a color
 */
export function getLighterColor(color: string, amount: number = 0.2): string {
  if (color.startsWith("#")) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);

    const newR = Math.min(255, Math.floor(r + (255 - r) * amount));
    const newG = Math.min(255, Math.floor(g + (255 - g) * amount));
    const newB = Math.min(255, Math.floor(b + (255 - b) * amount));

    return `#${newR.toString(16).padStart(2, "0")}${newG.toString(16).padStart(2, "0")}${newB.toString(16).padStart(2, "0")}`;
  }

  return color;
}

/**
 * Convert hex color to rgba with alpha
 */
export function hexToRgba(hex: string, alpha: number = 1): string {
  if (hex.startsWith("#")) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return hex;
}

// ============================================================================
// Connection Colors
// ============================================================================

/**
 * Get color for a connection type
 */
export function getConnectionColor(
  type: "main" | "error" | "success" | "parallel"
): string {
  const colorMap = {
    main: COLORS.main,
    error: COLORS.error,
    success: COLORS.success,
    parallel: COLORS.main, // Use main color for parallel connections
  };

  return colorMap[type] || COLORS.main;
}

/**
 * Get connection style based on type
 */
export function getConnectionStyle(
  type: "main" | "error" | "success" | "parallel"
) {
  const color = getConnectionColor(type);

  return {
    stroke: color,
    strokeWidth: 2,
    strokeDasharray: type === "parallel" ? "5,5" : undefined, // Dashed for parallel
  };
}

// ============================================================================
// Node Dimensions
// ============================================================================

/**
 * Node dimensions by category
 */
export const NODE_DIMENSIONS = {
  default: {
    width: 200,
    height: 80,
    minWidth: 150,
    maxWidth: 400,
  },
  find: {
    width: 200,
    height: 80,
    minWidth: 150,
    maxWidth: 300,
  },
  mouse: {
    width: 180,
    height: 70,
    minWidth: 140,
    maxWidth: 280,
  },
  keyboard: {
    width: 180,
    height: 70,
    minWidth: 140,
    maxWidth: 280,
  },
  controlFlow: {
    width: 220,
    height: 90,
    minWidth: 180,
    maxWidth: 350,
  },
  data: {
    width: 200,
    height: 80,
    minWidth: 150,
    maxWidth: 300,
  },
  state: {
    width: 200,
    height: 80,
    minWidth: 150,
    maxWidth: 300,
  },
} as const;

/**
 * Get dimensions for a node category
 */
export function getNodeDimensions(category: ActionCategory) {
  // Map category to property name (handle both camelCase and snake_case)
  const categoryKey = category === "control_flow" ? "controlFlow" : category;
  return (
    NODE_DIMENSIONS[categoryKey as keyof typeof NODE_DIMENSIONS] ||
    NODE_DIMENSIONS.default
  );
}

// ============================================================================
// Grid Settings
// ============================================================================

/**
 * Grid configuration
 */
export const GRID_CONFIG = {
  /** Grid size in pixels */
  size: 20,

  /** Grid type */
  type: "dots" as const, // 'dots' | 'lines' | 'cross'

  /** Grid color */
  color: COLORS.gridDot,

  /** Grid line width */
  lineWidth: 1,

  /** Grid dot size */
  dotSize: 2,

  /** Major grid line interval (every N grid lines) */
  majorInterval: 5,

  /** Major grid line color */
  majorColor: COLORS.gridLine,

  /** Major grid line width */
  majorLineWidth: 2,
};

// ============================================================================
// Snap Settings
// ============================================================================

/**
 * Snap-to-grid configuration
 */
export const SNAP_CONFIG = {
  /** Enable snap to grid */
  enabled: true,

  /** Snap grid size (should match GRID_CONFIG.size or be a multiple) */
  gridSize: 20,

  /** Snap threshold in pixels (how close before snapping) */
  threshold: 10,

  /** Snap to other nodes */
  snapToNodes: true,

  /** Snap distance for nodes */
  nodeSnapDistance: 40,

  /** Snap to center lines */
  snapToCenter: true,
};

// ============================================================================
// Zoom Settings
// ============================================================================

/**
 * Zoom configuration
 */
export const ZOOM_CONFIG = {
  /** Default zoom level */
  default: 1.0,

  /** Minimum zoom level */
  min: 0.1,

  /** Maximum zoom level */
  max: 2.0,

  /** Zoom step (mouse wheel) */
  step: 0.1,

  /** Zoom duration for animations (ms) */
  animationDuration: 200,

  /** Fit view padding */
  fitViewPadding: 0.1, // 10% padding around nodes

  /** Zoom on double click */
  zoomOnDoubleClick: false,

  /** Zoom on scroll */
  zoomOnScroll: true,

  /** Pan on scroll modifier */
  panOnScrollMode: "free" as const, // 'free' | 'vertical' | 'horizontal'
};

// ============================================================================
// Canvas Dimensions
// ============================================================================

/**
 * Canvas size configuration
 */
export const CANVAS_CONFIG = {
  /** Default canvas width */
  defaultWidth: 5000,

  /** Default canvas height */
  defaultHeight: 5000,

  /** Virtual canvas boundaries (for infinite canvas effect) */
  virtual: true,

  /** Background color */
  backgroundColor: COLORS.background,

  /** Whether to show background pattern */
  showPattern: true,

  /** Pattern type */
  patternType: "dots" as const, // 'dots' | 'lines' | 'cross'
};

// ============================================================================
// Animation Settings
// ============================================================================

/**
 * Animation configuration
 */
export const ANIMATION_CONFIG = {
  /** Flow animation speed (ms per edge) */
  flowSpeed: 1000,

  /** Flow animation enabled by default */
  flowAnimationEnabled: false,

  /** Node entrance animation */
  nodeEntrance: {
    enabled: true,
    duration: 200,
    easing: "ease-out",
  },

  /** Edge entrance animation */
  edgeEntrance: {
    enabled: true,
    duration: 150,
    easing: "ease-out",
  },

  /** Selection animation */
  selection: {
    enabled: true,
    duration: 100,
    easing: "ease-in-out",
  },

  /** Hover animation */
  hover: {
    enabled: true,
    duration: 150,
    easing: "ease-in-out",
  },
};

// ============================================================================
// Handle Configuration
// ============================================================================

/**
 * Handle (connection point) configuration
 */
export const HANDLE_CONFIG = {
  /** Handle size in pixels */
  size: 12,

  /** Handle border width */
  borderWidth: 2,

  /** Handle color */
  color: COLORS.primary,

  /** Handle hover color */
  hoverColor: COLORS.primaryLight,

  /** Handle border color */
  borderColor: COLORS.background,

  /** Show handles on hover only */
  showOnHoverOnly: false,

  /** Handle style */
  style: {
    width: 12,
    height: 12,
    borderRadius: "50%",
    border: `2px solid ${COLORS.background}`,
    background: COLORS.primary,
  },
};

// ============================================================================
// Selection Configuration
// ============================================================================

/**
 * Selection configuration
 */
export const SELECTION_CONFIG = {
  /** Selection border color */
  borderColor: COLORS.selection,

  /** Selection border width */
  borderWidth: 2,

  /** Selection fill color (for box select) */
  fillColor: COLORS.selectionFill,

  /** Multi-select mode */
  multiSelect: true,

  /** Box select enabled */
  boxSelect: true,

  /** Select on drag */
  selectNodesOnDrag: true,
};

// ============================================================================
// Edge Configuration
// ============================================================================

/**
 * Edge configuration
 */
export const EDGE_CONFIG = {
  /** Default edge type */
  type: "smoothstep" as const,

  /** Edge width */
  width: 2,

  /** Selected edge width */
  selectedWidth: 3,

  /** Edge hover width */
  hoverWidth: 3,

  /** Show edge labels */
  showLabels: true,

  /** Edge label background color */
  labelBgColor: COLORS.backgroundLight,

  /** Edge label text color */
  labelTextColor: COLORS.text,

  /** Edge label border radius */
  labelBorderRadius: 4,

  /** Edge label padding */
  labelPadding: 4,

  /** Marker (arrow) size */
  markerSize: 20,

  /** Marker color (uses edge color by default) */
  markerColor: "inherit",
};

// ============================================================================
// Minimap Configuration
// ============================================================================

/**
 * Minimap configuration
 */
export const MINIMAP_CONFIG = {
  /** Show minimap */
  enabled: true,

  /** Minimap position */
  position: "bottom-right" as const, // 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

  /** Minimap width */
  width: 200,

  /** Minimap height */
  height: 150,

  /** Node color in minimap */
  nodeColor: (node: unknown) => {
    const nodeData = node as { data?: { action?: { type?: ActionType } } };
    if (nodeData.data?.action?.type) {
      return getActionTypeColor(nodeData.data.action.type);
    }
    return COLORS.primary;
  },

  /** Node border color in minimap */
  nodeBorderRadius: 4,

  /** Background color */
  backgroundColor: hexToRgba(COLORS.background, 0.8),

  /** Mask color */
  maskColor: hexToRgba(COLORS.primary, 0.2),
};

// ============================================================================
// Controls Configuration
// ============================================================================

/**
 * Controls panel configuration
 */
export const CONTROLS_CONFIG = {
  /** Show controls */
  enabled: true,

  /** Controls position */
  position: "top-left" as const, // 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

  /** Show zoom controls */
  showZoom: true,

  /** Show fit view button */
  showFitView: true,

  /** Show interactive toggle */
  showInteractive: false,

  /** Button style */
  buttonStyle: {
    backgroundColor: COLORS.backgroundLight,
    color: COLORS.text,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 4,
    padding: 8,
  },
};

// ============================================================================
// Performance Configuration
// ============================================================================

/**
 * Performance optimization settings
 */
export const PERFORMANCE_CONFIG = {
  /** Enable node virtualization for large graphs */
  virtualize: true,

  /** Number of nodes before virtualization kicks in */
  virtualizeThreshold: 100,

  /** Debounce delay for layout recalculation (ms) */
  layoutDebounce: 100,

  /** Throttle delay for viewport updates (ms) */
  viewportThrottle: 16, // ~60fps

  /** Disable animations for large graphs */
  disableAnimationsThreshold: 200,
};
