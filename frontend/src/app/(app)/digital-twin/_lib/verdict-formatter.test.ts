import { describe, expect, it } from "vitest";

import { summarizeVerdict } from "./verdict-formatter";
import type { DriftVerdict } from "./types";

function deliveryVerdict(
  driftClass: string,
  components: Record<string, unknown>,
): DriftVerdict {
  return {
    instance: "delivery",
    drift_class: driftClass,
    coverage: 1,
    credibility: 0.9,
    staleness_seconds: 0,
    provenance: "join:live",
    components,
  };
}

describe("summarizeVerdict — delivery instance", () => {
  it("reports a fully-landed plan", () => {
    const v = deliveryVerdict("none", {
      status: "shipped",
      all_merged: true,
      prs: [
        { repo: "qontinui-runner", pr: 583, merged: true },
        { repo: "qontinui-schemas", pr: 83, merged: true },
      ],
      unmerged_prs: [],
    });
    const { prose } = summarizeVerdict("delivery", v);
    expect(prose).toContain("in sync");
    expect(prose).toContain("shipped");
    expect(prose).toContain("2 cited PRs");
    expect(prose).toContain("all merged");
  });

  it("flags a shipped plan with an unmerged cited PR", () => {
    const v = deliveryVerdict("active_negation", {
      status: "shipped",
      all_merged: false,
      prs: [{ repo: "qontinui-web", pr: 999, merged: false }],
      unmerged_prs: [{ repo: "qontinui-web", pr: 999, merged: false }],
    });
    const { prose } = summarizeVerdict("delivery", v);
    expect(prose).toContain("1 cited PR,");
    expect(prose).toContain("1 still unmerged");
  });

  it("handles a plan with no citations", () => {
    const v = deliveryVerdict("unknown", { status: "draft", prs: [] });
    const { prose } = summarizeVerdict("delivery", v);
    expect(prose).toContain("no cited PRs");
  });

  it("renders a work-unit anchor generically (no plan vocabulary)", () => {
    const v = deliveryVerdict("none", {
      anchor_kind: "work_unit",
      work_unit_id: "11111111-1111-1111-1111-111111111111",
      plan_id: null,
      status: "graduated",
      all_merged: true,
      prs: [{ repo: "qontinui-web", pr: 700, merged: true }],
      unmerged_prs: [],
    });
    const { prose } = summarizeVerdict("delivery", v);
    // Opaque status is surfaced under a generic "Unit status" label, never the
    // plan-specific "Plan status" wording.
    expect(prose).toContain("Unit status");
    expect(prose).toContain("graduated");
    expect(prose).not.toContain("Plan status");
    expect(prose).toContain("1 cited PR,");
    expect(prose).toContain("all merged");
  });

  // Coord plan `2026-08-18-closed-unmerged-citation-pins-shipped-forever`
  // retires a closed-never-merged citation from the delivery predicate and
  // widened `all_merged` to carry that predicate. A unit can therefore deliver
  // while a cited PR still reads `merged: false`.
  it("never says 'all merged' when a citation was retired unlanded", () => {
    const v = deliveryVerdict("none", {
      status: "shipped",
      all_merged: true, // the DELIVERY PREDICATE, not the literal
      prs: [
        { repo: "qontinui-coord", pr: 249, merged: true },
        {
          repo: "qontinui-claude-config",
          pr: 257,
          merged: false,
          terminal_unlanded: true,
        },
      ],
      unmerged_prs: [], // #257 does not block
      terminal_unlanded_count: 1,
    });
    const { prose } = summarizeVerdict("delivery", v);
    expect(prose).toContain("2 cited PRs");
    expect(prose).toContain("delivered");
    expect(prose).toContain("1 closed without landing");
    // The regression this test exists for: reporting a dead duplicate as merged.
    expect(prose).not.toContain("all merged");
  });

  it("says nothing landed when every citation closed unlanded", () => {
    const v = deliveryVerdict("active_negation", {
      status: "shipped",
      all_merged: false,
      prs: [
        { repo: "qontinui-web", pr: 11, merged: false, terminal_unlanded: true },
      ],
      unmerged_prs: [],
      terminal_unlanded_count: 1,
    });
    const { prose } = summarizeVerdict("delivery", v);
    expect(prose).toContain("none landed");
    // The old fallback understated this as an unremarkable "merge state mixed".
    expect(prose).not.toContain("merge state mixed");
  });

  it("counts the blocking bucket from coord's number when the list is absent", () => {
    // Coord serves each bucket as a count AND (when it fits) a list. Reading
    // only the list understated the blocking bucket to zero, which dropped the
    // "still unmerged" clause entirely and left the vaguest wording standing.
    const v = deliveryVerdict("active_negation", {
      status: "shipped",
      all_merged: false,
      prs: [
        { repo: "qontinui-web", pr: 1, merged: false },
        { repo: "qontinui-web", pr: 2, merged: false },
        { repo: "qontinui-coord", pr: 3, merged: false },
      ],
      blocking_unmerged_count: 2,
      terminal_unlanded_count: 1,
      landed_count: 0,
    });
    const { prose } = summarizeVerdict("delivery", v);
    expect(prose).toContain("2 still unmerged");
    expect(prose).toContain("1 closed without landing");
    expect(prose).not.toContain("merge state mixed");
  });

  it("never says 'none landed' when coord counted landed citations", () => {
    // The mirror of the "all merged" regression: `all_merged` is absent here
    // (an older or partial verdict), which is not evidence that nothing landed.
    // Asserting "none landed" over three landed citations is the same falsehood
    // pointing the other way.
    const v = deliveryVerdict("none", {
      status: "shipped",
      prs: [
        { repo: "qontinui-web", pr: 1, merged: true },
        { repo: "qontinui-web", pr: 2, merged: true },
        { repo: "qontinui-coord", pr: 3, merged: true },
        {
          repo: "qontinui-runner",
          pr: 4,
          merged: false,
          terminal_unlanded: true,
        },
      ],
      landed_count: 3,
      blocking_unmerged_count: 0,
      terminal_unlanded_count: 1,
    });
    const { prose } = summarizeVerdict("delivery", v);
    expect(prose).not.toContain("none landed");
    expect(prose).toContain("3 landed");
    expect(prose).toContain("1 closed without landing");
    // Nor may it claim the predicate coord did not assert.
    expect(prose).not.toContain("all merged");
    expect(prose).not.toContain("delivered");
  });

  it("falls back to plan wording when no anchor_kind is present", () => {
    const v = deliveryVerdict("none", {
      status: "shipped",
      all_merged: true,
      prs: [{ repo: "qontinui-web", pr: 1, merged: true }],
      unmerged_prs: [],
    });
    const { prose } = summarizeVerdict("delivery", v);
    expect(prose).toContain("Plan status");
  });
});
