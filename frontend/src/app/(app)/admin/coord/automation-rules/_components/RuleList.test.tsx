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
import { act, fireEvent, render, screen } from "@testing-library/react";

const hooks = vi.hoisted(() => ({
  updateRule: vi.fn(),
  deleteRule: vi.fn(),
  overrideRule: vi.fn(),
  revertOverride: vi.fn(),
  restoreDefault: vi.fn(),
  createRule: vi.fn(),
  reload: vi.fn(),
  rules: [] as unknown[],
  loadFailed: false,
}));

vi.mock("../_hooks/useAutomationRules", () => ({
  useAutomationRules: () => ({
    rules: hooks.rules,
    loading: false,
    saving: false,
    loadFailed: hooks.loadFailed,
    reload: hooks.reload,
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
  hooks.reload.mockReset();
  hooks.reload.mockResolvedValue(undefined);
  hooks.rules = [];
  hooks.loadFailed = false;
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

  it("has no ON branch that could PATCH the soft-delete column", () => {
    // A listed workspace row is always enabled, so its switch is only ever
    // clicked OFF. The removed `else if (enabled)` would have PATCHed
    // `enabled` — the column coord's DELETE writes — the moment anyone made
    // a disabled row listable.
    hooks.rules = [rule()];
    render(<RuleList />);

    const toggle = screen.getByRole("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(toggle);
    fireEvent.click(screen.getByText("Cancel"));
    // …and clicking again still cannot reach a PATCH.
    fireEvent.click(toggle);

    expect(hooks.updateRule).not.toHaveBeenCalled();
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

/**
 * A failed list read and an empty workspace are DIFFERENT facts, and this
 * surface used to render them identically: `useCoordPolicies` leaves `rules`
 * as `[]` when the call throws, and `useAutomationRules` did not re-export
 * `loadFailed` at all, so the "No automation rules yet / Create your first
 * rule" card claimed a workspace had no rules on the strength of an outage.
 *
 * That is the wrong claim on any page. It is a worse one HERE, because the
 * off-switch above is a soft delete: "all my rules are gone" is a state an
 * operator can now cause on this very screen, so a false empty reads as a
 * confirmation of the mistake they most fear having made.
 */
describe("failed read is UNKNOWN, not an empty workspace", () => {
  it("shows the load-failure panel instead of the empty-state card", () => {
    hooks.loadFailed = true;
    hooks.rules = [];
    render(<RuleList />);

    expect(screen.getByTestId("automation-rules-load-failed")).toBeTruthy();
    // The exact claim that must not be made from a failed read.
    expect(screen.queryByText("No automation rules yet.")).toBeNull();
    expect(screen.queryByText("Create your first rule")).toBeNull();
  });

  it("says the rules are unknown rather than absent", () => {
    hooks.loadFailed = true;
    render(<RuleList />);

    const text = screen.getByTestId("automation-rules-load-failed").textContent;
    expect(text).toContain("not the same as having none");
    expect(text).toContain("unknown");
  });

  it("retries in place instead of asking for a browser reload", () => {
    hooks.loadFailed = true;
    hooks.reload.mockResolvedValue(undefined);
    render(<RuleList />);

    fireEvent.click(screen.getByTestId("automation-rules-retry"));

    expect(hooks.reload).toHaveBeenCalledTimes(1);
  });

  /*
    A refetch never raises the hook's `loading` flag (that is first-load only),
    so without a local in-flight flag the Retry button is indistinguishable
    from a dead one against a coord that hangs — and the operator presses it
    again, which is how two overlapping reads get started.
  */
  it("holds the retry button while the refetch is in flight", async () => {
    hooks.loadFailed = true;
    let settle: () => void = () => {};
    hooks.reload.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        })
    );
    render(<RuleList />);

    const button = screen.getByTestId("automation-rules-retry");
    fireEvent.click(button);

    expect(button).toHaveProperty("disabled", true);
    expect(button.textContent).toContain("Retrying");

    fireEvent.click(button);
    expect(hooks.reload).toHaveBeenCalledTimes(1);

    await act(async () => {
      settle();
    });

    expect(screen.getByTestId("automation-rules-retry")).toHaveProperty(
      "disabled",
      false
    );
  });

  it("keeps the editor and confirmation dialogs mounted on the failed arm", () => {
    // The failed-empty arm renders in place of the LIST, never in place of the
    // component — an early return would tear down an open Radix dialog from
    // the parent instead of closing it.
    hooks.loadFailed = true;
    hooks.rules = [];
    const { container } = render(<RuleList />);

    expect(screen.getByTestId("automation-rules-load-failed")).toBeTruthy();
    // The panel is a child of the surface's own wrapper, not the whole render.
    expect(container.firstElementChild?.className).toContain("space-y-4");
  });

  it("announces the panel to assistive tech", () => {
    hooks.loadFailed = true;
    hooks.rules = [rule()];
    render(<RuleList />);

    // The failed-refetch panel appears inline in an already-rendered list:
    // no route change, no focus move, no heading. Nothing else signals it.
    expect(screen.getByTestId("automation-rules-load-failed")).toHaveProperty(
      "role",
      "alert"
    );
  });

  it("still renders the empty-state card for a genuinely empty workspace", () => {
    hooks.loadFailed = false;
    hooks.rules = [];
    render(<RuleList />);

    expect(screen.getByText("No automation rules yet.")).toBeTruthy();
    expect(screen.queryByTestId("automation-rules-load-failed")).toBeNull();
  });

  it("does not hide a loaded list behind the panel", () => {
    hooks.loadFailed = false;
    hooks.rules = [rule()];
    render(<RuleList />);

    expect(screen.queryByTestId("automation-rules-load-failed")).toBeNull();
    expect(screen.getByRole("switch")).toBeTruthy();
  });

  it("withholds New Rule when there is nothing to author against", () => {
    hooks.loadFailed = true;
    hooks.rules = [];
    render(<RuleList />);

    // Creating blind against a list that failed to load is how a duplicate of
    // a live rule gets made.
    expect(screen.queryByTestId("new-rule")).toBeNull();
  });

  /*
    A failed REFETCH is a different fact from a failed first load:
    `useCoordPolicies` does not clear `rules` on error, so the last good list is
    still in hand. Reporting the failure must not cost the reader that list.
  */
  it("keeps a retained list and marks it as the last successful read", () => {
    hooks.loadFailed = true;
    hooks.rules = [rule()];
    render(<RuleList />);

    expect(screen.getByTestId("automation-rules-load-failed")).toBeTruthy();
    // The rule is still listed and still operable.
    expect(screen.getByRole("switch")).toBeTruthy();
    expect(screen.getByTestId("new-rule")).toBeTruthy();

    const text = screen.getByTestId("automation-rules-load-failed").textContent;
    expect(text).toContain("last successful read");
    expect(text).not.toContain("not the same as having none");
  });
});
