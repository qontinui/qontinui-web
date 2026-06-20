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
