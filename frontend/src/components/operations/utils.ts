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
  return `${wsBase}/device-status/ws?token=${encodeURIComponent(token)}${activeTenantWsParam()}`;
}

/**
 * The dashboard tenant-switcher selection as a WS query param. A browser
 * WebSocket cannot send the `X-Qontinui-Active-Tenant` header the REST
 * calls use (HttpClient attaches it from the same localStorage key), so
 * the WS bridges read `active_tenant` from the query string instead. The
 * backend membership-validates it (`_effective_tenant_id`) — a stale or
 * non-member selection degrades to the home tenant server-side.
 */
function activeTenantWsParam(): string {
  if (typeof window === "undefined") return "";
  try {
    const active = window.localStorage.getItem("qontinui.active_tenant_id");
    return active ? `&active_tenant=${encodeURIComponent(active)}` : "";
  } catch {
    return "";
  }
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
  return `${wsBase}/ci-status/ws?token=${encodeURIComponent(token)}${activeTenantWsParam()}`;
}

/**
 * Polling fallback interval (ms) when the CI-status WS is offline.
 * Matches `DEVICE_STATUS_POLL_FALLBACK_MS` — CI status changes at
 * webhook cadence, so 5s is fresh enough without hot-looping coord.
 */
export const CI_STATUS_POLL_FALLBACK_MS = 5_000;

/**
 * REST + action endpoints for the gates panel (plan
 * `2026-06-05-plan-gate-web-surface-and-productization` Phase 2). All
 * tenant-scoped server-side via the operator → tenant_id resolver (coord
 * derives the tenant from the forwarded bearer); the caller never passes a
 * tenant_id.
 *
 * - `GATES_LIST_API`         — GET list of the tenant's gates.
 * - `gateApproveUrl(id)`     — POST clear an `operator_approval` gate.
 * - `gateReopenUrl(id)`      — POST clone a cleared/failed gate into a new
 *                              open gate (undo-by-reopen).
 * - `gateAudienceUrl(id)`    — PATCH a gate's `clearance_audience`
 *                              (operator re-classification).
 * - `gateMuteUrl(id)` / `gateUnmuteUrl(id)` — POST reversible mute toggle.
 * - `gateSnoozeUrl(id)`      — POST snooze until `{until: <rfc3339>}`.
 */
export const GATES_LIST_API = `${OPERATIONS_API}/gates/list`;
/**
 * Gates-list URL with optional filters. `excludeOrphans` appends
 * `?exclude_orphans=1`, asking coord to hide ORPHANED gates — `pr_merged`
 * gates whose PR is known-closed and `ci_green` gates on superseded SHAs
 * (no longer any open PR's head); neither can ever clear. Coord treats the
 * param as a truthy string; omitting it returns the raw, unfiltered list —
 * so the bare `GATES_LIST_API` constant above stays byte-identical for
 * existing callers.
 */
export function gatesListUrl(opts: { excludeOrphans?: boolean }): string {
  return opts.excludeOrphans
    ? `${GATES_LIST_API}?exclude_orphans=1`
    : GATES_LIST_API;
}
export function gateApproveUrl(gateId: string): string {
  return `${OPERATIONS_API}/gates/${encodeURIComponent(gateId)}/approve`;
}
export function gateReopenUrl(gateId: string): string {
  return `${OPERATIONS_API}/gates/${encodeURIComponent(gateId)}/reopen`;
}
export function gateAudienceUrl(gateId: string): string {
  return `${OPERATIONS_API}/gates/${encodeURIComponent(gateId)}/audience`;
}
export function gateMuteUrl(gateId: string): string {
  return `${OPERATIONS_API}/gates/${encodeURIComponent(gateId)}/mute`;
}
export function gateUnmuteUrl(gateId: string): string {
  return `${OPERATIONS_API}/gates/${encodeURIComponent(gateId)}/unmute`;
}
export function gateSnoozeUrl(gateId: string): string {
  return `${OPERATIONS_API}/gates/${encodeURIComponent(gateId)}/snooze`;
}
/** POST reject an OPEN `operator_approval` gate. Body `{reason?}`. */
export function gateRejectUrl(gateId: string): string {
  return `${OPERATIONS_API}/gates/${encodeURIComponent(gateId)}/reject`;
}
/**
 * POST force-clear a gate regardless of its predicate (DESTRUCTIVE — clears an
 * open gate that has not met its condition). Body `{reason}` REQUIRED.
 */
export function gateForceClearUrl(gateId: string): string {
  return `${OPERATIONS_API}/gates/${encodeURIComponent(gateId)}/force-clear`;
}
/**
 * POST cancel a gate's armed/dispatched continuation so clearing it no longer
 * spawns the follow-up session. Body `{cancelled_by, reason}`.
 */
export function gateContinuationCancelUrl(gateId: string): string {
  return `${OPERATIONS_API}/gates/${encodeURIComponent(gateId)}/continuation-cancel`;
}

/**
 * Polling interval for the gates panel (ms). Gates evaluate at coord's
 * sweep cadence (10s default) and verdicts flip slowly; 15s polling
 * surfaces a flip within ~2 sweeps without hot-looping the proxy.
 */
export const GATES_POLL_MS = 15_000;

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

/**
 * REST endpoints for the dev-action ledger surface (plan
 * `2026-06-07-twin-dev-event-cause-effect-ledger.md`). Both proxy coord's
 * public `/coord/dev-actions/*` routes through the web backend so the
 * browser doesn't hit coord cross-origin and the operator bearer is
 * forwarded consistently with the other dashboard proxies.
 *
 * - `DEV_ACTIONS_API`         — GET recent dev actions.
 * - `devActionDetailUrl(id)`  — GET one action + its outcome signatures.
 */
export const DEV_ACTIONS_API = `${OPERATIONS_API}/dev-actions/recent`;
export function devActionDetailUrl(actionId: string): string {
  return `${OPERATIONS_API}/dev-actions/${encodeURIComponent(actionId)}`;
}

/** Default number of recent dev actions to request. */
export const DEV_ACTIONS_LIMIT = 50;

/**
 * Polling interval for `useDevActionsStream` (ms). Dev actions land at
 * agent-execution cadence; 10s matches the fleet-health poll and is fresh
 * enough for an operator watching the ledger without hot-looping coord.
 */
export const DEV_ACTIONS_POLL_MS = 10_000;

/**
 * Migration reservation queue surface (coord-authoritative reservation
 * queue, `migration_reservations.rs`). Proxies coord's
 * `GET /coord/migrations/queue?repo=` through the web backend so the browser
 * doesn't hit coord cross-origin and the operator bearer is forwarded
 * consistently with the other dashboard proxies.
 */
export const MIGRATIONS_QUEUE_API = `${OPERATIONS_API}/migrations/queue`;

/**
 * Default repo for the migration queue tile. Alembic migrations live in
 * `qontinui/qontinui-web`, so that is the queue an operator wants by
 * default; the tile lets them switch to any `owner/repo`.
 */
export const MIGRATIONS_DEFAULT_REPO = "qontinui/qontinui-web";

/**
 * Trailing terminal rows to request alongside the full live set. Coord
 * clamps this to 0..=50; a handful is enough context (recently
 * merged/expired/withdrawn) without flooding the tile.
 */
export const MIGRATIONS_TERMINAL_LIMIT = 8;

/**
 * Polling interval for the migration queue (ms). Reservations change at
 * author/merge cadence (a slot is taken, a PR binds, a merge flips it) —
 * 15s surfaces a transition promptly without hot-looping coord, matching
 * the gates-panel cadence.
 */
export const MIGRATIONS_QUEUE_POLL_MS = 15_000;

/**
 * Build the migration-queue request URL for a given repo. `repo` is
 * required by coord (the queue is per-repo); `terminal_limit` defaults to
 * {@link MIGRATIONS_TERMINAL_LIMIT}.
 */
export function migrationsQueueUrl(
  repo: string,
  terminalLimit: number = MIGRATIONS_TERMINAL_LIMIT
): string {
  const q = new URLSearchParams({
    repo,
    terminal_limit: String(terminalLimit),
  });
  return `${MIGRATIONS_QUEUE_API}?${q.toString()}`;
}

/**
 * PATCH endpoint to set (or clear) a machine's operator-friendly display name.
 * Body `{ name: string }`: a non-empty name sets the alias; an empty string
 * clears it (reverts to the raw hostname). Tenant/user scoped server-side via
 * the operator bearer; the caller never passes a user_id.
 * Response: `{ hostname: string, name: string | null }`.
 */
export function machineRenameUrl(hostname: string): string {
  return `${OPERATIONS_API}/fleet/machines/${encodeURIComponent(hostname)}`;
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
 * Format a stall age (seconds) as a compact human label, e.g. "45s", "12m",
 * "3h", "2d". Used by the Phase 5 device-tile stalled badge, which receives
 * the age as a precomputed `stall_age_secs` from coord (not a timestamp), so
 * `relativeTime` doesn't apply.
 */
export function formatStallAge(secs: number | null | undefined): string {
  if (secs == null || Number.isNaN(secs) || secs < 0) return "0s";
  const s = Math.floor(secs);
  if (s < 60) return `${s}s`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * Truncate a string to `maxLen` characters, appending an ellipsis if needed.
 */
export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}
