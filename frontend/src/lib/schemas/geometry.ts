/**
 * Geometry types for coordinate systems, monitors, and regions.
 *
 * These types are aligned with qontinui-schemas for cross-project consistency.
 * Auto-generated from qontinui-schemas with minor adaptations for frontend use.
 *
 * @see qontinui-schemas/generated/typescript/geometry.ts
 */

/**
 * Coordinate system for positioning elements
 */
export enum CoordinateSystem {
  /** Absolute screen coordinates (origin at top-left of virtual desktop) */
  SCREEN = "screen",
  /** Virtual desktop coordinates (multi-monitor unified space) */
  VIRTUAL = "virtual",
  /** Coordinates relative to a specific monitor */
  MONITOR_RELATIVE = "monitor_relative",
}

/**
 * A point in 2D space with optional coordinate system metadata
 */
export interface Coordinates {
  /** X coordinate (horizontal position) */
  x: number;
  /** Y coordinate (vertical position) */
  y: number;
  /** Coordinate system. None defaults to SCREEN for backward compatibility. */
  system?: CoordinateSystem | null;
  /** Monitor index (required when system is MONITOR_RELATIVE) */
  monitor_index?: number | null;
}

/**
 * A rectangular region with position and dimensions
 */
export interface Region {
  /** X coordinate of top-left corner */
  x: number;
  /** Y coordinate of top-left corner */
  y: number;
  /** Width of the region */
  width: number;
  /** Height of the region */
  height: number;
  /** Coordinate system. None defaults to SCREEN for backward compatibility. */
  system?: CoordinateSystem | null;
  /** Monitor index (required when system is MONITOR_RELATIVE) */
  monitor_index?: number | null;
}

/**
 * Monitor position for UI display (based on X coordinate)
 *
 * Note: "center" is the canonical value from qontinui-schemas.
 * "middle" is accepted for backward compatibility with existing runner API.
 */
export type MonitorPosition =
  | "left"
  | "center"
  | "right"
  | "middle"
  | "primary";

/**
 * Information about a display monitor.
 *
 * This type aligns with qontinui-schemas Monitor type while supporting
 * additional fields returned by the runner API.
 */
export interface Monitor {
  /** OS-assigned monitor index (hardware enumeration order) */
  index: number;
  /** X position in absolute screen coordinates (can be negative) */
  x: number;
  /** Y position in absolute screen coordinates (can be negative) */
  y: number;
  /** Monitor width in pixels */
  width: number;
  /** Monitor height in pixels */
  height: number;
  /** Spatial position based on X coordinate (for UI display) */
  position: MonitorPosition;
  /** Whether this is the primary/main monitor */
  is_primary?: boolean;
  /** DPI scale factor (1.0 = 100%, 1.5 = 150%, 2.0 = 200%) */
  scale_factor?: number;
  /** Display name (e.g., 'DELL U2720Q') */
  name?: string | null;
}

/**
 * Extended monitor type with runner-specific fields.
 *
 * The runner API returns additional fields like `description` that are
 * not part of the base Monitor type from qontinui-schemas.
 */
export interface RunnerMonitor extends Monitor {
  /** Human-readable description of the monitor (e.g., "Monitor 0 (primary, 1920x1080)") */
  description: string;
  /** Override to ensure name is always present from runner API */
  name: string;
  /** Override to ensure is_primary is always present from runner API */
  is_primary: boolean;
}

/**
 * Virtual desktop representing all monitors in a unified coordinate space
 */
export interface VirtualDesktop {
  /** List of all monitors in the virtual desktop */
  monitors: Monitor[];
}

/**
 * Normalize monitor position values.
 *
 * The runner API may return "middle" or "primary" for position,
 * while the canonical schema uses "center". This function normalizes
 * values for consistent UI display.
 */
export function normalizeMonitorPosition(
  position: MonitorPosition
): "left" | "center" | "right" {
  if (position === "middle" || position === "primary") {
    return "center";
  }
  return position;
}

/**
 * Get a human-readable label for a monitor position
 */
export function getMonitorPositionLabel(position: MonitorPosition): string {
  const normalized = normalizeMonitorPosition(position);
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

// ============================================================================
// Coordinate Conversion Utilities
// ============================================================================

/**
 * Bounds representing the virtual desktop canvas area.
 * Used for converting between screen and canvas coordinates.
 */
export interface CanvasBounds {
  /** Total width of the virtual desktop */
  width: number;
  /** Total height of the virtual desktop */
  height: number;
  /** Minimum X coordinate (leftmost monitor's x position) */
  minX: number;
  /** Minimum Y coordinate (topmost monitor's y position) */
  minY: number;
}

/**
 * Coordinate converter utility class.
 *
 * Handles conversions between:
 * - SCREEN: Absolute screen coordinates (as reported by OS)
 * - MONITOR_RELATIVE: Relative to a specific monitor's origin (0,0)
 * - CANVAS: Relative to the virtual desktop canvas origin (bounds.minX, bounds.minY)
 *
 * IMPORTANT: Pattern coordinates in the UI are stored as MONITOR_RELATIVE.
 * When visualizing on a canvas, they must be converted to CANVAS coordinates.
 */
export class CoordinateConverter {
  private monitors: Map<number, Monitor>;
  private bounds: CanvasBounds;

  constructor(monitors: Monitor[], bounds: CanvasBounds) {
    this.monitors = new Map();
    monitors.forEach((m) => this.monitors.set(m.index, m));
    this.bounds = bounds;
  }

  /**
   * Convert MONITOR_RELATIVE coordinates to absolute SCREEN coordinates.
   *
   * @param x - X coordinate relative to monitor
   * @param y - Y coordinate relative to monitor
   * @param monitorIndex - Index of the monitor (defaults to 0)
   * @returns Absolute screen coordinates
   */
  monitorRelativeToScreen(
    x: number,
    y: number,
    monitorIndex: number = 0
  ): { x: number; y: number } {
    const monitor = this.monitors.get(monitorIndex);
    if (monitor) {
      return {
        x: monitor.x + x,
        y: monitor.y + y,
      };
    }
    // Fallback: if no monitor found, treat as already screen coords
    return { x, y };
  }

  /**
   * Convert absolute SCREEN coordinates to CANVAS coordinates.
   *
   * @param x - Absolute screen X coordinate
   * @param y - Absolute screen Y coordinate
   * @returns Canvas coordinates (relative to bounds.minX, bounds.minY)
   */
  screenToCanvas(x: number, y: number): { x: number; y: number } {
    return {
      x: x - this.bounds.minX,
      y: y - this.bounds.minY,
    };
  }

  /**
   * Convert MONITOR_RELATIVE coordinates directly to CANVAS coordinates.
   *
   * This is a convenience method that combines:
   * 1. monitorRelativeToScreen
   * 2. screenToCanvas
   *
   * @param x - X coordinate relative to monitor
   * @param y - Y coordinate relative to monitor
   * @param monitorIndex - Index of the monitor (defaults to 0)
   * @returns Canvas coordinates
   */
  monitorRelativeToCanvas(
    x: number,
    y: number,
    monitorIndex: number = 0
  ): { x: number; y: number } {
    const screen = this.monitorRelativeToScreen(x, y, monitorIndex);
    return this.screenToCanvas(screen.x, screen.y);
  }

  /**
   * Convert CANVAS coordinates to absolute SCREEN coordinates.
   *
   * @param x - Canvas X coordinate
   * @param y - Canvas Y coordinate
   * @returns Absolute screen coordinates
   */
  canvasToScreen(x: number, y: number): { x: number; y: number } {
    return {
      x: x + this.bounds.minX,
      y: y + this.bounds.minY,
    };
  }

  /**
   * Get a monitor by index.
   */
  getMonitor(index: number): Monitor | undefined {
    return this.monitors.get(index);
  }

  /**
   * Get the bounds.
   */
  getBounds(): CanvasBounds {
    return this.bounds;
  }
}
