/**
 * The work-unit page's "Schedule" panel, as pure functions.
 *
 * Plan `2026-11-25-overview-timeline-and-milestones-derive-from-coord`
 * Phase 5. The Project Overview is derived only from coord, so a unit's
 * declared phases, the units linked to each phase, the milestone each phase
 * ends at and its planned dates must be enterable by a person on this page.
 * Those live in the unit's `metadata` under five keys (`phases`,
 * `phase_units`, `parent`, `parent_phase`, `intent_initiative`); coord's
 * `operator-schedule-metadata` route owns that closed set.
 *
 * The panel edits a DRAFT: strings the operator typed. Nothing here guesses —
 * a stored entry the panel cannot read is counted in `unreadable`, never
 * dropped silently, because saving a draft replaces the whole `phases` list.
 */

/** One editable phase row; every field is the text as typed. */
export interface PhaseDraft {
  index: string;
  name: string;
  milestone: string;
  plannedStart: string;
  plannedEnd: string;
  /** Comma- or whitespace-separated unit slugs linked to this phase. */
  units: string;
}

export interface ScheduleDraft {
  phases: PhaseDraft[];
  parent: string;
  parentPhase: string;
  intentInitiative: string;
  /** Stored `phases` entries (or `phase_units` keys) that could not be read. */
  unreadable: number;
}

export interface SchedulePhaseEntry {
  index: number;
  name: string;
  milestone?: string;
  planned_start?: string;
  planned_end?: string;
}

/** The body `PATCH /plans/{slug}/schedule-metadata` takes. */
export interface ScheduleMetadataPatch {
  phases: SchedulePhaseEntry[] | null;
  phase_units: Record<string, string[]> | null;
  parent: string | null;
  parent_phase: number | null;
  intent_initiative: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PHASE_FIELDS = new Set([
  "index",
  "name",
  "milestone",
  "planned_start",
  "planned_end",
]);

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function parseUnitList(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[\s,]+/)) {
    const s = part.trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Read a stored `metadata` object into a draft. Never throws. */
export function draftFromMetadata(metadata: unknown): ScheduleDraft {
  const md =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  let unreadable = 0;
  const unitsByIndex = new Map<string, string[]>();
  const pu = md.phase_units;
  if (pu && typeof pu === "object" && !Array.isArray(pu)) {
    for (const [k, v] of Object.entries(pu as Record<string, unknown>)) {
      if (
        Array.isArray(v) &&
        v.every((x) => typeof x === "string") &&
        /^\d+$/.test(k)
      ) {
        unitsByIndex.set(k, v as string[]);
      } else {
        unreadable += 1;
      }
    }
  } else if (pu !== undefined && pu !== null) {
    unreadable += 1;
  }
  const phases: PhaseDraft[] = [];
  if (Array.isArray(md.phases)) {
    for (const e of md.phases) {
      const o =
        e && typeof e === "object" && !Array.isArray(e)
          ? (e as Record<string, unknown>)
          : null;
      const idx = o?.index;
      if (
        !o ||
        typeof idx !== "number" ||
        !Number.isInteger(idx) ||
        idx < 0 ||
        typeof o.name !== "string" ||
        // A field the panel does not edit would be dropped by the save, which
        // replaces the whole list: count it rather than lose it silently.
        Object.keys(o).some((k) => !PHASE_FIELDS.has(k)) ||
        // A present field of the wrong type would read as "" and the save
        // would erase it.
        ["milestone", "planned_start", "planned_end"].some(
          (k) => o[k] !== undefined && o[k] !== null && typeof o[k] !== "string"
        )
      ) {
        unreadable += 1;
        continue;
      }
      phases.push({
        index: String(idx),
        name: o.name,
        milestone: str(o.milestone),
        plannedStart: str(o.planned_start),
        plannedEnd: str(o.planned_end),
        units: (unitsByIndex.get(String(idx)) ?? []).join(", "),
      });
    }
  } else if (md.phases !== undefined && md.phases !== null) {
    unreadable += 1;
  }
  // A `phase_units` entry for a phase the list does not declare is not shown
  // anywhere in the panel, so a save would erase it: count it.
  const shown = new Set(phases.map((p) => p.index));
  for (const k of unitsByIndex.keys()) {
    if (!shown.has(k)) unreadable += 1;
  }
  const pp = md.parent_phase;
  for (const v of [md.parent, md.intent_initiative]) {
    if (v !== undefined && v !== null && typeof v !== "string") unreadable += 1;
  }
  if (pp !== undefined && pp !== null && typeof pp !== "number") unreadable += 1;
  return {
    phases,
    parent: str(md.parent),
    parentPhase: typeof pp === "number" ? String(pp) : "",
    intentInitiative: str(md.intent_initiative),
    unreadable,
  };
}

/** Problems the browser can see before coord is asked. Empty means none. */
export function validateDraft(draft: ScheduleDraft): string[] {
  const problems: string[] = [];
  const seen = new Set<number>();
  draft.phases.forEach((p, i) => {
    const row = `Phase row ${i + 1}`;
    if (!/^\d+$/.test(p.index.trim())) {
      problems.push(`${row}: the index must be a whole number.`);
    } else {
      const n = Number(p.index.trim());
      if (seen.has(n)) problems.push(`${row}: index ${n} is used twice.`);
      seen.add(n);
    }
    if (!p.name.trim()) problems.push(`${row}: the name is required.`);
    for (const [label, v] of [
      ["planned start", p.plannedStart],
      ["planned end", p.plannedEnd],
    ] as const) {
      if (v.trim() && !ISO_DATE.test(v.trim())) {
        problems.push(`${row}: ${label} must look like 2026-12-01.`);
      }
    }
    if (
      ISO_DATE.test(p.plannedStart.trim()) &&
      ISO_DATE.test(p.plannedEnd.trim()) &&
      p.plannedStart.trim() > p.plannedEnd.trim()
    ) {
      problems.push(`${row}: planned start is after planned end.`);
    }
  });
  if (draft.parentPhase.trim() && !/^\d+$/.test(draft.parentPhase.trim())) {
    problems.push("Parent phase must be a whole number.");
  }
  if (draft.parentPhase.trim() && !draft.parent.trim()) {
    problems.push("A parent phase needs a parent unit.");
  }
  if (draft.unreadable > 0) {
    problems.push(
      `${draft.unreadable} stored schedule entr${draft.unreadable === 1 ? "y" : "ies"} could not be read here; saving would drop ${draft.unreadable === 1 ? "it" : "them"}. Fix ${draft.unreadable === 1 ? "it" : "them"} where ${draft.unreadable === 1 ? "it was" : "they were"} written first.`
    );
  }
  return problems;
}

/**
 * The patch that makes the stored schedule keys equal the draft. An empty
 * list or field is sent as `null`, which removes the key in coord (RFC 7396)
 * rather than storing an empty value.
 */
export function buildSchedulePatch(draft: ScheduleDraft): ScheduleMetadataPatch {
  const phases = draft.phases.map((p) => {
    const entry: SchedulePhaseEntry = {
      index: Number(p.index.trim()),
      name: p.name.trim(),
    };
    if (p.milestone.trim()) entry.milestone = p.milestone.trim();
    if (p.plannedStart.trim()) entry.planned_start = p.plannedStart.trim();
    if (p.plannedEnd.trim()) entry.planned_end = p.plannedEnd.trim();
    return entry;
  });
  const units: Record<string, string[]> = {};
  for (const p of draft.phases) {
    const list = parseUnitList(p.units);
    if (list.length > 0) units[String(Number(p.index.trim()))] = list;
  }
  return {
    phases: phases.length > 0 ? phases : null,
    phase_units: Object.keys(units).length > 0 ? units : null,
    parent: draft.parent.trim() || null,
    parent_phase: draft.parentPhase.trim()
      ? Number(draft.parentPhase.trim())
      : null,
    intent_initiative: draft.intentInitiative.trim() || null,
  };
}

/** True when the draft would write exactly what is already stored. */
export function draftIsUnchanged(
  draft: ScheduleDraft,
  metadata: unknown
): boolean {
  return (
    JSON.stringify(buildSchedulePatch(draft)) ===
    JSON.stringify(buildSchedulePatch(draftFromMetadata(metadata)))
  );
}
