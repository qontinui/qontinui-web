import { describe, expect, it } from "vitest";
import { parseMermaidGantt } from "./gantt";
import {
  axisMonths,
  barSpan,
  dayOffset,
  describeSlip,
  projectWindow,
  toDay,
  toMermaidGantt,
  zoomWindow,
  type ExportPhase,
} from "./timeline";
import type { Milestone } from "./timeline-api";

const day = (iso: string) => toDay(iso)!;

describe("describeSlip", () => {
  it("never shows a slip as a bare signed number", () => {
    for (const days of [-203, -66, -1, 1, 9, 21, 23, 100]) {
      const said = describeSlip(days)!;
      expect(said.text).not.toMatch(/-|−/);
      expect(said.tone).toBe(days > 0 ? "late" : "early");
    }
  });

  it("says days under a fortnight and weeks above it", () => {
    expect(describeSlip(1)?.text).toBe("1 day late");
    expect(describeSlip(10)?.text).toBe("10 days late");
    expect(describeSlip(-5)?.text).toBe("5 days early");
    expect(describeSlip(21)?.text).toBe("3 weeks late");
    expect(describeSlip(23)?.text).toBe("about 3 weeks late");
  });

  it("names on-plan, and keeps unknown unknown", () => {
    expect(describeSlip(0)).toEqual({ text: "On plan", tone: "on_plan" });
    expect(describeSlip(null)).toBeNull();
  });
});

describe("the month axis", () => {
  const window = projectWindow(["2026-01-05", null, "2026-03-27"])!;

  it("covers whole months around every date it is given", () => {
    expect(window.start).toEqual(day("2026-01-01"));
    expect(window.end).toEqual(day("2026-03-31"));
    expect(projectWindow([null, undefined])).toBeNull();
  });

  it("lays the months side by side, filling the width", () => {
    const months = axisMonths(window);
    expect(months.map((m) => m.label)).toEqual(["Jan 2026", "Feb", "Mar"]);
    const total = months.reduce((sum, m) => sum + m.width, 0);
    expect(total).toBeCloseTo(100);
    expect(months[1]!.left).toBeCloseTo((31 / 90) * 100);
  });

  it("places a day, and nothing outside the window", () => {
    expect(dayOffset(day("2026-01-01"), window)).toBe(0);
    expect(dayOffset(day("2025-12-31"), window)).toBeNull();
    expect(dayOffset(day("2026-04-01"), window)).toBeNull();
  });

  it("clips a bar to the window and says which side runs off", () => {
    const span = barSpan(day("2025-12-15"), day("2026-01-10"), window)!;
    expect(span.left).toBe(0);
    expect(span.width).toBeCloseTo((10 / 90) * 100);
    expect(span.clippedStart).toBe(true);
    expect(span.clippedEnd).toBe(false);
    expect(barSpan(day("2025-01-01"), day("2025-02-01"), window)).toBeNull();
  });

  it("zooms onto today, held inside the project", () => {
    const project = projectWindow(["2026-01-05", "2026-12-20"])!;
    const quarter = zoomWindow(project, "quarter", day("2026-06-15"));
    expect(quarter.start).toEqual(day("2026-06-01"));
    expect(quarter.end).toEqual(day("2026-08-31"));
    const late = zoomWindow(project, "half", day("2030-01-01"));
    expect(late.start <= project.end && late.end >= project.end).toBe(true);
    expect(zoomWindow(project, "project", day("2026-06-15"))).toBe(project);
  });
});

const PHASES: ExportPhase[] = [
  {
    id: "p0",
    code: "A0",
    name: "Mobilisation",
    planned_start: "2026-01-05",
    planned_end: "2026-01-30",
    tasks: [
      {
        number: "1.1",
        title: "Kick-off: access",
        planned_start: "2026-01-05",
        planned_end: "2026-01-09",
        is_critical: true,
        status: "done",
      },
      {
        number: "1.2",
        title: "Environments",
        planned_start: "2026-01-12",
        planned_end: "2026-01-30",
        is_critical: false,
        status: "planned",
      },
    ],
  },
  {
    id: "p1",
    code: "A1",
    name: "Discovery",
    planned_start: "2026-02-02",
    planned_end: "2026-03-13",
    tasks: [],
  },
  {
    id: "p2",
    code: "A2",
    name: "Undated",
    planned_start: null,
    planned_end: null,
    tasks: [],
  },
];

function milestone(over: Partial<Milestone>): Milestone {
  return {
    id: "m",
    title: "Pilot live",
    description: "",
    kind: "pilot",
    phase_id: null,
    phase_code: null,
    target_date: "2026-03-02",
    completed_date: null,
    status: "planned",
    version: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    created_by: null,
    updated_by: null,
    ...over,
  };
}

describe("toMermaidGantt", () => {
  const { text, skipped } = toMermaidGantt("Delivery: plan", PHASES, [
    milestone({ phase_id: "p1", phase_code: "A1", title: "Sign-off" }),
    // Another estimate's A1: same code, different phase.
    milestone({
      id: "m3",
      phase_id: "elsewhere",
      phase_code: "A1",
      title: "Elsewhere",
    }),
    milestone({ id: "m2", title: "First value", status: "done" }),
  ]);

  it("is a fenced mermaid gantt of the plan", () => {
    expect(text.startsWith("```mermaid\ngantt\n")).toBe(true);
    expect(text.trimEnd().endsWith("```")).toBe(true);
    expect(text).toContain("title Delivery plan");
    expect(text).toContain("section A0 Mobilisation");
    expect(text).toMatch(
      /Kick-off access :crit, done, .*2026-01-05, 2026-01-09/
    );
    // A phase with no dated tasks is one bar of its own dates.
    expect(text).toMatch(/Discovery :a1, 2026-02-02, 2026-03-13/);
    expect(text).toMatch(/Sign-off :milestone, m\d+, 2026-03-02, 0d/);
    expect(text).toContain("section Milestones");
    const loose = text.slice(text.indexOf("section Milestones"));
    expect(loose).toContain("Elsewhere");
  });

  it("names what it could not draw rather than dropping it silently", () => {
    expect(skipped).toEqual(["A2 Undated"]);
  });

  it("reads back through the estimate's own gantt import", () => {
    const fenced = text.split("\n").slice(1, -2).join("\n");
    const parsed = parseMermaidGantt(fenced);
    expect(parsed.issues.filter((i) => i.severity === "error")).toEqual([]);
    const [a0, a1] = parsed.phases;
    expect(a0?.code).toBe("A0");
    expect(a0?.plannedStart).toBe("2026-01-05");
    expect(a0?.plannedEnd).toBe("2026-01-30");
    expect(a0?.tasks.map((t) => t.isCritical)).toEqual([true, false]);
    expect(a1?.code).toBe("A1");
    expect(a1?.plannedEnd).toBe("2026-03-13");
  });
});
