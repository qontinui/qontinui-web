/**
 * The automation-rules off-switch — the one control on this surface that used
 * to destroy a rule while presenting as a reversible toggle.
 *
 * The wire fact behind every assertion here: coord's
 * `DELETE /coord/policies/:id` is a SOFT delete that sets `enabled = false`
 * (`policies/routes.rs::delete_soft`), `coord.policy_rules` has no tombstone
 * column, and the list route's default is `enabled = true`. So a workspace
 * rule's OFF position is byte-identical to its deletion AND drops the row out
 * of the very list this page reloads — the rule vanished with no way to see or
 * restore it.
 *
 * Two behaviours are therefore pinned, and they are opposites on purpose:
 *
 *  1. A WORKSPACE rule's OFF is confirmed and routed to `deleteRule`. Nothing
 *     is written on the click, and it never PATCHes `enabled: false` — that
 *     would be the unreadable write, under a name that denies it.
 *  2. A BUILT-IN's OFF is left alone. Its switch runs the system-override
 *     routes, which genuinely are reversible, so a confirmation there would be
 *     friction with nothing behind it.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const hooks = vi.hoisted(() => ({
  updateRule: vi.fn(),
  deleteRule: vi.fn(),
  overrideRule: vi.fn(),
  revertOverride: vi.fn(),
  restoreDefault: vi.fn(),
  createRule: vi.fn(),
  rules: [] as unknown[],
}));

vi.mock("../_hooks/useAutomationRules", () => ({
  useAutomationRules: () => ({
    rules: hooks.rules,
    loading: false,
    saving: false,
    reload: vi.fn(),
    createRule: hooks.createRule,
    updateRule: hooks.updateRule,
    restoreDefault: hooks.restoreDefault,
    deleteRule: hooks.deleteRule,
    overrideRule: hooks.overrideRule,
    revertOverride: hooks.revertOverride,
  }),
}));

import { RuleList } from "./RuleList";
import type { PolicyRow } from "../types";

function rule(over: Partial<PolicyRow> = {}): PolicyRow {
  return {
    policy_id: "p-1",
    tenant_id: "t-1",
    repo: null,
    name: "auto-answer the deploy prompt",
    kind: "terminal_auto_response",
    decision_domain: null,
    mode: "deterministic",
    autonomy_level: "always_escalate",
    payload: null,
    condition: { type: "terminal_regex_match", pattern: "deploy\\?" },
    action: { type: "submit_prompt", text: "yes" },
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
    ...over,
  } as PolicyRow;
}

beforeEach(() => {
  hooks.updateRule.mockReset();
  hooks.deleteRule.mockReset();
  hooks.overrideRule.mockReset();
  hooks.revertOverride.mockReset();
  hooks.rules = [];
});

describe("workspace rule off-switch", () => {
  it("confirms instead of writing, and never PATCHes enabled:false", () => {
    hooks.rules = [rule()];
    render(<RuleList />);

    fireEvent.click(screen.getByRole("switch"));

    // The click alone must not reach the wire — the old behaviour destroyed
    // the rule here, silently.
    expect(hooks.updateRule).not.toHaveBeenCalled();
    expect(hooks.deleteRule).not.toHaveBeenCalled();
    expect(screen.getByTestId("automation-disable-confirm")).toBeTruthy();
  });

  it("names the soft delete rather than implying a reversible off", () => {
    hooks.rules = [rule()];
    render(<RuleList />);
    fireEvent.click(screen.getByRole("switch"));

    const text = screen.getByTestId("automation-disable-confirm").textContent;
    expect(text).toContain("no reversible");
    expect(text).toContain("same soft delete");
  });

  it("routes the confirmed OFF to deleteRule, not to a PATCH", () => {
    hooks.rules = [rule()];
    render(<RuleList />);
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByText("Turn off and delete"));

    // `enabled: false` via PATCH and via DELETE reach the SAME column with the
    // same value; only DELETE carries coord's operator stamping, and only it
    // matches what the user was told.
    expect(hooks.deleteRule).toHaveBeenCalledWith("p-1");
    expect(hooks.updateRule).not.toHaveBeenCalled();
  });

  it("writes nothing when the confirmation is cancelled", () => {
    hooks.rules = [rule()];
    render(<RuleList />);
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByText("Cancel"));

    expect(hooks.deleteRule).not.toHaveBeenCalled();
    expect(hooks.updateRule).not.toHaveBeenCalled();
  });
});

describe("built-in off-switch is untouched", () => {
  it("overrides immediately — that path really is reversible", () => {
    hooks.rules = [
      rule({ built_in: true, system_rule_id: "sys-1", override_state: null }),
    ];
    render(<RuleList />);

    fireEvent.click(screen.getByRole("switch"));

    expect(hooks.overrideRule).toHaveBeenCalledWith("sys-1", {
      disabled: true,
    });
    expect(screen.queryByTestId("automation-disable-confirm")).toBeNull();
    expect(hooks.deleteRule).not.toHaveBeenCalled();
  });

  it("reverts a disabled built-in back to the shipped default", () => {
    hooks.rules = [
      rule({
        built_in: true,
        system_rule_id: "sys-1",
        override_state: "disabled",
        enabled: false,
      }),
    ];
    render(<RuleList />);

    fireEvent.click(screen.getByRole("switch"));

    expect(hooks.revertOverride).toHaveBeenCalledWith("sys-1");
    expect(hooks.updateRule).not.toHaveBeenCalled();
  });
});
