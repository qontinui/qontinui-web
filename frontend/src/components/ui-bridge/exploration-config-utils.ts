/**
 * Pure utility functions for ExplorationConfigPanel.
 */

import type {
  ExplorationProgress,
  UIBridgeExplorationConfig,
  TargetType,
} from "./exploration-config-types";

/**
 * Calculate the exploration progress percentage.
 */
export function computeProgressPercent(
  progress: ExplorationProgress,
  config: UIBridgeExplorationConfig
): number {
  if (progress.status === "completed") return 100;
  if (progress.elementsDiscovered > 0) {
    return Math.round(
      (progress.elementsClicked / config.maxTotalElements) * 100
    );
  }
  return 0;
}

/**
 * Determine whether exploration can be started given the current config state.
 */
export function canStartExploration(
  config: UIBridgeExplorationConfig,
  selectedConnectionId: number | null
): boolean {
  return (
    (config.targetType === "extension" || selectedConnectionId !== null) &&
    (config.targetType === "extension" || !!config.targetUrl)
  );
}

/**
 * Get the disabled reason tooltip for the start button, or undefined if enabled.
 */
export function getStartDisabledReason(
  config: UIBridgeExplorationConfig,
  selectedConnectionId: number | null
): string | undefined {
  if (config.targetType !== "extension" && !selectedConnectionId) {
    return "Select a connected runner";
  }
  if (config.targetType !== "extension" && !config.targetUrl) {
    return "Enter a target URL to explore";
  }
  return undefined;
}

/**
 * Get the CSS class for a progress status badge.
 */
export function getStatusBadgeClass(
  status: ExplorationProgress["status"]
): string {
  switch (status) {
    case "running":
      return "border-brand-primary text-brand-primary animate-pulse";
    case "completed":
      return "border-brand-success text-brand-success";
    case "failed":
      return "border-red-500 text-red-500";
    default:
      return "border-yellow-500 text-yellow-500";
  }
}

/**
 * Parse a comma-separated string into an array of trimmed, non-empty strings.
 */
export function parseCommaSeparated(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Get the URL input label based on target type.
 */
export function getUrlLabel(targetType: TargetType): string {
  return targetType === "web" ? "Application URL" : "Connection URL";
}

/**
 * Get the URL input placeholder based on target type.
 */
export function getUrlPlaceholder(targetType: TargetType): string {
  if (targetType === "web") return "https://localhost:3000";
  return "ws://localhost:9877";
}
