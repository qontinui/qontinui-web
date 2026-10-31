/**
 * machineHealth — how a coord `GET /fleet/health` device is counted, by the
 * two surfaces that count them: the `Dev Ops ▾` nav badge
 * (`useFleetAlarmBadge`) and `/admin/coord/home`'s Degrading section.
 *
 * They ask different questions, so they have different predicates, and the
 * home page reconciles the two in words:
 *
 * - **The nav** counts every machine coord gave a verdict other than
 *   `healthy` ({@link isNotHealthyDevice}). Unchanged since before home read
 *   the roster.
 * - **Home** follows coord's own project state, which already turns a
 *   machine into a degradation row per device for `degraded`, `partitioned`,
 *   `stale` and `ci_offline`, and deliberately not for `healthy`,
 *   `abandoned` (a decision), coord's explicit `unknown` (a stored state it
 *   could not parse), or a placeholder row coord has never had a liveness
 *   signal from (`dispatch_liveness: "unknown"`) — `qontinui-coord`
 *   `crates/coord/src/project_state.rs` `roster_degradations`. So on home an
 *   `abandoned` machine is never degrading, and `unknown`, a placeholder, or
 *   a device with no `state` at all has NO VERDICT: UNKNOWN, never degrading
 *   and never healthy ({@link machineVerdict}).
 *
 * A machine coord already listed as a degradation row is not counted again
 * ({@link degradingCoverage}). The machines the nav counts that home does not
 * treat as degrading are said in one line ({@link notDegradationsSentence}),
 * so the two never disagree silently.
 */

/** The fields of a `/fleet/health` device the counts read. */
export interface MachineStateRef {
  device_id?: string | null;
  state?: string | null;
  /** Coord's tri-state liveness; `unknown` marks a placeholder row. */
  dispatch_liveness?: string | null;
}

/**
 * The NAV's predicate: a machine coord gave a verdict for, and the verdict is
 * not `healthy`. A device with no `state` is not counted.
 */
export function isNotHealthyDevice(d: MachineStateRef): boolean {
  return typeof d.state === "string" && d.state !== "" && d.state !== "healthy";
}

/** The states coord's project state turns into a degradation row. */
export const DEGRADING_MACHINE_STATES: ReadonlySet<string> = new Set([
  "degraded",
  "partitioned",
  "stale",
  "ci_offline",
]);

/** What home makes of one machine (coord's project-state semantics). */
export type MachineVerdict =
  | "healthy"
  | "degrading"
  | "abandoned"
  | "no_verdict";

/**
 * Home's predicate. A placeholder (no liveness signal ever) has no verdict
 * whatever its state; so do coord's explicit `unknown`, an absent or empty
 * state, and a state string this build does not know.
 */
export function machineVerdict(d: MachineStateRef): MachineVerdict {
  if (d.dispatch_liveness === "unknown") return "no_verdict";
  const s = typeof d.state === "string" ? d.state : "";
  if (s === "healthy") return "healthy";
  if (s === "abandoned") return "abandoned";
  if (DEGRADING_MACHINE_STATES.has(s)) return "degrading";
  return "no_verdict";
}

export interface MachineHealthCounts {
  /** Machines on coord's roster. */
  total: number;
  /** The nav's `unhealthy`: a verdict other than healthy. */
  notHealthy: number;
  healthy: number;
  /** In a state coord's project state reports as a degradation. */
  degrading: number;
  /** Abandoned — a decision, not a degradation. */
  abandoned: number;
  /** No verdict: coord's `unknown`, a placeholder, or no state at all. */
  noVerdict: number;
  /** The degrading machines' device ids, to join against coord's rows. */
  degradingIds: string[];
  /** Degrading machines coord sent no device id for (cannot be joined). */
  degradingWithoutId: number;
  /** Machines the nav counts that home does not treat as degrading. */
  notDegradations: { abandoned: number; noVerdict: number };
}

export function summarizeMachineHealth(
  devices: readonly MachineStateRef[]
): MachineHealthCounts {
  const c: MachineHealthCounts = {
    total: devices.length,
    notHealthy: 0,
    healthy: 0,
    degrading: 0,
    abandoned: 0,
    noVerdict: 0,
    degradingIds: [],
    degradingWithoutId: 0,
    notDegradations: { abandoned: 0, noVerdict: 0 },
  };
  for (const d of devices) {
    const nav = isNotHealthyDevice(d);
    if (nav) c.notHealthy += 1;
    const v = machineVerdict(d);
    if (v === "healthy") c.healthy += 1;
    else if (v === "abandoned") {
      c.abandoned += 1;
      if (nav) c.notDegradations.abandoned += 1;
    } else if (v === "no_verdict") {
      c.noVerdict += 1;
      if (nav) c.notDegradations.noVerdict += 1;
    } else {
      c.degrading += 1;
      if (typeof d.device_id === "string" && d.device_id !== "") {
        c.degradingIds.push(d.device_id);
      } else {
        c.degradingWithoutId += 1;
      }
    }
  }
  return c;
}

/** The fields of a coord degradation row the join reads. */
export interface DegradationSubjectRef {
  id: string;
  subjectKind: string | null;
  subjectId: string | null;
}

/**
 * How many degrading machines coord's open degradation rows already list
 * (a row about that device), and how many they do not. `rows === null`: no
 * list was served, so none is known to be listed.
 */
export function degradingCoverage(
  counts: MachineHealthCounts,
  rows: readonly DegradationSubjectRef[] | null
): { listed: number; unlisted: number } {
  if (rows === null) return { listed: 0, unlisted: counts.degrading };
  const listedIds = new Set(
    rows.flatMap((r) =>
      r.subjectKind === "device" && r.subjectId !== null ? [r.subjectId] : []
    )
  );
  const listed = counts.degradingIds.filter((id) => listedIds.has(id)).length;
  return { listed, unlisted: counts.degrading - listed };
}

/**
 * One line reconciling home with the nav: the machines the nav counts as not
 * healthy that are not degradations, by state. Null when there are none.
 */
export function notDegradationsSentence(
  counts: MachineHealthCounts,
  { seeDevOps }: { seeDevOps: boolean }
): string | null {
  const { abandoned, noVerdict } = counts.notDegradations;
  const n = abandoned + noVerdict;
  if (n === 0) return null;
  const parts: string[] = [];
  if (abandoned > 0) parts.push(`${abandoned} abandoned`);
  if (noVerdict > 0) parts.push(`${noVerdict} with no verdict`);
  const subject =
    n === 1
      ? "1 machine not reporting healthy is not a degradation"
      : `${n} machines not reporting healthy are not degradations`;
  return `${subject}: ${parts.join(", ")}${seeDevOps ? " — see Dev Ops" : ""}.`;
}
