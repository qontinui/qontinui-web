/**
 * The clearance-rule list: write-control gating.
 *
 * Two behaviours are pinned against their source rather than their markup:
 *
 *  1. Write controls render iff `useAuth().isCoordAdmin` — the coord proxy
 *     403s a non-admin anyway, so showing the buttons would be a lie about
 *     what the viewer can do.
 *  2. A rule stays READABLE to a non-admin — seeing who may clear a gate is
 *     diagnostic, and hiding it would push diagnosis back to raw API calls.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CoordPolicyRow } from "../../_shared/coordPolicies";

const authState = vi.hoisted(() => ({ isCoordAdmin: true }));
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => authState,
}));

import { ClearanceRuleList } from "./ClearanceRuleList";

let seq = 0;

function rule(over: {
  gate_class: string;
  authority: string;
  built_in?: boolean;
  name?: string;
}): CoordPolicyRow {
  seq += 1;
  const { gate_class, authority, ...rest } = over;
  return {
    policy_id: `p-${seq}`,
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

function renderList(rules: CoordPolicyRow[], onDelete = vi.fn()) {
  render(
    <ClearanceRuleList
      rules={rules}
      saving={false}
      onCreate={vi.fn()}
      onEdit={vi.fn()}
      onOverrideSystemDefault={vi.fn()}
      onDelete={onDelete}
    />
  );
}

describe("ClearanceRuleList write-control gating", () => {
  it("shows the write controls to a coord admin", () => {
    authState.isCoordAdmin = true;
    renderList([rule({ gate_class: "ops-confirm", authority: "agent_any" })]);
    expect(screen.getByTestId("new-clearance-rule")).toBeTruthy();
    expect(screen.getByLabelText("Delete rule-1")).toBeTruthy();
  });

  it("hides them from a non-admin member and says why", () => {
    authState.isCoordAdmin = false;
    renderList([rule({ gate_class: "ops-confirm", authority: "agent_any" })]);
    expect(screen.queryByTestId("new-clearance-rule")).toBeNull();
    expect(screen.queryByLabelText("Delete rule-2")).toBeNull();
    expect(screen.getByTestId("coord-admin-only-notice")).toBeTruthy();
    // The rule itself stays readable — seeing who may clear is diagnostic.
    expect(screen.getAllByTestId("clearance-rule-row")).toHaveLength(1);
  });
});

// The delete confirmation itself is NOT driven from here: its trigger is a
// `DestructiveButton`, which deliberately blocks any click whose
// `event.isTrusted` is false (the UI-Bridge/synthetic-click guard), so no
// test-library click can open the dialog. Its two moving parts are covered
// where they live instead: `resolveWithout` in `gateClearance.test.ts`
// ("falls to the system rule once the tenant rule is gone" and "falls all the
// way to the AUDIENCE default with no rule left"), and the cell that renders
// that answer in `EffectiveAuthorityMatrix.test.tsx`. The dialog composes
// exactly those two and adds no logic of its own.
