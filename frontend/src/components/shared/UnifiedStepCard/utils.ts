/**
 * Utility functions for UnifiedStepCard
 */

/**
 * Helper to resolve an ID to a display name
 */
export function resolveName(id: string, nameMap?: Map<string, string>): string {
  return nameMap?.get(id) ?? id;
}

/**
 * Format duration in milliseconds to human-readable string
 */
export function formatDuration(ms: number): string {
  if (ms === 0) return "0ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${((ms % 60000) / 1000).toFixed(0)}s`;
}
