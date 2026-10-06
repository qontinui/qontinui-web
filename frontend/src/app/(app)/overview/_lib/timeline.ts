/**
 * The Timeline's pure pieces: where a date sits on the month axis, how a
 * slip is said, what each status is called, and the plan as a mermaid
 * `gantt` block.
 *
 * Nothing here decides a forecast — the server does (`timeline-api.ts`,
 * `fetchForecast`). This file only PLACES what it is given, and words it.
 *
 * Every date is a calendar day (`YYYY-MM-DD`), read as local midnight and
 * compared by calendar day, so a bar never shifts by the reader's time zone.
 */

import {
  addMonths,
  differenceInCalendarDays,
  eachMonthOfInterval,
  endOfMonth,
  format,
  isValid,
  parseISO,
  startOfDay,
  startOfMonth,
} from "date-fns";
import type { GateStatus } from "./estimate-api";
import type {
  Milestone,
  MilestoneKind,
  MilestoneStatus,
  PhaseState,
} from "./timeline-api";

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

/** A wire day as a local date, or null when absent or unreadable. */
export function toDay(value: string | null | undefined): Date | null {
  if (!value) return null;
  const day = parseISO(value);
  return isValid(day) ? day : null;
}

/** "5 Jan 2026" — the way the overview writes a day. */
export function formatDay(value: string | null | undefined): string | null {
  const day = toDay(value);
  return day ? format(day, "d MMM yyyy") : null;
}

/** A local date as a wire day. */
export function isoDay(day: Date): string {
  return format(day, "yyyy-MM-dd");
}

// ---------------------------------------------------------------------------
// The month axis
// ---------------------------------------------------------------------------

export type Zoom = "project" | "year" | "half" | "quarter";

/** The last DAY of a month, at midnight like every other day here
 *  (`endOfMonth` is its last millisecond). */
function lastDayOf(day: Date): Date {
  return startOfDay(endOfMonth(day));
}

export const ZOOMS: { value: Zoom; label: string; months: number | null }[] = [
  { value: "project", label: "Whole project", months: null },
  { value: "year", label: "Year", months: 12 },
  { value: "half", label: "Half-year", months: 6 },
  { value: "quarter", label: "Quarter", months: 3 },
];

/** An inclusive span of calendar days the chart draws. */
export interface AxisWindow {
  start: Date;
  end: Date;
}

/**
 * The whole months covering every given day, or null when there is none.
 * Everything the chart draws (planned, actual, forecast, milestones, breaks,
 * today) goes in, so nothing it holds falls off the edge.
 */
export function projectWindow(
  days: (string | null | undefined)[]
): AxisWindow | null {
  const parsed = days.map(toDay).filter((d): d is Date => d !== null);
  if (parsed.length === 0) return null;
  const times = parsed.map((d) => d.getTime());
  return {
    start: startOfMonth(new Date(Math.min(...times))),
    end: lastDayOf(new Date(Math.max(...times))),
  };
}

/**
 * The window a zoom shows: the whole project, or `months` whole months
 * around today — a quarter of the span before it, the rest after, since a
 * reader looks ahead more than back. Today is held inside the project, so
 * a finished project zooms onto its end rather than onto empty months.
 */
export function zoomWindow(
  project: AxisWindow,
  zoom: Zoom,
  today: Date
): AxisWindow {
  const months = ZOOMS.find((z) => z.value === zoom)?.months ?? null;
  if (months === null) return project;
  const anchor =
    today < project.start
      ? project.start
      : today > project.end
        ? project.end
        : today;
  const start = startOfMonth(addMonths(anchor, -Math.floor(months / 4)));
  return { start, end: lastDayOf(addMonths(start, months - 1)) };
}

function windowDays(window: AxisWindow): number {
  return differenceInCalendarDays(window.end, window.start) + 1;
}

/** Where a day falls across the window, as a percentage from the left; null
 *  outside it. */
export function dayOffset(day: Date, window: AxisWindow): number | null {
  const offset = differenceInCalendarDays(day, window.start);
  const total = windowDays(window);
  if (offset < 0 || offset >= total) return null;
  return (offset / total) * 100;
}

/**
 * A bar from `start` to `end` (inclusive), clipped to the window, as left and
 * width percentages — or null when it is wholly outside. `clippedStart` /
 * `clippedEnd` say a side runs off the edge, so the chart can show it does.
 */
export function barSpan(
  start: Date,
  end: Date,
  window: AxisWindow
): {
  left: number;
  width: number;
  clippedStart: boolean;
  clippedEnd: boolean;
} | null {
  const total = windowDays(window);
  const from = differenceInCalendarDays(start, window.start);
  const to = differenceInCalendarDays(end, window.start) + 1;
  if (to <= 0 || from >= total || to <= from) return null;
  const left = Math.max(from, 0);
  const right = Math.min(to, total);
  return {
    left: (left / total) * 100,
    width: ((right - left) / total) * 100,
    clippedStart: from < 0,
    clippedEnd: to > total,
  };
}

/** The months across the window, each with its share of the width. The year
 *  is named on January and on the first month shown. */
export function axisMonths(
  window: AxisWindow
): { key: string; label: string; left: number; width: number }[] {
  return eachMonthOfInterval(window).map((month, index) => {
    const span = barSpan(month, endOfMonth(month), window);
    return {
      key: isoDay(month),
      label: format(
        month,
        index === 0 || month.getMonth() === 0 ? "MMM yyyy" : "MMM"
      ),
      left: span?.left ?? 0,
      width: span?.width ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

function duration(days: number): string {
  if (days < 14) return `${days} day${days === 1 ? "" : "s"}`;
  const weeks = days / 7;
  return Number.isInteger(weeks)
    ? `${weeks} weeks`
    : `about ${Math.round(weeks)} weeks`;
}

export type SlipTone = "late" | "early" | "on_plan";

/**
 * A slip in calendar days, in words — never a bare negative number. `null`
 * (the server could not say) stays null, for the caller to say why.
 */
export function describeSlip(
  days: number | null
): { text: string; tone: SlipTone } | null {
  if (days === null) return null;
  if (days === 0) return { text: "On plan", tone: "on_plan" };
  return days > 0
    ? { text: `${duration(days)} late`, tone: "late" }
    : { text: `${duration(-days)} early`, tone: "early" };
}

export const PHASE_STATE_LABEL: Record<PhaseState, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  done: "Done",
};

/** A gate's outcome: its words, a shape that does not rely on colour, and
 *  the colour classes the marker and the pill use. */
export const GATE: Record<
  GateStatus,
  { label: string; symbol: string; marker: string; pill: string }
> = {
  pending: {
    label: "Not decided yet",
    symbol: "◇",
    marker: "border-muted-foreground bg-background",
    pill: "border-border text-muted-foreground",
  },
  passed: {
    label: "Passed",
    symbol: "✓",
    marker: "border-emerald-600 bg-emerald-600",
    pill: "border-emerald-600/40 text-emerald-700 dark:text-emerald-400",
  },
  failed: {
    label: "Failed",
    symbol: "✕",
    marker: "border-red-600 bg-red-600",
    pill: "border-red-600/40 text-red-700 dark:text-red-400",
  },
  waived: {
    label: "Waived",
    symbol: "–",
    marker: "border-amber-500 bg-amber-500",
    pill: "border-amber-500/40 text-amber-700 dark:text-amber-400",
  },
};

export const GATE_OPTIONS: { value: GateStatus; label: string }[] = (
  ["pending", "passed", "failed", "waived"] as const
).map((value) => ({ value, label: GATE[value].label }));

export const MILESTONE_KIND_LABEL: Record<MilestoneKind, string> = {
  milestone: "Milestone",
  pilot: "Pilot",
  first_value: "First value",
  other: "Other",
};

export const MILESTONE_STATUS_LABEL: Record<MilestoneStatus, string> = {
  planned: "Planned",
  in_progress: "In progress",
  done: "Done",
  at_risk: "At risk",
};

// ---------------------------------------------------------------------------
// "Copy as mermaid gantt"
// ---------------------------------------------------------------------------

export interface ExportPhase {
  id: string;
  code: string;
  name: string;
  planned_start: string | null;
  planned_end: string | null;
  tasks: {
    number: string;
    title: string;
    planned_start: string | null;
    planned_end: string | null;
    is_critical: boolean;
    status: "planned" | "in_progress" | "done";
  }[];
}

/** Text mermaid reads as part of a task line: no `:` (the meta separator),
 *  `#` or `;` (comment and statement marks), nor line breaks. */
function label(text: string): string {
  return text.replace(/[:;#]/g, " ").replace(/\s+/g, " ").trim() || "Untitled";
}

function slugId(prefix: string, raw: string): string {
  return `${prefix}${raw.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
}

/**
 * The current PLAN as a mermaid `gantt` block, fenced, ready to paste into a
 * document or a deck. Planned dates only — it is the schedule, not the
 * progress. A phase's dated tasks are its bars (critical ones marked `crit`,
 * finished ones `done`); a phase with none is drawn as one bar of its own
 * dates; a phase with no dates at all cannot be drawn and is named in
 * `skipped`. Milestones sit in their phase's section, or in a closing
 * "Milestones" section when they belong to none.
 *
 * It reads back through the estimate's own gantt import (`gantt.ts`), so a
 * chart copied out and imported again keeps its phases and dates.
 */
export function toMermaidGantt(
  title: string,
  phases: ExportPhase[],
  milestones: Milestone[]
): { text: string; skipped: string[] } {
  const lines = [
    "```mermaid",
    "gantt",
    `    title ${label(title)}`,
    "    dateFormat YYYY-MM-DD",
  ];
  const skipped: string[] = [];
  const byPhase = new Map<string, Milestone[]>();
  const loose: Milestone[] = [];
  // By id, not code: codes are unique only within one estimate, and a
  // milestone may belong to a phase of another.
  const drawn = new Set(phases.map((p) => p.id));
  for (const milestone of milestones) {
    if (milestone.phase_id && drawn.has(milestone.phase_id)) {
      const list = byPhase.get(milestone.phase_id) ?? [];
      list.push(milestone);
      byPhase.set(milestone.phase_id, list);
    } else {
      loose.push(milestone);
    }
  }
  const milestoneLine = (m: Milestone, index: number) => {
    const tags = ["milestone", ...(m.status === "done" ? ["done"] : [])];
    return `    ${label(m.title)} :${tags.join(", ")}, ${slugId("m", `${index}`)}, ${m.target_date}, 0d`;
  };
  let milestoneIndex = 0;
  for (const phase of phases) {
    const dated = phase.tasks.filter((t) => t.planned_start && t.planned_end);
    const own = phase.planned_start && phase.planned_end;
    const theirs = byPhase.get(phase.id) ?? [];
    if (dated.length === 0 && !own && theirs.length === 0) {
      skipped.push(`${phase.code} ${phase.name}`);
      continue;
    }
    lines.push(`    section ${label(`${phase.code} ${phase.name}`)}`);
    if (dated.length > 0) {
      for (const task of dated) {
        const tags = [
          ...(task.is_critical ? ["crit"] : []),
          ...(task.status === "done" ? ["done"] : []),
          ...(task.status === "in_progress" ? ["active"] : []),
        ];
        lines.push(
          `    ${label(task.title)} :${[...tags, slugId(`${phase.code}_`, task.number), task.planned_start, task.planned_end].join(", ")}`
        );
      }
    } else if (own) {
      lines.push(
        `    ${label(phase.name)} :${slugId("", phase.code)}, ${phase.planned_start}, ${phase.planned_end}`
      );
    }
    for (const milestone of theirs) {
      milestoneIndex += 1;
      lines.push(milestoneLine(milestone, milestoneIndex));
    }
  }
  if (loose.length > 0) {
    lines.push("    section Milestones");
    for (const milestone of loose) {
      milestoneIndex += 1;
      lines.push(milestoneLine(milestone, milestoneIndex));
    }
  }
  lines.push("```");
  return { text: `${lines.join("\n")}\n`, skipped };
}
