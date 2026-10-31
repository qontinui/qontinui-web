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
 *   `abandoned` (a decision) or coord's explicit `unknown` (a stored state it
 *   could not parse) — `qontinui-coord` `crates/coord/src/project_state.rs`
 *   `roster_degradations`. So on home an `abandoned` machine is never
 *   degrading, and `unknown` or a device with no `state` at all has NO
 *   VERDICT: UNKNOWN, never degrading and never healthy
 *   ({@link machineVerdict}).
 * - **A placeholder row is not a machine.** A row coord has never had a
 *   liveness signal from (`dispatch_liveness: "unknown"`) "has never named a
 *   running machine"; coord leaves it out of the population it grades
 *   (`project_state.rs` `headroom_coverage`, `roster_degradations`) and out
 *   of both sides of its fleet-partition ratio (`fleet_health.rs`
 *   `evaluate`). Home does the same: a placeholder is in no machine count and
 *   is named in a line of its own. The nav still counts one whose state is
 *   not `healthy`, so the reconcile line names those.
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
  | "no_verdict"
  | "placeholder";

/**
 * Home's predicate. A placeholder (no liveness signal ever) is not a machine
 * at all, whatever its state. Coord's explicit `unknown`, an absent or empty
 * state, and a state string this build does not know have no verdict.
 */
export function machineVerdict(d: MachineStateRef): MachineVerdict {
  if (d.dispatch_liveness === "unknown") return "placeholder";
  const s = typeof d.state === "string" ? d.state : "";
  if (s === "healthy") return "healthy";
  if (s === "abandoned") return "abandoned";
  if (DEGRADING_MACHINE_STATES.has(s)) return "degrading";
  return "no_verdict";
}

export interface MachineHealthCounts {
  /** Machines on coord's roster that coord grades: every row but placeholders. */
  total: number;
  /** Placeholder rows coord does not grade; in no other count but `notHealthy`. */
  placeholders: number;
  /** The nav's `unhealthy`: a verdict other than healthy. */
  notHealthy: number;
  healthy: number;
  /** In a state coord's project state reports as a degradation. */
  degrading: number;
  /** Abandoned — a decision, not a degradation. */
  abandoned: number;
  /** No verdict: coord's `unknown`, or no state at all. */
  noVerdict: number;
  /** The degrading machines' device ids, to join against coord's rows. */
  degradingIds: string[];
  /** Degrading machines coord sent no device id for (cannot be joined). */
  degradingWithoutId: number;
  /** Rows the nav counts that home does not treat as degrading. */
  notDegradations: {
    abandoned: number;
    noVerdict: number;
    placeholders: number;
  };
}

export function summarizeMachineHealth(
  devices: readonly MachineStateRef[]
): MachineHealthCounts {
  const c: MachineHealthCounts = {
    total: 0,
    placeholders: 0,
    notHealthy: 0,
    healthy: 0,
    degrading: 0,
    abandoned: 0,
    noVerdict: 0,
    degradingIds: [],
    degradingWithoutId: 0,
    notDegradations: { abandoned: 0, noVerdict: 0, placeholders: 0 },
  };
  for (const d of devices) {
    const nav = isNotHealthyDevice(d);
    if (nav) c.notHealthy += 1;
    const v = machineVerdict(d);
    if (v === "placeholder") {
      c.placeholders += 1;
      if (nav) c.notDegradations.placeholders += 1;
      continue;
    }
    c.total += 1;
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
 * One line reconciling home with the nav: the rows the nav counts as not
 * healthy that are not degradations, by state — placeholder rows included,
 * since the nav counts them. Null when there are none.
 *
 * Placeholder rows and machines with no verdict are also named on lines of
 * their own, above this one (the placeholder line, and the machines line's
 * no-verdict clause). So this line points back at them ("named above")
 * rather than counting them a second time, and its subject is "rows" when
 * any is a placeholder, which is not a machine. A reader summing every line
 * then reaches the badge, not more.
 */
export function notDegradationsSentence(
  counts: MachineHealthCounts,
  { seeDevOps }: { seeDevOps: boolean }
): string | null {
  const { abandoned, noVerdict, placeholders } = counts.notDegradations;
  const n = abandoned + noVerdict + placeholders;
  if (n === 0) return null;
  const parts: string[] = [];
  if (abandoned > 0) parts.push(`${abandoned} abandoned`);
  if (noVerdict > 0) {
    parts.push(
      noVerdict === counts.noVerdict
        ? `the ${noVerdict} with no verdict named above`
        : `${noVerdict} of the ${counts.noVerdict} with no verdict named above`
    );
  }
  if (placeholders > 0) {
    parts.push(
      placeholders === counts.placeholders
        ? `the ${placeholders} placeholder ${placeholders === 1 ? "row" : "rows"} named above`
        : `${placeholders} of the ${counts.placeholders} placeholder rows named above`
    );
  }
  const noun = placeholders > 0 ? "row" : "machine";
  const subject =
    n === 1
      ? `1 ${noun} not reporting healthy is not a degradation`
      : `${n} ${noun}s not reporting healthy are not degradations`;
  return `${subject}: ${parts.join(", ")}${seeDevOps ? " — see Dev Ops" : ""}.`;
}

/**
 * Whether no graded machine is live: every row coord grades is abandoned
 * (or there is none), so whatever else the roster holds is placeholders.
 * No machine reports, so none can be called fine — never calm.
 */
export function noLiveMachine(counts: MachineHealthCounts): boolean {
  return counts.total === counts.abandoned;
}

/** A roster whose graded machines are all abandoned, in words. */
export function noLiveMachineSentence(counts: MachineHealthCounts): string {
  const n = counts.total;
  return `${n === 1 ? "The 1 machine coord grades is" : `All ${n} machines coord grades are`} abandoned, so no live machine reports — there is no machine this view can call healthy.`;
}

/**
 * The placeholder rows in their own line, or null when there are none. They
 * are coord's bookkeeping, not machines, so the line is calm.
 */
export function placeholdersSentence(
  counts: MachineHealthCounts
): string | null {
  const n = counts.placeholders;
  if (n === 0) return null;
  return n === 1
    ? "1 placeholder row coord does not grade is not counted as a machine."
    : `${n} placeholder rows coord does not grade are not counted as machines.`;
}

// ---------------------------------------------------------------------------
// What coord withheld from the roster
// ---------------------------------------------------------------------------

/**
 * What coord says it withheld from the roster (`fleet_health.rs`: `excluded`,
 * `excluded_error`), served on EVERY roster, not only an empty one. Coord's
 * roster joins `coord.tenant_devices`, so a device with no binding for this
 * tenant never appears in `devices` at all — "the device heartbeats fine …
 * the roster's JOIN drops it" (`device_state.rs`). Coord counts those
 * separately; an empty roster with devices withheld is "a binding fault, not
 * an empty fleet", and a non-empty one is incomplete. Only `none_withheld`
 * is a complete roster as far as exclusions go — and even then a roster at
 * coord's row limit may be cut off ({@link RosterCut}), which is incomplete
 * too.
 *
 * - `none_withheld` — coord counted, and withheld nothing.
 * - `withheld` — coord withheld devices (no binding, or bound to another
 *   tenant): their health is UNKNOWN.
 * - `withheld_unmeasured` — coord could not count what it withheld
 *   (`excluded: null` beside `excluded_error`): UNKNOWN, with coord's reason.
 *   A malformed `excluded` reads the same, with no reason.
 * - `not_stated` — a coord that serves neither field: UNKNOWN.
 */
export type RosterExclusions =
  | { kind: "none_withheld" }
  | { kind: "withheld"; unbound: number; boundToOtherTenant: number }
  | { kind: "withheld_unmeasured"; reason: string | null }
  | { kind: "not_stated" };

/** The body fields the exclusions are read from (unvalidated: a proxy may mangle them). */
export interface RosterExclusionsRef {
  excluded?: unknown;
  excluded_error?: unknown;
}

/** A count coord serialized as an `i64`: a finite, non-negative integer. */
const isCount = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0;

/**
 * Coord serializes `excluded` as exactly two `i64` counts, or `null` beside
 * `excluded_error`. Anything else — `{}`, `[]`, a missing, `null` or
 * non-numeric count — is not a count of zero: it reads as
 * `withheld_unmeasured` (UNKNOWN), never `none_withheld`. Only an absent
 * field is `not_stated` (a coord predating it).
 */
export function readRosterExclusions(
  body: RosterExclusionsRef
): RosterExclusions {
  const reason =
    typeof body.excluded_error === "string" && body.excluded_error !== ""
      ? body.excluded_error
      : null;
  const x = body.excluded;
  if (reason !== null || x === null) {
    return { kind: "withheld_unmeasured", reason };
  }
  if (x === undefined) return { kind: "not_stated" };
  // An array, like any object without both counts, fails the count check.
  if (typeof x !== "object") {
    return { kind: "withheld_unmeasured", reason: null };
  }
  const { unbound, bound_to_other_tenant: boundToOtherTenant } = x as Record<
    string,
    unknown
  >;
  if (!isCount(unbound) || !isCount(boundToOtherTenant)) {
    return { kind: "withheld_unmeasured", reason: null };
  }
  return unbound + boundToOtherTenant > 0
    ? { kind: "withheld", unbound, boundToOtherTenant }
    : { kind: "none_withheld" };
}

/** Whether coord withheld devices, or could not count what it withheld. */
export function isRosterBindingFault(e: RosterExclusions): boolean {
  return e.kind === "withheld" || e.kind === "withheld_unmeasured";
}

/**
 * Whether coord says it withheld nothing. A roster is complete only when
 * this holds AND it is not cut off at coord's row limit ({@link isRosterCut}).
 */
export function isRosterComplete(e: RosterExclusions): boolean {
  return e.kind === "none_withheld";
}

/**
 * A NON-empty roster's exclusions in words, or null when it is complete.
 * `withReason`: whether coord's own error text may be quoted (never while
 * presenting — it is coord's error chain).
 */
export function rosterIncompleteSentence(
  e: RosterExclusions,
  { withReason }: { withReason: boolean }
): string | null {
  switch (e.kind) {
    case "none_withheld":
      return null;
    case "withheld": {
      const n = e.unbound + e.boundToOtherTenant;
      return `Coord also withheld ${n} ${n === 1 ? "machine" : "machines"} from its roster (${withheldParts(e).join(", ")}), so the roster is incomplete and ${n === 1 ? "its" : "their"} health is unknown.`;
    }
    case "withheld_unmeasured":
      return `Coord could not count the machines it withheld from its roster${withReason && e.reason ? ` (${e.reason})` : ""}, so the roster may be incomplete — machine health beyond it is unknown.`;
    case "not_stated":
      return "Coord does not say whether it withheld any machines from its roster, so the roster may be incomplete — machine health beyond it is unknown.";
  }
}

function withheldParts(e: { unbound: number; boundToOtherTenant: number }) {
  const parts: string[] = [];
  if (e.unbound > 0) parts.push(`${e.unbound} with no binding`);
  if (e.boundToOtherTenant > 0) {
    parts.push(`${e.boundToOtherTenant} bound to another tenant`);
  }
  return parts;
}

/**
 * An empty roster in words. `withReason`: whether coord's own error text may
 * be quoted (never while presenting — it is coord's error chain).
 */
export function emptyRosterSentence(
  e: RosterExclusions,
  { withReason }: { withReason: boolean }
): string {
  switch (e.kind) {
    case "none_withheld":
      return "Coord lists no machines and withheld none from its roster, so there is no machine this view can call healthy.";
    case "withheld": {
      const n = e.unbound + e.boundToOtherTenant;
      return `Coord lists no machines but withheld ${n} from its roster (${withheldParts(e).join(", ")}) — a binding fault, not an empty fleet, so machine health is unknown.`;
    }
    case "withheld_unmeasured":
      return `Coord lists no machines and could not count the machines it withheld from its roster${withReason && e.reason ? ` (${e.reason})` : ""} — machine health is unknown.`;
    case "not_stated":
      return "Coord lists no machines and does not say whether it withheld any — machine health is unknown.";
  }
}

// ---------------------------------------------------------------------------
// Whether coord cut the roster off at its row limit
// ---------------------------------------------------------------------------

/**
 * The most rows coord's roster returns. `qontinui-coord`
 * `crates/coord/src/device_state.rs`, the roster query: `ORDER BY <in
 * dispatch window> DESC, d.hostname LIMIT 1000`. Coord serves no total and
 * no truncation flag beside it, so a roster this long may have been cut off,
 * and the rows past the cut (out-of-window machines, by hostname) are
 * missing with nothing saying so. Keep this equal to coord's `LIMIT`.
 */
export const COORD_ROSTER_ROW_LIMIT = 1000;

/**
 * Whether the roster may be cut off at coord's row limit.
 *
 * - `whole` — fewer rows than the limit, and coord says nothing of a cut.
 * - `may_be_cut` — the roster is at the limit, or coord says it was cut
 *   (`truncated: true`), or coord serves a `total` larger than the rows it
 *   listed. The rows past the cut are UNKNOWN, just as a withheld machine is.
 *   `total` is coord's figure when it served one larger than `listed`.
 */
export type RosterCut =
  | { kind: "whole" }
  | { kind: "may_be_cut"; listed: number; total: number | null };

/** The body fields the cut is read from (`truncated`/`total`: optional, unvalidated). */
export interface RosterCutRef {
  devices: readonly unknown[];
  truncated?: unknown;
  total?: unknown;
}

export function readRosterCut(body: RosterCutRef): RosterCut {
  const listed = body.devices.length;
  const total =
    typeof body.total === "number" &&
    Number.isFinite(body.total) &&
    body.total > listed
      ? body.total
      : null;
  if (
    body.truncated === true ||
    total !== null ||
    listed >= COORD_ROSTER_ROW_LIMIT
  ) {
    return { kind: "may_be_cut", listed, total };
  }
  return { kind: "whole" };
}

/** Whether the roster may be cut off: never complete, never calm. */
export function isRosterCut(c: RosterCut): boolean {
  return c.kind === "may_be_cut";
}

/** A roster that may be cut off, in words; null when it is whole. */
export function rosterCutSentence(c: RosterCut): string | null {
  if (c.kind === "whole") return null;
  const rows = `${c.listed} ${c.listed === 1 ? "row" : "rows"}`;
  return c.total !== null
    ? `Coord's roster lists ${rows} of ${c.total}, so it is cut off at coord's limit — the health of the other ${c.total - c.listed} is unknown.`
    : `Coord's roster lists ${rows}, so it may be cut off at coord's limit of ${COORD_ROSTER_ROW_LIMIT} — machine health beyond it is unknown.`;
}
