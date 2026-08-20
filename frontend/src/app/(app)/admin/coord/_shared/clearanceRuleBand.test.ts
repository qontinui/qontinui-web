/**
 * Band derivation for a gate's deciding `gate_clearance` rule.
 *
 * The load-bearing property is that no path may pick the likelier band. The two
 * negative arms are deliberately DIFFERENT: a loaded set that lacks the id is
 * an explicit `"unknown"` (the rule is gone), while an unloaded set is `null`
 * (nothing to say). Each assertion compares the derived band to the rule set it
 * was derived FROM, so the two cannot drift.
 */

import { describe, expect, it } from "vitest";
import type { CoordPolicyRow } from "./coordPolicies";
import { clearanceBandIndex, lookupClearanceBand } from "./clearanceRuleBand";

function row(
  policy_id: string,
  built_in: boolean,
  decision_domain: string | null = "gate_clearance"
): CoordPolicyRow {
  return {
    policy_id,
    tenant_id: "t-1",
    repo: null,
    name: policy_id,
    kind: null,
    decision_domain,
    mode: "data_driven",
    autonomy_level: "always_escalate",
    payload: { gate_class: "routine-review", authority: "agent_any" },
    condition: {},
    action: {},
    priority: 100,
    enabled: true,
    rationale: null,
    default_source: null,
    expires_at: null,
    created_at: "2026-01-01T00:00:00Z",
    created_by: "op",
    updated_at: "2026-01-01T00:00:00Z",
    updated_by: "op",
    built_in,
    override_state: null,
    system_rule_id: null,
  };
}

describe("clearanceBandIndex", () => {
  it("maps each rule id to the band its own built_in flag reports", () => {
    const rules = [row("tenant-1", false), row("system-1", true)];
    const index = clearanceBandIndex(rules)!;
    expect(index.get("tenant-1")).toBe("tenant");
    expect(index.get("system-1")).toBe("system");
    expect([...index.keys()].sort()).toEqual(["system-1", "tenant-1"]);
  });

  it("ignores rows from other decision domains", () => {
    const index = clearanceBandIndex([
      row("other", false, "merge_sequencing"),
      row("v1", false, null),
    ])!;
    expect(index.size).toBe(0);
  });

  it("returns null — not an empty index — when the rule set was not loaded", () => {
    expect(clearanceBandIndex(null)).toBeNull();
  });
});

describe("lookupClearanceBand", () => {
  const index = clearanceBandIndex([
    row("tenant-1", false),
    row("system-1", true),
  ]);

  it("reports the band the index holds", () => {
    expect(lookupClearanceBand("tenant-1", index)).toBe("tenant");
    expect(lookupClearanceBand("system-1", index)).toBe("system");
  });

  it("is 'unknown' — never a guessed band — for an id the loaded set no longer has", () => {
    expect(lookupClearanceBand("deleted-rule", index)).toBe("unknown");
  });

  it("makes NO band claim when the rule set could not be loaded at all", () => {
    // Distinct from the case above: not knowing because we never looked is not
    // the same statement as looking and not finding it.
    expect(lookupClearanceBand("tenant-1", null)).toBeNull();
  });

  it("is null (no band claim at all) when no rule decided the gate", () => {
    expect(lookupClearanceBand(null, index)).toBeNull();
    expect(lookupClearanceBand(undefined, index)).toBeNull();
    expect(lookupClearanceBand(null, null)).toBeNull();
  });
});
