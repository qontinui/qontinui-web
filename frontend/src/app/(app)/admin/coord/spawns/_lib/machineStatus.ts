/**
 * machineStatus — one line per machine on `/admin/coord/spawns` (plan
 * `2026-10-23-console-presentation-spaces` Phase 4, "per-machine status"):
 * whether it takes new work (drain), what work it may take (dispatch role),
 * how much automated work it carries against its ceiling, and how many
 * sessions it has open now. Pure; each arm is unit-tested
 * (`machineStatus.test.ts`).
 *
 * Every column comes from a read the console already makes, through the
 * existing reader — nothing here re-derives a verdict:
 *
 * | column | source | reader |
 * |---|---|---|
 * | the machines | coord fleet health (`/fleet/health`) | `useFleetHealth` |
 * | drain | coord's drain map (`/fleet/drain`) — Dev Ops' read | `useFleetDrain`, `resolveDeviceDrain` |
 * | dispatch role | `/fleet/dispatch-roles` | `useFleetDispatchRoles`, `describeRole` |
 * | sessions open now | coord's session run record (`/session-runs/concurrency`), `open_now` | `useSessionConcurrency`, session-load's `machineLines` (its silent-machine rule) |
 * | in flight vs ceiling, held reasons | — | none: see {@link IN_FLIGHT_UNKNOWN} |
 *
 * ## In flight against ceiling is UNKNOWN, by a named missing door
 *
 * Coord states each device's in-flight autofix count, the ceilings and the
 * held reasons only in `GET /coord/agent-fixer-arm-readiness` (`admission`),
 * a door that admits coord-signed device and agent tokens and refuses the
 * operator's sign-in the web backend forwards. No web passthrough reads it, so
 * the column says so — once for the list and in each line's title — rather
 * than rendering a 0 or a blank.
 *
 * ## A failed roster refresh keeps the list, and says so
 *
 * The roster's last good answer stays on screen, because a failed read says
 * nothing about the fleet; {@link machineListStale} says it is stale above the
 * list, and each line carries the mark.
 *
 * ## Sessions open now is UNKNOWN unless coord counted it
 *
 * It is coord's `open_now`, and only for a machine that is registered and
 * heartbeating (session-load's rule): a silent machine's open runs are not a
 * count of anything live. A machine the run record does not list is UNKNOWN
 * too — absent is not zero.
 */

import type { FleetHealthDevice } from "@/lib/api/operations/coordFleet";
import {
  LANES,
  ROLE_OPENS,
  describeRole,
  type DispatchRolesRead,
  type RoleMachine,
} from "@/components/operations/fleetDispatchRoles";
import {
  formatDrainRemaining,
  resolveDeviceDrain,
  type FleetDrainRead,
} from "@/components/operations/fleetDrain";
import { presentedFailureReason } from "@/components/operations/presentedFailure";
import type { MachineIdentity } from "@/components/presentation";
import {
  machineLines,
  sessionLoadIssueText,
  type ConcurrencyWire,
  type SessionLoadIssue,
} from "@/app/(app)/admin/coord/session-load/_lib/sessionLoadStatus";

/** One value on a machine's line. */
export interface MachineCell {
  /** Machine-readable (`drained`, `known`, `unknown` …). */
  state: string;
  text: string;
  title?: string;
  /** Amber: the value could not be read, or it is the last good read. */
  unknown: boolean;
}

export interface MachineStatusLine {
  /** The coord device id. */
  key: string;
  identity: MachineIdentity;
  /** The line is from the roster's last good read: its latest refresh failed. */
  stale: boolean;
  drain: MachineCell;
  role: MachineCell;
  inFlight: MachineCell;
  sessions: MachineCell;
}

/** The session run read, as its hook holds it. */
export interface SessionsRead {
  data: ConcurrencyWire | null;
  issue: SessionLoadIssue | null;
}

export interface MachineStatusInput {
  /** The fleet roster, or `null` before it was read. */
  devices: ReadonlyArray<FleetHealthDevice> | null;
  devicesError: string | null;
  drain: FleetDrainRead;
  roles: DispatchRolesRead;
  sessions: SessionsRead;
  /** The window the session read covers, in words ("the last 24 hours"). */
  sessionsWindowLabel: string;
  nowMs: number;
  presenting: boolean;
}

/** Why in-flight against ceiling cannot be shown — once per list, and per line. */
export const IN_FLIGHT_UNKNOWN = {
  operator:
    "No web door reads coord's spawn-admission counts. Each device's in-flight autofix count, the ceilings and the held reasons are served only by GET /coord/agent-fixer-arm-readiness (its admission block), which admits coord-signed device and agent tokens and refuses the operator sign-in the web backend forwards.",
  presented:
    "How much automated work each machine carries against its limit is not shown yet: the coordination service does not offer that figure to this console.",
} as const;

function unknown(text: string, title?: string): MachineCell {
  return { state: "unknown", text, title, unknown: true };
}

function sameId(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function drainCell(
  read: FleetDrainRead,
  deviceId: string,
  nowMs: number,
  presenting: boolean
): MachineCell {
  const d = resolveDeviceDrain(read, deviceId, nowMs);
  switch (d.state) {
    case "drained": {
      const until = formatDrainRemaining(d.entry.until, nowMs);
      return {
        state: "drained",
        text: `out of service — back ${until}`,
        title: presenting
          ? undefined
          : `Drained until ${d.entry.until}${d.entry.reason ? ` — ${d.entry.reason}` : ""}${d.entry.drainedBy ? ` (by ${d.entry.drainedBy})` : ""}.`,
        unknown: false,
      };
    }
    case "expired":
      return {
        state: "expired",
        text: "drain expired — taking new work",
        title: presenting
          ? undefined
          : `The drain held until ${d.entry.until}; coord evaluates expiry on read, so this machine is taking work again.`,
        unknown: false,
      };
    case "not_drained":
      return { state: "not_drained", text: "taking new work", unknown: false };
    case "unknown":
      return unknown(
        "drain UNKNOWN",
        presenting
          ? "Whether this machine is taking new work could not be read."
          : d.reason
      );
  }
}

/**
 * A machine's role in an outsider's words. "Workhorse", "Bench" and "CI node"
 * are the operator's names and no glossary term reads them, so while
 * presenting a role is said as what it lets the machine take (`ROLE_OPENS`,
 * the role's whole definition).
 */
export function presentedRoleText(m: RoleMachine): string {
  if (m.unrecognisedRole !== null) return "Role not recognised";
  if (m.role === null) {
    // As `describeRole`: another tenant's role may close a lane this tenant's
    // absent row would open.
    const closedElsewhere = m.lanes
      ? LANES.filter(
          (l) => !(l === "agent" && m.hostOnly) && m.lanes![l].role === "closed"
        )
      : [];
    if (closedElsewhere.length > 0)
      return "Limited by another project's setting";
  }
  const opens = m.role === null ? ROLE_OPENS.workhorse : ROLE_OPENS[m.role];
  const takes =
    opens.agent && opens.ci
      ? "Takes sessions and builds"
      : opens.ci
        ? "Takes builds only"
        : opens.agent
          ? "Takes sessions only"
          : "Takes no new work";
  if (m.role === null) return `${takes} (no role set)`;
  return m.registered ? takes : `${takes} (not yet registered)`;
}

function roleCell(
  read: DispatchRolesRead,
  deviceId: string,
  presenting: boolean
): MachineCell {
  if (read.state === "loading") {
    return unknown("role UNKNOWN", "The dispatch roles are still being read.");
  }
  if (read.state === "unknown") {
    return unknown(
      "role UNKNOWN",
      presenting ? "The dispatch roles could not be read." : read.reason
    );
  }
  const m = read.machines.find(
    (x) => x.deviceId !== null && sameId(x.deviceId, deviceId)
  );
  if (!m) {
    return unknown(
      "role UNKNOWN",
      read.rosterTruncated === true
        ? "The role read does not list this machine, and it reported its device list as cut short — the machine may have been cut."
        : "The role read does not list this machine."
    );
  }
  return {
    state: m.role ?? "unassigned",
    text: presenting ? presentedRoleText(m) : describeRole(m),
    unknown: false,
  };
}

function sessionsCell(
  read: SessionsRead,
  deviceId: string,
  windowLabel: string,
  presenting: boolean
): MachineCell {
  if (read.data === null) {
    if (read.issue === null) {
      return unknown("UNKNOWN", "The session run record is still being read.");
    }
    return unknown(
      "UNKNOWN",
      presenting
        ? "How many sessions this machine has open could not be read."
        : sessionLoadIssueText(
            read.issue,
            "how many sessions this machine has open"
          )
    );
  }
  const stale = read.issue !== null;
  const line = machineLines(read.data, null).find((l) =>
    sameId(l.deviceId, deviceId)
  );
  if (!line) {
    return unknown(
      "UNKNOWN",
      `The session run record lists no run on this machine in ${windowLabel}, so how many it has open now is unknown — not none.`
    );
  }
  if (line.openNow === null) {
    return unknown(
      "UNKNOWN",
      presenting
        ? "This machine has not reported recently, so how many sessions it has open now is unknown."
        : line.status.reason
    );
  }
  const staleNote = stale
    ? presenting
      ? " (from the last good read)"
      : ` (at the last good read — the latest refresh failed: ${presentedFailureReason(sessionLoadIssueText(read.issue!, "the latest figure"), presenting)})`
    : "";
  return {
    state: "known",
    text: `${line.openNow} open now${stale ? " (stale)" : ""}`,
    title: `${line.openNow} session${line.openNow === 1 ? "" : "s"} open on this machine, as the session run record counts them${staleNote}.`,
    unknown: stale,
  };
}

/** One line per machine in the fleet roster, in the roster's own order. */
export function machineStatusLines(
  input: MachineStatusInput
): MachineStatusLine[] | null {
  if (input.devices === null) return null;
  return input.devices.map((d) => ({
    key: d.device_id,
    identity: { deviceId: d.device_id, hostname: d.hostname ?? null },
    stale: input.devicesError !== null,
    drain: drainCell(input.drain, d.device_id, input.nowMs, input.presenting),
    role: roleCell(input.roles, d.device_id, input.presenting),
    inFlight: unknown(
      "UNKNOWN",
      input.presenting
        ? IN_FLIGHT_UNKNOWN.presented
        : IN_FLIGHT_UNKNOWN.operator
    ),
    sessions: sessionsCell(
      input.sessions,
      d.device_id,
      input.sessionsWindowLabel,
      input.presenting
    ),
  }));
}

/** Why the machine list itself cannot be shown, or `null` when it can. */
export function machineListUnknown(
  input: Pick<MachineStatusInput, "devices" | "devicesError" | "presenting">
): string | null {
  if (input.devices !== null) return null;
  if (input.devicesError === null) return "Reading the fleet roster…";
  return `The fleet roster could not be read (${presentedFailureReason(input.devicesError, input.presenting)}), so which machines exist is unknown — not none.`;
}

/**
 * Why the list shown is not the roster as it is now, or `null` when it is: a
 * failed refresh keeps the last good list (a failed read says nothing about
 * the fleet), and a machine added or removed since is not on it.
 */
export function machineListStale(
  input: Pick<MachineStatusInput, "devices" | "devicesError" | "presenting">
): string | null {
  if (input.devices === null || input.devicesError === null) return null;
  return `The latest refresh of the fleet roster failed (${presentedFailureReason(input.devicesError, input.presenting)}), so this list is from the last good read: a machine added or removed since then is not reflected.`;
}
