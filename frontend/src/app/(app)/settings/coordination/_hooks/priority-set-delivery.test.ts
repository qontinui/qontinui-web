import { describe, expect, it } from "vitest";

import {
  type CompositionRuleRow,
  type PrioritySetRow,
  classifySetOrigin,
  computeDeliveryMap,
  computeSetDelivery,
  friendlyCoordError,
  orderingEntryName,
  orderingNames,
  slugifySetName,
  unwrapCompositionRules,
  unwrapPrioritySets,
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
    created_by: "operator@example.com",
    updated_by: "operator@example.com",
    ...overrides,
  };
}

describe("classifySetOrigin (badge honesty)", () => {
  it("classifies a true cross-tenant inherited row as system", () => {
    expect(classifySetOrigin(makeSet({ is_system: true }))).toBe("system");
  });

  it("system wins even when created_by is system", () => {
    expect(
      classifySetOrigin(makeSet({ is_system: true, created_by: "system" }))
    ).toBe("system");
  });

  it("classifies an own-tenant machine-seeded row as seeded", () => {
    // The operator-deployment case: seeded defaults are is_system=false but
    // created_by="system".
    expect(
      classifySetOrigin(makeSet({ is_system: false, created_by: "system" }))
    ).toBe("seeded");
  });

  it("classifies an operator-created own-tenant row as custom", () => {
    expect(
      classifySetOrigin(
        makeSet({ is_system: false, created_by: "jspinak@gmail.com" })
      )
    ).toBe("custom");
  });

  it("treats a missing/null created_by as custom (not seeded)", () => {
    expect(
      classifySetOrigin(makeSet({ is_system: false, created_by: null }))
    ).toBe("custom");
    expect(
      classifySetOrigin({ is_system: false } as PrioritySetRow)
    ).toBe("custom");
  });
});

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

describe("unwrapPrioritySets / unwrapCompositionRules", () => {
  it("unwraps the coord envelope (the real wire shape)", () => {
    const row = { priority_set_id: "x", set_name: "implementation" };
    expect(unwrapPrioritySets({ priority_sets: [row], total: 1 })).toEqual([row]);
    const rule = { composition_rule_id: "r", surface: "infra" };
    expect(unwrapCompositionRules({ composition_rules: [rule], total: 1 })).toEqual([rule]);
  });

  it("tolerates a bare array", () => {
    expect(unwrapPrioritySets([{ set_name: "a" }])).toEqual([{ set_name: "a" }]);
    expect(unwrapCompositionRules([{ surface: "infra" }])).toEqual([{ surface: "infra" }]);
  });

  it("never returns a non-array (the prod not-iterable crash guard)", () => {
    for (const bad of [null, undefined, 42, "x", {}, { priority_sets: "nope" }, { composition_rules: 7 }]) {
      expect(unwrapPrioritySets(bad)).toEqual([]);
      expect(unwrapCompositionRules(bad)).toEqual([]);
    }
  });
});
