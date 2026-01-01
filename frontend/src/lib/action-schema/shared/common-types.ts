/**
 * Common types used across all action configurations
 */

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Coordinates {
  x: number;
  y: number;
}

export type MouseButton = "LEFT" | "RIGHT" | "MIDDLE";

// Note: SearchStrategy is now exported from target-config.ts (sourced from @qontinui/schemas)
// Import it from there instead: import { SearchStrategy } from "./target-config"

export type LogLevel = "debug" | "info" | "warning" | "error";
