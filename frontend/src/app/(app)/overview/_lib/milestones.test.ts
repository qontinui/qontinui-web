import { describe, expect, it } from "vitest";
import {
  cellText,
  rowProblems,
  rowToText,
  textToRow,
} from "@/components/overview/editing/fields";
import type { JsonSchema } from "@/components/overview/editing/api";
import {
  milestoneRowProblem,
  milestoneTable,
  otherPhases,
  parseMilestonesCsv,
  planMilestoneWrites,
  type MilestoneRow,
} from "./milestones";

const PHASES = [
  { id: "p0", code: "A0", name: "Mobilisation" },
  { id: "p1", code: "A1", name: "Discovery" },
];

/** The create schema as pydantic serves it, trimmed to what is checked. */
const CREATE_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    title: { type: "string", minLength: 1, maxLength: 200 },
    target_date: {
      type: "string",
      format: "date",
      formatMinimum: "1970-01-01",
      formatMaximum: "2200-12-31",
    },
    completed_date: {
      anyOf: [
        {
          type: "string",
          format: "date",
          formatMinimum: "1970-01-01",
          formatMaximum: "2200-12-31",
        },
        { type: "null" },
      ],
    },
  },
};

function row(over: Partial<MilestoneRow> = {}): MilestoneRow {
  return {
    id: "m1",
    version: 1,
    title: "Pilot live",
    kind: "pilot",
    phase_id: "p1",
    target_date: "2026-03-02",
    status: "planned",
    completed_date: null,
    description: "",
    ...over,
  };
}

describe("parseMilestonesCsv", () => {
  it("reads loosely worded lines and names phases by code", () => {
    const { rows, issues } = parseMilestonesCsv(
      "title,due,status,kind,phase,done on,notes\n" +
        "Pilot live,2026-05-04,At risk,pilot,a1,,First site\n" +
        "First value,2026-06-01,done,First Value,,2026-06-03,",
      PHASES
    );
    expect(issues).toEqual([]);
    expect(rows[0]).toMatchObject({
      title: "Pilot live",
      status: "at_risk",
      kind: "pilot",
      phase_id: "p1",
      description: "First site",
    });
    expect(rows[1]).toMatchObject({
      status: "done",
      kind: "first_value",
      completed_date: "2026-06-03",
      phase_id: null,
    });
  });

  it("names every line it cannot use, and why", () => {
    const { rows, issues } = parseMilestonesCsv(
      [
        ",2026-01-01",
        "No date,soon",
        "Bad status,2026-01-01,finished",
        "Bad phase,2026-01-01,,,Z9",
        "Done undated,2026-01-01,done",
        "Undone dated,2026-01-01,planned,,,2026-01-02",
      ].join("\n"),
      PHASES
    );
    expect(rows).toEqual([]);
    expect(issues.map((i) => i.line)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(issues[3]?.message).toContain("A0, A1");
  });
});

describe("the milestone table's fields", () => {
  const table = milestoneTable(PHASES);
  const text = (over: Record<string, string | boolean>) => ({
    title: "Pilot",
    target_date: "2026-03-02",
    status: "planned",
    kind: "milestone",
    phase_id: "",
    completed_date: "",
    description: "",
    ...over,
  });

  it("refuses a date that is not a real day or is out of range", () => {
    for (const bad of ["2026-02-30", "02/03/2026", "1900-01-01"]) {
      const read = textToRow(
        table,
        text({ target_date: bad }),
        CREATE_SCHEMA,
        row()
      );
      expect("errors" in read && read.errors.target_date).toBeTruthy();
    }
  });

  it("stores an empty phase as none, and a choice by its value", () => {
    const none = textToRow(table, text({}), CREATE_SCHEMA, row());
    expect("row" in none && none.row.phase_id).toBeNull();
    const chosen = textToRow(
      table,
      text({ phase_id: "p0" }),
      CREATE_SCHEMA,
      row()
    );
    expect("row" in chosen && chosen.row.phase_id).toBe("p0");
  });

  it("carries the record's id and version through an edit", () => {
    const read = textToRow(
      table,
      text({ title: "Renamed" }),
      CREATE_SCHEMA,
      row()
    );
    expect("row" in read && read.row).toMatchObject({ id: "m1", version: 1 });
    expect(rowProblems(table, row(), CREATE_SCHEMA)).toEqual([]);
  });

  it("mirrors the server's done-means-dated rule", () => {
    expect(
      milestoneRowProblem({ status: "done", completed_date: null })
    ).toBeTruthy();
    expect(
      milestoneRowProblem({ status: "planned", completed_date: "2026-01-01" })
    ).toBeTruthy();
    expect(
      milestoneRowProblem({ status: "done", completed_date: "2026-01-01" })
    ).toBeNull();
  });
});

describe("planMilestoneWrites", () => {
  const a = row({ id: "a", title: "Alpha" });
  const b = row({ id: "b", title: "Beta" });

  it("turns an edited table into one write per changed row", () => {
    const next = [
      { ...a, status: "at_risk" as const },
      row({ id: "", version: 0, title: "Gamma" }),
    ];
    const plan = planMilestoneWrites([a, b], next, "edit");
    expect(plan.updates).toEqual([{ row: a, patch: { status: "at_risk" } }]);
    expect(plan.creates.map((r) => r.title)).toEqual(["Gamma"]);
    expect(plan.deletes).toEqual([b]);
  });

  it("writes nothing for an unchanged table", () => {
    expect(planMilestoneWrites([a, b], [a, b], "edit")).toEqual({
      creates: [],
      updates: [],
      deletes: [],
    });
  });

  it("makes a paste add and update by title, and never delete", () => {
    const twin = row({ id: "c", title: "Beta" });
    const pasted = [
      row({ id: "", version: 0, title: "alpha", target_date: "2026-04-01" }),
      row({ id: "", version: 0, title: "Beta" }),
      row({ id: "", version: 0, title: "Delta" }),
    ];
    const plan = planMilestoneWrites([a, b, twin], pasted, "import");
    expect(plan.deletes).toEqual([]);
    expect(plan.updates).toEqual([
      { row: a, patch: { title: "alpha", target_date: "2026-04-01" } },
    ]);
    // "Beta" names two milestones, so it is a new one rather than a guess.
    expect(plan.creates.map((r) => r.title)).toEqual(["Beta", "Delta"]);
  });
});

describe("a paste that updates", () => {
  it("writes only the columns the line fills in", () => {
    const done = row({
      id: "m1",
      title: "Pilot live",
      status: "done",
      completed_date: "2026-05-06",
      phase_id: "p1",
      description: "First site",
    });
    const { rows, issues } = parseMilestonesCsv(
      "Pilot live,2026-05-04",
      PHASES
    );
    expect(issues).toEqual([]);
    const plan = planMilestoneWrites([done], rows, "import");
    expect(plan.updates).toEqual([
      { row: done, patch: { target_date: "2026-05-04" } },
    ]);
  });
});

describe("a milestone tied to another estimate's phase", () => {
  it("is offered under its code rather than shown as an id", () => {
    const foreign = {
      id: "m9",
      title: "Old gate",
      description: "",
      kind: "milestone" as const,
      phase_id: "old-phase",
      phase_code: "B2",
      target_date: "2026-01-01",
      completed_date: null,
      status: "planned" as const,
      version: 1,
      created_at: "",
      updated_at: "",
      created_by: null,
      updated_by: null,
    };
    const others = otherPhases([foreign], PHASES);
    expect(others).toEqual([
      { id: "old-phase", label: "B2 (another estimate)" },
    ]);
    const table = milestoneTable(PHASES, others);
    const phase = table.fields.find((f) => f.field === "phase_id")!;
    expect(cellText(phase, row({ phase_id: "old-phase" }))).toBe(
      "B2 (another estimate)"
    );
    // And the row still edits without re-picking its phase.
    const read = textToRow(
      table,
      rowToText(table, row({ phase_id: "old-phase" })),
      CREATE_SCHEMA,
      row({ phase_id: "old-phase" })
    );
    expect("row" in read && read.row.phase_id).toBe("old-phase");
  });
});
