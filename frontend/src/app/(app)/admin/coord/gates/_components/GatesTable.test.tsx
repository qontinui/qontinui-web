/**
 * GatesTable — free-text search (Part A) + copyable gate-id sub-line (Part B).
 *
 * Plan 2026-07-21-gates-search-gateid-and-sweep-action Phase 3. Covers:
 *   - typing a title substring narrows the rendered rows
 *   - typing an 8-char gate-id prefix selects exactly that gate's row
 *   - the gate-id short form (first 8 chars) renders
 *   - the copy affordance writes the FULL gate id to the clipboard (bonus)
 *
 * The heavyweight per-row children (GateActions makes network calls; ShadowReap
 * is out of scope) are stubbed so the render is isolated to the table itself.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() },
}));
vi.mock("./GateActions", () => ({ GateActions: () => null }));
vi.mock("./ShadowReap", () => ({ ShadowReapEvidence: () => null }));

import { GatesTable } from "./GatesTable";
import type { GateOverviewRow } from "@/services/admin-dev-service";
import type { CoordPolicyRow } from "../../_shared/coordPolicies";

function gate(overrides: Partial<GateOverviewRow> = {}): GateOverviewRow {
  return {
    gate_id: "00000000-0000-0000-0000-000000000000",
    claim_kind: null,
    resource_key: null,
    plan_id: null,
    plan_slug: null,
    work_unit_id: null,
    work_unit_slug: null,
    phase_name: null,
    predicate: { kind: "pr_merged" },
    verdict: "open",
    verdict_reason: null,
    shadow_reap_signal: null,
    shadow_reap_at: null,
    registered_by: null,
    tenant_id: "t-1",
    created_at: new Date().toISOString(),
    evaluated_at: null,
    cleared_at: null,
    muted: false,
    snoozed_until: null,
    clearance_audience: "operator",
    continuation_spawn: null,
    continuation_dispatched_at: null,
    continuation_consumed_at: null,
    continuation_consumed_by: null,
    continuation_consumed_outcome: null,
    continuation_cancelled_at: null,
    continuation_cancelled_by: null,
    continuation_cancel_reason: null,
    title: "A gate",
    measures: "some measure",
    progress: {
      basis: "binary",
      current: null,
      target: null,
      unit: null,
      fraction: null,
      eta: null,
      eta_confidence: "none",
    },
    age_secs: 10,
    stale: false,
    ...overrides,
  };
}

const GATES: GateOverviewRow[] = [
  gate({
    gate_id: "2aeadf7c-1111-2222-3333-444455556666",
    title: "Ship the runner release surface",
  }),
  gate({
    gate_id: "8a1ca893-aaaa-bbbb-cccc-ddddeeeeffff",
    title: "Backfill land-aware pr_merged residue",
  }),
  gate({
    gate_id: "deadbeef-9999-8888-7777-666655554444",
    title: "Unrelated devenv phase-2",
    plan_slug: "devenv-phase-2",
  }),
];

describe("GatesTable search + gate-id", () => {
  beforeEach(() => {
    toastSuccess.mockReset();
  });

  function rowTitles(): string[] {
    return screen
      .getAllByTestId("gates-table-row")
      .map((r) => r.querySelector(".font-medium")?.textContent ?? "");
  }

  it("renders every gate with no search", () => {
    render(<GatesTable gates={GATES} onActed={() => {}} />);
    expect(screen.getAllByTestId("gates-table-row")).toHaveLength(3);
  });

  it("renders the short (8-char) gate-id form", () => {
    render(<GatesTable gates={GATES} onActed={() => {}} />);
    const ids = screen
      .getAllByTestId("gates-gate-id")
      .map((el) => el.textContent ?? "");
    expect(ids.some((t) => t.includes("2aeadf7c"))).toBe(true);
    // The full id is not shown inline (only the short form + copy button).
    expect(ids.some((t) => t.includes("2aeadf7c-1111"))).toBe(false);
  });

  it("a title substring narrows the rendered rows", async () => {
    const user = userEvent.setup();
    render(<GatesTable gates={GATES} onActed={() => {}} />);
    await user.type(screen.getByTestId("gates-search"), "runner");
    expect(rowTitles()).toEqual(["Ship the runner release surface"]);
  });

  it("an 8-char gate-id prefix selects exactly that gate's row", async () => {
    const user = userEvent.setup();
    render(<GatesTable gates={GATES} onActed={() => {}} />);
    await user.type(screen.getByTestId("gates-search"), "2aeadf7c");
    const rows = screen.getAllByTestId("gates-table-row");
    expect(rows).toHaveLength(1);
    expect(rowTitles()).toEqual(["Ship the runner release surface"]);
  });

  it("search matches on the anchor slug too", async () => {
    const user = userEvent.setup();
    render(<GatesTable gates={GATES} onActed={() => {}} />);
    await user.type(screen.getByTestId("gates-search"), "devenv");
    expect(rowTitles()).toEqual(["Unrelated devenv phase-2"]);
  });

  it("renders NO gate-class chip and NO provenance line when the clearance-authority fields are absent (pre-deploy coord — identical to today)", () => {
    // GATES rows deliberately omit gate_class / cleared_* /
    // registered_by_agent_id entirely (plan
    // `2026-07-27-configurable-gate-clearance-authority` Phase 6: coord may
    // not send them yet; the UI must not break — or change — on absence).
    render(<GatesTable gates={GATES} onActed={() => {}} />);
    expect(screen.queryByTestId("gates-gate-class")).toBeNull();
    expect(screen.queryByTestId("gates-clearance-provenance")).toBeNull();
  });

  it("renders the gate-class chip when gate_class is set", () => {
    render(
      <GatesTable
        gates={[gate({ gate_class: "security-surface" })]}
        onActed={() => {}}
      />,
    );
    expect(
      screen.getByTestId("gates-gate-class").textContent,
    ).toBe("security-surface");
  });

  it("renders a withdrawn verdict with its own label and the failed (destructive) tone", () => {
    render(
      <GatesTable gates={[gate({ verdict: "withdrawn" })]} onActed={() => {}} />,
    );
    // Scope to the row — the verdict filter <option> also says "withdrawn".
    const row = screen.getByTestId("gates-table-row");
    const badge = within(row).getByText("withdrawn");
    // Same destructive tone as `failed`, but the label stays `withdrawn`.
    expect(badge.className).toContain("destructive");
  });

  it("renders the clearance-provenance sub-line when coord stamps the columns", () => {
    render(
      <GatesTable
        gates={[
          gate({
            verdict: "cleared",
            cleared_via: "agent_attest",
            cleared_by_agent_id: "6f2a91c3-0000-0000-0000-000000000001",
            cleared_by_device_id: "1b2c3d4e-0000-0000-0000-000000000002",
            cleared_under_rule: "9e8d7c6b-0000-0000-0000-000000000003",
          }),
        ]}
        onActed={() => {}}
      />,
    );
    expect(
      screen.getByTestId("gates-clearance-provenance").textContent,
    ).toBe("attested by agent 6f2a91c3 on 1b2c3d4e under rule 9e8d7c6b");
  });

  // -- clearance-rule BAND (plan 2026-08-10-agent-gate-management P3) -------
  //
  // Coord's gates wire carries the deciding rule's ID and nothing about which
  // band it came from. The band shown must therefore AGREE with the rule set
  // the table was handed — these assert exactly that, and that neither absent
  // arm is filled in with a guess.

  const RULE_ID = "9e8d7c6b-0000-0000-0000-000000000003";

  const clearedUnderRule = () =>
    gate({
      verdict: "cleared",
      cleared_via: "agent_attest",
      cleared_under_rule: RULE_ID,
    });

  function clearanceRule(built_in: boolean): CoordPolicyRow {
    return {
      policy_id: RULE_ID,
      tenant_id: "t-1",
      repo: null,
      name: "routine-review",
      kind: null,
      decision_domain: "gate_clearance",
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

  it("names the band from the supplied rule set — tenant when the rule is the workspace's", () => {
    render(
      <GatesTable
        gates={[clearedUnderRule()]}
        onActed={() => {}}
        clearanceRules={[clearanceRule(false)]}
      />,
    );
    expect(
      screen.getByTestId("gates-clearance-provenance").textContent,
    ).toBe("attested under tenant rule 9e8d7c6b");
  });

  it("…and system when the SAME rule id is a built-in in that set", () => {
    render(
      <GatesTable
        gates={[clearedUnderRule()]}
        onActed={() => {}}
        clearanceRules={[clearanceRule(true)]}
      />,
    );
    expect(
      screen.getByTestId("gates-clearance-provenance").textContent,
    ).toBe("attested under system default rule 9e8d7c6b");
  });

  it("says 'band unknown' when the loaded rule set no longer has the rule", () => {
    render(
      <GatesTable
        gates={[clearedUnderRule()]}
        onActed={() => {}}
        clearanceRules={[]}
      />,
    );
    expect(
      screen.getByTestId("gates-clearance-provenance").textContent,
    ).toBe("attested under rule 9e8d7c6b (band unknown)");
  });

  it("says no clearance rule matched when an agent door cleared with no rule", () => {
    render(
      <GatesTable
        gates={[
          gate({
            verdict: "cleared",
            cleared_via: "agent_attest",
            cleared_by_device_id: "1b2c3d4e-0000-0000-0000-000000000002",
          }),
        ]}
        onActed={() => {}}
        clearanceRules={[]}
      />,
    );
    expect(
      screen.getByTestId("gates-clearance-provenance").textContent,
    ).toBe(
      "attested by 1b2c3d4e — no clearance rule matched (audience default)",
    );
  });

  it("makes no audience-default claim for an operator door", () => {
    render(
      <GatesTable
        gates={[gate({ verdict: "cleared", cleared_via: "operator_route" })]}
        onActed={() => {}}
        clearanceRules={[]}
      />,
    );
    expect(
      screen.getByTestId("gates-clearance-provenance").textContent,
    ).toBe("cleared by operator");
  });

  it("the copy button writes the FULL gate id to the clipboard", async () => {
    const user = userEvent.setup();
    // Redefine clipboard AFTER userEvent.setup() — setup() installs its own
    // clipboard stub, so our spy must win to observe the component's writeText.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<GatesTable gates={[GATES[0]]} onActed={() => {}} />);
    await user.click(screen.getByTestId("gates-gate-id-copy"));
    expect(writeText).toHaveBeenCalledWith(
      "2aeadf7c-1111-2222-3333-444455556666",
    );
  });
});
