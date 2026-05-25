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

/**
 * REST endpoint for the CI Status Dashboard surface. Tenant-scoped
 * server-side via the operator → tenant_id resolver (same as
 * device-status); the caller doesn't pass tenant_id.
 * Plan `2026-05-25-ci-status-dashboard-plan.md` Phase 3.
 */
export const CI_STATUS_API = `${OPERATIONS_API}/ci-status`;

/**
 * POST endpoint that arms a `CiGreen` gate for a repo's current main
 * tip. The web backend resolves the head SHA / tenant and forwards to
 * coord's `POST /coord/gates/register`. Plan Phase 5.
 */
export const CI_STATUS_NOTIFY_API = `${OPERATIONS_API}/ci-status/notify-when-green`;

/**
 * WebSocket URL for the CI-status push channel. Mirrors
 * `deviceStatusWsUrl`: bridges to coord's CI-status WS after the web
 * backend mints a tenant-scoped service JWT. Authenticates via the
 * `token` query-param (the JS WS API can't set headers on upgrade).
 */
export function ciStatusWsUrl(token: string): string {
  let wsBase: string;
  if (OPERATIONS_API.startsWith("https://")) {
    wsBase = "wss://" + OPERATIONS_API.slice("https://".length);
  } else if (OPERATIONS_API.startsWith("http://")) {
    wsBase = "ws://" + OPERATIONS_API.slice("http://".length);
  } else {
    wsBase = "ws://" + OPERATIONS_API;
  }
  return `${wsBase}/ci-status/ws?token=${encodeURIComponent(token)}`;
}

/**
 * Polling fallback interval (ms) when the CI-status WS is offline.
 * Matches `DEVICE_STATUS_POLL_FALLBACK_MS` — CI status changes at
 * webhook cadence, so 5s is fresh enough without hot-looping coord.
 */
export const CI_STATUS_POLL_FALLBACK_MS = 5_000;

/**
 * REST endpoint for the Phase 4.4 symbol-claims surface. Proxies coord's
 * `/coord/claims/list?kind=symbol` so the dashboard can render the
 * per-machine "currently editing" sub-line without the browser hitting
 * coord cross-origin. No tenant scoping in the pilot (matches Phase 4.3
 * design note); coord-side scoping is a follow-up.
 */
export const SYMBOL_CLAIMS_API = `${OPERATIONS_API}/symbol-claims`;

/**
 * Polling interval for `useSymbolClaimsStream` in milliseconds.
 * Coord defaults `Symbol` claims to 300s TTL; 30s polling is fresh
 * enough to surface edits within ~1 frame and slow enough to keep
 * coord's Redis SCAN budget unbothered. A WS push channel is a
 * follow-up — symbol claims churn at human-typing cadence, not the
 * sub-second cadence that justified WS for device_status.
 */
export const SYMBOL_CLAIMS_POLL_MS = 30_000;

/** Maximum symbol claims to render per machine in the MachineCard
 *  sub-line. Anything beyond is summarized with a "+N more" indicator. */
export const SYMBOL_CLAIMS_TOP_N = 5;

/** Maximum visible length of an extracted symbol name in the sub-line.
 *  Longer names get truncated with an ellipsis to keep the card stable. */
export const SYMBOL_NAME_MAX_LEN = 30;

/**
 * Extract the symbol name from a `<repo>:<file>:<symbol>` resource_key.
 *
 * Per the qontinui-supervisor `symbol_watcher` convention, the symbol
 * name is the LAST colon-separated component. Windows paths in the
 * `file` segment can contain backslashes but never colons (colons in
 * Windows paths are only legal as the drive separator at position 1,
 * which the daemon canonicalizes out), so split-by-`:` is unambiguous.
 *
 * Falls back to the full resource_key when there's no colon — defensive
 * against bad upstream data, never crashes the render path.
 */
export function extractSymbol(resourceKey: string): string {
  const idx = resourceKey.lastIndexOf(":");
  const name = idx === -1 ? resourceKey : resourceKey.slice(idx + 1);
  if (name.length <= SYMBOL_NAME_MAX_LEN) return name;
  // U+2026 HORIZONTAL ELLIPSIS keeps the visual width tight.
  return name.slice(0, SYMBOL_NAME_MAX_LEN - 1) + "…";
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
