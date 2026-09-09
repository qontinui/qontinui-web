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
    continuation_deferred_at: null,
    continuation_deferred_reason: null,
    continuation_deferred_count: 0,
    continuation_expired_at: null,
    continuation_expired_reason: null,
    continuation_action: null,
    continuation_will_dispatch: null,
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

  /**
   * Phase 3 Wave 4 (D2/R5): the clearance-provenance sub-line, the work
   * anchor, the shadow-reap evidence and the progress-freshness line all moved
   * OFF the collapsed row and into the `<tr><td colSpan={9}>` `<RecordDetail>`
   * that a click expands (`colSpan={10}` since the Continuation column landed).
   * Their testids are unchanged (D4a) — what changed is
   * that reaching them costs the same click an operator now makes. Clicking
   * the row is the affordance under test everywhere below.
   */
  async function expandFirstRow(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getAllByTestId("gates-table-row")[0]);
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

  it("renders NO gate-class chip and NO provenance line when the clearance-authority fields are absent (pre-deploy coord — identical to today)", async () => {
    // GATES rows deliberately omit gate_class / cleared_* /
    // registered_by_agent_id entirely (plan
    // `2026-07-27-configurable-gate-clearance-authority` Phase 6: coord may
    // not send them yet; the UI must not break — or change — on absence).
    const user = userEvent.setup();
    render(<GatesTable gates={GATES} onActed={() => {}} />);
    expect(screen.queryByTestId("gates-gate-class")).toBeNull();
    // Assert the absence WHERE THE LINE NOW LIVES. Checking a collapsed table
    // for it would pass whether or not the code is right, which is the
    // vacuous-green shape a moved element invites.
    await expandFirstRow(user);
    expect(screen.getByTestId("gates-row-detail")).toBeTruthy();
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

  it("renders a withdrawn verdict with its own label and NO red", () => {
    render(
      <GatesTable gates={[gate({ verdict: "withdrawn" })]} onActed={() => {}} />,
    );
    // Scope to the row — the verdict filter <option> also says "withdrawn".
    const row = screen.getByTestId("gates-table-row");
    const badge = within(row).getByText("withdrawn");
    // Phase 3 Wave 4 (R3): this used to carry `failed`'s destructive tone on
    // the stated reasoning that it "tones like failed". A registrant
    // cancelling its own request costs nobody anything, so it is CALM and
    // keeps its own label. `gateStatus.test.ts` owns the palette assertion;
    // this one pins that the ROW renders it.
    // `bg-destructive` is the variant's own fill. Matching bare "destructive"
    // would be a false positive: shadcn's Badge BASE class carries
    // `aria-invalid:border-destructive`, so every badge on the page contains
    // the substring.
    expect(badge.className).not.toContain("bg-destructive");
    expect(/\bbg-red-/.test(badge.className)).toBe(false);
    expect(badge.getAttribute("data-status-kind")).toBe("withdrawn");
  });

  it("renders the clearance-provenance sub-line when coord stamps the columns", async () => {
    const user = userEvent.setup();
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
    await expandFirstRow(user);
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

  it("names the band from the supplied rule set — tenant when the rule is the workspace's", async () => {
    const user = userEvent.setup();
    render(
      <GatesTable
        gates={[clearedUnderRule()]}
        onActed={() => {}}
        clearanceRules={[clearanceRule(false)]}
      />,
    );
    await expandFirstRow(user);
    expect(
      screen.getByTestId("gates-clearance-provenance").textContent,
    ).toBe("attested under tenant rule 9e8d7c6b");
  });

  it("…and system when the SAME rule id is a built-in in that set", async () => {
    const user = userEvent.setup();
    render(
      <GatesTable
        gates={[clearedUnderRule()]}
        onActed={() => {}}
        clearanceRules={[clearanceRule(true)]}
      />,
    );
    await expandFirstRow(user);
    expect(
      screen.getByTestId("gates-clearance-provenance").textContent,
    ).toBe("attested under system default rule 9e8d7c6b");
  });

  it("says 'band unknown' when the loaded rule set no longer has the rule", async () => {
    const user = userEvent.setup();
    render(
      <GatesTable
        gates={[clearedUnderRule()]}
        onActed={() => {}}
        clearanceRules={[]}
      />,
    );
    await expandFirstRow(user);
    expect(
      screen.getByTestId("gates-clearance-provenance").textContent,
    ).toBe("attested under rule 9e8d7c6b (band unknown)");
  });

  it("says no clearance rule matched when an agent door cleared with no rule", async () => {
    const user = userEvent.setup();
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
    await expandFirstRow(user);
    expect(
      screen.getByTestId("gates-clearance-provenance").textContent,
    ).toBe(
      "attested by 1b2c3d4e — no clearance rule matched (audience default)",
    );
  });

  it("makes no audience-default claim for an operator door", async () => {
    const user = userEvent.setup();
    render(
      <GatesTable
        gates={[gate({ verdict: "cleared", cleared_via: "operator_route" })]}
        onActed={() => {}}
        clearanceRules={[]}
      />,
    );
    await expandFirstRow(user);
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

/**
 * The Continuation column (plan
 * `2026-09-09-continuation-dispatch-fails-silently-three-times-in-four`).
 *
 * The property under test is DISCRIMINATION, not decoration: the three
 * readings an operator has to be able to tell apart on sight — a continuation
 * that failed to spawn, one that started and never reported, and one that has
 * no recorded outcome at all — must not render the same, and none of them may
 * render as success.
 */
describe("GatesTable — continuation column", () => {
  const SPAWN_FAILED = gate({
    gate_id: "f0000000-0000-0000-0000-00000000000f",
    title: "Failed to spawn",
    continuation_spawn: { target_device_id: "abcdef1234567890" },
    continuation_dispatched_at: new Date(Date.now() - 3_600_000).toISOString(),
    continuation_consumed_at: new Date(Date.now() - 3_500_000).toISOString(),
    continuation_consumed_outcome:
      "spawn_failed: no Tauri AppHandle (runner has no webview runtime) — cannot open a visible terminal",
  });
  const SPAWNED = gate({
    gate_id: "50000000-0000-0000-0000-000000000005",
    title: "Spawned, never reported",
    continuation_spawn: { target_device_id: "abcdef1234567890" },
    continuation_dispatched_at: new Date(Date.now() - 3_600_000).toISOString(),
    continuation_consumed_at: new Date(Date.now() - 3_500_000).toISOString(),
    continuation_consumed_outcome: "spawned",
  });
  const SILENT = gate({
    gate_id: "60000000-0000-0000-0000-000000000006",
    title: "Consumed in silence",
    continuation_spawn: { target_device_id: "abcdef1234567890" },
    continuation_dispatched_at: new Date(Date.now() - 3_600_000).toISOString(),
    continuation_consumed_at: new Date(Date.now() - 3_500_000).toISOString(),
    continuation_consumed_outcome: null,
  });
  const DEFERRED_58 = gate({
    gate_id: "70000000-0000-0000-0000-000000000007",
    title: "Deferred fifty-eight times",
    continuation_spawn: { target_device_id: "abcdef1234567890" },
    continuation_dispatched_at: new Date(Date.now() - 86_400_000).toISOString(),
    continuation_deferred_at: new Date(Date.now() - 600_000).toISOString(),
    continuation_deferred_reason: "thread_pressure:critical:540_over_400",
    continuation_deferred_count: 58,
  });
  const DEFERRED_ONCE = gate({
    gate_id: "80000000-0000-0000-0000-000000000008",
    title: "Deferred once",
    continuation_spawn: { target_device_id: "abcdef1234567890" },
    continuation_dispatched_at: new Date(Date.now() - 3_600_000).toISOString(),
    continuation_deferred_at: new Date(Date.now() - 600_000).toISOString(),
    continuation_deferred_reason: "thread_pressure:warn:300_over_256",
    continuation_deferred_count: 1,
  });

  function kinds(): string[] {
    return screen
      .getAllByTestId("gates-continuation")
      .map((el) => el.getAttribute("data-continuation-kind") ?? "");
  }

  it("renders a spawn_failed row differently from a spawned one and a silent one", () => {
    render(
      <GatesTable gates={[SPAWN_FAILED, SPAWNED, SILENT]} onActed={() => {}} />,
    );
    expect(kinds()).toEqual(["spawn_failed", "spawned", "consumed_silent"]);
    // ...and none of the three is the success reading.
    expect(kinds()).not.toContain("work_completed");
  });

  it("marks the spawn failure red with the ✕, and the two unknowns amber without it", () => {
    render(
      <GatesTable gates={[SPAWN_FAILED, SPAWNED, SILENT]} onActed={() => {}} />,
    );
    const badges = screen
      .getAllByTestId("gates-continuation")
      .map((el) => el.querySelector("[data-status-kind]") as HTMLElement);
    expect(badges[0].className).toMatch(/bg-red-/);
    expect(badges[0].textContent).toContain("✕");
    expect(badges[1].className).toMatch(/bg-amber-/);
    expect(badges[1].textContent).not.toContain("✓");
    expect(badges[2].className).toMatch(/bg-amber-/);
    expect(badges[2].textContent).not.toContain("✓");
  });

  it("says none — never a blank cell — when no continuation is attached", () => {
    render(<GatesTable gates={[gate()]} onActed={() => {}} />);
    expect(screen.getByTestId("gates-continuation-none").textContent).toBe(
      "none",
    );
    expect(screen.queryByTestId("gates-continuation")).toBeNull();
  });

  it("distinguishes 58 deferrals from 1, and escalates only the former", () => {
    render(
      <GatesTable gates={[DEFERRED_58, DEFERRED_ONCE]} onActed={() => {}} />,
    );
    expect(kinds()).toEqual(["deferral_stuck", "deferred"]);
    const labels = screen
      .getAllByTestId("gates-continuation")
      .map((el) => el.textContent ?? "");
    expect(labels[0]).toContain("deferred ×58");
    expect(labels[1]).toContain("deferred ×1");
  });

  it("keeps showing the deferrals a completed continuation survived", () => {
    render(
      <GatesTable
        gates={[
          gate({
            title: "Ran, eventually",
            continuation_spawn: { target_device_id: "abcdef1234567890" },
            continuation_dispatched_at: new Date(
              Date.now() - 86_400_000,
            ).toISOString(),
            continuation_deferred_at: new Date(
              Date.now() - 40_000_000,
            ).toISOString(),
            continuation_deferred_reason: "at_cap:4",
            continuation_deferred_count: 12,
            continuation_consumed_at: new Date(
              Date.now() - 30_000_000,
            ).toISOString(),
            continuation_consumed_outcome: "work_completed",
          }),
        ]}
        onActed={() => {}}
      />,
    );
    expect(kinds()).toEqual(["work_completed"]);
    expect(
      screen.getByTestId("gates-continuation-deferral-chip").textContent,
    ).toBe("after 12 deferrals");
  });

  it("counts the attention/unknown/deferred populations above the table", () => {
    render(
      <GatesTable
        gates={[SPAWN_FAILED, SPAWNED, SILENT, DEFERRED_58, DEFERRED_ONCE]}
        onActed={() => {}}
      />,
    );
    // spawn_failed + deferral_stuck are the author kinds here.
    expect(screen.getByTestId("continuation-attention-value").textContent).toBe(
      "continuations needing attention 2",
    );
    // spawned + consumed_silent.
    expect(screen.getByTestId("continuation-unknown-value").textContent).toBe(
      "outcome unknown 2",
    );
    expect(screen.getByTestId("continuation-deferred-value").textContent).toBe(
      "ever deferred 2",
    );
  });

  it("renders no count cluster when the page has nothing to say", () => {
    render(<GatesTable gates={[gate()]} onActed={() => {}} />);
    expect(screen.queryByTestId("gates-continuation-summary")).toBeNull();
  });

  it("filters to the rows that need attention", async () => {
    const user = userEvent.setup();
    render(
      <GatesTable
        gates={[SPAWN_FAILED, SPAWNED, SILENT, DEFERRED_ONCE]}
        onActed={() => {}}
      />,
    );
    await user.selectOptions(
      screen.getByTestId("gates-filter-continuation"),
      "attention",
    );
    expect(kinds()).toEqual(["spawn_failed"]);
  });

  it("filters to every row that was ever deferred, whatever state it reached", async () => {
    const user = userEvent.setup();
    render(
      <GatesTable
        gates={[SPAWN_FAILED, DEFERRED_58, DEFERRED_ONCE]}
        onActed={() => {}}
      />,
    );
    await user.selectOptions(
      screen.getByTestId("gates-filter-continuation"),
      "deferred",
    );
    expect(kinds()).toEqual(["deferral_stuck", "deferred"]);
  });

  it("finds a gate by pasting the outcome coord recorded", async () => {
    const user = userEvent.setup();
    render(
      <GatesTable gates={[SPAWN_FAILED, SPAWNED, SILENT]} onActed={() => {}} />,
    );
    await user.type(screen.getByTestId("gates-search"), "no Tauri AppHandle");
    expect(screen.getAllByTestId("gates-table-row")).toHaveLength(1);
    expect(kinds()).toEqual(["spawn_failed"]);
  });

  it("spells out the failure and the deferral pressure in the expansion", async () => {
    const user = userEvent.setup();
    render(<GatesTable gates={[DEFERRED_58]} onActed={() => {}} />);
    await user.click(screen.getAllByTestId("gates-table-row")[0]);
    const problem = screen.getByTestId("gates-continuation-problem").textContent;
    expect(problem).toContain("deferred ×58");
    expect(problem).toContain("out of OS threads (critical)");
    expect(problem).toContain("540 observed against a limit of 400");
    expect(problem).toContain("Dispatch pushed back 58 times");
    // The timeline reports the stamps rather than inventing a liveness claim.
    expect(
      screen.getByTestId("gates-continuation-timeline").textContent,
    ).toContain("last deferred");
  });

  it("carries coord's verbatim outcome into the raw slot", async () => {
    const user = userEvent.setup();
    render(<GatesTable gates={[SPAWN_FAILED]} onActed={() => {}} />);
    await user.click(screen.getAllByTestId("gates-table-row")[0]);
    const raw = screen.getByTestId("gates-row-detail").textContent ?? "";
    expect(raw).toContain("consumed_outcome: spawn_failed: no Tauri AppHandle");
  });

  it("states the spawn INTENT only while it is still a prediction", async () => {
    const user = userEvent.setup();
    render(
      <GatesTable
        gates={[
          gate({
            continuation_spawn: {
              target_device_id: "abcdef1234567890",
              initial_prompt: "carry on",
            },
          }),
        ]}
        onActed={() => {}}
      />,
    );
    await user.click(screen.getAllByTestId("gates-table-row")[0]);
    expect(
      screen.getByTestId("gates-continuation-intent").textContent,
    ).toContain("Clearing opens a visible terminal session on abcdef12");
  });

  it("drops the intent line once the continuation has actually dispatched", async () => {
    const user = userEvent.setup();
    render(<GatesTable gates={[SPAWN_FAILED]} onActed={() => {}} />);
    await user.click(screen.getAllByTestId("gates-table-row")[0]);
    expect(screen.queryByTestId("gates-continuation-intent")).toBeNull();
  });
});
