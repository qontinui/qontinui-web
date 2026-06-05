import { describe, expect, it } from "vitest";

import {
  type CompositionRuleRow,
  type PrioritySetRow,
  computeDeliveryMap,
  computeSetDelivery,
  friendlyCoordError,
  orderingEntryName,
  orderingNames,
  slugifySetName,
} from "./priority-set-delivery";

function makeRule(
  overrides: Partial<CompositionRuleRow> = {}
): CompositionRuleRow {
  return {
    composition_rule_id: "rule-1",
    decision_domain: "next_step",
    surface: "user_facing",
    activity: null,
    layers: [],
    tenant_id: "t-1",
    priority: 0,
    enabled: true,
    is_system: false,
    ...overrides,
  };
}

function makeSet(overrides: Partial<PrioritySetRow> = {}): PrioritySetRow {
  return {
    priority_set_id: "ps-1",
    set_name: "infra_first",
    repo: null,
    ordering: [],
    non_factors: [],
    version: 1,
    enabled: true,
    is_system: false,
    ...overrides,
  };
}

describe("orderingEntryName / orderingNames", () => {
  it("returns bare strings unchanged", () => {
    expect(orderingEntryName("throughput")).toBe("throughput");
  });

  it("normalizes weighted objects to their name", () => {
    expect(orderingEntryName({ name: "risk", weight: 2, min_bar: 1 })).toBe(
      "risk"
    );
  });

  it("normalizes a mixed array", () => {
    expect(
      orderingNames(["throughput", { name: "risk", weight: 3 }, "autonomy"])
    ).toEqual(["throughput", "risk", "autonomy"]);
  });
});

describe("computeSetDelivery (honesty gate)", () => {
  it("flags a set carried by no rule as undelivered", () => {
    const rules = [makeRule({ layers: [{ set: "other", role: "lead" }] })];
    const d = computeSetDelivery("infra_first", rules);
    expect(d.delivered).toBe(false);
    expect(d.surfaces).toEqual([]);
  });

  it("reports the surface of an enabled rule that names the set", () => {
    const rules = [
      makeRule({
        surface: "infra",
        layers: [{ set: "infra_first", role: "lead" }],
      }),
    ];
    const d = computeSetDelivery("infra_first", rules);
    expect(d.delivered).toBe(true);
    expect(d.surfaces).toEqual(["infra"]);
  });

  it("ignores disabled rules even if they name the set", () => {
    const rules = [
      makeRule({
        enabled: false,
        surface: "infra",
        layers: [{ set: "infra_first", role: "lead" }],
      }),
    ];
    const d = computeSetDelivery("infra_first", rules);
    expect(d.delivered).toBe(false);
    expect(d.surfaces).toEqual([]);
  });

  it("collects + de-dupes + sorts distinct surfaces", () => {
    const rules = [
      makeRule({
        composition_rule_id: "r1",
        surface: "user_facing",
        layers: [{ set: "infra_first", role: "filter" }],
      }),
      makeRule({
        composition_rule_id: "r2",
        surface: "infra",
        layers: [{ set: "infra_first", role: "lead" }],
      }),
      makeRule({
        composition_rule_id: "r3",
        surface: "infra",
        layers: [{ set: "infra_first", role: "tiebreaker" }],
      }),
    ];
    const d = computeSetDelivery("infra_first", rules);
    expect(d.delivered).toBe(true);
    expect(d.surfaces).toEqual(["infra", "user_facing"]);
  });

  it("matches any layer role", () => {
    for (const role of ["filter", "lead", "tiebreaker"] as const) {
      const rules = [makeRule({ layers: [{ set: "s", role }] })];
      expect(computeSetDelivery("s", rules).delivered).toBe(true);
    }
  });
});

describe("computeDeliveryMap", () => {
  it("builds a per-set delivery map", () => {
    const sets = [
      makeSet({ set_name: "carried" }),
      makeSet({ priority_set_id: "ps-2", set_name: "orphan" }),
    ];
    const rules = [
      makeRule({ surface: "infra", layers: [{ set: "carried", role: "lead" }] }),
    ];
    const map = computeDeliveryMap(sets, rules);
    expect(map.carried.delivered).toBe(true);
    expect(map.carried.surfaces).toEqual(["infra"]);
    expect(map.orphan.delivered).toBe(false);
  });
});

describe("friendlyCoordError", () => {
  it("maps duplicate_set_name", () => {
    const e = new Error(
      'POST /x failed: 409 - {"error":"duplicate_set_name"}'
    );
    expect(friendlyCoordError(e)).toMatch(/already exists/i);
  });

  it("maps admin_required", () => {
    const e = new Error('POST /x failed: 403 - {"error":"admin_required"}');
    expect(friendlyCoordError(e)).toMatch(/admin/i);
  });

  it("maps system_row_immutable", () => {
    const e = new Error(
      'PATCH /x failed: 409 - {"error":"system_row_immutable"}'
    );
    expect(friendlyCoordError(e)).toMatch(/system default/i);
  });

  it("maps a bare 403 status", () => {
    const e = new Error("DELETE /x failed: 403 - Forbidden");
    expect(friendlyCoordError(e)).toMatch(/admin/i);
  });

  it("falls back to the raw message", () => {
    const e = new Error("GET /x failed: 500 - boom");
    expect(friendlyCoordError(e)).toContain("boom");
  });
});

describe("slugifySetName", () => {
  it("lowercases and underscores", () => {
    expect(slugifySetName("Infra First")).toBe("infra_first");
  });
  it("trims edge separators and collapses runs", () => {
    expect(slugifySetName("  Risk -- Retirement!! ")).toBe("risk_retirement");
  });
  it("returns empty for non-alnum input", () => {
    expect(slugifySetName("  ---  ")).toBe("");
  });
});
