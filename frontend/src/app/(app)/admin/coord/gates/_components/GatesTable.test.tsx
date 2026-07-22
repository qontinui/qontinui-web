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
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() },
}));
vi.mock("./GateActions", () => ({ GateActions: () => null }));
vi.mock("./ShadowReap", () => ({ ShadowReapEvidence: () => null }));

import { GatesTable } from "./GatesTable";
import type { GateOverviewRow } from "@/services/admin-dev-service";

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
