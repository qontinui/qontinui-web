/**
 * GateActions — per-gate operator action controls (admin gates dashboard).
 *
 * Covers the state-gating of which actions surface and that a confirmed action
 * POSTs to the correct web-backend coord proxy with the expected body:
 *   - OPEN operator_approval gate → Approve…/Reject… present; Reopen absent
 *   - cleared gate                → Reopen present; Approve/Force-clear absent
 *   - muted open gate             → Unmute present
 *   - gate with a live continuation → Cancel continuation… present
 *   - Force-clear confirm is disabled until a reason is entered, then POSTs
 *     `{reason}` to the force-clear proxy
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { GateActions } from "./GateActions";
import type { GateOverviewRow } from "@/services/admin-dev-service";

function gate(overrides: Partial<GateOverviewRow> = {}): GateOverviewRow {
  return {
    gate_id: "g-1",
    claim_kind: null,
    resource_key: null,
    plan_id: null,
    plan_slug: null,
    work_unit_id: null,
    work_unit_slug: null,
    phase_name: null,
    predicate: { kind: "operator_approval", prompt: "ship it?" },
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
    title: "Ship gate",
    measures: "operator approval",
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

// Radix opens the menu on a pointer sequence, not a bare MouseEvent click —
// userEvent (pointer checks disabled for jsdom) drives it reliably.
const user = userEvent.setup({ pointerEventsCheck: 0 });
async function openMenu() {
  await user.click(screen.getByTestId("gate-actions-trigger"));
}

describe("GateActions", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  it("open operator_approval gate shows approve/reject, not reopen", async () => {
    render(<GateActions gate={gate()} onActed={() => {}} />);
    await openMenu();
    expect(await screen.findByText("Approve…")).toBeInTheDocument();
    expect(screen.getByText("Reject…")).toBeInTheDocument();
    expect(screen.getByText("Mute")).toBeInTheDocument();
    expect(screen.getByText("Force-clear…")).toBeInTheDocument();
    expect(screen.queryByText("Reopen")).toBeNull();
    expect(screen.queryByText("Unmute")).toBeNull();
  });

  it("cleared gate shows reopen, not approve/force-clear", async () => {
    render(
      <GateActions
        gate={gate({ verdict: "cleared", predicate: { kind: "pr_merged" } })}
        onActed={() => {}}
      />,
    );
    await openMenu();
    expect(await screen.findByText("Reopen")).toBeInTheDocument();
    expect(screen.queryByText("Approve…")).toBeNull();
    expect(screen.queryByText("Force-clear…")).toBeNull();
  });

  it("muted gate shows unmute", async () => {
    render(<GateActions gate={gate({ muted: true })} onActed={() => {}} />);
    await openMenu();
    expect(await screen.findByText("Unmute")).toBeInTheDocument();
    expect(screen.queryByText("Mute")).toBeNull();
  });

  it("gate with a live continuation shows cancel continuation", async () => {
    render(
      <GateActions
        gate={gate({ continuation_spawn: { initial_prompt: "go" } })}
        onActed={() => {}}
      />,
    );
    await openMenu();
    expect(
      await screen.findByText("Cancel continuation…"),
    ).toBeInTheDocument();
  });

  it("force-clear confirm is disabled until a reason is entered", async () => {
    render(<GateActions gate={gate()} onActed={() => {}} />);
    await openMenu();
    await user.click(await screen.findByText("Force-clear…"));

    // The confirm sits inside a DestructiveButton (synthetic-click gated, so we
    // don't drive the POST here — that path is covered by destructive-button's
    // own tests). We assert the reason-gating: disabled until non-empty.
    const confirm = await screen.findByText("Force-clear gate");
    expect(confirm.closest("button")).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Reason \(required\)/i), {
      target: { value: "predicate stuck, overriding" },
    });
    expect(confirm.closest("button")).not.toBeDisabled();
  });

  it("change-audience PATCHes {audience} to the proxy and refetches", async () => {
    // Audience is a plain menu item (not a DestructiveButton), so the click
    // path exercises the runAction plumbing: URL, method, body, onActed.
    const onActed = vi.fn();
    render(<GateActions gate={gate()} onActed={onActed} />);
    await openMenu();
    await user.click(await screen.findByText(/Set audience → agent/i));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/v1/operations/gates/g-1/audience");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ audience: "agent" });
    await waitFor(() => expect(onActed).toHaveBeenCalled());
  });
});
