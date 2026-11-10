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
 * - **Red is reserved for coord saying it cannot reach a live device**
 *   (`partitioned`) — a condition, not a gap.
 * - **The population is the live machines, not the rows.** An `abandoned`
 *   machine has been silent past coord's timer and a placeholder row is not a
 *   machine; coord's own project state grades neither as a degradation, and
 *   `/admin/coord/home` counts them the same way (`machineHealth.ts`). Neither
 *   can turn the strip red, and neither can be the reason it reads green: a
 *   roster of only those is amber. On a long-lived tenant they are most of the
 *   roster (measured 2026-11-02: 879 of the 1000 rows served, of 4645), so
 *   counting them read "933 of 1000 machines unreachable" permanently, and 1000
 *   was coord's row cap, not a machine count. The cost is that a machine that
 *   crashes leaves this count once the timer runs out: coord has no
 *   decommission state to tell the two apart, so the detail line and the
 *   abandoned badge keep it in view.
 * - **Only a roster that vouches for every machine can be green.** A machine
 *   coord withheld, or a cut that may hide a degrading one, holds the strip at
 *   amber (`rosterCoversHealth`). A cut of only the dead tail does not, and the
 *   detail says how many rows are not listed.
 * - **`stale` is its own bucket, and it is amber.** Coord's fifth
 *   `DeviceState` means the heartbeat is fine and the resource SAMPLER has
 *   gone quiet. It is neither healthy nor unreachable, and folding it into
 *   either would be a lie in a different direction each time: green would hide
 *   a publisher that has stopped, red would report a network partition that is
 *   not happening. It is also not the `unknown` catch-all — coord OBSERVED
 *   this, it did not fail to say anything.
 * - **`ci_unrefreshed` is its own bucket too, and it is amber.** Coord's
 *   registrar has not refreshed a CI registration recently, and nothing
 *   contradicts it. Coord raises no degradation for it, so it never turns the
 *   strip red, but it is not healthy, so it never lets the strip read green.
 */

import type {
  FleetHealthDevice,
  FleetHealthPayload,
} from "@/lib/api/operations/coordFleet";
import {
  abandonedNotCountedSentence,
  ciUnrefreshedPhrase,
  countDegradingStates,
  emptyRosterSentence,
  isRosterComplete,
  liveMachineCount,
  noLiveMachineSentence,
  readMachineRoster,
  rosterCoversHealth,
  readRosterCut,
  rosterCutHidesHealth,
  rosterDisclosures,
  retiredRowsSentence,
  rosterIncompleteSentence,
  type RosterCompletenessRef,
  type RosterCut,
} from "@/components/admin/coord/machineHealth";
import { joinParts } from "./devOpsHeadline";

/** Traffic-light level, same vocabulary as `console/HealthStrip`. */
export type FleetLivenessLevel = "green" | "amber" | "red";

export interface FleetLivenessSummary {
  level: FleetLivenessLevel;
  headline: string;
  /** The signals behind the verdict, in plain language. */
  detail: string;
  /**
   * How many live machines coord's list holds (neither abandoned nor a
   * placeholder row), or `null` when that is not known: no list has been read
   * (`answered` is false), or none is live on a roster that cannot vouch for
   * every machine. `null` is "unknown", never `0`: a whole roster with none
   * live is `0`, and the badge must not render the one as the other
   * (`[policy: unknown-must-not-render-as-a-default]`).
   */
  total: number | null;
  /** The roster cannot vouch for every machine, so `total` is a floor. */
  totalIsFloor: boolean;
  /**
   * What coord's row cap left out, in a few words for the badge, or `null`
   * when the list is whole. Worded in rows: a roster row is not always a
   * machine.
   */
  rosterNote: string | null;
  healthy: number;
  degraded: number;
  /** `partitioned` — coord cannot reach the live device. */
  unreachable: number;
  /**
   * `stale` — coord reaches the device, but its resource sampler has gone
   * quiet. Counted apart from both `degraded` and `unknown` because the
   * operator's next move differs: this one is a publisher to look at, not a
   * machine.
   */
  stale: number;
  /** `ci_offline` — coord's verdict that the machine's CI runner is offline. */
  ciOffline: number;
  /**
   * `ci_unrefreshed` — a CI registration coord's registrar has not refreshed
   * recently, with no contrary measurement. Not a degradation, not unknown,
   * and never healthy.
   */
  ciUnrefreshed: number;
  /** No state, or a state this build does not recognise. Never `healthy`. */
  unknown: number;
  /** `abandoned` listed — silent past coord's timer, and in no other count. */
  abandoned: number;
  /** Rows were cut, so more abandoned machines may be unlisted: a floor. */
  abandonedIsFloor: boolean;
  /**
   * Why the nav's "N unhealthy" is more than this strip counts, or null when
   * they agree or a failed read leaves the two apart. The nav deliberately
   * counts every verdict other than healthy (`machineHealth.ts`), and is
   * operator-only, so this line is too.
   */
  navReconcile: string | null;
}

/** The roster's cut, from a fleet-health body. A body not read yet is whole. */
export function fleetRosterCut(data: FleetHealthPayload | null): RosterCut {
  return readRosterCut({
    devices: data?.devices ?? [],
    truncated: data?.truncated,
    total: data?.total,
    degradable_dropped: data?.degradable_dropped,
    row_cap: data?.row_cap,
  });
}

/** The badge's note on a cut roster, or null when the list is whole. */
function rosterNoteFor(cut: RosterCut): string | null {
  if (cut.kind === "whole") return null;
  if (cut.kind === "may_be_cut") return "list may be cut";
  const total = "total" in cut ? cut.total : null;
  return `${total !== null ? `${total} roster rows` : "list cut"}${rosterCutHidesHealth(cut) ? ", some health unknown" : ""}`;
}

export function summarizeFleetLiveness(input: {
  devices: FleetHealthDevice[];
  /**
   * The body the devices came from (or `null` before one has answered): what
   * coord says it withheld and cut. Required, so no caller can read a roster
   * without reading how much of it was served.
   */
  completeness: RosterCompletenessRef | null;
  loading: boolean;
  error: string | null;
  /**
   * Whether coord's device list has answered at least once. A failed poll
   * keeps the last answer, so an error over an ANSWERED whole empty list is
   * still a known `0`; an unanswered read is `null`.
   */
  answered: boolean;
}): FleetLivenessSummary {
  const { devices, loading, error, answered } = input;
  const roster = readMachineRoster(devices, input.completeness ?? {});
  const states = countDegradingStates(devices);
  const live = liveMachineCount(roster.counts);
  const unreachable = states.partitioned;
  const covers = rosterCoversHealth(roster);
  // "None live" from a roster that cannot vouch for every machine is UNKNOWN,
  // not 0: the badge says so, as the headline figure does on the same body.
  const knownLive = live === 0 && !covers ? null : live;
  // Its own words, not home's: no arm here is sure to have named these above.
  const { notDegradations } = roster.counts;
  const notCounted = [
    notDegradations.abandoned > 0 && `${notDegradations.abandoned} abandoned`,
    notDegradations.noVerdict > 0 &&
      `${notDegradations.noVerdict} with no health verdict`,
    notDegradations.ciUnrefreshed > 0 &&
      ciUnrefreshedPhrase(notDegradations.ciUnrefreshed),
    notDegradations.placeholders > 0 &&
      `${notDegradations.placeholders} placeholder ${notDegradations.placeholders === 1 ? "row" : "rows"}`,
  ].filter((part): part is string => part !== false);
  const counts = {
    total: knownLive,
    totalIsFloor: !covers,
    rosterNote: rosterNoteFor(roster.cut),
    healthy: roster.counts.healthy,
    degraded: states.degraded,
    unreachable,
    stale: states.stale,
    ciOffline: states.ciOffline,
    ciUnrefreshed: roster.counts.ciUnrefreshed,
    unknown: roster.counts.noVerdict,
    abandoned: roster.counts.abandoned,
    abandonedIsFloor: roster.cut.kind !== "whole",
    navReconcile:
      notCounted.length === 0
        ? null
        : `The nav's ${roster.counts.notHealthy} unhealthy also counts what is not a degradation here: ${joinParts(notCounted)}.`,
  };
  // The strip is shown while presenting, so coord's own `excluded_error` text
  // stays out of it: the reason is on `/admin/coord/home`, operator view.
  const reasons = { withReason: false };
  const left = rosterDisclosures(roster, reasons);
  /** A sentence, then what the count left out, less what the sentence said. */
  const withLeft = (sentence: string, ...said: (string | null)[]) =>
    [sentence, ...left.filter((line) => !said.includes(line))].join(" ");
  const incompleteLine = rosterIncompleteSentence(roster.exclusions, reasons);

  if (error) {
    return {
      ...counts,
      total: answered ? knownLive : null,
      // The nav polls on its own, so a kept reading cannot explain its count.
      navReconcile: null,
      level: "amber",
      headline: "Fleet health unavailable",
      detail:
        `${error} -- this says nothing about the machines themselves. ` +
        (answered
          ? [
              "The rows below are the last read, not a current one.",
              ...left,
            ].join(" ")
          : "Nothing has been read yet in this session."),
    };
  }
  if (loading && !answered) {
    return {
      ...counts,
      total: null,
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
      detail: isRosterComplete(roster.exclusions)
        ? withLeft(
            [
              "Coord's device list is empty. That is an absence of telemetry, " +
                "not an all-clear.",
              retiredRowsSentence(roster.exclusions),
            ]
              .filter(Boolean)
              .join(" ")
          )
        : // Coord withheld machines: a binding fault, not an empty fleet.
          withLeft(
            emptyRosterSentence(roster.exclusions, reasons),
            incompleteLine
          ),
    };
  }
  if (live === 0) {
    // Only abandoned machines and placeholder rows: nothing live reports.
    return {
      ...counts,
      level: "amber",
      headline: "No live machines reporting health",
      detail:
        roster.counts.abandoned > 0
          ? withLeft(
              noLiveMachineSentence(roster.counts),
              abandonedNotCountedSentence(roster.counts)
            )
          : withLeft(
              emptyRosterSentence(roster.exclusions, reasons),
              incompleteLine
            ),
    };
  }
  const population = `${live} ${covers ? "" : "listed "}${live === 1 ? "machine" : "machines"}`;
  if (unreachable > 0) {
    return {
      ...counts,
      level: "red",
      headline: `${unreachable} of ${population} unreachable`,
      detail: withLeft(
        unreachable === 1
          ? "Coord has stopped reaching it (partitioned). Work routed to it will not run."
          : "Coord has stopped reaching them (partitioned). Work routed to them will not run."
      ),
    };
  }
  if (
    states.degraded > 0 ||
    states.stale > 0 ||
    states.ciOffline > 0 ||
    roster.counts.ciUnrefreshed > 0 ||
    roster.counts.noVerdict > 0
  ) {
    const parts: string[] = [];
    if (states.degraded > 0) parts.push(`${states.degraded} degraded`);
    if (states.stale > 0) parts.push(`${states.stale} with a silent sampler`);
    if (states.ciOffline > 0) parts.push(`${states.ciOffline} with CI offline`);
    if (roster.counts.ciUnrefreshed > 0) {
      parts.push(
        `${roster.counts.ciUnrefreshed} not refreshed by the registrar`
      );
    }
    if (roster.counts.noVerdict > 0) {
      parts.push(`${roster.counts.noVerdict} with no health verdict`);
    }
    // Most specific first: `stale` names an observation coord made, and would
    // be drowned by the generic sentence about the machines being "off".
    const detail =
      states.stale > 0
        ? "A machine coord still reaches whose resource sampler has gone " +
          "quiet is STALE: unknown, not healthy and not unreachable. The " +
          "telemetry stopped, which says nothing yet about the machine."
        : roster.counts.noVerdict > 0
          ? "A machine coord gives no health verdict for is unknown, not healthy."
          : states.degraded > 0
            ? states.degraded === 1
              ? "Coord's recent checks of one failed, and it has not given up on it."
              : "Coord's recent checks of them failed, and it has not given up on them."
            : states.ciOffline === 1
              ? "Its CI runner is offline, or GitHub no longer lists its registration."
              : states.ciOffline > 1
                ? "Their CI runners are offline, or GitHub no longer lists their registrations."
                : // Only registrations the registrar has not refreshed.
                  "A CI registration coord's registrar has not refreshed " +
                  "recently is not healthy, but nothing says it is offline " +
                  "either: its refresh is late, and coord does not count that " +
                  "as a degradation.";
    return {
      ...counts,
      level: "amber",
      headline: `${population}, ${joinParts(parts)}`,
      detail: withLeft(detail),
    };
  }
  if (!covers) {
    return {
      ...counts,
      level: "amber",
      headline: `${population} healthy, any others unknown`,
      detail: withLeft("Every live machine listed reports healthy."),
    };
  }
  return {
    ...counts,
    level: "green",
    headline:
      live === 1 ? "1 machine, healthy" : `All ${live} machines healthy`,
    // "Reports", not "reaches": this read's `state`, not its `dispatch_liveness`.
    detail: withLeft(
      left.length === 0
        ? "Every machine coord knows about reports healthy."
        : "Every live machine coord lists reports healthy."
    ),
  };
}
