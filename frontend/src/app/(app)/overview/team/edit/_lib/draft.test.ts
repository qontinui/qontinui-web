import { describe, expect, it } from "vitest";
import {
  applyGanttImport,
  draftFromEstimate,
  draftProblems,
  draftToContent,
} from "./draft";
import type { EstimateDetail } from "../../../_lib/estimate-api";

/**
 * A loaded estimate carrying a value in EVERY field the content endpoint
 * owns — including the ones the Team editor never shows, which the Timeline
 * page (Phase 3) writes and which one Save from here would otherwise reset.
 */
const LOADED: EstimateDetail = {
  estimate: {
    id: "e1",
    name: "Estimate v0.1",
    purpose: "budget",
    status: "approved",
    is_baseline: true,
    source_page_id: null,
    accuracy_note: "±25%",
    contingency_pct: "10",
    notes: "notes",
    version: 7,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    created_by: null,
    updated_by: null,
  },
  roles: [
    {
      id: "r1",
      code: "BE",
      name: "Backend",
      responsibility: "Builds it",
      day_rate_micros: 750_000_000,
      currency: "EUR",
      client_side: false,
      sort_order: 0,
    },
  ],
  phases: [
    {
      id: "p1",
      code: "A0",
      name: "Mobilisation",
      sort_order: 0,
      planned_start: "2026-01-05",
      planned_end: "2026-01-30",
      stated_working_weeks: "3.60",
      gate_criteria: "Environments reachable",
      actual_start: "2026-01-06",
      actual_end: "2026-02-02",
      gate_status: "passed",
      gate_decided_at: "2026-02-03",
      gate_notes: "Demonstrated to the sponsor",
      tasks: [
        {
          id: "t1",
          number: "1.1",
          title: "Kick-off",
          requirement_refs: "R1, R2",
          planned_start: "2026-01-05",
          planned_end: "2026-01-09",
          is_critical: true,
          status: "done",
          sort_order: 0,
          efforts: [
            { role_id: "r1", role_code: "BE", planned_person_days: "4.00" },
          ],
        },
      ],
    },
  ],
  allocations: [
    {
      phase_id: "p1",
      phase_code: "A0",
      role_id: "r1",
      role_code: "BE",
      fte: "0.500",
    },
  ],
  price_tiers: [
    {
      id: "pt1",
      name: "Midpoint",
      multiplier: "1.0",
      is_primary: true,
      sort_order: 0,
    },
  ],
  cost_lines: [
    {
      id: "c1",
      kind: "build_non_labour",
      label: "Licences",
      basis: "12 seats",
      low_micros: 1_000_000_000,
      high_micros: 2_000_000_000,
      currency: "EUR",
      phase_id: "p1",
      phase_code: "A0",
      run_model: null,
      sort_order: 0,
    },
  ],
  calendar_breaks: [
    {
      id: "b1",
      label: "Easter",
      start_date: "2026-04-03",
      end_date: "2026-04-06",
    },
  ],
};

describe("the editor's draft round-trip", () => {
  it("returns every phase and task field it was given", () => {
    const content = draftToContent(draftFromEstimate(LOADED));
    const phase = content.phases[0]!;
    // The four the Team editor never shows, which the Timeline page writes.
    expect(phase.gate_status).toBe("passed");
    expect(phase.gate_decided_at).toBe("2026-02-03");
    expect(phase.gate_notes).toBe("Demonstrated to the sponsor");
    expect(phase.actual_start).toBe("2026-01-06");
    expect(phase.actual_end).toBe("2026-02-02");
    // The number the source plan stated, kept beside the derived one.
    expect(phase.stated_working_weeks).toBe("3.60");
    // And the task's own unshown field.
    expect(phase.tasks?.[0]?.requirement_refs).toBe("R1, R2");
  });

  it("carries cost lines and calendar breaks it does not edit", () => {
    const content = draftToContent(draftFromEstimate(LOADED));
    expect(content.cost_lines).toHaveLength(1);
    expect(content.cost_lines[0]?.phase_code).toBe("A0");
    expect(content.calendar_breaks).toHaveLength(1);
  });

  it("carries the efforts and the allocation matrix separately", () => {
    const content = draftToContent(draftFromEstimate(LOADED));
    expect(content.phases[0]?.tasks?.[0]?.efforts).toEqual([
      { role_code: "BE", planned_person_days: "4.00" },
    ]);
    expect(content.allocations).toEqual([
      { phase_code: "A0", role_code: "BE", fte: "0.500" },
    ]);
  });

  it("sends the version it loaded, so a peer's save is refused not overwritten", () => {
    expect(draftToContent(draftFromEstimate(LOADED)).expected_version).toBe(7);
  });

  it("detaches — and warns about — a cost line whose phase the import removed", () => {
    const draft = draftFromEstimate(LOADED);
    draft.phases = [];
    draft.allocations = [];
    draft.efforts = [];
    const problems = draftProblems(draft);
    expect(problems.map((p) => p.severity)).toEqual(["warning"]);
    expect(problems[0]?.message).toContain("Licences");
    // The cost survives; only its phase link goes.
    const content = draftToContent(draft);
    expect(content.cost_lines[0]?.phase_code).toBeNull();
    expect(content.cost_lines[0]?.low_micros).toBe(1_000_000_000);
  });
});

describe("draftProblems", () => {
  it("blocks a save whose effort names a role that is not in the estimate", () => {
    const draft = draftFromEstimate(LOADED);
    draft.efforts = [
      {
        phase_code: "A0",
        task_number: "1.1",
        role_code: "GONE",
        planned_person_days: "3",
      },
    ];
    const errors = draftProblems(draft).filter((p) => p.severity === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("GONE");
  });

  it("blocks a save whose allocation names a phase that is not in the estimate", () => {
    const draft = draftFromEstimate(LOADED);
    draft.allocations = [{ phase_code: "ZZ", role_code: "BE", fte: "1" }];
    const errors = draftProblems(draft).filter((p) => p.severity === "error");
    expect(errors[0]?.message).toContain("ZZ");
  });

  it("blocks a save whose days name a task the estimate does not have", () => {
    const draft = draftFromEstimate(LOADED);
    draft.efforts = [
      {
        phase_code: "A0",
        task_number: "9.9",
        role_code: "BE",
        planned_person_days: "3",
      },
    ];
    const errors = draftProblems(draft).filter((p) => p.severity === "error");
    expect(errors[0]?.message).toContain("9.9");
  });

  it("reports one problem for twenty rows with the same cause", () => {
    const draft = draftFromEstimate(LOADED);
    draft.allocations = Array.from({ length: 20 }, () => ({
      phase_code: "ZZ",
      role_code: "BE",
      fte: "1",
    }));
    expect(
      draftProblems(draft).filter((p) => p.severity === "error")
    ).toHaveLength(1);
  });

  it("reports two effort rows landing on one task and role", () => {
    // Reachable when a re-import removes a task: its rows keep a number
    // that now belongs to a different task. Same role, the backend 422s on
    // a task the editor never named; different roles, the days are silently
    // added to whatever took the number. The key still EXISTS either way,
    // which is why the dangling-key check could not see it.
    const draft = draftFromEstimate(LOADED);
    draft.efforts = [
      {
        phase_code: "A0",
        task_number: "1.1",
        role_code: "BE",
        planned_person_days: "2",
      },
      {
        phase_code: "A0",
        task_number: "1.1",
        role_code: "BE",
        planned_person_days: "5",
      },
    ];
    const errors = draftProblems(draft).filter((p) => p.severity === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("two entries for BE");
  });

  it("does not report two roles on the same task", () => {
    const draft = draftFromEstimate(LOADED);
    draft.efforts = [
      {
        phase_code: "A0",
        task_number: "1.1",
        role_code: "BE",
        planned_person_days: "2",
      },
      {
        phase_code: "A0",
        task_number: "1.1",
        role_code: "DL",
        planned_person_days: "5",
      },
    ];
    // DL is not a role of this estimate, so that error is expected; the
    // duplicate one is not.
    expect(
      draftProblems(draft).some((p) => p.message.includes("two entries"))
    ).toBe(false);
  });

  it("requires exactly one primary price when tiers are given", () => {
    const draft = draftFromEstimate(LOADED);
    draft.priceTiers = [
      { name: "Low", multiplier: "0.9", is_primary: true },
      { name: "High", multiplier: "1.2", is_primary: true },
    ];
    expect(
      draftProblems(draft).some((p) => p.message.includes("primary"))
    ).toBe(true);
  });

  it("finds nothing wrong with the estimate as loaded", () => {
    expect(draftProblems(draftFromEstimate(LOADED))).toEqual([]);
  });
});

describe("applyGanttImport", () => {
  /** What `ganttToPhases` hands over: the schedule and nothing else. */
  const IMPORTED = [
    {
      code: "A0",
      name: "Mobilisation (revised)",
      planned_start: "2026-01-12",
      planned_end: "2026-02-06",
      tasks: [
        {
          number: "1.1",
          title: "Kick-off",
          planned_start: "2026-01-12",
          planned_end: "2026-01-16",
          is_critical: false,
          status: "planned" as const,
        },
        {
          number: "1.2",
          title: "Environments",
          planned_start: "2026-01-19",
          planned_end: "2026-02-06",
          is_critical: true,
          status: "planned" as const,
        },
      ],
    },
  ];

  it("takes the schedule from the chart", () => {
    const after = applyGanttImport(draftFromEstimate(LOADED), IMPORTED);
    const phase = after.phases[0]!;
    expect(phase.name).toBe("Mobilisation (revised)");
    expect(phase.planned_start).toBe("2026-01-12");
    expect(phase.planned_end).toBe("2026-02-06");
    expect(phase.tasks).toHaveLength(2);
    expect(phase.tasks[1]?.is_critical).toBe(true);
  });

  it("keeps everything a chart cannot express, matched by code", () => {
    const after = applyGanttImport(draftFromEstimate(LOADED), IMPORTED);
    const phase = after.phases[0]!;
    expect(phase.gate_status).toBe("passed");
    expect(phase.gate_criteria).toBe("Environments reachable");
    expect(phase.gate_decided_at).toBe("2026-02-03");
    expect(phase.gate_notes).toBe("Demonstrated to the sponsor");
    expect(phase.actual_start).toBe("2026-01-06");
    expect(phase.actual_end).toBe("2026-02-02");
    expect(phase.stated_working_weeks).toBe("3.60");
  });

  it("keeps a task's requirement refs, matched by task number", () => {
    // One level down from the phase, and the only loss path left after the
    // draft round-trip was fixed.
    const after = applyGanttImport(draftFromEstimate(LOADED), IMPORTED);
    expect(after.phases[0]?.tasks[0]?.requirement_refs).toBe("R1, R2");
    // A task the chart adds has none, rather than inheriting a neighbour's.
    expect(after.phases[0]?.tasks[1]?.requirement_refs).toBeNull();
  });

  it("keeps refs on the right task when a task is inserted above it", () => {
    // Task numbers encode POSITION in the chart, so inserting one renumbers
    // everything below. Matching on number handed `Kick-off`'s refs to the
    // new task and left `Kick-off` with none — a wrong requirement
    // reference, which reads as an authored one.
    const withInsertion = [
      {
        ...IMPORTED[0]!,
        tasks: [
          {
            number: "1.1",
            title: "Discovery",
            planned_start: "2026-01-05",
            planned_end: "2026-01-09",
            is_critical: false,
            status: "planned" as const,
          },
          { ...IMPORTED[0]!.tasks[0]!, number: "1.2" },
        ],
      },
    ];
    const after = applyGanttImport(draftFromEstimate(LOADED), withInsertion);
    const tasks = after.phases[0]!.tasks;
    expect(tasks.map((t) => t.title)).toEqual(["Discovery", "Kick-off"]);
    expect(tasks[0]?.requirement_refs).toBeNull();
    expect(tasks[1]?.requirement_refs).toBe("R1, R2");
  });

  it("keeps refs when a section is inserted above the phase", () => {
    // The phase is still found by code, but every task number below the
    // insertion point has shifted by a whole phase.
    const renumbered = [
      {
        ...IMPORTED[0]!,
        tasks: IMPORTED[0]!.tasks.map((t, i) => ({
          ...t,
          number: `2.${i + 1}`,
        })),
      },
    ];
    const after = applyGanttImport(draftFromEstimate(LOADED), renumbered);
    expect(after.phases[0]?.tasks[0]?.requirement_refs).toBe("R1, R2");
  });

  it("moves the EFFORT rows with the task, not with the number", () => {
    // The bigger half of the same defect: effort rows are keyed by the task
    // number, which moves on every insertion, so the days authored against
    // "Kick-off" silently became the inserted task's days. No error, no
    // warning, no visible change — the key still existed.
    const withInsertion = [
      {
        ...IMPORTED[0]!,
        tasks: [
          {
            number: "1.1",
            title: "Discovery",
            planned_start: "2026-01-05",
            planned_end: "2026-01-09",
            is_critical: false,
            status: "planned" as const,
          },
          { ...IMPORTED[0]!.tasks[0]!, number: "1.2" },
        ],
      },
    ];
    const after = applyGanttImport(draftFromEstimate(LOADED), withInsertion);
    // The 4 days belonged to Kick-off, which is now task 1.2.
    expect(after.efforts).toEqual([
      {
        phase_code: "A0",
        task_number: "1.2",
        role_code: "BE",
        planned_person_days: "4.00",
      },
    ]);
    // And the whole graph still validates, which is what makes the remap
    // load-bearing rather than cosmetic.
    expect(draftProblems(after).filter((p) => p.severity === "error")).toEqual(
      []
    );
  });

  it("leaves a dropped phase's rows to be REPORTED, not silently deleted", () => {
    // Deleting them would be the same silent loss one table over, and the
    // import cannot know the reader meant it. They dangle, and the pre-save
    // check names both tables so the save is blocked until they agree.
    const after = applyGanttImport(draftFromEstimate(LOADED), []);
    expect(after.efforts).toHaveLength(1);
    const errors = draftProblems(after).filter((p) => p.severity === "error");
    expect(errors.some((p) => p.message.includes("allocation table"))).toBe(
      true
    );
    expect(errors.some((p) => p.message.includes("days table"))).toBe(true);
  });

  it("pairs duplicate titles in order instead of all onto the first", () => {
    const twoReviews = {
      ...LOADED,
      phases: [
        {
          ...LOADED.phases[0]!,
          tasks: [
            {
              ...LOADED.phases[0]!.tasks[0]!,
              number: "1.1",
              title: "Review",
              requirement_refs: "R1",
            },
            {
              ...LOADED.phases[0]!.tasks[0]!,
              number: "1.2",
              title: "Review",
              requirement_refs: "R2",
              efforts: [],
            },
            {
              ...LOADED.phases[0]!.tasks[0]!,
              number: "1.3",
              title: "Build",
              requirement_refs: "R3",
              efforts: [],
            },
          ],
        },
      ],
    };
    const reimported = [
      {
        ...IMPORTED[0]!,
        tasks: ["Review", "Review", "Build"].map((title, i) => ({
          number: `1.${i + 1}`,
          title,
          planned_start: "2026-01-05",
          planned_end: "2026-01-09",
          is_critical: false,
          status: "planned" as const,
        })),
      },
    ];
    const after = applyGanttImport(draftFromEstimate(twoReviews), reimported);
    expect(after.phases[0]?.tasks.map((t) => t.requirement_refs)).toEqual([
      "R1",
      "R2",
      "R3",
    ]);
  });

  it("keeps a renamed task's refs when nothing else moved", () => {
    // A pure rename: same task count, so position still means something and
    // the second pass carries the refs a title match cannot.
    const renamed = [
      {
        ...IMPORTED[0]!,
        tasks: [{ ...IMPORTED[0]!.tasks[0]!, title: "Kick-off and access" }],
      },
    ];
    const after = applyGanttImport(draftFromEstimate(LOADED), renamed);
    expect(after.phases[0]?.tasks[0]?.title).toBe("Kick-off and access");
    expect(after.phases[0]?.tasks[0]?.requirement_refs).toBe("R1, R2");
  });

  it("would rather LOSE a ref than attribute it to the wrong task", () => {
    // An insertion and a rename in one import. `index` is the imported
    // index against the raw saved index, so an unconstrained positional
    // fallback is wrong by exactly the shift the title anchors prove
    // happened — and it handed the brand-new task the renamed one's refs
    // AND its person-days, which reads as authored data.
    //
    // With the lists at different lengths the fallback declines: the
    // renamed task loses its ref, which is visible and re-enterable, and
    // NOTHING wears a ref that was never its own.
    const savedThree = {
      ...LOADED,
      phases: [
        {
          ...LOADED.phases[0]!,
          tasks: ["A", "B", "C"].map((title, i) => ({
            ...LOADED.phases[0]!.tasks[0]!,
            number: `1.${i + 1}`,
            title,
            requirement_refs: `R${title}`,
            efforts: [],
          })),
        },
      ],
    };
    const reimported = [
      {
        ...IMPORTED[0]!,
        tasks: ["A", "X", "B2", "C"].map((title, i) => ({
          number: `1.${i + 1}`,
          title,
          planned_start: "2026-01-05",
          planned_end: "2026-01-09",
          is_critical: false,
          status: "planned" as const,
        })),
      },
    ];
    const after = applyGanttImport(draftFromEstimate(savedThree), reimported);
    expect(after.phases[0]?.tasks.map((t) => t.requirement_refs)).toEqual([
      "RA", // matched by title
      null, // brand new — and NOT wearing B's ref
      null, // renamed — lost, not stolen from
      "RC", // matched by title
    ]);
  });

  it("gives a phase the chart introduces an empty gate, not a borrowed one", () => {
    const after = applyGanttImport(draftFromEstimate(LOADED), [
      { ...IMPORTED[0]!, code: "B9", name: "New phase" },
    ]);
    expect(after.phases[0]?.gate_status).toBe("pending");
    expect(after.phases[0]?.gate_notes).toBe("");
    expect(after.phases[0]?.tasks[0]?.requirement_refs).toBeNull();
  });

  it("drops a phase the chart does not mention", () => {
    const after = applyGanttImport(draftFromEstimate(LOADED), []);
    expect(after.phases).toEqual([]);
    // And leaves everything that is not the schedule alone.
    expect(after.roles).toHaveLength(1);
    expect(after.costLines).toHaveLength(1);
    expect(after.version).toBe(7);
  });

  it("survives the round trip to the wire shape", () => {
    const content = draftToContent(
      applyGanttImport(draftFromEstimate(LOADED), IMPORTED)
    );
    const phase = content.phases[0]!;
    expect(phase.gate_status).toBe("passed");
    expect(phase.tasks?.[0]?.requirement_refs).toBe("R1, R2");
  });
});
