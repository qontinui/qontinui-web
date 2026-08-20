/**
 * The effective-authority matrix renders the RESOLUTION, not the rows.
 *
 * Each assertion compares what the table says against the rule set it was
 * given — a tenant row must visibly beat a system row for the same class, and a
 * class with no rule must show BOTH arms of coord's audience-dependent default
 * rather than one picked answer. Asserting only that the table renders would
 * let the display and the resolver drift apart.
 */

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { CoordPolicyRow } from "../../_shared/coordPolicies";
import { EffectiveAuthorityMatrix } from "./EffectiveAuthorityMatrix";

let seq = 0;

function rule(over: {
  gate_class: string;
  authority: string;
  built_in?: boolean;
  priority?: number;
  name?: string;
  enabled?: boolean;
}): CoordPolicyRow {
  seq += 1;
  const { gate_class, authority, ...rest } = over;
  return {
    policy_id: `000000${seq}0-0000-0000-0000-000000000000`,
    tenant_id: "t-1",
    repo: null,
    name: `rule-${seq}`,
    kind: null,
    decision_domain: "gate_clearance",
    mode: "data_driven",
    autonomy_level: "always_escalate",
    payload: { gate_class, authority },
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
    built_in: false,
    override_state: null,
    system_rule_id: null,
    ...rest,
  };
}

function row(gateClass: string) {
  return within(screen.getByTestId(`gate-clearance-matrix-row-${gateClass}`));
}

describe("EffectiveAuthorityMatrix", () => {
  it("shows the tenant rule's authority and band when it outranks a system rule", () => {
    const system = rule({
      gate_class: "security-surface",
      authority: "operator_only",
      built_in: true,
      priority: 1,
      name: "coord default",
    });
    const tenant = rule({
      gate_class: "security-surface",
      authority: "agent_any",
      priority: 9999,
      name: "my override",
    });

    render(<EffectiveAuthorityMatrix rules={[system, tenant]} />);

    const cell = row("security-surface");
    // The authority shown is the TENANT row's, not the system row's…
    expect(cell.getByTestId("gate-clearance-effective").textContent).toContain(
      "Any agent"
    );
    // …and the band is named, so the user can tell which one decided.
    const decided = cell.getByTestId("gate-clearance-decided-by").textContent;
    expect(decided).toContain("This workspace");
    expect(decided).toContain("my override");
    expect(decided).toContain("Outranks 1 lower-precedence rule");
  });

  it("shows the system band when only a system rule exists", () => {
    render(
      <EffectiveAuthorityMatrix
        rules={[
          rule({
            gate_class: "routine-review",
            authority: "agent_any",
            built_in: true,
            name: "coord default",
          }),
        ]}
      />
    );
    const decided = row("routine-review").getByTestId(
      "gate-clearance-decided-by"
    ).textContent;
    expect(decided).toContain("System default");
    expect(decided).not.toContain("This workspace");
  });

  it("shows BOTH audience arms — never one guessed answer — with no rule", () => {
    render(<EffectiveAuthorityMatrix rules={[]} />);
    const cell = row("ops-confirm");
    const effective = cell.getByTestId("gate-clearance-effective").textContent!;
    expect(effective).toContain("operator-audience gates");
    expect(effective).toContain("Operator only");
    expect(effective).toContain("agent-audience gates");
    expect(effective).toContain("Any agent");
    expect(cell.getByTestId("gate-clearance-decided-by").textContent).toContain(
      "No rule"
    );
  });

  it("lists a class only an inert rule mentions, and flags a near-miss spelling", () => {
    render(
      <EffectiveAuthorityMatrix
        rules={[
          rule({
            gate_class: "Security-Surface",
            authority: "agent_any",
            enabled: false,
          }),
        ]}
      />
    );
    const cell = row("Security-Surface");
    // The class is visible even though nothing resolves through it…
    expect(cell.getByTestId("gate-clearance-near-miss").textContent).toContain(
      "security-surface"
    );
    // …and it resolves to the default, because the rule is disabled.
    expect(cell.getByTestId("gate-clearance-decided-by").textContent).toContain(
      "No rule"
    );
    // The correctly-spelled class is unaffected by the typo'd rule.
    expect(
      row("security-surface").getByTestId("gate-clearance-decided-by")
        .textContent
    ).toContain("No rule");
  });
});
