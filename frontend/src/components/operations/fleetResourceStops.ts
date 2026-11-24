/**
 * Pressure-stop rows, pure (plan
 * `2026-11-24-pressure-stops-record-box-stats-in-coord` Phase 4).
 *
 * A pressure stop is one runner resource-guard refusal or deferral, recorded in
 * coord's `coord.resource_pressure_stop_events` and served by
 * `GET /fleet/resource-stops`. This module owns the wire types and the wording
 * rules `FleetResourceStopsSection` renders through.
 *
 * ## The honesty rules
 *
 * - **Null is unknown, never zero.** `session_count_*`, `active_ci_runners` and
 *   `ci_jobs_queued` are null when the runner could not read them at refusal
 *   time. A `0` here would read as an idle box at the moment it refused work.
 * - **`table_present: false` is "not available", never "no stops".** Coord
 *   answers it while its migration has not applied; an empty list then means
 *   nothing was READ.
 * - **A lane or pool this build does not know keeps its raw token.** Coord's
 *   CHECK vocabularies can grow ahead of the web build; a quiet fallback to
 *   the nearest known word would be a different claim.
 */

import { formatBytes } from "./fleetResources";

/** One stored stop, exactly as coord serves it (nullables stay null). */
export interface ResourceStopRow {
  event_id: string;
  device_id: string;
  client_event_id: string;
  observed_at: string;
  recorded_at: string | null;
  stop_kind: string;
  /** The metric class that refused: `memory_free_commit` | `thread_pressure`. */
  lane: string;
  /** The pool that refused: `host` | `wsl` | `threads`. */
  guard_lane: string | null;
  severity: string;
  /** An allowlisted token (`terminal_spawn`, `ci_job`, …), never a command line. */
  what_class: string;
  observed: number | null;
  limit_value: number | null;
  reason: string | null;
  session_count_terminal: number | null;
  session_count_live_claude: number | null;
  active_ci_runners: number | null;
  ci_jobs_queued: number | null;
  calibration: Record<string, unknown> | null;
  fleet_calibration: Record<string, unknown> | null;
  suppressed_count: number;
  dropped_before: number;
  box_stats: Record<string, unknown> | null;
}

/** `GET /fleet/resource-stops`, as coord serves it and the proxy passes it. */
export interface ResourceStopsResponse {
  /** `false`: the coord table does not exist yet, so `stops` is UNKNOWN. */
  table_present: boolean;
  count: number;
  stops: ResourceStopRow[];
  /** `true` when `limit` truncated the page. */
  bounded: boolean;
  limit: number;
  limit_clamped: boolean;
  summary: unknown;
}

/** The headline words for the metric lane — the ones the guard dialog names. */
export function stopLaneLabel(lane: string): string {
  switch (lane) {
    case "memory_free_commit":
      return "Low memory";
    case "thread_pressure":
      return "High thread count";
    default:
      return lane;
  }
}

/** The pool that refused. `null` (an older runner) is unknown, not "host". */
export function guardLaneLabel(guardLane: string | null): string {
  switch (guardLane) {
    case null:
      return "unknown";
    case "host":
      return "host";
    case "wsl":
      return "WSL";
    case "threads":
      return "threads";
    default:
      return guardLane;
  }
}

/** A recorded count: null is `unknown`, never `0`. */
export function formatStopCount(n: number | null): string {
  return n === null || !Number.isFinite(n) ? "unknown" : String(n);
}

/**
 * The reading against its limit. Memory is bytes (free commit against the
 * floor); threads are counts. Either side null is `unknown` — a half reading
 * would invite the operator to compare against a number that is not there.
 */
export function formatObservedVsLimit(row: ResourceStopRow): string {
  const { observed, limit_value: limit } = row;
  if (observed === null || limit === null) return "unknown";
  if (row.lane === "memory_free_commit") {
    return `${formatBytes(observed)} free / floor ${formatBytes(limit)}`;
  }
  if (row.lane === "thread_pressure") {
    return `${observed} / ${limit} threads`;
  }
  return `${observed} / ${limit}`;
}

/** Session counts in one cell: terminal-hosted and live claude, each possibly unknown. */
export function formatSessions(row: ResourceStopRow): string {
  return `${formatStopCount(row.session_count_terminal)} terminal / ${formatStopCount(
    row.session_count_live_claude
  )} claude`;
}

/**
 * The distinct `source` labels the runner recorded beside each effective
 * ceiling or floor (`default`, `machine_scaled`, `policy`, …), depth-limited
 * because the object is the runner's own shape and this surface must not
 * assume more of it than a `source` string.
 */
function collectSources(value: unknown, depth: number, out: Set<string>): void {
  if (depth < 0 || typeof value !== "object" || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) collectSources(item, depth - 1, out);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "source" && typeof child === "string") out.add(child);
    else collectSources(child, depth - 1, out);
  }
}

/**
 * What the row says about the box's calibration at refusal time.
 *
 * `calibration` is always recorded by the runner; an empty object is "none
 * recorded", not a calm box. `fleet_calibration` is null until the
 * fleet-calibration collector ships, and the runner writes a typed
 * `{"state":"unknown"}` meanwhile — both render as unknown, never as zero or
 * blank.
 */
export function calibrationSummary(row: ResourceStopRow): {
  effective: string;
  fleet: string;
} {
  const calibration = row.calibration;
  let effective: string;
  if (calibration === null || Object.keys(calibration).length === 0) {
    effective = "none recorded";
  } else {
    const sources = new Set<string>();
    collectSources(calibration, 3, sources);
    effective =
      sources.size > 0
        ? `sources: ${[...sources].sort().join(", ")}`
        : `${Object.keys(calibration).length} fields recorded`;
  }
  const fleetState = row.fleet_calibration?.state;
  const fleet =
    row.fleet_calibration === null
      ? "unknown"
      : typeof fleetState === "string"
        ? fleetState
        : "recorded";
  return { effective, fleet };
}
