/**
 * The milestone table: its registry declaration for the kit's `RecordTable`,
 * its CSV column mapping, and how a table edit becomes writes.
 *
 * Unlike the estimate's tables, every milestone is a record of its own on the
 * authoring contract — its own version, its own `If-Match`, its own change-log
 * row. So the table is not saved as a whole: each change the reader makes
 * (`planMilestoneWrites`) is one create, update or delete, sent at once.
 *
 * Pure: no React, no network.
 */

import {
  nonEmptyLines,
  splitCsvLine,
  type CsvIssue,
  type CsvResult,
} from "@/components/overview/editing/csv";
import { isIsoDay } from "@/components/overview/editing/fields";
import { threeWayMerge } from "@/components/overview/editing/merge";
import type { TableDeclaration } from "@/components/overview/editing/registry";
import { MILESTONE_KIND_LABEL, MILESTONE_STATUS_LABEL } from "./timeline";
import type { Milestone, MilestoneKind, MilestoneStatus } from "./timeline-api";

/** A milestone as the table edits it. `id` is empty and `version` 0 for one
 *  not yet created. */
export interface MilestoneRow {
  id: string;
  version: number;
  title: string;
  kind: MilestoneKind;
  phase_id: string | null;
  target_date: string;
  status: MilestoneStatus;
  completed_date: string | null;
  description: string;
  /** Set on a row read from a paste: the columns the paste actually gave.
   *  A paste that updates an existing milestone writes only these, so a
   *  column left out is left alone rather than reset to its default. */
  supplied?: Writable[];
}

/** The fields a write carries — everything the table edits. */
const WRITABLE = [
  "title",
  "kind",
  "phase_id",
  "target_date",
  "status",
  "completed_date",
  "description",
] as const;
export type Writable = (typeof WRITABLE)[number];

export function milestoneToRow(m: Milestone): MilestoneRow {
  return {
    id: m.id,
    version: m.version,
    title: m.title,
    kind: m.kind,
    phase_id: m.phase_id,
    target_date: m.target_date,
    status: m.status,
    completed_date: m.completed_date,
    description: m.description,
  };
}

export interface PhaseChoice {
  id: string;
  code: string;
  name: string;
}

const KIND_OPTIONS = (
  Object.entries(MILESTONE_KIND_LABEL) as [MilestoneKind, string][]
).map(([value, label]) => ({ value, label }));

const STATUS_OPTIONS = (
  Object.entries(MILESTONE_STATUS_LABEL) as [MilestoneStatus, string][]
).map(([value, label]) => ({ value, label }));

/**
 * The server's one cross-field rule, mirrored so the table refuses a row the
 * API would: a milestone is done exactly when it has the date it was done.
 */
export function milestoneRowProblem(row: {
  status: MilestoneStatus;
  completed_date: string | null;
}): string | null {
  if (row.status === "done" && !row.completed_date)
    return "A done milestone needs the date it was done.";
  if (row.status !== "done" && row.completed_date)
    return "Only a done milestone has a “done on” date — mark it done or clear the date.";
  return null;
}

function normalise(word: string): string {
  return word
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");
}

function pick<V extends string>(
  options: { value: V; label: string }[],
  text: string
): V | null {
  const wanted = normalise(text);
  return (
    options.find(
      (o) => normalise(o.value) === wanted || normalise(o.label) === wanted
    )?.value ?? null
  );
}

/**
 * Milestones from a paste: `title, date, status, kind, phase, done on, notes`.
 *
 * Only the title and the date are required; the status defaults to planned
 * and the kind to milestone. A phase is named by its CODE (`A2`). Words are
 * matched loosely (`At risk`, `at_risk`, `first value`).
 */
export function parseMilestonesCsv(
  text: string,
  phases: PhaseChoice[]
): CsvResult<MilestoneRow> {
  const issues: CsvIssue[] = [];
  const rows: MilestoneRow[] = [];
  const rowLines: number[] = [];
  const lines = nonEmptyLines(text);
  const first = normalise(splitCsvLine(lines[0]?.text ?? "")[0] ?? "");
  const start = first === "title" || first === "milestone" ? 1 : 0;

  for (const entry of lines.slice(start)) {
    const [title, date, status, kind, phase, doneOn, notes] = [
      0, 1, 2, 3, 4, 5, 6,
    ].map((i) => splitCsvLine(entry.text)[i] ?? "") as string[];
    const fail = (message: string) =>
      issues.push({
        line: entry.line,
        text: entry.text,
        message,
        severity: "error",
      });
    if (!title) {
      fail("The first column, the milestone's title, is empty.");
      continue;
    }
    if (!isIsoDay(date ?? "")) {
      fail(`“${date}” is not a date. Write it as 2026-03-31.`);
      continue;
    }
    const statusValue = status ? pick(STATUS_OPTIONS, status) : "planned";
    if (!statusValue) {
      fail(
        `“${status}” is not a status. Use one of: ${STATUS_OPTIONS.map((o) => o.label).join(", ")}.`
      );
      continue;
    }
    const kindValue = kind ? pick(KIND_OPTIONS, kind) : "milestone";
    if (!kindValue) {
      fail(
        `“${kind}” is not a kind. Use one of: ${KIND_OPTIONS.map((o) => o.label).join(", ")}.`
      );
      continue;
    }
    let phaseId: string | null = null;
    if (phase) {
      const found = phases.find(
        (p) => p.code.toLowerCase() === phase.toLowerCase()
      );
      if (!found) {
        fail(
          `There is no phase “${phase}”. Name a phase by its code: ${
            phases.map((p) => p.code).join(", ") || "this estimate has none"
          }.`
        );
        continue;
      }
      phaseId = found.id;
    }
    if (doneOn && !isIsoDay(doneOn)) {
      fail(`“${doneOn}” is not a date. Write it as 2026-03-31.`);
      continue;
    }
    const row: MilestoneRow = {
      id: "",
      version: 0,
      title: title.trim(),
      kind: kindValue,
      phase_id: phaseId,
      target_date: date!,
      status: statusValue,
      completed_date: doneOn || null,
      description: notes ?? "",
      supplied: [
        "title",
        "target_date",
        ...(status ? (["status"] as const) : []),
        ...(kind ? (["kind"] as const) : []),
        ...(phase ? (["phase_id"] as const) : []),
        ...(doneOn ? (["completed_date"] as const) : []),
        ...(notes ? (["description"] as const) : []),
      ],
    };
    // The done-means-dated rule is NOT checked here: a line may update a
    // milestone whose stored status or date completes it. The page checks
    // each write as the milestone will then stand, and refuses before
    // sending.
    rows.push(row);
    rowLines.push(entry.line);
  }
  return { rows, issues, lines: rowLines };
}

/** The table, declared for the kit — its phase choices are this estimate's. */
export function milestoneTable(
  phases: PhaseChoice[],
  /** Phases a milestone already names that are not among `phases` (another
   *  estimate's, e.g. a former baseline's): offered so such a row still
   *  reads and edits, never as a raw id. */
  others: { id: string; label: string }[] = []
): TableDeclaration<MilestoneRow> {
  return {
    resource: "milestones",
    schemaDef: "MilestoneCreate",
    singular: "milestone",
    plural: "milestones",
    emptyText: "No milestones yet.",
    identity: ["title", "target_date"],
    fields: [
      { field: "title", label: "Milestone", kind: "text", required: true },
      { field: "target_date", label: "Due", kind: "date", required: true },
      {
        field: "status",
        label: "Status",
        kind: "select",
        required: true,
        options: STATUS_OPTIONS,
      },
      {
        field: "kind",
        label: "Kind",
        kind: "select",
        required: true,
        options: KIND_OPTIONS,
      },
      {
        field: "phase_id",
        label: "Phase",
        kind: "select",
        options: [
          ...phases.map((p) => ({
            value: p.id,
            label: `${p.code} ${p.name}`,
          })),
          ...others.map((o) => ({ value: o.id, label: o.label })),
        ],
        emptyLabel: "No phase",
      },
      { field: "completed_date", label: "Done on", kind: "date" },
      { field: "description", label: "Notes", kind: "text" },
    ],
    blank: () => ({
      id: "",
      version: 0,
      title: "",
      kind: "milestone",
      phase_id: null,
      target_date: "",
      status: "planned",
      completed_date: null,
      description: "",
    }),
    csv: {
      label: "Paste milestones",
      help: "One milestone per line: title, due date, status, kind, phase code, done-on date, notes. Only the title and the due date are required. A line whose title matches exactly one existing milestone updates it — only the columns the line fills in; every other line adds one. A paste never removes a milestone, and an empty cell never clears a value — use the table for that.",
      placeholder:
        "title,due,status,kind,phase,done on,notes\nPilot live,2026-05-04,planned,pilot,A3,,First site only",
      parse: (text) => parseMilestonesCsv(text, phases),
    },
  };
}

export interface MilestoneWrites {
  creates: MilestoneRow[];
  /** `row` is the record as it stood; `patch` only what changed. */
  updates: { row: MilestoneRow; patch: Partial<MilestoneRow> }[];
  deletes: MilestoneRow[];
}

function changed(
  before: MilestoneRow,
  after: MilestoneRow,
  fields: readonly Writable[] = WRITABLE
): Partial<MilestoneRow> {
  const patch: Partial<Record<Writable, unknown>> = {};
  for (const field of fields) {
    if (before[field] !== after[field]) patch[field] = after[field];
  }
  return patch as Partial<MilestoneRow>;
}

/** A milestone write that met a newer version, rebuilt on it. */
export interface RebasedMilestone {
  /** Theirs, with every field I changed set to mine. */
  merged: MilestoneRow;
  /** What "save mine over theirs" sends: every field I changed, and only
   *  those — a field only they changed is never written back. */
  patch: Partial<MilestoneRow>;
  /** Fields we both changed to different values: the writer's choice. */
  both: Writable[];
}

/**
 * My edit of a milestone (`mine`, built on `base`) rebuilt on THEIR newer
 * version — the kit's three-way merge (`threeWayMerge`), field by field.
 */
export function rebaseMilestone(
  base: MilestoneRow,
  mine: MilestoneRow,
  theirs: Milestone
): RebasedMilestone {
  const theirRow = milestoneToRow(theirs);
  const { merged, mineOnly, both } = threeWayMerge(
    base,
    mine,
    theirRow,
    WRITABLE
  );
  const patch: Partial<Record<Writable, unknown>> = {};
  for (const field of [...mineOnly, ...both]) patch[field] = mine[field];
  return {
    merged: { ...merged, id: theirs.id, version: theirs.version },
    patch: patch as Partial<MilestoneRow>,
    both,
  };
}

/** A writable field's name as the table shows it. */
export const MILESTONE_FIELD_LABEL: Record<Writable, string> = {
  title: "Milestone",
  kind: "Kind",
  phase_id: "Phase",
  target_date: "Due",
  status: "Status",
  completed_date: "Done on",
  description: "Notes",
};

/** The fields a create sends. */
export function createBody(row: MilestoneRow): Record<string, unknown> {
  return Object.fromEntries(WRITABLE.map((f) => [f, row[f]]));
}

/**
 * The writes that turn `previous` (what the server holds) into `next`.
 *
 * - An **edit** (`how: "edit"`) is the table as the reader left it: a row
 *   with no id is created, a row whose fields moved is updated with only
 *   those fields, a row that is gone is deleted.
 * - An **import** (a CSV paste) is never a deletion. Each pasted row whose
 *   title matches exactly ONE existing milestone (ignoring case) updates it;
 *   every other row is created. An ambiguous title is a new milestone, not a
 *   guess at which one was meant.
 */
export function planMilestoneWrites(
  previous: MilestoneRow[],
  next: MilestoneRow[],
  how: "edit" | "import"
): MilestoneWrites {
  const plan: MilestoneWrites = { creates: [], updates: [], deletes: [] };
  if (how === "import") {
    for (const row of next) {
      const same = previous.filter(
        (p) => p.title.trim().toLowerCase() === row.title.trim().toLowerCase()
      );
      if (same.length === 1) {
        const patch = changed(same[0]!, row, row.supplied ?? WRITABLE);
        if (Object.keys(patch).length > 0)
          plan.updates.push({ row: same[0]!, patch });
      } else {
        plan.creates.push(row);
      }
    }
    return plan;
  }
  const byId = new Map(previous.map((p) => [p.id, p]));
  const kept = new Set<string>();
  for (const row of next) {
    const was = row.id ? byId.get(row.id) : undefined;
    if (!was) {
      plan.creates.push(row);
      continue;
    }
    kept.add(row.id);
    const patch = changed(was, row);
    if (Object.keys(patch).length > 0) plan.updates.push({ row: was, patch });
  }
  plan.deletes = previous.filter((p) => !kept.has(p.id));
  return plan;
}

/** The phases milestones name that `phases` does not hold, labelled from
 *  the code the server resolved. */
export function otherPhases(
  milestones: Milestone[],
  phases: PhaseChoice[]
): { id: string; label: string }[] {
  const known = new Set(phases.map((p) => p.id));
  const out = new Map<string, string>();
  for (const m of milestones) {
    if (m.phase_id && !known.has(m.phase_id))
      out.set(m.phase_id, `${m.phase_code ?? "A phase"} (another estimate)`);
  }
  return [...out].map(([id, label]) => ({ id, label }));
}
