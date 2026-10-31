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
 * no-verdict clause), and so are the abandoned machines when no graded
 * machine is live (the no-live-machine line). So this line points back at
 * them ("named above")
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
  if (abandoned > 0) {
    // With no live machine, the abandoned machines are named above, on the
    // no-live-machine line ({@link noLiveMachineSentence}).
    parts.push(
      !noLiveMachine(counts)
        ? `${abandoned} abandoned`
        : abandoned === counts.abandoned
          ? `the ${abandoned} abandoned named above`
          : `${abandoned} of the ${counts.abandoned} abandoned named above`
    );
  }
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
 * is a complete roster as far as exclusions go — and even then coord may
 * have cut the roster off at its row limit ({@link RosterCut}), which can
 * leave machine health unknown too.
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
 * Whether coord says it withheld nothing. A roster is complete for health
 * purposes only when this holds AND its cut hides no machine that could be
 * degrading ({@link rosterCutHidesHealth}).
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
 * The most rows an OLDER coord's roster returns. Before the roster cap
 * (`qontinui-coord` `crates/coord/src/device_state.rs` `ROSTER_CAP`), the
 * roster query was `ORDER BY <in dispatch window> DESC, d.hostname
 * LIMIT 1000` and served no total and no truncation flag beside it. On such a
 * coord a roster this long may have been cut off, and the rows past the cut
 * are missing with nothing saying so: the out-of-window rows by hostname
 * when fewer than 1000 rows are in the window, and in-window rows too when
 * more are. It is also the soft cap's value on a coord that serves
 * `row_cap`; that coord's own `row_cap.soft` is preferred when served.
 */
export const COORD_ROSTER_ROW_LIMIT = 1000;

/**
 * Whether the roster is complete, read from coord's completeness fields
 * (`fleet_health.rs`: `total`, `truncated`, `degradable_dropped`,
 * `row_cap`) when it serves them, and from the row count when it does not.
 *
 * Coord's cap returns every row that could carry a degradation first, and
 * cuts only the tail that cannot (abandoned machines outside the dispatch
 * window, placeholder rows coord never observed) at its soft cap. A
 * degradable row is withheld only past its hard cap, and coord counts those
 * as `degradable_dropped`.
 *
 * - `whole` — coord says nothing was cut (`truncated: false`), or, on a coord
 *   that serves no flag, the roster is shorter than the limit.
 * - `cut_tail_only` — coord cut rows, and says none of them could be
 *   degrading (`truncated: true`, `degradable_dropped: 0`, a consistent
 *   `total`). Complete for health purposes: calm is allowed, and the lines
 *   say how many rows are not listed.
 * - `cut_degradable` — coord withheld `degradableDropped` machines that
 *   could be degrading: the health view is partial, never calm.
 * - `reported_cut` — coord says it cut the roster (`truncated: true`, or a
 *   `total` above the rows listed) but gives no usable `degradable_dropped`:
 *   the rows past the cut are UNKNOWN, never calm.
 * - `may_be_cut` — coord serves no usable flag (an older coord, or a
 *   malformed field), and the roster is at or past `limit`: it may have been
 *   cut off, never calm.
 *
 * `total` is coord's figure when it served one consistent with `listed`.
 * `limit` is coord's `row_cap.soft` when served, else
 * {@link COORD_ROSTER_ROW_LIMIT}; `hardLimit` is `row_cap.hard`, or null.
 */
export type RosterCut =
  | { kind: "whole" }
  | {
      kind: "cut_tail_only";
      listed: number;
      total: number;
      limit: number;
    }
  | {
      kind: "cut_degradable";
      listed: number;
      total: number | null;
      degradableDropped: number;
      hardLimit: number | null;
    }
  | { kind: "reported_cut"; listed: number; total: number | null }
  | { kind: "may_be_cut"; listed: number; limit: number };

/**
 * The body fields the cut is read from. Every one but `devices` is optional
 * and unvalidated: an older coord sends none of them, and a proxy may mangle
 * them.
 */
export interface RosterCutRef {
  devices: readonly unknown[];
  truncated?: unknown;
  total?: unknown;
  degradable_dropped?: unknown;
  row_cap?: unknown;
}

/** A positive cap from coord's `row_cap`, or null when absent or malformed. */
function rowCapField(rowCap: unknown, key: "soft" | "hard"): number | null {
  if (typeof rowCap !== "object" || rowCap === null) return null;
  const v = (rowCap as Record<string, unknown>)[key];
  return isCount(v) && v > 0 ? v : null;
}

/**
 * Read the cut. A malformed field is treated as absent, never as complete,
 * and fields that contradict each other are resolved toward a cut: a
 * `total` below the rows listed is dropped; `truncated: false` beside a
 * larger `total`, a non-zero `degradable_dropped`, or either one malformed,
 * is dropped; and `truncated: true` beside a `total` equal to the rows
 * listed keeps the reported cut, with no `total` to print.
 */
export function readRosterCut(body: RosterCutRef): RosterCut {
  const listed = body.devices.length;
  let truncated = typeof body.truncated === "boolean" ? body.truncated : null;
  const total = isCount(body.total) && body.total >= listed ? body.total : null;
  const degradableDropped = isCount(body.degradable_dropped)
    ? body.degradable_dropped
    : null;
  const limit = rowCapField(body.row_cap, "soft") ?? COORD_ROSTER_ROW_LIMIT;
  // `truncated: false` is a completeness claim: trusted only when nothing
  // served beside it is malformed or says otherwise.
  const totalMalformed = body.total !== undefined && total === null;
  const droppedMalformed =
    body.degradable_dropped !== undefined && degradableDropped === null;
  if (
    truncated === false &&
    (totalMalformed ||
      droppedMalformed ||
      (total !== null && total > listed) ||
      (degradableDropped !== null && degradableDropped > 0))
  ) {
    truncated = null;
  }
  const cutTotal = total !== null && total > listed ? total : null;
  if (degradableDropped !== null && degradableDropped > 0) {
    return {
      kind: "cut_degradable",
      listed,
      total: cutTotal,
      degradableDropped,
      hardLimit: rowCapField(body.row_cap, "hard"),
    };
  }
  if (truncated === true || cutTotal !== null) {
    return truncated === true && cutTotal !== null && degradableDropped === 0
      ? { kind: "cut_tail_only", listed, total: cutTotal, limit }
      : { kind: "reported_cut", listed, total: cutTotal };
  }
  if (truncated === false) return { kind: "whole" };
  return listed >= limit
    ? { kind: "may_be_cut", listed, limit }
    : { kind: "whole" };
}

/**
 * The cut a read roster carries when none was recorded — an unreachable
 * defensive fallback (every read view carries the cut it was parsed with).
 * Unstated is never "whole".
 */
export function unstatedRosterCut(listed: number): RosterCut {
  return { kind: "may_be_cut", listed, limit: COORD_ROSTER_ROW_LIMIT };
}

/**
 * Whether the cut leaves machine health UNKNOWN: never complete, never
 * calm. A cut coord says withheld no row that could be degrading
 * (`cut_tail_only`) does not.
 */
export function rosterCutHidesHealth(c: RosterCut): boolean {
  return c.kind !== "whole" && c.kind !== "cut_tail_only";
}

/** "1 row" / "3 rows". */
function rowsText(n: number): string {
  return `${n} ${n === 1 ? "row" : "rows"}`;
}

/** The roster's cut in words; null when it is whole. */
export function rosterCutSentence(c: RosterCut): string | null {
  switch (c.kind) {
    case "whole":
      return null;
    case "cut_tail_only": {
      const n = c.total - c.listed;
      return `Coord's roster lists ${rowsText(c.listed)} of ${c.total}: the other ${n} ${n === 1 ? "is an abandoned or placeholder row" : "are abandoned or placeholder rows"} past coord's limit of ${c.limit}, not listed here — coord says none of them could be degrading.`;
    }
    case "cut_degradable": {
      const d = c.degradableDropped;
      return `Coord's roster lists ${rowsText(c.listed)}${c.total !== null ? ` of ${c.total}` : ""}, and coord withheld ${d} ${d === 1 ? "machine that" : "machines that"} could be degrading past its row limit${c.hardLimit !== null ? ` of ${c.hardLimit}` : ""} — ${d === 1 ? "its" : "their"} health is unknown, so this view is partial.`;
    }
    case "reported_cut":
      return c.total !== null
        ? `Coord reports its roster was cut: it lists ${rowsText(c.listed)} of ${c.total} — the health of the other ${c.total - c.listed} is unknown.`
        : `Coord reports its roster was cut after ${rowsText(c.listed)} — machine health beyond it is unknown.`;
    case "may_be_cut":
      return c.listed >= c.limit
        ? `Coord's roster lists ${rowsText(c.listed)}, ${c.listed === c.limit ? "at" : "more than"} coord's limit of ${c.limit}, so it may be cut off — machine health beyond it is unknown.`
        : `Coord does not say whether its roster of ${rowsText(c.listed)} is complete — machine health beyond it is unknown.`;
  }
}
