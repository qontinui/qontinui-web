/**
 * The schedule's pure pieces: what every state is CALLED, how an unknown
 * figure is worded, how a coord phase is laid over a hand-entered one, and how
 * two milestone lists become one lane.
 *
 * Plain language is a total function over closed sets (plan
 * `2026-11-25-overview-timeline-and-milestones-derive-from-coord`, D6): every
 * state coord can serve has a label here, typed `Record<State, string>` so the
 * compiler refuses a state without one, and `LABEL_TABLES` lists them all so a
 * test fails when a table is missing a state even if the types were cast away.
 * Nothing here ever turns an unknown into a default: a figure coord could not
 * give reads "Not available", never `0 days`, "On track" or "Planned".
 *
 * Pure: no React, no network.
 */

import { format, isValid, parseISO } from "date-fns";
import { formatDay } from "./timeline";
import { MILESTONE_STATUS_LABEL } from "./timeline";
import type { Milestone, PhaseProgress } from "./timeline-api";
import {
  BASES,
  FORECAST_POSITIONS,
  GATE_VERDICTS,
  MILESTONE_STATUSES,
  PHASE_STATES,
  SOURCE_KINDS,
  UNKNOWN_REASONS,
  type GateVerdict,
  type MilestoneView,
  type PhaseView,
  type Resolved,
  type ScheduleBasis,
  type ScheduleEnvelope,
  type ScheduleMilestoneStatus,
  type SchedulePhaseState,
  type SourceKind,
  type UnknownReason,
  type ForecastPosition,
} from "./schedule-api";

// ---------------------------------------------------------------------------
// Labels — one total table per closed set
// ---------------------------------------------------------------------------

export const PHASE_STATE_WORDS: Readonly<Record<SchedulePhaseState, string>> = {
  planned: "Planned",
  in_progress: "In progress",
  done: "Done",
  // Coord holds no evidence either way. Not "Planned": absence of evidence is
  // not a plan.
  not_confirmed: "Not confirmed",
};

export const MILESTONE_STATUS_WORDS: Readonly<
  Record<ScheduleMilestoneStatus, string>
> = {
  met: "Met",
  not_met: "Not met yet",
  not_confirmed: "Not confirmed",
};

export const GATE_VERDICT_WORDS: Readonly<Record<GateVerdict, string>> = {
  pending: "Waiting for a decision",
  passed: "Approved",
  failed: "Not approved",
};

export const UNKNOWN_REASON_WORDS: Readonly<Record<UnknownReason, string>> = {
  coord_unreachable: "the project record could not be reached",
  coord_denied: "the project record refused the request",
  coord_stale: "the last reading is too old to rely on",
  no_programme: "no delivery programme is recorded for this project",
  ambiguous_programme: "more than one delivery programme is recorded",
  not_declared: "the project record does not say",
  not_recorded: "it was not recorded",
  ship_retracted: "a delivery was withdrawn after it was recorded",
  tenant_mismatch: "the record belongs to a different project",
  unparseable: "the record could not be read",
  truncated: "the record was too large to read completely",
  phase_dates_missing: "the phases have no planned dates to forecast from",
  no_phases: "the project has no phases yet",
  no_calendar: "no estimate with a working calendar has been entered",
};

export const SOURCE_KIND_WORDS: Readonly<Record<SourceKind, string>> = {
  coord_work_unit: "Project record",
  coord_delivery: "Delivery record",
  coord_document: "Project document",
  coord_gates: "Decision record",
  entered: "Entered by a person",
  derived: "Worked out from the above",
};

export const BASIS_WORDS: Readonly<Record<ScheduleBasis, string>> = {
  coord: "the project record",
  entered: "figures entered by a person",
  mixed: "the project record and figures entered by a person",
};

export const POSITION_WORDS: Readonly<Record<ForecastPosition, string>> = {
  no_phases: "No phases",
  in_progress: "In progress",
  finished: "Finished",
  not_started: "Not started",
  between_phases: "Between phases",
};

/** Every table with the states it must cover. A test walks this. */
export const LABEL_TABLES: readonly {
  name: string;
  states: readonly string[];
  labels: Readonly<Record<string, string>>;
}[] = [
  { name: "phase state", states: PHASE_STATES, labels: PHASE_STATE_WORDS },
  {
    name: "milestone status",
    states: MILESTONE_STATUSES,
    labels: MILESTONE_STATUS_WORDS,
  },
  { name: "gate verdict", states: GATE_VERDICTS, labels: GATE_VERDICT_WORDS },
  {
    name: "unknown reason",
    states: UNKNOWN_REASONS,
    labels: UNKNOWN_REASON_WORDS,
  },
  { name: "source kind", states: SOURCE_KINDS, labels: SOURCE_KIND_WORDS },
  { name: "basis", states: BASES, labels: BASIS_WORDS },
  {
    name: "forecast position",
    states: FORECAST_POSITIONS,
    labels: POSITION_WORDS,
  },
];

/** The states `labels` has no (or an empty) word for. */
export function missingLabels(
  states: readonly string[],
  labels: Readonly<Record<string, string>>
): string[] {
  return states.filter((s) => !(labels[s] ?? "").trim());
}

/** A word that is not in a table (a state a newer server serves) is said
 *  plainly as unrecognised, never passed through as its raw identifier. */
function word<T extends string>(
  labels: Readonly<Record<T, string>>,
  state: T,
  fallback: string
): string {
  const found = (labels as Readonly<Record<string, string | undefined>>)[state];
  return found && found.trim() ? found : fallback;
}

export const phaseStateWord = (s: SchedulePhaseState) =>
  word(PHASE_STATE_WORDS, s, "Not confirmed");
export const milestoneStatusWord = (s: ScheduleMilestoneStatus) =>
  word(MILESTONE_STATUS_WORDS, s, "Not confirmed");
export const gateVerdictWord = (v: GateVerdict) =>
  word(GATE_VERDICT_WORDS, v, "Waiting for a decision");
export const unknownReasonWord = (r: UnknownReason | null | undefined) =>
  r ? word(UNKNOWN_REASON_WORDS, r, "the project record does not say") : "";
export const sourceKindWord = (k: SourceKind) =>
  word(SOURCE_KIND_WORDS, k, "Project record");
export const basisWord = (b: ScheduleBasis) =>
  word(BASIS_WORDS, b, "the project record");

// ---------------------------------------------------------------------------
// Times
// ---------------------------------------------------------------------------

/** "21 Nov 2025" from an RFC 3339 instant or a calendar day; null when absent
 *  or unreadable. */
export function formatInstantDay(
  value: string | null | undefined
): string | null {
  if (!value) return null;
  const at = parseISO(value);
  return isValid(at) ? format(at, "d MMM yyyy") : null;
}

/** "14:03" in the reader's zone; null when absent or unreadable. */
export function formatClock(value: string | null | undefined): string | null {
  if (!value) return null;
  const at = parseISO(value);
  return isValid(at) ? format(at, "HH:mm") : null;
}

// ---------------------------------------------------------------------------
// Unknown figures
// ---------------------------------------------------------------------------

export interface UnknownText {
  /** "Not available since 21 Nov 2025", or "Not available" when coord never
   *  gave the time it was last known. */
  headline: string;
  /** The reason, in words ("it was not recorded"); "" when none was given. */
  reason: string;
}

export function describeUnknown(r: {
  unknown_since?: string | null;
  unknown_reason?: UnknownReason | null;
}): UnknownText {
  const since = formatInstantDay(r.unknown_since);
  return {
    headline: since ? `Not available since ${since}` : "Not available",
    reason: unknownReasonWord(r.unknown_reason),
  };
}

/** A figure's day, and whose it is. `kind: "unknown"` carries no day. */
export interface FigureDay {
  kind: "coord" | "entered" | "unknown";
  day: string | null;
}

export function figureDay(r: Resolved<string>): FigureDay {
  if (r.state === "known" && r.value) return { kind: "coord", day: r.value };
  if (r.state === "entered" && r.value)
    return { kind: "entered", day: r.value };
  return { kind: "unknown", day: null };
}

/** "Entered by Maria on 3 Nov 2025" — the attribution of a person's value. */
export function enteredBy(r: {
  entered?: { by: string | null; at: string | null } | null;
}): string {
  const by = r.entered?.by ?? null;
  const at = formatInstantDay(r.entered?.at);
  return `Entered by ${by ?? "a person"}${at ? ` on ${at}` : ""}`;
}

// ---------------------------------------------------------------------------
// Overlay: coord phases over an estimate's phases (Phase 4, D5)
// ---------------------------------------------------------------------------

/** One date as the overlay shows it: coord's value, with a hand-entered value
 *  that differs beside it, or the entered value alone where coord is silent. */
export interface OverlayDate {
  /** The day shown. Null when neither coord nor a person gave one. */
  day: string | null;
  /** Who the shown day is from. */
  from: "coord" | "entered" | "unknown";
  /** A hand-entered day that contradicts coord's (never edited by this view). */
  entered_disagrees: string | null;
  /** Set when `from` is `unknown`: why, for the figure's own text. */
  resolved: Resolved<string> | null;
}

export interface OverlayPhase {
  coord: PhaseView;
  start: OverlayDate;
  end: OverlayDate;
  /** Coord's reading of the phase, unless coord holds nothing and the
   *  estimate's own record says otherwise. */
  disagreements: number;
}

function overlayDate(
  entered: string | null,
  coord: Resolved<string>
): OverlayDate {
  const c = figureDay(coord);
  if (c.kind === "coord") {
    const differs = entered !== null && entered !== c.day;
    return {
      day: c.day,
      from: "coord",
      // Coord's own `disagrees` stands when the typed row it saw differs; a
      // typed value in THIS tenant's estimate is compared here the same way.
      entered_disagrees: differs
        ? entered
        : (coord.disagrees?.entered_value ?? null),
      resolved: coord,
    };
  }
  if (c.kind === "entered") {
    return {
      day: c.day,
      from: "entered",
      entered_disagrees: null,
      resolved: coord,
    };
  }
  if (entered !== null) {
    return {
      day: entered,
      from: "entered",
      entered_disagrees: null,
      resolved: coord,
    };
  }
  return {
    day: null,
    from: "unknown",
    entered_disagrees: null,
    resolved: coord,
  };
}

export interface Overlay {
  /** Estimate phase id -> its coord counterpart, matched by EQUAL code only. */
  matched: Map<string, OverlayPhase>;
  /** Coord phases no estimate phase carries the code of: "From coord". */
  coordOnly: PhaseView[];
  /** Estimate phases with no coord counterpart: "Entered". */
  enteredOnly: string[];
  /** Figures where a person's value contradicts coord's. */
  disagreements: number;
}

/**
 * Lay coord's phases over an estimate's. A coord phase and an estimate phase
 * are the same phase only when their codes are EQUAL (`F1` = `F1`); there is
 * no fuzzy match, so an unmatched phase is listed on its own side rather than
 * guessed onto another.
 */
export function overlayPhases(
  estimate: readonly PhaseProgress[],
  coord: readonly PhaseView[] | null
): Overlay {
  const byCode = new Map<string, PhaseView>();
  for (const p of coord ?? []) if (!byCode.has(p.code)) byCode.set(p.code, p);
  const matched = new Map<string, OverlayPhase>();
  const enteredOnly: string[] = [];
  let disagreements = 0;
  const used = new Set<string>();
  for (const e of estimate) {
    const c = byCode.get(e.code);
    if (!c) {
      enteredOnly.push(e.id);
      continue;
    }
    used.add(c.code);
    const start = overlayDate(e.actual_start, c.actual_start);
    const end = overlayDate(e.actual_end, c.actual_end);
    const n =
      (start.entered_disagrees ? 1 : 0) + (end.entered_disagrees ? 1 : 0);
    disagreements += n;
    matched.set(e.id, { coord: c, start, end, disagreements: n });
  }
  return {
    matched,
    coordOnly: (coord ?? []).filter((p) => !used.has(p.code)),
    enteredOnly,
    disagreements,
  };
}

// ---------------------------------------------------------------------------
// The milestone lane: typed and coord milestones as one list (Phase 4)
// ---------------------------------------------------------------------------

export type LaneTone =
  | "done"
  | "planned"
  | "in_progress"
  | "at_risk"
  | "unconfirmed";

export interface LaneMilestone {
  /** Stable key for lists. */
  key: string;
  /** The id the UI Bridge reads this marker by. */
  uiId: string;
  title: string;
  /** Calendar day; null for a coord milestone whose date is not available. */
  date: string | null;
  /** The status in plain words. */
  statusWord: string;
  tone: LaneTone;
  /** Where it is held: coord, a person, or both (they agree). */
  sources: ("coord" | "entered")[];
  /** The milestone's date was entered by a person, coord having none. */
  dateFrom: "coord" | "entered" | "unknown";
}

/** Case-folded, whitespace-collapsed: the milestone name as a key. */
export function normaliseName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

const TYPED_TONE: Record<Milestone["status"], LaneTone> = {
  planned: "planned",
  in_progress: "in_progress",
  done: "done",
  at_risk: "at_risk",
};

const COORD_TONE: Record<ScheduleMilestoneStatus, LaneTone> = {
  met: "done",
  not_met: "planned",
  not_confirmed: "unconfirmed",
};

function slugId(text: string): string {
  return normaliseName(text)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function coordLane(m: MilestoneView, index: number): LaneMilestone {
  const date = figureDay(m.target_date);
  const status = m.status.value;
  return {
    key: `coord:${m.id ?? slugId(m.name)}:${index}`,
    uiId: `coord-${m.id ?? slugId(m.name) ?? index}`,
    title: m.name,
    date: date.day,
    statusWord: status ? milestoneStatusWord(status) : "Not confirmed",
    tone: status ? COORD_TONE[status] : "unconfirmed",
    sources: ["coord"],
    dateFrom: date.kind,
  };
}

/**
 * Typed (hand-entered) and coord milestones as one lane. A typed and a coord
 * milestone collapse into one, showing both sources, ONLY when their
 * normalised name AND date are equal (typed milestones carry no `V1`-style
 * id, so name plus date is the only key); otherwise both are listed. A coord
 * milestone with no available date is listed, undated, never dropped.
 */
export function mergeMilestones(
  typed: readonly Milestone[],
  coord: readonly MilestoneView[] | null
): LaneMilestone[] {
  const lane: LaneMilestone[] = (coord ?? []).map(coordLane);
  const claimed = new Set<number>();
  const out: LaneMilestone[] = [];
  for (const m of typed) {
    const key = normaliseName(m.title);
    const at = lane.findIndex(
      (c, i) =>
        !claimed.has(i) &&
        c.date !== null &&
        c.date === m.target_date &&
        normaliseName(c.title) === key
    );
    if (at >= 0) {
      claimed.add(at);
      lane[at] = { ...lane[at]!, sources: ["coord", "entered"] };
      continue;
    }
    out.push({
      key: `entered:${m.id}`,
      uiId: m.id,
      title: m.title,
      date: m.target_date,
      statusWord: MILESTONE_STATUS_LABEL[m.status],
      tone: TYPED_TONE[m.status],
      sources: ["entered"],
      dateFrom: "entered",
    });
  }
  return [...lane, ...out].sort((a, b) => {
    if (a.date === null) return b.date === null ? 0 : 1;
    if (b.date === null) return -1;
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  });
}

/** The first dated milestone on or after `today` that coord does not say is
 *  met — the next date that matters. Null when there is none. */
export function nextMilestone(
  lane: readonly LaneMilestone[],
  today: string
): LaneMilestone | null {
  return (
    lane.find((m) => m.date !== null && m.date >= today && m.tone !== "done") ??
    null
  );
}

// ---------------------------------------------------------------------------
// The header's facts
// ---------------------------------------------------------------------------

export interface PhaseCounts {
  total: number;
  done: number;
  inProgress: number;
  planned: number;
  notConfirmed: number;
  /** Phases whose state coord could not read at all. */
  unavailable: number;
}

export function countPhases(phases: readonly PhaseView[]): PhaseCounts {
  const c: PhaseCounts = {
    total: phases.length,
    done: 0,
    inProgress: 0,
    planned: 0,
    notConfirmed: 0,
    unavailable: 0,
  };
  for (const p of phases) {
    const s = p.state.value;
    if (p.state.state === "unknown" || s === null) c.unavailable += 1;
    else if (s === "done") c.done += 1;
    else if (s === "in_progress") c.inProgress += 1;
    else if (s === "planned") c.planned += 1;
    else c.notConfirmed += 1;
  }
  return c;
}

/** The phases coord reads as under way, named in the tenant's own words. */
export function currentPhases(phases: readonly PhaseView[]): PhaseView[] {
  return phases.filter((p) => p.state.value === "in_progress");
}

/** Every day the chart must hold, so no bar or marker falls off its axis. */
export function scheduleDays(
  env: ScheduleEnvelope,
  lane: readonly LaneMilestone[]
): (string | null)[] {
  const days: (string | null)[] = [
    env.initiative.starts.value,
    env.initiative.ends.value,
  ];
  for (const p of env.phases.value ?? []) {
    days.push(p.actual_start.value, p.actual_end.value, p.planned_end.value);
  }
  for (const m of lane) days.push(m.date);
  return days;
}

/** "5 Jan 2026" for a calendar day, or "Not available" — never a blank. */
export function dayOrNotAvailable(day: string | null): string {
  return formatDay(day) ?? "Not available";
}
