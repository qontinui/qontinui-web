/**
 * laneFreshness — "which of this machine's sample lanes has gone quiet?", as a
 * device-row status.
 *
 * Plan
 * `2026-11-04-devops-a-silent-wsl-lane-reads-healthy-because-freshness-is-graded-on-the-newest-lane`,
 * Done-when 5 (`qontinui-web`, READ-ONLY: no route, no schema, no write path).
 *
 * ## The defect behind it
 *
 * On 2026-11-04 coord graded a device's sample freshness on its NEWEST lane, so
 * a box with a fresh `host` lane (24 s) and a silent `wsl` lane (697 s, against
 * a 120 s threshold) read `healthy`. Coord's Phase 1 (qontinui-coord#3815)
 * grades on the STALEST expected lane instead and serves, per device:
 *
 * * `stale_lanes: [{lane, lane_instance, age_secs}]`: the expected lanes past
 *   `sample_stale_after_secs`. `[]` means the freshness read succeeded and no
 *   expected lane is stale. `null` means the freshness read FAILED, and coord
 *   never sends `[]` in that case.
 * * `stalest_sample_age_secs`: the age `state` was graded on.
 *
 * Coord's badge already turns `stale`. What it cannot say is WHICH lane went
 * quiet, and an operator needs that to know where to look: the host sampler
 * and the WSL distro's sampler are separate processes.
 *
 * ## The one rule this module holds
 *
 * **A missing verdict is UNKNOWN, never "none".** There are two ways to get
 * one, and each gets its own reason:
 *
 * * `null`: coord made the read and it failed.
 * * absent (`undefined`): this coord predates the field. Same rendering,
 *   different cause.
 *
 * Neither may render as "no stale lanes". That would be the newest-lane
 * defect again: silence read as health [policy:
 * verification-and-evidence/silent-empty-is-unknown].
 */

import type { AttentionMap } from "@/components/console/attention";
import type { RowStatus, StatusPalette } from "@/components/console/statusRow";
import {
  INERT,
  UNKNOWN_AMBER,
  WAITING_AMBER,
} from "@/components/console/statusRow";

/**
 * One expected lane's freshness. A verbatim mirror of coord's
 * `fleet_health::LaneAge`.
 *
 * Declared here, in the module that owns the vocabulary, and imported by the
 * two shapes that carry it (`FleetHealthDevice`, `CoordHealthJoin`), so the
 * wire contract has exactly one spelling.
 */
export interface LaneAge {
  /** `"host"`, `"wsl"`, … (coord's closed lane vocabulary). */
  lane: string;
  /** The lane instance (e.g. the WSL distro `"Ubuntu"`); `null` for a sole publisher. */
  lane_instance?: string | null;
  /** Seconds since this lane's newest sample, computed by coord's database. */
  age_secs: number;
}

/** `fresh`: measured, nothing stale. `stale`: ≥1 named lane. `unknown`: no verdict. */
export type LaneFreshnessKind = "fresh" | "stale" | "unknown";

/**
 * The audited kind→attention table (style guide §4.2 clause 1).
 *
 * - `fresh`: **none.** Coord measured every expected lane inside the threshold.
 * - `stale`: **waiting.** Coord raises a `warning` S1 alert for the lane and
 *   pages no one. The machine is reachable and usable; one sampler is quiet.
 *   Red would claim more urgency than coord itself does.
 * - `unknown`: **waiting**, the IGNORANCE FLOOR. Never `none`.
 */
export const LANE_FRESHNESS_ATTENTION_BY_KIND: AttentionMap<LaneFreshnessKind> =
  {
    fresh: "none",
    stale: "waiting",
    unknown: "waiting",
  };

/** Built from the shared literals, never hand-spelled (§4.1). */
export const LANE_FRESHNESS_BADGE_CLASS: Record<LaneFreshnessKind, string> = {
  fresh: INERT,
  stale: WAITING_AMBER,
  unknown: UNKNOWN_AMBER,
};

export const LANE_FRESHNESS_PALETTE: StatusPalette<LaneFreshnessKind> = {
  badgeClass: LANE_FRESHNESS_BADGE_CLASS,
  // No author kind, so there is no red and no ✕.
  authorGlyphKinds: new Set<LaneFreshnessKind>(),
};

/** What the resolver reads off one coord device row. */
export interface LaneFreshnessInput {
  /** `[]` measured-fresh · `null` read failed · `undefined` coord predates the field. */
  stale_lanes?: LaneAge[] | null;
  /** The threshold coord graded against; `null`/absent = not computed. */
  sample_stale_after_secs?: number | null;
  /**
   * Coord's device `state`. Coord fills `stale_lanes` whatever the heartbeat
   * state, and applies the `stale` overlay only to a heartbeat-healthy
   * device, so only `state === "stale"` licenses saying the machine still
   * heartbeats. A `partitioned` machine with a quiet lane must not be told so.
   */
  state?: string;
}

export interface LaneFreshnessStatus extends RowStatus<LaneFreshnessKind> {
  /** The stale lanes, stalest first. Empty unless `kind === "stale"`. */
  lanes: LaneAge[];
  /** `false` on the `unknown` arm, so no caller can read a missing verdict as a pass. */
  measured: boolean;
}

/** `wsl/Ubuntu`, or a bare `host` when the lane has no instance. */
export function laneName(l: LaneAge): string {
  return l.lane_instance ? `${l.lane}/${l.lane_instance}` : l.lane;
}

/** A compact age: `45s`, `11m`, `3h`, `2d`. Non-finite or negative reads `?`. */
export function formatLaneAge(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) return "?";
  if (secs < 120) return `${Math.round(secs)}s`;
  if (secs < 2 * 3600) return `${Math.round(secs / 60)}m`;
  if (secs < 2 * 86400) return `${Math.round(secs / 3600)}h`;
  return `${Math.round(secs / 86400)}d`;
}

/**
 * The one place a coord device row's lane freshness becomes something an
 * operator reads.
 */
export function resolveLaneFreshness(
  input: LaneFreshnessInput
): LaneFreshnessStatus {
  const { stale_lanes } = input;
  const threshold =
    typeof input.sample_stale_after_secs === "number" &&
    Number.isFinite(input.sample_stale_after_secs)
      ? input.sample_stale_after_secs
      : null;

  if (stale_lanes === undefined) {
    return {
      kind: "unknown",
      label: "lane freshness unknown",
      reason:
        "Coord's fleet-health row carries no per-lane freshness for this " +
        "device. That coord build predates the field, so whether one sample " +
        "lane has gone quiet is UNKNOWN. It is not 'no stale lanes'.",
      attention: LANE_FRESHNESS_ATTENTION_BY_KIND.unknown,
      lanes: [],
      measured: false,
    };
  }
  if (stale_lanes === null || !Array.isArray(stale_lanes)) {
    return {
      kind: "unknown",
      label: "lane freshness unknown",
      reason:
        stale_lanes === null
          ? "Coord's per-lane freshness read failed this tick, so whether " +
            "one sample lane has gone quiet is UNKNOWN. It is not 'no stale " +
            "lanes'."
          : "Coord sent per-lane freshness in a shape this console cannot " +
            "read, so whether one sample lane has gone quiet is UNKNOWN. It " +
            "is not 'no stale lanes'.",
      attention: LANE_FRESHNESS_ATTENTION_BY_KIND.unknown,
      lanes: [],
      measured: false,
    };
  }
  if (stale_lanes.length === 0) {
    return {
      kind: "fresh",
      label: "lanes fresh",
      reason:
        threshold !== null
          ? `Every sample lane coord expects from this device published ` +
            `within ${formatLaneAge(threshold)}.`
          : "Every sample lane coord expects from this device is fresh.",
      attention: LANE_FRESHNESS_ATTENTION_BY_KIND.fresh,
      lanes: [],
      measured: true,
    };
  }
  const lanes = [...stale_lanes].sort((a, b) => b.age_secs - a.age_secs);
  const stalest = lanes[0]?.age_secs ?? Number.NaN;
  const named = lanes
    .map((l) => `${laneName(l)} ${formatLaneAge(l.age_secs)}`)
    .join(", ");
  return {
    kind: "stale",
    label: `stale lane: ${named}`,
    reason:
      `Coord expects samples from ${lanes.map(laneName).join(", ")} and the ` +
      `newest is ${formatLaneAge(stalest)} old` +
      (threshold !== null
        ? `, past the ${formatLaneAge(threshold)} threshold. `
        : ". ") +
      (input.state === "stale"
        ? "The machine still heartbeats. The sampler on that lane has gone " +
          "quiet, so headroom there is unknown."
        : "Headroom on that lane is unknown. Read the device state beside " +
          "this badge for whether coord still hears the machine at all."),
    attention: LANE_FRESHNESS_ATTENTION_BY_KIND.stale,
    lanes,
    measured: true,
  };
}
