/**
 * R3's audit for the gate-clearance rule palette, plus the judgement
 * `paletteDisagreements` cannot make (§4.2 clause 4: it proves the hue matches
 * the DECLARED attention, never that the declared attention was right).
 *
 * The judgement here is the split of `inertReason`'s five answers into a
 * CHOICE band and a DEFECT band. The list painted all five with one amber
 * "inactive" badge.
 */

import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console/attention";
import type { CoordPolicyRow } from "../_shared/coordPolicies";
import {
  CLEARANCE_ATTENTION_BY_KIND,
  CLEARANCE_AUTHOR_GLYPH_KINDS,
  CLEARANCE_RULE_CLASS,
  deriveClearanceRuleStatus,
  type ClearanceRuleKind,
} from "./clearanceRuleStatus";

const ALL: ClearanceRuleKind[] = [
  "active",
  "disabled",
  "expired",
  "misconfigured",
];

let seq = 0;
function rule(over: Partial<CoordPolicyRow> = {}): CoordPolicyRow {
  seq += 1;
  return {
    policy_id: `000000${seq}0-0000-0000-0000-000000000000`,
    tenant_id: "t-1",
    repo: null,
    name: `rule-${seq}`,
    kind: null,
    decision_domain: "gate_clearance",
    mode: "data_driven",
    autonomy_level: "always_escalate",
    payload: { gate_class: "security-surface", authority: "operator_only" },
    condition: {},
    action: {},
    priority: 100,
    enabled: true,
    built_in: false,
    expires_at: null,
    rationale: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-02T00:00:00Z",
    ...over,
  } as CoordPolicyRow;
}

describe("gate-clearance rule palette", () => {
  it("agrees with the attention table — red iff author, amber iff waiting", () => {
    expect(
      paletteDisagreements(CLEARANCE_ATTENTION_BY_KIND, {
        badgeClass: CLEARANCE_RULE_CLASS,
        authorGlyphKinds: CLEARANCE_AUTHOR_GLYPH_KINDS,
      })
    ).toEqual([]);
  });

  it("is total over the kind union in both directions", () => {
    expect(Object.keys(CLEARANCE_ATTENTION_BY_KIND).sort()).toEqual(
      [...ALL].sort()
    );
    for (const k of ALL) expect(CLEARANCE_RULE_CLASS[k]).toBeTruthy();
  });
});

describe("the CHOICE / DEFECT split the palette audit cannot make", () => {
  it("keeps a live rule calm and marks it done", () => {
    const s = deriveClearanceRuleStatus(rule());
    expect(s.kind).toBe("active");
    expect(s.attention).toBe("none");
    // A rule that works owes nobody an explanation.
    expect(s.reason).toBeUndefined();
  });

  it("treats `disabled` and `expired` as CHOICES — calm, said in words", () => {
    const off = deriveClearanceRuleStatus(rule({ enabled: false }));
    expect(off.kind).toBe("disabled");
    expect(off.attention).toBe("none");
    expect(/\bbg-(red|amber)-/.test(CLEARANCE_RULE_CLASS.disabled)).toBe(false);
    // The ask is carried in words, which is the other half of R3's third case.
    expect(off.reason).toMatch(/only resolves enabled rules/i);

    const gone = deriveClearanceRuleStatus(
      rule({ expires_at: "2020-01-01T00:00:00Z" })
    );
    expect(gone.kind).toBe("expired");
    expect(gone.attention).toBe("none");
  });

  it("files the three DEFECTS as author-action", () => {
    // A workspace rule scoped to a repo can never match: gates carry no repo.
    expect(
      deriveClearanceRuleStatus(rule({ repo: "qontinui/qontinui-web" })).kind
    ).toBe("misconfigured");
    // No `gate_class` — coord cannot key it.
    expect(
      deriveClearanceRuleStatus(rule({ payload: { authority: "operator_only" } }))
        .kind
    ).toBe("misconfigured");
    // An authority outside coord's closed set — the resolver skips the rule.
    expect(
      deriveClearanceRuleStatus(
        rule({ payload: { gate_class: "x", authority: "everyone" } })
      ).kind
    ).toBe("misconfigured");

    expect(CLEARANCE_ATTENTION_BY_KIND.misconfigured).toBe("author");
    expect(/\bbg-red-/.test(CLEARANCE_RULE_CLASS.misconfigured)).toBe(true);
  });

  it("does not call a repo-scoped SYSTEM rule misconfigured", () => {
    // coord matches system rows repo-agnostically, so a repo on a built-in is
    // not the dead rule it would be on a workspace row. Pinned because getting
    // this backwards paints a working default red.
    expect(
      deriveClearanceRuleStatus(
        rule({ built_in: true, repo: "qontinui/qontinui-web" })
      ).kind
    ).toBe("active");
  });

  it("does not treat a FUTURE expiry as expired", () => {
    expect(
      deriveClearanceRuleStatus(
        rule({ expires_at: "2999-01-01T00:00:00Z" })
      ).kind
    ).toBe("active");
  });
});
