// ============================================================================
// Operations Page Types
//
// Mirrors the backend `/api/v1/operations/fleet` and
// `/api/v1/operations/fleet/tasks` endpoints. The runner shape is the
// canonical {@link Runner} from `@qontinui/shared-types`; per-machine
// aggregation (`MachineGroup`) is presentation logic that lives here.
// ============================================================================

import type { Runner } from "@qontinui/shared-types";

export interface ClaudeSessionInfo {
  pid: number;
  working_directory: string | null;
  started_at: string | null;
}

/**
 * One row of `coord.device_status`, mirroring the wire shape coord
 * exposes on `GET /coord/status` (plan
 * `2026-05-21-coordination-improvements.md` Phase 1.1) and pushes
 * on `WS /ws/device-status` as `{kind: "device_status.changed", row}`.
 *
 * Phase 1.3 — the operations dashboard renders a per-machine
 * "currently doing" sub-line in `MachineCard` driven by these rows.
 * The frontend joins by hostname; `device_id` is also surfaced for
 * tooltips and fallback identification when hostname is null.
 *
 * The local `DeviceStatusRow` declaration in `coordTypes.ts` is the
 * legacy untyped wire shape used by `DeviceStatusTile` (the
 * pre-tenant-scope broadcast surface). When the tile retires this
 * type can be removed from `coordTypes.ts`.
 */
export interface DeviceStatus {
  device_id: string;
  hostname: string | null;
  current_task: string | null;
  current_repo: string | null;
  current_branch: string | null;
  free_text: string | null;
  /** Open JSON bag. Conventionally carries `phase: "N/M"` from
   *  `/implement-plan` (Phase 1.4) and may carry arbitrary
   *  caller-defined extras. */
  details: Record<string, unknown>;
  /** Optional tenant scope. NULL when posted by a pre-Phase-1.1
   *  writer; the dashboard renders only the caller-tenant rows so
   *  this is informational. */
  tenant_id: string | null;
  /** RFC 3339. Drives the "<age>s ago" sub-line. */
  updated_at: string;
}

/** Wire shape returned by `GET /api/v1/operations/device-status`. */
export interface DeviceStatusResponse {
  devices: DeviceStatus[];
  count: number;
}

/**
 * One row from `GET /coord/claims/list?kind=symbol` — a live symbol
 * claim held by a machine's tree-sitter `symbol_watcher` daemon
 * (qontinui-supervisor Phase 4.1). Plan
 * `2026-05-21-coordination-improvements.md` Phase 4.4 surfaces these as
 * a "currently editing" sub-line on each `MachineCard`.
 *
 * Wire shape mirrors coord's `ClaimHolder`:
 *
 * - `machine_id` — UUID of the holding machine. Joins to the
 *   `coord.devices` table; matches `DeviceStatus.device_id` for the
 *   same machine.
 * - `resource_key` — `<repo>:<file>:<symbol-name>` format set by the
 *   symbol_watcher daemon.
 * - `ttl_seconds` — remaining TTL on the Redis key. Coord defaults
 *   `Symbol` claims to 300s; the dashboard sorts top-N by this value
 *   so the freshest edit floats to the front.
 *
 * Coord does NOT echo `acquired_at`; the dashboard derives "how long
 * ago did this edit start?" via `(default_ttl - ttl_seconds)` if it
 * ever needs to render age.
 */
export interface SymbolClaim {
  kind: "symbol";
  resource_key: string;
  machine_id: string;
  ttl_seconds: number;
}

/** Wire shape returned by `GET /api/v1/operations/symbol-claims` (which
 *  proxies coord's `/coord/claims/list?kind=symbol`). */
export interface SymbolClaimsResponse {
  kind: "symbol";
  prefix: string;
  holders: SymbolClaim[];
  truncated: boolean;
}

/**
 * Fleet status payload — directly serializes from the unified Runner
 * entity plus a hostname → Claude-session map.
 */
export interface FleetStatus {
  runners: Runner[];
  claude_sessions: Record<string, ClaudeSessionInfo[]>; // hostname -> sessions
  total_runners: number;
  total_healthy: number;
  total_running_tasks: number;
  total_claude_sessions: number;
}

export interface RunnerTaskRun {
  id: string;
  runner_id: string;
  runner_hostname: string | null;
  runner_port: number | null;
  status: string;
  prompt: string | null;
  started_at: string | null;
  workflow_name: string | null;
}

export interface AggregatedTaskRuns {
  task_runs: RunnerTaskRun[];
  total: number;
}

/**
 * Group runners by hostname for the machine-card grid. Hostname-less
 * runners are bucketed under `"unknown"` so they still surface in the
 * grid.
 *
 * `currentActivity` is the joined `coord.device_status` row for this
 * hostname (Phase 1.3). Absent when no agent on this machine has
 * posted to `/coord/status` recently, or when the WS subscription
 * is offline AND the polling fallback hasn't caught up yet.
 */
export interface MachineGroup {
  hostname: string;
  runners: Runner[];
  claudeSessions: ClaudeSessionInfo[];
  currentActivity?: DeviceStatus;
  /**
   * Up to 5 live symbol claims for this machine, sorted by `ttl_seconds`
   * descending (freshest first). Plan
   * `2026-05-21-coordination-improvements.md` Phase 4.4. Joined from
   * `useSymbolClaimsStream()` by `machine_id ↔ DeviceStatus.device_id`.
   *
   * Empty array when no symbol_watcher daemon is reporting for this
   * machine; the `MachineCard` hides the sub-line entirely in that case.
   */
  currentlyEditing?: SymbolClaim[];
}
