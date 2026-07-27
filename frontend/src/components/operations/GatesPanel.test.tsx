/**
 * GatesPanel — clearance-authority rendering (plan
 * `2026-07-27-configurable-gate-clearance-authority` Phase 6).
 *
 * The load-bearing contract is ABSENCE: coord may not emit `gate_class` /
 * `registered_by_agent_id` / `cleared_*` yet (the coord readers stay draft
 * until the web migration applies to RDS), so a row without them MUST render
 * exactly as it does today — no chip, no provenance segment, no crash. The
 * positive cases pin the withdrawn-verdict badge tone and the provenance
 * sentence.
 *
 * `useGatesStream` (network polling) and `httpClient` are stubbed so the
 * render is isolated to the panel itself.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: vi.fn() }));
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: vi.fn() },
}));
const useGatesStreamMock = vi.fn();
vi.mock("./useGatesStream", () => ({
  useGatesStream: (...args: unknown[]) => useGatesStreamMock(...args),
}));

import { GatesPanel } from "./GatesPanel";
import type { GateRow } from "./types";

function gateRow(overrides: Partial<GateRow> = {}): GateRow {
  return {
    gate_id: "2aeadf7c-1111-2222-3333-444455556666",
    claim_kind: null,
    resource_key: null,
    plan_id: "plan-1",
    phase_name: "Phase 2",
    predicate: { kind: "operator_approval", prompt: "Deploy approved?" },
    verdict: "open",
    verdict_reason: null,
    registered_by: null,
    tenant_id: "t-1",
    created_at: new Date().toISOString(),
    evaluated_at: null,
    cleared_at: null,
    ...overrides,
  };
}

function renderPanel(gates: GateRow[]) {
  useGatesStreamMock.mockReturnValue({
    gates,
    error: null,
    refetch: vi.fn(),
  });
  return render(<GatesPanel />);
}

describe("GatesPanel clearance-authority fields", () => {
  it("renders NO gate-class chip and NO provenance segment when the fields are absent (pre-deploy coord — identical to today)", () => {
    const { container } = renderPanel([gateRow()]);
    expect(container.querySelector("[data-gate-class]")).toBeNull();
    expect(
      container.querySelector("[data-clearance-provenance]")
    ).toBeNull();
    // The row itself still renders normally.
    expect(
      container.querySelector("[data-gate-id='2aeadf7c-1111-2222-3333-444455556666']")
    ).not.toBeNull();
  });

  it("renders the gate-class chip when gate_class is set", () => {
    const { container } = renderPanel([
      gateRow({ gate_class: "security-surface" }),
    ]);
    const chip = container.querySelector("[data-gate-class]");
    expect(chip?.textContent).toBe("security-surface");
  });

  it("renders a withdrawn verdict with its own label and the failed (destructive) tone", () => {
    renderPanel([gateRow({ verdict: "withdrawn" })]);
    const badge = screen.getByText("withdrawn");
    // Same destructive tone as `failed`, but the label stays `withdrawn`.
    expect(badge.className).toContain("destructive");
  });

  it("renders the clearance-provenance segment when coord stamps the columns", () => {
    const { container } = renderPanel([
      gateRow({
        verdict: "cleared",
        cleared_via: "agent_attest",
        cleared_by_agent_id: "6f2a91c3-0000-0000-0000-000000000001",
        cleared_by_device_id: "1b2c3d4e-0000-0000-0000-000000000002",
        cleared_under_rule: "9e8d7c6b-0000-0000-0000-000000000003",
      }),
    ]);
    expect(
      container.querySelector("[data-clearance-provenance]")?.textContent
    ).toBe("attested by agent 6f2a91c3 on 1b2c3d4e under rule 9e8d7c6b");
  });
});
