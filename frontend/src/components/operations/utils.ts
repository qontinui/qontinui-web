// ============================================================================
// Operations Page Utility Helpers
// ============================================================================

import { ApiConfig } from "@/services/api-config";

/** API base for the operations endpoints (Phase 2 unified surface). */
export const OPERATIONS_API = `${ApiConfig.API_BASE_URL}/api/v1/operations`;

/**
 * REST endpoint for the Phase 1.3 device-status surface. Tenant-scoped
 * server-side via the operator → tenant_id resolver; the caller
 * doesn't need to pass tenant_id.
 */
export const DEVICE_STATUS_API = `${OPERATIONS_API}/device-status`;

/**
 * WebSocket URL for the Phase 1.3 device-status push channel. Bridges
 * to coord's `/ws/device-status` after minting a tenant-scoped
 * service JWT on the server side. The frontend authenticates via the
 * same `token` query-param pattern used elsewhere (the JS WS API
 * can't set custom headers on the upgrade).
 */
export function deviceStatusWsUrl(token: string): string {
  // OPERATIONS_API begins with `http://` or `https://`; translate to
  // `ws://`/`wss://` for the WS upgrade. The browser's URL constructor
  // can't help here because we're inserting the WS scheme on top of
  // an HTTP-shaped base URL.
  let wsBase: string;
  if (OPERATIONS_API.startsWith("https://")) {
    wsBase = "wss://" + OPERATIONS_API.slice("https://".length);
  } else if (OPERATIONS_API.startsWith("http://")) {
    wsBase = "ws://" + OPERATIONS_API.slice("http://".length);
  } else {
    wsBase = "ws://" + OPERATIONS_API;
  }
  return `${wsBase}/device-status/ws?token=${encodeURIComponent(token)}`;
}

/** Polling interval in milliseconds. */
export const POLL_INTERVAL_MS = 5_000;

/**
 * Polling fallback interval when the device-status WS is offline.
 * 5s matches the existing fleet-status polling cadence — slow enough
 * that polling N tenants doesn't hot-loop coord, fast enough that a
 * disconnected operator sees fresh data within one display refresh.
 */
export const DEVICE_STATUS_POLL_FALLBACK_MS = 5_000;

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
