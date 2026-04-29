// ============================================================================
// Operations Page Utility Helpers
// ============================================================================

import { ApiConfig } from "@/services/api-config";

/** API base for the operations endpoints (Phase 2 unified surface). */
export const OPERATIONS_API = `${ApiConfig.API_BASE_URL}/api/v1/operations`;

/** Polling interval in milliseconds. */
export const POLL_INTERVAL_MS = 5_000;

/**
 * Convert an ISO timestamp to a human-friendly relative string.
 * e.g. "3s ago", "2m ago", "1h ago", "3d ago"
 */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "never";

  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;

  if (Number.isNaN(diffMs) || diffMs < 0) return "just now";

  const seconds = Math.floor(diffMs / 1_000);
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Truncate a string to `maxLen` characters, appending an ellipsis if needed.
 */
export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}
