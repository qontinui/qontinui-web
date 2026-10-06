"use client";

/**
 * Can any runner take a Regression Tests run right now? — an ADVISORY hint
 * shown by the Run control, never a gate on it.
 *
 * A run executes on a device paired to the group's project: coord's
 * `conditions/dispatch.rs` picks one through `pick_audit_device_outcome`
 * (paired, live, `claude_code_available`, undrained). When none qualifies the
 * run is still RECORDED, as an `error` run reading "no capable runner online"
 * or "every capable runner is drained". Without a hint the user clicks Run and
 * gets a red row with no warning.
 *
 * ## Sources — two existing reads, no new endpoint
 *
 * - `GET /api/v1/operations/fleet/health` (the roster `DevicePicker` is fed
 *   from) for which devices are inside coord's dispatch window.
 * - `GET /api/v1/operations/fleet/drain` for which of those coord is holding
 *   out of the fleet, parsed by the shared `parseFleetDrain`.
 *
 * Both sit under `/api/v1/operations/`, so they are already scoped to the
 * selected project by the active-tenant header.
 *
 * ## Unknown is not "no runners"
 *
 * This page is for any member, and those reads may 403 or fail for a
 * non-operator. Every failure, loading state, unrecognised shape, or a device
 * whose liveness coord does not state is UNKNOWN, and UNKNOWN shows NO hint
 * ([policy: silent-empty-is-unknown]). The hint appears only on positive
 * evidence about the listed devices.
 *
 * ## A likely outcome, never a certainty
 *
 * The hint keys on coord's `within_dispatch_window` (heartbeat within
 * `COORD_DEVICE_HEARTBEAT_TTL_SECS`, default 120 s, or probe-reachable). The
 * run picker (`pr_merge/preconditions.rs` `audit_pool_sql`) uses a LOOSER,
 * env-configurable window that is not on the wire
 * (`COORD_AUDIT_CAPABLE_LIVENESS_SECS`, default 300 s). So for a few minutes
 * after a device stops checking in the hint can warn while coord would still
 * pick it — it can warn a little early. It can also under-report: the
 * capability half of the pick (`claude_code_available`) is not on the roster
 * wire either. Both are why the wording states the observation ("has checked
 * in recently") and a PROBABLE consequence, never that the run will fail.
 * Coord's pick stays the authority, and Run is never blocked.
 */

import { useCallback, useState } from "react";
import { httpClient } from "@/services/service-factory";
import { COORD_DASHBOARD_POLL_OPTIONS } from "@/components/operations/coordPollError";
import { useSingleFlightPoll } from "@/components/operations/useSingleFlightPoll";
import {
  FLEET_HEALTH_API,
  type FleetHealthDevice,
  type FleetHealthPayload,
} from "@/components/operations/useFleetHealth";
import {
  parseFleetDrain,
  resolveDeviceDrain,
  type FleetDrainRead,
} from "@/components/operations/fleetDrain";

/** `GET /api/v1/operations/fleet/drain`, same-origin like `FLEET_HEALTH_API`. */
export const CONDITIONS_FLEET_DRAIN_API = "/api/v1/operations/fleet/drain";

/**
 * Re-read cadence. The roster pages poll every 10-30 s because liveness is
 * their whole job; here it is a side note, so once a minute is enough to catch
 * a runner coming up while the page is open.
 */
export const RUNNER_HINT_POLL_MS = 60_000;

/** Why no runner can take a run — coord's two recorded `error` summaries. */
export type RunnerHintKind = "no_runner_online" | "all_drained";

/** The roster read as far as this page got; `null` = unknown. */
export type RosterRead = FleetHealthDevice[] | null;

/**
 * Decide the hint from the two reads. PURE. Returns `null` — show nothing —
 * whenever a runner is available OR availability is unknown.
 */
export function runnerHintFor(
  roster: RosterRead,
  drain: FleetDrainRead,
  now: number
): RunnerHintKind | null {
  if (roster === null) return null;

  const online: FleetHealthDevice[] = [];
  let livenessUnknown = false;
  for (const d of roster) {
    if (d.within_dispatch_window === true) online.push(d);
    else if (d.within_dispatch_window !== false) livenessUnknown = true;
  }

  if (online.length === 0) {
    // A device coord states no liveness for might be up; do not claim none is.
    return livenessUnknown ? null : "no_runner_online";
  }

  // Some device is online: the hint applies only if coord is POSITIVELY
  // holding every one of them out of the fleet.
  for (const d of online) {
    const s = resolveDeviceDrain(drain, d.device_id, now);
    if (s.state !== "drained") return null;
  }
  return "all_drained";
}

/** The sentence shown by the Run control. */
export function runnerHintText(
  kind: RunnerHintKind,
  projectName: string | null
): string {
  const project = projectName ? `“${projectName}”` : "this project";
  if (kind === "no_runner_online") {
    return (
      `No runner paired to ${project} has checked in recently, so a run ` +
      `started now will probably fail (recorded as “no capable runner ` +
      `online”). Runs execute on a runner paired to the group's project.`
    );
  }
  return (
    `Every runner of ${project} that checked in recently is drained, so a ` +
    `run started now will probably be recorded as “every capable runner is ` +
    `drained” until a drain is lifted or expires.`
  );
}

function rosterOf(body: unknown): RosterRead {
  if (typeof body !== "object" || body === null) return null;
  const devices = (body as FleetHealthPayload).devices;
  if (!Array.isArray(devices)) return null;
  return devices.filter(
    (d): d is FleetHealthDevice =>
      typeof d === "object" && d !== null && typeof d.device_id === "string"
  );
}

/**
 * Poll both reads (single-flight, no retries, once a minute) and return the
 * hint to show, or `null`.
 */
export function useRunnerHint(): RunnerHintKind | null {
  const [roster, setRoster] = useState<RosterRead>(null);
  const [drain, setDrain] = useState<FleetDrainRead>({ state: "loading" });

  const poll = useCallback(async (isCurrent: () => boolean) => {
    const [health, drainBody] = await Promise.allSettled([
      httpClient.get<unknown>(FLEET_HEALTH_API, COORD_DASHBOARD_POLL_OPTIONS),
      httpClient.get<unknown>(
        CONDITIONS_FLEET_DRAIN_API,
        COORD_DASHBOARD_POLL_OPTIONS
      ),
    ]);
    if (!isCurrent()) return;
    setRoster(health.status === "fulfilled" ? rosterOf(health.value) : null);
    setDrain(
      drainBody.status === "fulfilled"
        ? parseFleetDrain(drainBody.value)
        : { state: "unknown", reason: "the drain read failed" }
    );
  }, []);

  useSingleFlightPoll(poll, RUNNER_HINT_POLL_MS);

  return runnerHintFor(roster, drain, Date.now());
}
