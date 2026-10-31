/**
 * machineHealth — the one predicate for "a machine coord reports in a state
 * other than healthy", shared by the `Dev Ops ▾` nav badge
 * (`useFleetAlarmBadge`) and `/admin/coord/home`'s Degrading section, so the
 * two can never count the same fleet differently.
 *
 * Both read coord's `GET /fleet/health` roster (`fetchFleetHealth`). A device
 * whose `state` is absent has no verdict: it is counted as having no health
 * state — UNKNOWN, never healthy and never folded into "not healthy", which
 * is a verdict coord did give.
 */

/** The one field of a `/fleet/health` device the counts read. */
export interface MachineStateRef {
  state?: string | null;
}

/** A machine coord gave a verdict for, and the verdict is not `healthy`. */
export function isNotHealthyDevice(d: MachineStateRef): boolean {
  return typeof d.state === "string" && d.state !== "" && d.state !== "healthy";
}

/** A machine coord gave no verdict for at all. */
export function hasNoHealthState(d: MachineStateRef): boolean {
  return typeof d.state !== "string" || d.state === "";
}

export interface MachineHealthCounts {
  /** Machines on coord's roster. */
  total: number;
  /** In a state other than healthy — the nav's `unhealthy`. */
  notHealthy: number;
  /** With no health state at all — unknown. */
  noState: number;
}

export function summarizeMachineHealth(
  devices: readonly MachineStateRef[]
): MachineHealthCounts {
  return {
    total: devices.length,
    notHealthy: devices.filter(isNotHealthyDevice).length,
    noState: devices.filter(hasNoHealthState).length,
  };
}
