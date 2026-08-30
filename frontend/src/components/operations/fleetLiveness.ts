/**
 * The Dev Ops Overview's opening verdict — derived, pure, and unit-tested.
 *
 * R1 of `frontend/docs/console-ui-style-guide.md` ("health strip first") has
 * one load-bearing clause: the strip is derived from data already on the page,
 * never a second fetch. R8 has the other: the derivation is a pure module, not
 * a chain of ternaries in JSX. This is both.
 *
 * ## The rules it encodes
 *
 * - **`unknown` is never green.** A device coord reports no state for, and a
 *   read that did not answer, both hold the strip at amber. An absent signal
 *   is not an all-clear (`[policy: silent-empty-is-unknown]`).
 * - **An empty fleet is amber, not green.** "No devices reporting health" and
 *   "every device is healthy" are different facts and must not render the
 *   same; a fleet whose telemetry has gone entirely dark would otherwise read
 *   as perfect.
 * - **A failed read is amber, not red.** The failure is evidence about the
 *   network, not about the machines. Painting it red would invent an incident.
 * - **Red is reserved for coord saying it cannot reach a device**
 *   (`partitioned` / `abandoned`) — a condition, not a gap.
 * - **`stale` is its own bucket, and it is amber.** Coord's fifth
 *   `DeviceState` means the heartbeat is fine and the resource SAMPLER has
 *   gone quiet. It is neither healthy nor unreachable, and folding it into
 *   either would be a lie in a different direction each time: green would hide
 *   a publisher that has stopped, red would report a network partition that is
 *   not happening. It is also not the `unknown` catch-all — coord OBSERVED
 *   this, it did not fail to say anything.
 */

import type { FleetHealthDevice } from "./useFleetHealth";

/** Traffic-light level, same vocabulary as `console/HealthStrip`. */
export type FleetLivenessLevel = "green" | "amber" | "red";

export interface FleetLivenessSummary {
  level: FleetLivenessLevel;
  headline: string;
  /** The signals behind the verdict, in plain language. */
  detail: string;
  total: number;
  healthy: number;
  degraded: number;
  /** `partitioned` + `abandoned` — coord cannot reach the device. */
  unreachable: number;
  /**
   * `stale` — coord reaches the device, but its resource sampler has gone
   * quiet. Counted apart from both `degraded` and `unknown` because the
   * operator's next move differs: this one is a publisher to look at, not a
   * machine.
   */
  stale: number;
  /** No state, or a state this build does not recognise. Never `healthy`. */
  unknown: number;
}

/** Coord `DeviceState` values that mean "coord cannot reach this device". */
const UNREACHABLE_STATES = new Set(["partitioned", "abandoned"]);

/**
 * Coord's `stale`: the heartbeat is fine, the SAMPLER is not.
 *
 * Kept as a named constant beside `UNREACHABLE_STATES` so the two are read as
 * the deliberately different claims they are — the boundary between them is
 * the whole reason coord added a fifth variant rather than reusing the fourth.
 */
const SAMPLER_QUIET_STATE = "stale";

export function summarizeFleetLiveness(input: {
  devices: FleetHealthDevice[];
  loading: boolean;
  error: string | null;
}): FleetLivenessSummary {
  const { devices, loading, error } = input;
  let healthy = 0;
  let degraded = 0;
  let unreachable = 0;
  let stale = 0;
  let unknown = 0;
  for (const d of devices) {
    if (d.state === "healthy") healthy++;
    else if (d.state === "degraded") degraded++;
    else if (d.state === SAMPLER_QUIET_STATE) stale++;
    else if (d.state && UNREACHABLE_STATES.has(d.state)) unreachable++;
    else unknown++;
  }
  const counts = {
    total: devices.length,
    healthy,
    degraded,
    unreachable,
    stale,
    unknown,
  };

  if (error) {
    return {
      ...counts,
      level: "amber",
      headline: "Fleet health unavailable",
      detail:
        `${error} -- this says nothing about the machines themselves. ` +
        (devices.length > 0
          ? "The rows below are the last read, not a current one."
          : "Nothing has been read yet in this session."),
    };
  }
  if (loading && devices.length === 0) {
    return {
      ...counts,
      level: "amber",
      headline: "Reading fleet health",
      detail: "Coord's device list has not answered yet.",
    };
  }
  if (devices.length === 0) {
    return {
      ...counts,
      level: "amber",
      headline: "No devices reporting health",
      detail:
        "Coord's device list is empty. That is an absence of telemetry, not " +
        "an all-clear.",
    };
  }
  if (unreachable > 0) {
    return {
      ...counts,
      level: "red",
      headline: `${unreachable} of ${devices.length} machines unreachable`,
      detail:
        "Coord has stopped reaching them (partitioned or abandoned). Work " +
        "routed to them will not run.",
    };
  }
  if (degraded > 0 || stale > 0 || unknown > 0) {
    const parts: string[] = [];
    if (degraded > 0) parts.push(`${degraded} degraded`);
    if (stale > 0) parts.push(`${stale} with a silent sampler`);
    if (unknown > 0) parts.push(`${unknown} with no reported state`);
    // Most specific first: `stale` names an observation coord made, and would
    // be drowned by the generic sentence about the machines being "off".
    const detail =
      stale > 0
        ? "A machine coord still reaches whose resource sampler has gone " +
          "quiet is STALE: unknown, not healthy and not unreachable. The " +
          "telemetry stopped, which says nothing yet about the machine."
        : unknown > 0
          ? "A machine coord reports no state for is unknown, not healthy."
          : "Coord still reaches them; something about them is off.";
    return {
      ...counts,
      level: "amber",
      headline: `${devices.length} machines, ${parts.join(" and ")}`,
      detail,
    };
  }
  return {
    ...counts,
    level: "green",
    headline:
      devices.length === 1
        ? "1 machine, healthy"
        : `All ${devices.length} machines healthy`,
    detail: "Coord reaches every device it knows about.",
  };
}
