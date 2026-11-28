/**
 * The schedule's pure pieces: what every state is CALLED, how an unknown
 * figure is worded, and how coord's milestones become one lane. Derived only
 * (plan D5): nothing here knows of a typed or entered value.
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
import {
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
  no_calendar: "the project record declares no working calendar",
};

export const SOURCE_KIND_WORDS: Readonly<Record<SourceKind, string>> = {
  coord_work_unit: "Project record",
  coord_delivery: "Delivery record",
  coord_document: "Project document",
  coord_gates: "Decision record",
  derived: "Worked out from the above",
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
  return states.filter((s) => !(own(labels, s) ?? "").trim());
}

/** What a value this build has no label for reads: neutral, never a concrete
 *  state it might be mistaken for. */
export const UNRECOGNISED = "Unrecognised";

/** An own property of a plain table, or undefined: `constructor` or
 *  `toString` are not states. */
function own<V>(
  table: Readonly<Record<string, V>>,
  key: string
): V | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/** A word that is not in a table (a state a newer server serves) is said
 *  plainly as unrecognised, never passed through as its raw identifier. */
function word<T extends string>(
  labels: Readonly<Record<T, string>>,
  state: T,
  fallback: string
): string {
  const found = own(labels as Readonly<Record<string, string>>, state);
  return found && found.trim() ? found : fallback;
}

export const phaseStateWord = (s: SchedulePhaseState) =>
  word(PHASE_STATE_WORDS, s, UNRECOGNISED);
export const milestoneStatusWord = (s: ScheduleMilestoneStatus) =>
  word(MILESTONE_STATUS_WORDS, s, UNRECOGNISED);
export const gateVerdictWord = (v: GateVerdict) =>
  word(GATE_VERDICT_WORDS, v, UNRECOGNISED);
export const unknownReasonWord = (r: UnknownReason | null | undefined) =>
  r ? word(UNKNOWN_REASON_WORDS, r, "the reason is not recognised") : "";
export const sourceKindWord = (k: SourceKind) =>
  word(SOURCE_KIND_WORDS, k, UNRECOGNISED);

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

/** A figure's day. `kind: "unknown"` carries no day. */
export interface FigureDay {
  kind: "coord" | "unknown";
  day: string | null;
}

export function figureDay(r: Resolved<string>): FigureDay {
  if (r.state === "known" && r.value) return { kind: "coord", day: r.value };
  return { kind: "unknown", day: null };
}

// ---------------------------------------------------------------------------
// The milestone lane: coord's milestones as one dated list
// ---------------------------------------------------------------------------

export type LaneTone =
  | "done"
  | "planned"
  | "in_progress"
  | "at_risk"
  | "unconfirmed"
  /** coord gave no status at all, or one this build does not know. */
  | "unknown";

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
}

/** Case-folded, whitespace-collapsed: the milestone name as a key. */
export function normaliseName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

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
  const tone = status === null ? undefined : own(COORD_TONE, status);
  const recognised = tone !== undefined;
  const unknownStatus = describeUnknown(m.status);
  return {
    key: `coord:${m.id ?? slugId(m.name)}:${index}`,
    uiId: `coord-${m.id ?? slugId(m.name) ?? index}`,
    title: m.name,
    date: date.day,
    statusWord:
      status !== null && recognised
        ? milestoneStatusWord(status)
        : status !== null
          ? UNRECOGNISED
          : [unknownStatus.headline, unknownStatus.reason]
              .filter(Boolean)
              .join(" — "),
    tone: tone ?? "unknown",
  };
}

/**
 * Coord's milestones as one lane, dated ones first in date order. A milestone
 * with no available date is listed, undated, never dropped.
 */
export function milestoneLane(
  coord: readonly MilestoneView[] | null
): LaneMilestone[] {
  return (coord ?? []).map(coordLane).sort((a, b) => {
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
