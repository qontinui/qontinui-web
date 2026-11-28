/**
 * "Register decision gate" (project Overview plan Phase 8).
 *
 * - derived-only: the dialog's one write is `POST /operations/gates/decision`;
 *   it calls nothing on the overview, and the decision itself stays with the
 *   existing approve / reject / reopen controls (asserted at the source of
 *   `GateActions.tsx`).
 * - tenant / unknown: coord's refusal is shown verbatim and nothing is
 *   reported as registered; the body carries no `gate_class`.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import {
  RegisterDecisionGateDialog,
  registrationNotice,
} from "./RegisterDecisionGateDialog";

function fill(testid: string, value: string) {
  fireEvent.change(screen.getByTestId(testid), { target: { value } });
}

function fillAll() {
  fill("gates-register-decision-unit", " my-plan ");
  fill("gates-register-decision-phase", "Customer showing accepted");
  fill("gates-register-decision-prompt", "Accepted?");
}

describe("RegisterDecisionGateDialog", () => {
  beforeEach(() => fetchMock.mockReset());

  it("posts the form to /gates/decision, and only there", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ gate_id: "g1", initial_verdict: "open" }), {
        status: 200,
      })
    );
    const onRegistered = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <RegisterDecisionGateDialog
        open
        onOpenChange={onOpenChange}
        onRegistered={onRegistered}
      />
    );
    const submit = screen.getByTestId("gates-register-decision-submit");
    expect(submit).toBeDisabled();
    fillAll();
    fill("gates-register-decision-audience", "agent");
    fireEvent.click(submit);

    await waitFor(() => expect(onRegistered).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/operations/gates/decision");
    expect(init.method).toBe("POST");
    expect(init.idempotent).toBe(false);
    expect(JSON.parse(init.body)).toEqual({
      work_unit_slug: "my-plan",
      phase_name: "Customer showing accepted",
      prompt: "Accepted?",
      clearance_audience: "agent",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows coord's refusal and registers nothing", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: "work_unit_not_in_tenant",
          message: "that unit belongs to another tenant",
        }),
        { status: 403 }
      )
    );
    const onRegistered = vi.fn();
    render(
      <RegisterDecisionGateDialog
        open
        onOpenChange={vi.fn()}
        onRegistered={onRegistered}
      />
    );
    fillAll();
    fireEvent.click(screen.getByTestId("gates-register-decision-submit"));
    const err = await screen.findByTestId("gates-register-decision-error");
    expect(err.textContent ?? "").toContain("another tenant");
    expect(onRegistered).not.toHaveBeenCalled();
  });

  it("leaves the decision to the existing approve/reject/reopen controls", () => {
    const actions = readFileSync(join(__dirname, "GateActions.tsx"), "utf8");
    expect(actions).toMatch(/approveGate/);
    expect(actions).toMatch(/rejectGate/);
    expect(actions).toMatch(/reopenGate/);
    const dialog = readFileSync(
      join(__dirname, "RegisterDecisionGateDialog.tsx"),
      "utf8"
    );
    expect(dialog).not.toMatch(/api\/v1\/overview/);
    expect(dialog).not.toMatch(/gate_class/);
  });

  it.each([
    [{ gate_id: "g", initial_verdict: "open" }, false],
    [
      { gate_id: "g", initial_verdict: "open", warnings: ["class not stored"] },
      true,
    ],
    [{ gate_id: "g" }, true],
    [{ gate_id: "g", initial_verdict: null }, true],
    [{ gate_id: "g", initial_verdict: "cleared" }, true],
    [{ gate_id: "g", initial_verdict: "misconfigured" }, true],
  ])(
    "only an open verdict with no warnings is a plain success: %j",
    (o, has) => {
      expect(registrationNotice(o) !== null).toBe(has);
    }
  );

  it("keeps the dialog open and shows coord's warnings when the gate is not plainly armed", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          gate_id: "g2",
          initial_verdict: "open",
          warnings: ["requested gate_class was not stored"],
        }),
        { status: 200 }
      )
    );
    const onRegistered = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <RegisterDecisionGateDialog
        open
        onOpenChange={onOpenChange}
        onRegistered={onRegistered}
      />
    );
    fillAll();
    fireEvent.click(screen.getByTestId("gates-register-decision-submit"));
    const notice = await screen.findByTestId("gates-register-decision-notice");
    expect(notice.textContent ?? "").toContain("was not stored");
    expect(notice.textContent ?? "").toContain("g2");
    expect(onRegistered).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("says UNKNOWN, not armed, when coord reports no verdict", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ gate_id: "g3" }), { status: 200 })
    );
    render(
      <RegisterDecisionGateDialog
        open
        onOpenChange={vi.fn()}
        onRegistered={vi.fn()}
      />
    );
    fillAll();
    fireEvent.click(screen.getByTestId("gates-register-decision-submit"));
    const notice = await screen.findByTestId("gates-register-decision-notice");
    expect(notice.textContent ?? "").toContain("did not report");
  });
});
