import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Milestone, PhaseProgress } from "../../../_lib/timeline-api";

/**
 * What a Save drops, and what that costs: the drop set mirrors the server's
 * matching rule (`match_phases`: by id, then by code among the unclaimed —
 * never by name); a dropped phase is "at risk" when it has recorded progress
 * or tied milestones, read fresh; a read that fails is `unknown`, never
 * `clear`.
 */

const mocks = vi.hoisted(() => ({ listResource: vi.fn() }));
vi.mock("@/components/overview/editing/api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listResource: mocks.listResource,
}));

import {
  assessDrops,
  checkDroppedPhases,
  droppedPhases,
  recordedProgress,
  type SavedPhase,
} from "./dropped";

const SAVED: SavedPhase[] = [
  { id: "p0", code: "A0", name: "Mobilisation" },
  { id: "p1", code: "A1", name: "Discovery" },
  { id: "p2", code: "A2", name: "Build" },
];

function progress(
  id: string,
  code: string,
  recorded: Partial<PhaseProgress> = {}
): PhaseProgress {
  return {
    id,
    estimate_id: "e1",
    code,
    name: `Phase ${code}`,
    sort_order: 0,
    planned_start: null,
    planned_end: null,
    gate_criteria: "",
    actual_start: null,
    actual_end: null,
    gate_status: "pending",
    gate_decided_at: null,
    gate_notes: "",
    version: 1,
    updated_at: null,
    updated_by: null,
    ...recorded,
  };
}

function milestone(id: string, phaseId: string | null): Milestone {
  return {
    id,
    title: `Milestone ${id}`,
    description: "",
    kind: "milestone",
    phase_id: phaseId,
    phase_code: null,
    target_date: "2026-03-02",
    completed_date: null,
    status: "planned",
    version: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    created_by: null,
    updated_by: null,
  };
}

const list = <T>(items: T[], degraded: string | null = null) => ({
  items,
  total: items.length,
  can_edit: true,
  degraded,
});

describe("droppedPhases", () => {
  it("drops nothing when every saved phase is continued by id or code", () => {
    expect(
      droppedPhases(SAVED, [
        { id: "p0", code: "A0" },
        { code: "A1" },
        { id: "p2", code: "A2" },
      ])
    ).toEqual([]);
  });

  it("keeps a phase renamed by its id", () => {
    expect(
      droppedPhases(SAVED, [
        { id: "p0", code: "A0" },
        { id: "p1", code: "D1" },
        { id: "p2", code: "A2" },
      ])
    ).toEqual([]);
  });

  it("drops a phase whose code a re-import renamed (no id), never matching by name", () => {
    expect(
      droppedPhases(SAVED, [{ code: "A0" }, { code: "D1" }, { code: "A2" }])
    ).toEqual([SAVED[1]]);
  });

  it("does not let a code claim a phase an id already claimed", () => {
    // p0 continues under X0 by its id, so the id-less A0 cannot also claim
    // it by code: A0 is a new phase, and p1 and p2 are continued by nothing.
    expect(
      droppedPhases(SAVED, [{ id: "p0", code: "X0" }, { code: "A0" }])
    ).toEqual([SAVED[1], SAVED[2]]);
  });

  it("matches a phase that names an id by that id only, never also by its code", () => {
    // p0 renamed to A1: it does NOT continue p1 as well, which is dropped —
    // as the server drops it.
    expect(
      droppedPhases(SAVED, [{ id: "p0", code: "A1" }, { code: "A2" }])
    ).toEqual([SAVED[1]]);
  });

  it("drops a phase left out altogether", () => {
    expect(droppedPhases(SAVED, [{ id: "p0", code: "A0" }])).toEqual([
      SAVED[1],
      SAVED[2],
    ]);
  });
});

describe("recordedProgress", () => {
  it("is empty for a phase nothing has been recorded against", () => {
    expect(recordedProgress(progress("p1", "A1"))).toEqual([]);
  });

  it("names the gate's outcome, its notes and the actual dates", () => {
    expect(
      recordedProgress(
        progress("p1", "A1", {
          gate_status: "passed",
          gate_decided_at: "2026-02-27",
          gate_notes: "Signed off",
          actual_start: "2026-02-02",
          actual_end: "2026-02-27",
        })
      )
    ).toEqual([
      "gate outcome (Passed)",
      "gate notes",
      "actual start and end dates",
    ]);
    expect(
      recordedProgress(progress("p1", "A1", { actual_start: "2026-02-02" }))
    ).toEqual(["actual start date"]);
  });
});

describe("assessDrops", () => {
  it("reports only the dropped phases that would lose something", () => {
    const losses = assessDrops(
      [SAVED[1]!, SAVED[2]!],
      [
        progress("p1", "A1", { actual_start: "2026-02-02" }),
        progress("p2", "A2"),
      ],
      [milestone("m1", "p2"), milestone("m2", "p2"), milestone("m3", "p0")]
    );
    expect(losses).toEqual([
      { phase: SAVED[1], progress: ["actual start date"], milestones: 0 },
      { phase: SAVED[2], progress: [], milestones: 2 },
    ]);
  });

  it("finds an id-less phase (an older working copy) by its code", () => {
    const losses = assessDrops(
      [{ id: null, code: "A1", name: "Discovery" }],
      [progress("p1", "A1", { gate_notes: "x" })],
      [milestone("m1", "p1")]
    );
    expect(losses[0]?.progress).toEqual(["gate notes"]);
    expect(losses[0]?.milestones).toBe(1);
  });
});

describe("checkDroppedPhases", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the estimate's progress, then the dropped phases' milestones", async () => {
    mocks.listResource
      .mockResolvedValueOnce(
        list([progress("p1", "A1", { gate_status: "failed" })])
      )
      .mockResolvedValueOnce(list([milestone("m1", "p1")]));
    const check = await checkDroppedPhases("e1", [SAVED[1]!]);
    expect(mocks.listResource.mock.calls).toEqual([
      ["phase-progress", { estimate_id: "e1" }],
      ["milestones", { phase_id: ["p1"] }],
    ]);
    expect(check).toEqual({
      kind: "at_risk",
      losses: [
        { phase: SAVED[1], progress: ["gate outcome (Failed)"], milestones: 1 },
      ],
    });
  });

  it("is clear when nothing dropped holds anything", async () => {
    mocks.listResource
      .mockResolvedValueOnce(list([progress("p1", "A1")]))
      .mockResolvedValueOnce(list([]));
    expect(await checkDroppedPhases("e1", [SAVED[1]!])).toEqual({
      kind: "clear",
    });
  });

  it("reads nothing when nothing is dropped", async () => {
    expect(await checkDroppedPhases("e1", [])).toEqual({ kind: "clear" });
    expect(mocks.listResource).not.toHaveBeenCalled();
  });

  it("is unknown — never clear — when a read fails or is degraded", async () => {
    mocks.listResource.mockRejectedValueOnce(new Error("503 from the server"));
    const failed = await checkDroppedPhases("e1", [SAVED[1]!]);
    expect(failed.kind).toBe("unknown");
    expect(failed.kind === "unknown" && failed.reason).toMatch(/503/);

    mocks.listResource
      .mockResolvedValueOnce(list([progress("p1", "A1")]))
      .mockRejectedValueOnce(new Error("timed out"));
    const milestones = await checkDroppedPhases("e1", [SAVED[1]!]);
    expect(milestones.kind === "unknown" && milestones.reason).toMatch(
      /milestones could not be read: timed out/
    );

    mocks.listResource.mockResolvedValueOnce(list([], "store not ready"));
    const degraded = await checkDroppedPhases("e1", [SAVED[1]!]);
    expect(degraded).toEqual({
      kind: "unknown",
      dropped: [SAVED[1]],
      reason: "store not ready",
    });
  });
});
