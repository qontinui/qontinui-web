/**
 * The Dev Ops headline figures — pure, derived, and unit-tested (plan
 * `2026-10-23-console-presentation-spaces` Phase 7).
 *
 * In presentation mode `/admin/coord/devops` opens with three figures an
 * external evaluator can say out loud: how many machines are healthy, how
 * much of the fleet's agent capacity is in use, and how many CI runners can
 * take a job. Each comes from a read the page ALREADY makes (D3.4: nothing
 * new is fetched for presentation mode; R1: derived from data already on the
 * page), and each is computed here rather than in JSX so its honesty rules are
 * assertable without a DOM.
 *
 * ## The rules every figure keeps
 *
 * - **UNKNOWN is never zero.** A read that has not answered, or whose LATEST
 *   poll failed, yields `unknown` with the reason — never `0`, never the last
 *   number dressed as current. The three sources are polled independently and
 *   each can fail on its own, so each figure decides alone.
 * - **The label names what is counted.** "Machines healthy" counts coord's own
 *   `healthy` verdict and nothing else (`ux-priorities`
 *   `a-status-signal-must-observe-the-state-it-names`); the detail line says
 *   what the rest are. Its denominator is the live machines, read the way
 *   `/admin/coord/home` reads them (`machineHealth.ts`): never the rows coord
 *   served, which include abandoned machines and placeholder rows and stop at
 *   coord's row cap.
 * - **The as-of is the read's.** Coord's own timestamp where the body carries
 *   one (fleet health's and the CI mirror's `as_of`, `servedAsOf.ts`);
 *   otherwise the moment the browser received the answer. The page's hooks
 *   stamp either on success only.
 * - **No machine is named.** A figure is a count; nothing here reads a
 *   hostname into a sentence, so the strip needs no aliasing at all.
 */

import type { HeadlineValue } from "@/components/presentation";
import type { FleetHealthDevice } from "@/lib/api/operations/coordFleet";
import {
  countDegradingStates,
  liveMachineCount,
  readMachineRoster,
  rosterCoversHealth,
  rosterCutHidesHealth,
  type RosterCompletenessRef,
  type MachineRoster,
} from "@/components/admin/coord/machineHealth";
import {
  matchesFleetRouting,
  normalizeCiRunnerStatus,
  type CiRunnerMirrorRead,
} from "./ciRunnerMirror";
import type { FleetDeviceRef } from "./fleetResources";
import { buildWorktreeSlotRows, slotRowIsKnown } from "./fleetWorktreeSlots";
import type { WorktreeSlotsResponse } from "./useFleetWorktreeSlots";

/**
 * The reader's names for every read the Dev Ops page dates in presentation
 * mode — the headline figures and each section's provenance chips. Spelled
 * once, so a chip and the figure it backs can never name one read two ways.
 */
export const DEVOPS_SOURCES = {
  fleetHealth: "coord fleet health",
  worktreeSlots: "coord worktree slots",
  ciRunnerMirror: "coord CI runner mirror",
  faultToVisibility: "coord fault-to-visibility",
  runnerInventory: "runner inventory",
  diskTelemetry: "coord disk telemetry",
  drainState: "coord drain state",
  deviceStatus: "coord device status",
  dispatchRoles: "coord dispatch roles",
  resourceSamples: "coord resource samples",
  operatorAudit: "coord operator audit",
} as const;

/**
 * The newest of several instants (ISO-8601), or `null` when none parses.
 *
 * The as-of of a read whose body dates its ROWS rather than itself — coord's
 * disk telemetry (`observed_at` per volume), the device-status stream
 * (`updated_at` per machine): the time its newest measurement was true. An
 * undatable row adds nothing, and a read with no datable row is UNKNOWN as of
 * nothing — never "now".
 */
export function latestInstant(
  values: Iterable<string | null | undefined>
): string | null {
  let newest: number | null = null;
  for (const value of values) {
    if (!value) continue;
    const t = Date.parse(value);
    if (Number.isNaN(t)) continue;
    if (newest === null || t > newest) newest = t;
  }
  return newest === null ? null : new Date(newest).toISOString();
}

/** "1 machine" / "3 machines" — every count on the strip names its unit. */
function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** The parts after a figure, joined into one readable clause. */
export function joinParts(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Machines healthy — coord's fleet-health read
// ---------------------------------------------------------------------------

export interface FleetHealthReadInput {
  devices: readonly FleetHealthDevice[];
  /** What coord says it withheld and cut; `null` before a body has answered. */
  completeness: RosterCompletenessRef | null;
  /** The read has answered at least once in this session. */
  answered: boolean;
  /** The LATEST poll's failure, if it failed. */
  error: string | null;
  /** When the current `devices` were true (coord's `as_of`, else receipt). */
  asOfMs: number | null;
}

export function machinesHealthyFigure(
  input: FleetHealthReadInput
): HeadlineValue {
  if (input.error !== null) {
    return {
      state: "unknown",
      reason:
        "The latest read of machine health failed, so how many machines are healthy is not known right now.",
    };
  }
  if (!input.answered) {
    return {
      state: "unknown",
      reason: "Machine health has not been read yet.",
    };
  }
  const roster = readMachineRoster(input.devices, input.completeness ?? {});
  // This figure is said out loud while presenting, so its words are its own:
  // "the coordination service", never "coord", and never coord's own
  // `excluded_error` text.
  // A roster that cannot vouch for every machine yields no share at all: a
  // count over a list that may be missing a degrading machine is not a count
  // of the fleet, however it is worded.
  if (!rosterCoversHealth(roster)) {
    const why: string[] = [];
    if (rosterCutHidesHealth(roster.cut)) {
      why.push(
        roster.cut.kind === "may_be_cut"
          ? "The coordination service's list of machines reached its limit and may be cut off, so how many are healthy is not known right now."
          : "The coordination service's list of machines was cut off and may leave out one that is degrading, so how many are healthy is not known right now."
      );
    }
    const withheld = withheldSentence(roster, input.devices.length === 0);
    if (withheld !== null) why.push(withheld);
    return { state: "unknown", reason: why.join(" ") };
  }
  // Past this point the only cut left is the tail coord says cannot degrade.
  const tail = roster.cut.kind === "cut_tail_only" ? roster.cut : null;
  const notCounted = figureNotCounted(roster);
  const withNotes = (sentence: string) =>
    [
      sentence,
      ...notCounted,
      ...(tail === null
        ? []
        : [
            `It lists ${tail.listed} of ${tail.total} rows, and says none of the others could be degrading.`,
          ]),
    ].join(" ");
  if (input.devices.length === 0) {
    return {
      state: "known",
      value: "0",
      detail:
        tail === null
          ? "The coordination service lists no machines for this account yet."
          : `The coordination service lists 0 of ${tail.total} rows, and says none of the others could be degrading.`,
      asOf: input.asOfMs,
    };
  }
  const live = liveMachineCount(roster.counts);
  if (live === 0) {
    // Only abandoned machines and placeholder rows: "0 of 0" is not a share.
    const n = roster.counts.abandoned;
    return {
      state: "known",
      value: "0",
      // The sentence names the abandoned machines, so the note is not repeated.
      detail: [
        n > 0
          ? `${n === 1 ? "The 1 machine the coordination service grades is" : `All ${n} machines the coordination service grades are`} abandoned, so no listed machine reports health.`
          : "The coordination service lists no live machine.",
        ...notCounted.filter((line) => line !== abandonedFigureSentence(n)),
        ...(tail === null
          ? []
          : [
              `It lists ${tail.listed} of ${tail.total} rows, and says none of the others could be degrading.`,
            ]),
      ].join(" "),
      asOf: input.asOfMs,
    };
  }
  const states = countDegradingStates(input.devices);
  const rest: string[] = [];
  if (states.partitioned > 0) rest.push(`${states.partitioned} unreachable`);
  if (states.degraded > 0) rest.push(`${states.degraded} degraded`);
  if (states.stale > 0) rest.push(`${states.stale} with telemetry gone quiet`);
  if (states.ciOffline > 0) rest.push(`${states.ciOffline} with CI offline`);
  if (roster.counts.noVerdict > 0) {
    rest.push(`${roster.counts.noVerdict} with no health verdict`);
  }
  return {
    state: "known",
    value: `${roster.counts.healthy} of ${live}`,
    detail: withNotes(
      rest.length > 0
        ? `Healthy by the coordination service's own check; ${joinParts(rest)}.`
        : notCounted.length > 0 || tail !== null
          ? "Every live machine the coordination service lists reports healthy."
          : "Every machine the coordination service knows about reports healthy."
    ),
    asOf: input.asOfMs,
  };
}

/** The abandoned machines the figure leaves out, in its own words. */
function abandonedFigureSentence(n: number): string | null {
  if (n === 0) return null;
  return n === 1
    ? "1 machine the coordination service marked abandoned after a long silence is not counted."
    : `${n} machines the coordination service marked abandoned after a long silence are not counted.`;
}

/** What the figure's count leaves out, in its own words. */
function figureNotCounted(r: MachineRoster): string[] {
  const out: string[] = [];
  const abandoned = abandonedFigureSentence(r.counts.abandoned);
  if (abandoned !== null) out.push(abandoned);
  const p = r.counts.placeholders;
  if (p > 0) {
    out.push(
      p === 1
        ? "1 placeholder row the coordination service does not grade is not counted as a machine."
        : `${p} placeholder rows the coordination service does not grade are not counted as machines.`
    );
  }
  return out;
}

/** Why the figure cannot count machines the service withheld, or null. */
function withheldSentence(r: MachineRoster, empty: boolean): string | null {
  const e = r.exclusions;
  switch (e.kind) {
    case "none_withheld":
      return null;
    case "withheld": {
      const n = e.unbound + e.boundToOtherTenant;
      const machines = `${n} ${n === 1 ? "machine" : "machines"}`;
      return empty
        ? `The coordination service lists no machines but withheld ${machines} from its list, a binding fault rather than an empty fleet, so how many are healthy is not known right now.`
        : `The coordination service also withheld ${machines} from its list, so how many are healthy is not known right now.`;
    }
    case "withheld_unmeasured":
      return "The coordination service could not count the machines it withheld from its list, so how many are healthy is not known right now.";
    case "not_stated":
      return "The coordination service does not say whether it withheld any machines from its list, so how many are healthy is not known right now.";
  }
}

// ---------------------------------------------------------------------------
// Agent workspaces in use — coord's worktree-slots read
// ---------------------------------------------------------------------------

export interface WorktreeSlotsReadInput {
  /** The page's device spine — the same one the section's table uses. */
  devices: FleetDeviceRef[];
  data: WorktreeSlotsResponse | null;
  error: string | null;
  fetchedAtMs: number | null;
}

export function workspacesInUseFigure(
  input: WorktreeSlotsReadInput
): HeadlineValue {
  if (input.error !== null) {
    return {
      state: "unknown",
      reason:
        "The latest read of agent workspaces failed, so how much capacity is in use is not known right now.",
    };
  }
  if (input.data === null) {
    return {
      state: "unknown",
      reason: "Agent workspaces have not been read yet.",
    };
  }
  const rows = buildWorktreeSlotRows(input.devices, input.data);
  const counted = rows.filter(slotRowIsKnown);
  const uncounted = rows.length - counted.length;
  if (counted.length === 0) {
    return {
      state: "unknown",
      reason:
        rows.length === 0
          ? "No machine reports agent workspace slots yet."
          : `None of the ${count(rows.length, "machine")} has a slot count confirmed as live, so capacity in use cannot be stated.`,
    };
  }
  let used = 0;
  let limit = 0;
  for (const row of counted) {
    used += row.entry.active_worktrees;
    limit += row.entry.max_worktrees;
  }
  const notes: string[] = [];
  if (uncounted > 0) {
    // Either coord's slot read does not list the machine, or it lists one
    // whose count no recent census corroborates: in both cases there is no
    // live count to add, so the machine is left out rather than counted as
    // idle.
    notes.push(
      `${count(uncounted, "machine")} not counted, with no live slot count`
    );
  }
  if (input.data.truncated) {
    notes.push("some machines were left out of the read");
  }
  return {
    state: "known",
    value: `${used} of ${limit}`,
    detail:
      `Agent workspaces in use across ${count(counted.length, "machine")}` +
      (notes.length > 0 ? `; ${joinParts(notes)}.` : "."),
    asOf: input.fetchedAtMs,
  };
}

// ---------------------------------------------------------------------------
// CI runners ready — coord's CI-runner mirror
// ---------------------------------------------------------------------------

export function ciRunnersReadyFigure(read: CiRunnerMirrorRead): HeadlineValue {
  if (read.state === "loading") {
    return {
      state: "unknown",
      reason: "The CI runner list has not been read yet.",
    };
  }
  if (read.state === "unavailable") {
    return {
      state: "unknown",
      reason:
        "The CI runner list could not be read, so how many runners can take a job is not known right now.",
    };
  }
  const rows = [...read.byHostname.values()];
  const incomplete = read.unplaceableRows > 0 || read.shadowedRows > 0;
  if (rows.length === 0) {
    // An answered roster that lists nothing is a measured zero ONLY when it
    // dropped nothing. Registrations the console could not place are runners
    // nobody can count, so a 0 there would be UNKNOWN shown as zero.
    return incomplete
      ? {
          state: "unknown",
          reason:
            "The CI runner list came back with registrations the console could not place, so how many runners can take a job is not known right now.",
        }
      : {
          state: "known",
          value: "0",
          detail: "No self-hosted CI runners are registered.",
          asOf: read.asOf,
        };
  }
  const note = incomplete
    ? " Some registrations could not be listed, so the roster is incomplete."
    : "";
  // A partition of the roster, so the detail line can name every runner the
  // figure leaves out. "Ready" is what the label says it counts: a runner
  // that can take a job NOW — online, idle, and carrying the labels fleet
  // jobs route on. A busy runner is running its one job and is counted
  // apart from them, never inside the figure.
  let ready = 0;
  let busy = 0;
  let offline = 0;
  let unrouted = 0;
  let unknown = 0;
  for (const row of rows) {
    // The mirror's own narrowing, so "status unknown" here is the same
    // verdict the machine rows' CI badge renders.
    const status = normalizeCiRunnerStatus(row.ci_runner_status);
    if (status === "offline") {
      offline += 1;
    } else if (status === "unknown") {
      unknown += 1;
    } else if (!matchesFleetRouting(row.ci_runner_labels)) {
      unrouted += 1;
    } else if (status === "busy") {
      busy += 1;
    } else {
      ready += 1;
    }
  }
  const parts: string[] = [];
  if (busy > 0) parts.push(`${busy} running a job`);
  if (offline > 0) parts.push(`${offline} offline`);
  if (unrouted > 0) {
    parts.push(
      `${count(unrouted, "runner")} online but not receiving fleet jobs`
    );
  }
  if (unknown > 0) parts.push(`${unknown} with status unknown`);
  return {
    state: "known",
    value: `${ready} of ${rows.length}`,
    detail:
      (parts.length === 0
        ? "Every registered runner is idle and can take a job."
        : `Idle and able to take a job now; ${joinParts(parts)}.`) + note,
    asOf: read.asOf,
  };
}
