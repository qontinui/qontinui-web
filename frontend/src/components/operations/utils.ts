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
 * POST endpoint that spawns a red-main fix session for a repo (red-main
 * auto-remediation Phase 4b). The web backend forwards to coord's
 * `POST /pr-merge/red-main/:repo/spawn-fix`, which opens a visible fix
 * session on the operator's device for the repo's current red episode.
 * Coord 409s when a fix session is already running for that episode or the
 * repo has no live red-main alert. `repo` is `owner/name` and is inlined
 * inside the path (the backend route captures it as `{repo:path}`, the same
 * shape as `/pr-merge/repos/:repo/profile`).
 */
export function redMainSpawnFixUrl(repo: string): string {
  return `${OPERATIONS_API}/pr-merge/red-main/${repo}/spawn-fix`;
}

// ---------------------------------------------------------------------------
// Tenant self-service merge recovery (plan
// `2026-07-30-coord-tenant-self-service-merge-recovery` Phase 4)
// ---------------------------------------------------------------------------
//
// Two reads that tell a tenant WHY their PR is wedged, and two Tier-2 writes
// that let them clear it themselves. All four proxy straight through the web
// backend to coord on the SAME paths coord's MCP tools drive, so the web and
// agent paths cannot diverge in effect. The backend proxies coord's status
// code + JSON body VERBATIM (see `_proxy_coord_passthrough` in
// `operations.py`), so coord's 409 `land_in_flight` / `batch_in_flight` and its
// deliberate 404-not-403 `*_not_found_in_tenant_scope` reach the browser
// intact instead of being flattened into a generic 500.
//
// `repo` is `owner/name` and is inlined inside the path (the backend captures
// it as `{repo:path}`, the same shape as `/pr-merge/repos/:repo/profile`).

/**
 * GET coord's "your PR is stuck" nudges for a repo — the alarm coord already
 * raises. Returns `{repo, enabled, cooldown_secs, max_nudges, nudges[],
 * stuck_now[]}`; `stuck_now[]` is coord's LIVE classification of currently
 * dirty open PRs, `nudges[]` is the notification history.
 */
export function stuckNudgesUrl(repo: string): string {
  return `${OPERATIONS_API}/pr-merge/${repo}/stuck-nudges`;
}

/**
 * GET coord's merge verdict for one PR. The card needs it for exactly one
 * thing the PR list does not carry: `proposal.proposal_id`, without which
 * there is nothing to address a cancel to.
 */
export function prMergeVerdictUrl(
  owner: string,
  name: string,
  prNumber: number
): string {
  return `${OPERATIONS_API}/pr-merge/verdict/${encodeURIComponent(
    owner
  )}/${encodeURIComponent(name)}/${prNumber}`;
}

/**
 * POST cancel a merge proposal. Body `{reason?, unblock}` — and the two
 * `unblock` values are genuinely different actions, never one button:
 * `false` STOPS (the cancelled prior stays on record and blocks a retry at
 * this commit), `true` clears the block AND re-enqueues a fresh attempt.
 * Coord 409s `land_in_flight` / `batch_in_flight` / already-terminal, and
 * 404s `proposal_not_found_in_tenant_scope` cross-tenant.
 */
export function proposalCancelUrl(proposalId: string): string {
  return `${OPERATIONS_API}/pr-merge/proposals/${encodeURIComponent(
    proposalId
  )}/cancel`;
}

/**
 * POST re-run coord's merge decision for one PR against fresh GitHub truth.
 * No body. Returns `{repo, pr_number, evaluated, result: "pass"|"block",
 * outer_state, block_reason_code, block_payload}`, or 404
 * `pr_not_found_in_tenant_scope` when the PR is outside the caller's tenant.
 */
export function prReevaluateUrl(
  owner: string,
  name: string,
  prNumber: number
): string {
  return `${OPERATIONS_API}/pr-merge/prs/${encodeURIComponent(
    owner
  )}/${encodeURIComponent(name)}/${prNumber}/reevaluate`;
}

/**
 * Polling interval for the stuck-PR recovery panel (ms). A wedge is a
 * minutes-to-hours condition and each poll costs coord a nudge scan, so 30s is
 * fresh enough to reflect a remediation without hot-looping the proxy.
 */
export const STUCK_PR_POLL_MS = 30_000;

/**
 * Maximum stuck PRs the recovery panel renders at once. A repo with 30 wedged
 * PRs has a systemic problem, not 30 individual ones — the panel says so
 * rather than rendering 30 diagnosis cards.
 */
export const STUCK_PR_MAX_CARDS = 6;

/**
 * How many candidates the panel reads a merge verdict for per poll.
 *
 * Deliberately ABOVE {@link STUCK_PR_MAX_CARDS}: the verdict is what retracts a
 * candidate the age screen caught but that turns out to be moving normally, and
 * every retraction promotes the next candidate into view. Reading exactly
 * `STUCK_PR_MAX_CARDS` would leave a promoted card with no verdict — and, since
 * the fused list is the same on the next poll, permanently stuck on "merge
 * attempt not read yet". The headroom covers the retractions without letting a
 * repo with 30 wedged PRs turn one poll into 30 reads.
 */
export const STUCK_PR_MAX_VERDICT_READS = STUCK_PR_MAX_CARDS + 4;

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
 * POST endpoint that sets a PR's GitHub draft state (plan
 * `2026-07-23-operator-set-pr-draft-state`). Body `{draft: bool}`: `false`
 * marks the PR ready-for-review (releasing it to the merge train), `true`
 * converts it back to draft (the documented hold). The web backend forwards
 * the operator's Cognito bearer to coord's
 * `POST /coord/repos/{owner}/{repo}/pull-requests/{number}/draft-state`; the
 * caller never passes a tenant_id. `owner`/`repo` come from splitting the
 * row's `owner/name` repo string.
 */
export function prDraftStateUrl(
  owner: string,
  repo: string,
  number: number
): string {
  return `${OPERATIONS_API}/prs/${encodeURIComponent(owner)}/${encodeURIComponent(
    repo
  )}/${number}/draft-state`;
}

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
 * Polling interval for the migration queue (ms). Reservations change at
 * author/merge cadence (a slot is taken, a PR binds, a merge flips it) —
 * 15s surfaces a transition promptly without hot-looping coord, matching
 * the gates-panel cadence.
 */
export const MIGRATIONS_QUEUE_POLL_MS = 15_000;

/**
 * Build the migration-queue request URL for a given repo. `repo` is
 * required by coord (the queue is per-repo).
 */
export function migrationsQueueUrl(repo: string): string {
  const q = new URLSearchParams({ repo });
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
 *
 * MOVED to `@/components/console/time` by plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 1, and
 * re-exported here so all **23** existing importers are untouched (13 via
 * `@/components/operations/utils`, 10 via `./utils`). It moved because the
 * console primitives need it and this module is the merge-train route
 * catalogue — a `console/` → `operations/` runtime edge for one pure 28-line
 * formatter. NEW code imports it from `@/components/console`.
 *
 * Six further files declare their own `relativeTime` rather than importing
 * one, so they are NOT in that 23 and were not touched; see
 * `console/time.ts`'s module doc for the list. They are later-wave debt.
 */
export { relativeTime } from "@/components/console/time";

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

// ---------------------------------------------------------------------------
// Volume free space (disk monitoring, Phase 1)
// ---------------------------------------------------------------------------
//
// Plan `2026-08-07-product-disk-monitoring-and-cleanup.md` Phase 1. Reads
// coord's `worktree_volume` head through the web proxy — no alembic migration
// ships with this phase, and web never touches coord's Postgres schema.

/**
 * GET the latest volume snapshot for every device in the caller's tenant.
 * Tenant-scoped server-side via the operator bearer; the caller passes no
 * tenant_id. A device with no telemetry is ABSENT from the payload — that is
 * UNKNOWN, never zero (plan D10).
 */
export const FLEET_VOLUMES_API = `${OPERATIONS_API}/fleet/volumes`;

/**
 * GET one device's latest volume snapshot (per-device sibling of the above).
 *
 * NOTE: intentionally unwired in Phase 1 — the fleet read covers every card, so
 * nothing calls this yet. Phase 2 (per-device drill-down) is its first
 * consumer; it is not accidentally-dead code.
 */
export function deviceVolumesUrl(deviceId: string): string {
  return `${OPERATIONS_API}/devices/${encodeURIComponent(deviceId)}/volumes`;
}

/**
 * Age at which a volume reading stops being presented as current.
 *
 * The runner publishes on a short tick (Phase 1 step 1 targets 60s), so a
 * reading older than 5 minutes means the publisher missed several ticks. It is
 * still SHOWN — with its age — because a stale number plus its age is
 * information, whereas hiding it would be indistinguishable from "no disks".
 */
export const VOLUME_STALE_AFTER_MS = 5 * 60_000;

/**
 * Free-space bands, in bytes. These are the runner's existing thresholds
 * (`census.rs` `COORD_LOW_DISK_WARN_BYTES` / `COORD_LOW_DISK_CRIT_BYTES`:
 * 100 GiB warn, 25 GiB crit), promoted here so the dashboard colours agree
 * with the log-side warning rather than inventing a second opinion. Phase 3
 * replaces both with per-device configuration.
 */
export const VOLUME_WARN_FREE_BYTES = 100 * 1024 ** 3;
export const VOLUME_CRIT_FREE_BYTES = 25 * 1024 ** 3;

/** Severity band for a volume's free space. */
export type VolumeSeverity = "ok" | "warn" | "critical";

/**
 * Band a volume's free space, or `null` when there is nothing to band.
 *
 * A non-finite input (`NaN` from a byte count that did not arrive as a number,
 * `Infinity`) has NO severity. It must not fall through the `<` comparisons
 * into the `"ok"` arm: both `NaN < CRIT` and `NaN < WARN` are false, so the
 * naive form returns green — a fabricated "healthy" badge for a volume that was
 * never measured, which is exactly the render this feature exists to remove.
 * The hazard is fixed HERE rather than at each call site, because the next
 * consumer of this shared helper is the one that forgets to guard.
 */
export function volumeSeverity(freeBytes: number): VolumeSeverity | null {
  if (!Number.isFinite(freeBytes)) return null;
  if (freeBytes < VOLUME_CRIT_FREE_BYTES) return "critical";
  if (freeBytes < VOLUME_WARN_FREE_BYTES) return "warn";
  return "ok";
}

const BINARY_UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"] as const;

/**
 * Format a byte count with BINARY units (KiB/GiB/TiB), which is what the
 * thresholds above are expressed in and what Windows' own "GB" actually means.
 * Labelling them `GiB` removes the ambiguity rather than papering over it.
 *
 * Returns `"unknown"` for a non-finite or negative input — a value that could
 * not be computed says so instead of rendering as `0 B`.
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "unknown";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BINARY_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // Sub-unit values keep one decimal; bytes stay integral.
  const text = unit === 0 ? String(Math.round(value)) : value.toFixed(1);
  return `${text} ${BINARY_UNITS[unit]}`;
}

/**
 * Percentage of a volume that is FREE, rounded to one decimal. Returns `null`
 * when the total is unusable (0, negative, non-finite) — a percentage that
 * cannot be computed must render as "unknown", never as 0 %.
 */
export function percentFree(
  freeBytes: number,
  totalBytes: number
): number | null {
  if (!Number.isFinite(freeBytes) || !Number.isFinite(totalBytes)) return null;
  if (totalBytes <= 0 || freeBytes < 0) return null;
  return Math.round((freeBytes / totalBytes) * 1000) / 10;
}

/**
 * Age of a reading in milliseconds, or `null` when it cannot be computed
 * (absent/unparseable timestamp). A future timestamp clamps to 0 rather than
 * going negative — clock skew is not evidence of freshness, but it is also not
 * evidence of staleness.
 */
export function readingAgeMs(
  observedAt: string | null | undefined
): number | null {
  if (!observedAt) return null;
  const then = new Date(observedAt).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, Date.now() - then);
}

/**
 * Truncate a string to `maxLen` characters, appending an ellipsis if needed.
 */
export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

// ---------------------------------------------------------------------------
// Gate clearance provenance (plan
// `2026-07-27-configurable-gate-clearance-authority` Phase 6)
// ---------------------------------------------------------------------------

/**
 * The clearance-provenance fields coord stamps when a gate reaches a terminal
 * verdict (columns added by web migration `gates_clearance_provenance_01`).
 * Every field is optional + nullable: a coord predating the provenance deploy
 * omits them all, and the summary is simply not rendered.
 */
export interface ClearanceProvenance {
  /** Which door moved the gate: `operator_route | agent_attest | agent_reject
   *  | withdraw | force_clear | sweep` (free text — future values render). */
  cleared_via?: string | null;
  /** Device UUID of the caller that moved the gate. */
  cleared_by_device_id?: string | null;
  /** Agent UUID of the caller (agent-token sessions only). */
  cleared_by_agent_id?: string | null;
  /** `policy_rules.policy_id` of the `gate_clearance` rule that authorized
   *  the action; null for operator routes and the no-rule defaults. */
  cleared_under_rule?: string | null;
}

/** Verb rendered for each known `cleared_via` door. Unknown non-null values
 *  degrade to "cleared via <value>" — never a crash, never a hidden row. */
const CLEARED_VIA_VERBS: Record<string, string> = {
  operator_route: "cleared by operator",
  agent_attest: "attested",
  agent_reject: "rejected",
  withdraw: "withdrawn",
  force_clear: "force-cleared",
  sweep: "cleared by sweep",
};

/** The agent-facing doors — the only ones that run a clearance-authority
 *  resolution, so the only ones for which "no rule" means "the audience
 *  default decided" rather than "no resolution happened". */
const AGENT_CLEARANCE_DOORS: ReadonlySet<string> = new Set([
  "agent_attest",
  "agent_reject",
]);

/**
 * Optional band annotation for the deciding `gate_clearance` rule. NOT on the
 * wire — the caller derives it by looking `cleared_under_rule` up in the
 * tenant's current rule set (see `admin/coord/_shared/clearanceRuleBand.ts`).
 * Omit it and the sentence renders exactly as it did before this option
 * existed.
 */
export interface ClearanceProvenanceOptions {
  /** `"tenant"` / `"system"` when the deciding rule was found in the current
   *  rule set; `"unknown"` when the set WAS read and no longer carries the id.
   *  `null`/omitted — including "the set was never read" — renders the
   *  un-annotated "under rule <id>", which claims nothing either way. */
  ruleBand?: "tenant" | "system" | "unknown" | null;
  /** When true AND the door is an agent door that carries no rule, say so:
   *  the built-in audience default decided, which is a real answer rather than
   *  a missing one. Opt-in so existing callers render byte-identically. */
  noteAudienceDefault?: boolean;
}

/** How each band is spelled in the sentence. */
const RULE_BAND_PHRASES: Record<"tenant" | "system" | "unknown", string> = {
  tenant: "under tenant rule",
  system: "under system default rule",
  // Deliberately not a band — the caller could not establish one, and
  // guessing "tenant" here is exactly the mis-diagnosis this cell exists to
  // prevent.
  unknown: "under rule",
};

/** UUID → 8-char short form for display (full value belongs in a title). */
function shortId(id: string): string {
  return id.slice(0, 8);
}

/**
 * Human-readable clearance-provenance sentence, e.g.
 * `"attested by agent 6f2a91c3 on 1b2c3d4e under rule 9e8d7c6b"`.
 *
 * Composes from whichever fields are present (each independently optional —
 * a device-JWT clearance has no agent id; operator routes have no rule).
 * Returns `null` when NO provenance field is set, so callers can render
 * nothing — the panel must look identical to today against a coord that does
 * not emit the columns yet.
 *
 * `opts` adds the band of the deciding rule ("tenant rule" / "system default
 * rule" / an explicit "band unknown") and, on an agent door with no rule, the
 * "no rule matched — audience default" statement. Both are opt-in: called with
 * one argument this function is byte-identical to its pre-`opts` behaviour.
 */
export function summarizeClearanceProvenance(
  p: ClearanceProvenance,
  opts?: ClearanceProvenanceOptions
): string | null {
  const via = p.cleared_via ?? null;
  const agent = p.cleared_by_agent_id ?? null;
  const device = p.cleared_by_device_id ?? null;
  const rule = p.cleared_under_rule ?? null;
  if (!via && !agent && !device && !rule) return null;

  const verb = via
    ? (CLEARED_VIA_VERBS[via] ?? `cleared via ${via}`)
    : "cleared";
  const parts: string[] = [verb];
  if (agent) parts.push(`by agent ${shortId(agent)}`);
  if (device) {
    // "on <device>" when the sentence already names an actor (an agent id, or
    // a verb that itself says "by …" — operator/sweep); "by <device>" only
    // when the device IS the actor. Avoids "cleared by operator by <id>".
    const actorNamed = agent !== null || verb.includes(" by ");
    parts.push(actorNamed ? `on ${shortId(device)}` : `by ${shortId(device)}`);
  }
  if (rule) {
    // No band supplied → the un-annotated phrase, identical to today. An
    // explicit "unknown" is a different statement (the set was read and the
    // rule is gone) and is called out.
    // `?? "unknown"` picks the LOOKUP KEY for the un-annotated phrase ("under
    // rule <id>"); it is not a claim that the band is unknown. The explicit
    // "(band unknown)" suffix below fires only when the caller actually said
    // so — i.e. it read the rule set and the rule was not in it.
    const band = opts?.ruleBand ?? "unknown";
    parts.push(`${RULE_BAND_PHRASES[band]} ${shortId(rule)}`);
    if (opts?.ruleBand === "unknown") parts.push("(band unknown)");
  } else if (
    opts?.noteAudienceDefault &&
    via &&
    AGENT_CLEARANCE_DOORS.has(via)
  ) {
    parts.push("— no clearance rule matched (audience default)");
  }
  return parts.join(" ");
}
