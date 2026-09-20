import { describe, expect, it } from "vitest";
import { draftFromEstimate, draftProblems, draftToContent } from "./draft";
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
