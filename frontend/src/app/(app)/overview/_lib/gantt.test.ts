import { describe, expect, it } from "vitest";
import { ganttToPhases, parseMermaidGantt } from "./gantt";

/**
 * The reference example's SHAPE: six coded sections, dated bars, `crit`
 * markers, a milestone, `after` dependencies and `excludes weekends`. No real
 * names, dates or figures from the client document — only the structure the
 * import has to survive.
 */
const REFERENCE = `
gantt
    title       Delivery plan
    dateFormat  YYYY-MM-DD
    axisFormat  %b %Y
    excludes    weekends

    section A0 Mobilisation
    Kick-off and access        :a0t1, 2026-01-05, 5d
    Environment baseline       :a0t2, after a0t1, 2026-01-30

    section A1 Discovery
    Requirements workshops     :a1t1, 2026-02-02, 3w
    Architecture note          :crit, a1t2, after a1t1, 2026-03-13

    section A2 Build one
    Core service               :crit, a2t1, 2026-03-16, 2026-05-01
    Reporting                  :a2t2, 2026-04-01, 2026-05-29

    section A3 Build two
    Migration                  :a3t1, 2026-06-01, 2026-07-17
    Cutover rehearsal          :a3t2, after a3t1, 2026-07-31

    section A4 Pilot
    Pilot in two sites         :crit, a4t1, 2026-08-03, 2026-09-04
    Go / no-go                 :milestone, a4m1, 2026-09-11, 0d

    section A5 Handover
    Runbooks                   :a5t1, 2026-09-14, 2w
    Support handover           :a5t2, after a5t1, 2026-10-09
`;

describe("parseMermaidGantt — the reference example's shape", () => {
  const result = parseMermaidGantt(REFERENCE);

  it("reads every section as a phase, with its code split off the name", () => {
    expect(result.phases.map((p) => p.code)).toEqual([
      "A0",
      "A1",
      "A2",
      "A3",
      "A4",
      "A5",
    ]);
    expect(result.phases.map((p) => p.name)).toEqual([
      "Mobilisation",
      "Discovery",
      "Build one",
      "Build two",
      "Pilot",
      "Handover",
    ]);
  });

  it("reads the title and honours `excludes weekends`", () => {
    expect(result.title).toBe("Delivery plan");
    expect(result.excludesWeekends).toBe(true);
  });

  it("imports every task with no errors", () => {
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(result.taskCount).toBe(12);
  });

  it("marks the critical tasks and only those", () => {
    const critical = result.phases
      .flatMap((p) => p.tasks)
      .filter((t) => t.isCritical)
      .map((t) => t.id);
    expect(critical).toEqual(["a1t2", "a2t1", "a4t1"]);
  });

  it("lays a duration over working days when weekends are excluded", () => {
    // Mon 2026-01-05 + 5d, weekends excluded, ends the same Friday.
    const kickoff = result.phases[0].tasks[0];
    expect(kickoff.plannedStart).toBe("2026-01-05");
    expect(kickoff.plannedEnd).toBe("2026-01-09");
    // 3w with weekends excluded is 15 working days: Mon 02 Feb → Fri 20 Feb.
    const workshops = result.phases[1].tasks[0];
    expect(workshops.plannedStart).toBe("2026-02-02");
    expect(workshops.plannedEnd).toBe("2026-02-20");
  });

  it("starts an `after` task on the next working day", () => {
    // a0t1 ends Fri 2026-01-09, so a0t2 starts Mon 2026-01-12, not Sat 10.
    expect(result.phases[0].tasks[1].plannedStart).toBe("2026-01-12");
  });

  it("gives a milestone a single day", () => {
    const milestone = result.phases[4].tasks[1];
    expect(milestone.isMilestone).toBe(true);
    expect(milestone.plannedStart).toBe("2026-09-11");
    expect(milestone.plannedEnd).toBe("2026-09-11");
  });

  it("derives each phase's span from its tasks", () => {
    expect(result.phases[2].plannedStart).toBe("2026-03-16");
    expect(result.phases[2].plannedEnd).toBe("2026-05-29");
  });

  it("numbers tasks <phase>.<task> for the save payload", () => {
    const payload = ganttToPhases(result);
    expect(payload[0].tasks.map((t) => t.number)).toEqual(["1.1", "1.2"]);
    expect(payload[5].tasks.map((t) => t.number)).toEqual(["6.1", "6.2"]);
    expect(payload[0].planned_start).toBe("2026-01-05");
  });
});

describe("parseMermaidGantt — calendar days when weekends are not excluded", () => {
  it("lays 5d over five calendar days", () => {
    const result = parseMermaidGantt(`
gantt
    dateFormat YYYY-MM-DD
    section P One
    Work :t1, 2026-01-05, 5d
`);
    expect(result.excludesWeekends).toBe(false);
    expect(result.phases[0].tasks[0].plannedEnd).toBe("2026-01-09");
  });

  it("lays 1w over seven calendar days", () => {
    const result = parseMermaidGantt(`
gantt
    dateFormat YYYY-MM-DD
    section P One
    Work :t1, 2026-01-05, 1w
`);
    expect(result.phases[0].tasks[0].plannedEnd).toBe("2026-01-11");
  });
});

describe("parseMermaidGantt — what it refuses to guess", () => {
  it("names a task that follows an id the chart never defines", () => {
    const result = parseMermaidGantt(`
gantt
    dateFormat YYYY-MM-DD
    section P One
    Work :t1, after nothing, 3d
`);
    expect(result.taskCount).toBe(0);
    expect(result.issues[0].severity).toBe("error");
    expect(result.issues[0].message).toContain("nothing");
    expect(result.issues[0].line).toBe(5);
  });

  it("refuses a dateFormat it cannot read rather than misreading dates", () => {
    const result = parseMermaidGantt(`
gantt
    dateFormat DD/MM/YYYY
    section P One
    Work :t1, 2026-01-05, 3d
`);
    expect(
      result.issues.some(
        (i) => i.severity === "error" && i.message.includes("DD/MM/YYYY")
      )
    ).toBe(true);
  });

  it("warns rather than errors when no dateFormat is declared", () => {
    const result = parseMermaidGantt(`
gantt
    section P One
    Work :t1, 2026-01-05, 3d
`);
    expect(result.taskCount).toBe(1);
    expect(result.issues.map((i) => i.severity)).toEqual(["warning"]);
  });

  it("rejects a task that ends before it starts", () => {
    const result = parseMermaidGantt(`
gantt
    dateFormat YYYY-MM-DD
    section P One
    Work :t1, 2026-02-05, 2026-01-05
`);
    expect(result.taskCount).toBe(0);
    expect(result.issues[0].message).toContain("ends before it starts");
  });

  it("rejects a duration in a unit it does not understand", () => {
    const result = parseMermaidGantt(`
gantt
    dateFormat YYYY-MM-DD
    section P One
    Work :t1, 2026-01-05, 2mo
`);
    expect(result.taskCount).toBe(0);
    expect(result.issues[0].message).toContain("days or weeks");
  });

  it("refuses an absurd duration rather than freezing the tab laying it out", () => {
    // The layout walks a day at a time, because weekends are skipped. This
    // runs in the reader's browser on whatever they paste, so the bound is
    // what stops a typo from hanging the page.
    const started = Date.now();
    const result = parseMermaidGantt(`
gantt
    dateFormat YYYY-MM-DD
    excludes weekends
    section P One
    Work :t1, 2026-01-05, 999999999d
`);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(result.taskCount).toBe(0);
    expect(result.issues[0]?.message).toContain("longer than this import");
  });

  it("still lays out a long but plausible duration", () => {
    // 200w with weekends counted is 1400 calendar days, inclusive of the
    // start: 2026-01-05 + 1399 days.
    const result = parseMermaidGantt(`
gantt
    dateFormat YYYY-MM-DD
    section P One
    Work :t1, 2026-01-05, 200w
`);
    expect(result.taskCount).toBe(1);
    expect(result.phases[0]?.tasks[0]?.plannedEnd).toBe("2029-11-04");
  });

  it("keeps a task written before any section, and says where it put it", () => {
    const result = parseMermaidGantt(`
gantt
    dateFormat YYYY-MM-DD
    Stray :t1, 2026-01-05, 3d
`);
    expect(result.phases[0].name).toBe("Unnamed section");
    expect(result.taskCount).toBe(1);
    expect(result.issues[0].severity).toBe("warning");
  });

  it("renames rather than merges two sections with the same code", () => {
    const result = parseMermaidGantt(`
gantt
    dateFormat YYYY-MM-DD
    section A1 First
    Work :t1, 2026-01-05, 3d
    section A1 Second
    More :t2, 2026-01-12, 3d
`);
    expect(result.phases.map((p) => p.code)).toEqual(["A1", "A1-2"]);
    expect(result.issues.some((i) => i.message.includes("renamed"))).toBe(true);
  });

  it("reports a line that is neither a directive, a section nor a task", () => {
    const result = parseMermaidGantt(`
gantt
    dateFormat YYYY-MM-DD
    section P One
    this line has no colon
`);
    expect(result.issues[0].severity).toBe("error");
    expect(result.issues[0].text).toBe("this line has no colon");
  });
});

describe("parseMermaidGantt — shapes a real chart uses", () => {
  it("reads a markdown fence around the chart", () => {
    const result = parseMermaidGantt(
      [
        "```mermaid",
        "gantt",
        "  dateFormat YYYY-MM-DD",
        "  section P One",
        "  Work :t1, 2026-01-05, 3d",
        "```",
      ].join("\n")
    );
    expect(result.taskCount).toBe(1);
  });

  it("ignores %% comments", () => {
    const result = parseMermaidGantt(`
gantt
    dateFormat YYYY-MM-DD
    section P One
    Work :t1, 2026-01-05, 3d %% a note
`);
    expect(result.taskCount).toBe(1);
    expect(result.issues).toEqual([]);
  });

  it("maps `done` and `active` onto the task status", () => {
    const result = parseMermaidGantt(`
gantt
    dateFormat YYYY-MM-DD
    section P One
    Finished :done, t1, 2026-01-05, 3d
    Running  :active, t2, 2026-01-12, 3d
    Later    :t3, 2026-01-19, 3d
`);
    expect(result.phases[0].tasks.map((t) => t.status)).toEqual([
      "done",
      "in_progress",
      "planned",
    ]);
  });

  it("takes a start and end with no id", () => {
    const result = parseMermaidGantt(`
gantt
    dateFormat YYYY-MM-DD
    section P One
    Work :2026-01-05, 2026-01-09
`);
    expect(result.taskCount).toBe(1);
    expect(result.phases[0].tasks[0].id).toBe("");
    expect(result.phases[0].tasks[0].plannedEnd).toBe("2026-01-09");
  });

  it("follows the previous task when only a duration is given", () => {
    const result = parseMermaidGantt(`
gantt
    dateFormat YYYY-MM-DD
    section P One
    First  :t1, 2026-01-05, 3d
    Second :4d
`);
    expect(result.phases[0].tasks[1].plannedStart).toBe("2026-01-08");
    expect(result.phases[0].tasks[1].plannedEnd).toBe("2026-01-11");
  });

  it("is deterministic — the same source parses to the same result", () => {
    expect(parseMermaidGantt(REFERENCE)).toEqual(parseMermaidGantt(REFERENCE));
  });
});
