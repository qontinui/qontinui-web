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

  it("does not move a weekend milestone", () => {
    // A milestone is a point, not a bar, so there is no duration to lay out
    // and mermaid draws it on the day it was given. It reaches the duration
    // branch only because it is spelled `:milestone, m1, <date>, 0d`.
    const result = parseMermaidGantt(`
gantt
    dateFormat YYYY-MM-DD
    excludes weekends
    section P One
    Go live :milestone, m1, 2026-01-03, 0d
`);
    const milestone = result.phases[0]?.tasks[0];
    expect(milestone?.plannedStart).toBe("2026-01-03");
    expect(milestone?.plannedEnd).toBe("2026-01-03");
    expect(result.issues).toEqual([]);
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

describe("parseMermaidGantt — a keyword is a directive only with a boundary", () => {
  // A bare `startsWith` ate any task whose TITLE began with a keyword, and
  // produced no issue — the one outcome this module promises never to have.
  it("does not read a task titled 'Sections…' as a section", () => {
    const result = parseMermaidGantt(`
gantt
    dateFormat YYYY-MM-DD
    section A0 Mobilisation
    Sections signed off :s1, 2026-01-05, 5d
`);
    expect(result.phases.map((p) => p.code)).toEqual(["A0"]);
    expect(result.phases[0]?.tasks[0]?.title).toBe("Sections signed off");
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("does not let a task titled 'Titles…' overwrite the chart title", () => {
    const result = parseMermaidGantt(`
gantt
    dateFormat YYYY-MM-DD
    title Delivery plan
    section A0 Mobilisation
    Titles and rates :t1, 2026-01-05, 5d
`);
    expect(result.title).toBe("Delivery plan");
    expect(result.taskCount).toBe(1);
  });

  it("reads a line that IS the keyword as the directive, and says so", () => {
    // "Excludes" is the keyword exactly, so mermaid's own lexer reads this
    // as the directive too. Following it is right; doing it in silence is
    // not, because a task has just vanished.
    const result = parseMermaidGantt(`
gantt
    dateFormat YYYY-MM-DD
    section A0 Mobilisation
    Excludes review :e1, 2026-01-05, 5d
`);
    expect(result.taskCount).toBe(0);
    // Two warnings, no error: the line was ambiguous, AND its value was not
    // a set of days this import understands. Nothing is silent.
    expect(result.issues.every((i) => i.severity === "warning")).toBe(true);
    expect(
      result.issues.some(
        (i) => i.line === 5 && i.message.includes("was meant to be a task")
      )
    ).toBe(true);
  });

  it("warns rather than silently swallowing a task on an IGNORED directive", () => {
    // These five directives are discarded outright, which made this the one
    // branch where a swallowed task left no trace at all. All five, and a
    // one-field task shape (`:5d`) as well as a three-field one, because
    // the single-field shape is one this parser reads elsewhere.
    for (const [line, keyword] of [
      ["Weekday cover :w1, 2026-01-05, 5d", "weekday"],
      ["Weekday catch-up :5d", "weekday"],
      ["Todaymarker review :x1, 2026-01-05, 5d", "todaymarker"],
      ["Axisformat rules :a1, 2026-01-05, 5d", "axisformat"],
      ["Tickinterval review :t1, after a1", "tickinterval"],
      ["Inclusiveenddates sign-off :i1, 2026-01-05, 2d", "inclusiveenddates"],
    ] as const) {
      const result = parseMermaidGantt(`
gantt
    dateFormat YYYY-MM-DD
    section A0 One
    ${line}
`);
      expect(result.taskCount, line).toBe(0);
      expect(result.issues, line).toHaveLength(1);
      expect(result.issues[0]?.severity, line).toBe("warning");
      expect(result.issues[0]?.message, line).toContain(keyword);
    }
  });

  it("does not warn about a KEPT directive whose value merely names dates", () => {
    // The warning is for a task that vanished, so firing it on a perfectly
    // good title told the reader to rename something that was already right.
    // These four keep their value, so a false positive is pure noise on the
    // screen whose job is to show what went wrong.
    for (const line of [
      "title Delivery plan: 2026-01-05",
      "title Delivery plan: 2026-01-05, 2026-03-31",
      "section A0: 2026-01-05",
      "section Sprint 1: 2026-01-05, 2026-03-31",
    ]) {
      const result = parseMermaidGantt(`
gantt
    dateFormat YYYY-MM-DD
    ${line}
    section P One
    Work :t1, 2026-01-05, 3d
`);
      expect(result.issues, line).toEqual([]);
      expect(result.taskCount, line).toBe(1);
    }
  });

  it("does not let a swallowed task pose as a declared date format", () => {
    // `dateFormatSeen` set from task meta suppressed the "no dateFormat
    // declared" warning the chart deserved, and raised an error quoting the
    // meta as if it were a format string.
    const result = parseMermaidGantt(`
gantt
    section A0 One
    Dateformat migration :d1, 2026-01-05, 5d
`);
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(
      result.issues.every((i) => !i.message.includes("YYYY-MM-DD can be read"))
    ).toBe(true);
  });

  it("accepts a warning on a discarded directive to avoid losing a task", () => {
    // `weekday monday: 2w` and the swallowed task `Weekday catch-up :5d`
    // are structurally identical — one keyword, one field, a duration — so
    // no rule separates them. The trade is made deliberately and in this
    // direction: these five directives are DISCARDED, so a spurious warning
    // costs a line of noise, while a missed one costs a task in silence.
    const result = parseMermaidGantt(`
gantt
    dateFormat YYYY-MM-DD
    weekday monday: 2w
    section P One
    Work :t1, 2026-01-05, 3d
`);
    expect(result.issues.map((i) => i.severity)).toEqual(["warning"]);
    expect(result.taskCount).toBe(1);
  });

  it("still ignores a discarded directive whose value is not task meta", () => {
    const result = parseMermaidGantt(`
gantt
    dateFormat YYYY-MM-DD
    axisFormat %H:%M
    todayMarker stroke-width:5px
    weekday monday
    inclusiveEndDates
    section P One
    Work :t1, 2026-01-05, 3d
`);
    expect(result.issues).toEqual([]);
    expect(result.taskCount).toBe(1);
  });

  it("keeps a chart title that contains a date", () => {
    // Deciding the line by "something after a colon looks like a date"
    // instead of by the keyword dropped the title and invented a phase.
    const result = parseMermaidGantt(`
gantt
    dateFormat YYYY-MM-DD
    title Delivery plan: 2026-01-05
    section A0 Mobilisation
    Work :t1, 2026-01-05, 5d
`);
    expect(result.title).toBe("Delivery plan: 2026-01-05");
    expect(result.phases.map((p) => p.code)).toEqual(["A0"]);
    expect(result.taskCount).toBe(1);
  });

  it("keeps a section whose name contains a date", () => {
    const result = parseMermaidGantt(`
gantt
    dateFormat YYYY-MM-DD
    section A0: 2026-01-05
    Work :t1, 2026-01-05, 5d
`);
    expect(result.phases).toHaveLength(1);
    expect(result.phases[0]?.tasks).toHaveLength(1);
    // The task belongs to the real section, not to an invented one.
    expect(result.phases[0]?.name).not.toBe("Unnamed section");
  });

  it("keeps an `excludes` and a `weekday` whose value contains a duration", () => {
    const result = parseMermaidGantt(`
gantt
    dateFormat YYYY-MM-DD
    excludes weekends
    weekday monday: 2w
    section P One
    Work :t1, 2026-01-05, 5d
`);
    expect(result.excludesWeekends).toBe(true);
    expect(result.phases.map((p) => p.code)).toEqual(["P"]);
    expect(result.taskCount).toBe(1);
  });

  it("still reads a section whose NAME contains a colon", () => {
    // The colon alone does not make a line a task — what follows it does.
    const result = parseMermaidGantt(`
gantt
    dateFormat YYYY-MM-DD
    section A0: Mobilisation
    Work :t1, 2026-01-05, 3d
`);
    expect(result.phases).toHaveLength(1);
    expect(result.phases[0]?.name).toContain("Mobilisation");
    expect(result.taskCount).toBe(1);
  });

  it("still ignores an axisFormat whose value contains a colon", () => {
    const result = parseMermaidGantt(`
gantt
    dateFormat YYYY-MM-DD
    axisFormat %H:%M
    todayMarker stroke-width:5px
    section P One
    Work :t1, 2026-01-05, 3d
`);
    expect(result.issues).toEqual([]);
    expect(result.taskCount).toBe(1);
  });

  it("still reads a directive followed by a tab", () => {
    const result = parseMermaidGantt(
      [
        "gantt",
        "\tdateFormat\tYYYY-MM-DD",
        "\tsection A0 One",
        "\tWork :t1, 2026-01-05, 3d",
      ].join("\n")
    );
    expect(result.issues).toEqual([]);
    expect(result.taskCount).toBe(1);
  });
});

describe("parseMermaidGantt — a date has to be a real day", () => {
  it("refuses an impossible month or day rather than rolling it over", () => {
    for (const bad of ["2026-13-45", "2026-02-30", "2026-00-10"]) {
      const result = parseMermaidGantt(`
gantt
    dateFormat YYYY-MM-DD
    section P One
    Work :t1, ${bad}, 3d
`);
      expect(result.taskCount, bad).toBe(0);
      expect(result.issues[0]?.message, bad).toContain("not a real date");
    }
  });

  it("reads a two-digit year as that year, not as 19xx", () => {
    const result = parseMermaidGantt(`
gantt
    dateFormat YYYY-MM-DD
    section P One
    Work :t1, 0099-01-01, 1d
`);
    expect(result.taskCount).toBe(1);
    expect(result.phases[0]?.tasks[0]?.plannedStart).toBe("0099-01-01");
  });

  it("refuses an impossible END date too", () => {
    const result = parseMermaidGantt(`
gantt
    dateFormat YYYY-MM-DD
    section P One
    Work :t1, 2026-01-05, 2026-02-31
`);
    expect(result.taskCount).toBe(0);
    expect(result.issues[0]?.message).toContain("not a real date");
  });
});

describe("parseMermaidGantt — a weekend start under `excludes weekends`", () => {
  it("moves the start to the first working day and says so", () => {
    // Sat 2026-01-03 + 5 working days is Mon 05 to Fri 09 — the bar mermaid
    // draws. Keeping the Saturday start would claim a 7-day bar.
    const result = parseMermaidGantt(`
gantt
    dateFormat YYYY-MM-DD
    excludes weekends
    section P One
    Kick-off :t1, 2026-01-03, 5d
`);
    expect(result.phases[0]?.tasks[0]?.plannedStart).toBe("2026-01-05");
    expect(result.phases[0]?.tasks[0]?.plannedEnd).toBe("2026-01-09");
    expect(result.issues[0]?.severity).toBe("warning");
    expect(result.issues[0]?.message).toContain("2026-01-05");
  });

  it("leaves a weekend start alone when the chart does not exclude weekends", () => {
    const result = parseMermaidGantt(`
gantt
    dateFormat YYYY-MM-DD
    section P One
    Kick-off :t1, 2026-01-03, 5d
`);
    expect(result.phases[0]?.tasks[0]?.plannedStart).toBe("2026-01-03");
    expect(result.issues).toEqual([]);
  });

  it("leaves an explicit end date on a weekend start alone", () => {
    // Only the DURATION path lays days out; an explicit end is what it says.
    const result = parseMermaidGantt(`
gantt
    dateFormat YYYY-MM-DD
    excludes weekends
    section P One
    Kick-off :t1, 2026-01-03, 2026-01-09
`);
    expect(result.phases[0]?.tasks[0]?.plannedStart).toBe("2026-01-03");
    expect(result.phases[0]?.tasks[0]?.plannedEnd).toBe("2026-01-09");
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
