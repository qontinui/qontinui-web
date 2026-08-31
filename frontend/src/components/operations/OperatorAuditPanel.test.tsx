import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const getMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => getMock(...args),
    post: vi.fn(),
    fetch: vi.fn(),
  },
}));

import { OperatorAuditPanel } from "./OperatorAuditPanel";
import { NIL_OPERATOR_ID, type AuditRow } from "./operatorAudit";

/**
 * The console view for `coord.operator_audit` — plan
 * `2026-08-20-fleet-page-runner-enable-disable-switch` Phase 5.
 *
 * The plan's gate is that a drain (Phase 1) and a label flip (Phase 4) are
 * both visible with the acting operator's identity. Phase 4 is blocked on a
 * GitHub App grant no agent can obtain, so the drain half is the one that can
 * be exercised here — with the nil-operator arm beside it, because the plan's
 * §7 warns that a silently-dropped audit row is the DEFAULT failure mode and
 * this view is the only place it becomes visible.
 */

const DRAIN_ROW: AuditRow = {
  audit_id: "aud-1",
  operator_id: "11111111-1111-1111-1111-111111111111",
  action: "fleet.drain.set",
  resource_kind: "coord.fleet_runtime_policy",
  resource_key: "drain:22222222-2222-2222-2222-222222222222",
  metadata: {
    device_id: "22222222-2222-2222-2222-222222222222",
    drained: true,
    until: "2026-09-01T12:00:00Z",
    reason: "clippy failing 2/2 on this host",
    version: 17,
  },
  occurred_at: "2026-08-31T12:00:00Z",
};

beforeEach(() => {
  getMock.mockReset();
  window.localStorage.clear();
});

async function openPanel() {
  render(<OperatorAuditPanel />);
  fireEvent.click(screen.getByRole("button", { name: /Operator audit/i }));
  await waitFor(() => expect(getMock).toHaveBeenCalled());
}

describe("the read", () => {
  it("asks coord for the fleet actions by default", async () => {
    getMock.mockResolvedValue({ audit: [DRAIN_ROW], count: 1 });
    await openPanel();
    const url = getMock.mock.calls[0]?.[0] as string;
    expect(url).toContain("/operations/coord/audit/recent");
    // `*` is a legal query character and `URLSearchParams` leaves it alone —
    // which matters, because coord's prefix grammar keys on the literal
    // trailing asterisk.
    expect(url).toContain("action=fleet.*");
    expect(url).toContain("limit=100");
  });

  it("re-reads when the filter widens", async () => {
    getMock.mockResolvedValue({ audit: [], count: 0 });
    await openPanel();
    getMock.mockClear();
    fireEvent.change(screen.getByTestId("operator-audit-filter"), {
      target: { value: "all" },
    });
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    expect(getMock.mock.calls[0]?.[0] as string).not.toContain("action=");
  });
});

describe("a drain is answerable — who, when, why, and how far", () => {
  it("shows the action, the operator, the reason and the blast radius", async () => {
    getMock.mockResolvedValue({ audit: [DRAIN_ROW], count: 1 });
    await openPanel();

    const row = await screen.findByTestId(`audit-row-${DRAIN_ROW.audit_id}`);
    expect(row.textContent).toContain("fleet.drain.set");
    fireEvent.click(screen.getByRole("button", { name: /fleet.drain.set/ }));

    const detail = await screen.findByTestId(
      `audit-detail-${DRAIN_ROW.audit_id}`
    );
    expect(detail.textContent).toContain(
      "11111111-1111-1111-1111-111111111111"
    );
    expect(detail.textContent).toContain("clippy failing 2/2 on this host");
    const blast = screen.getByTestId(`audit-blast-${DRAIN_ROW.audit_id}`);
    expect(blast.textContent).toContain("22222222-2222-2222-2222-222222222222");
    expect(blast.textContent).toContain("paused");
    expect(blast.textContent).toContain("2026-09-01T12:00:00Z");
  });

  it("calls out a nil operator instead of rendering it as a person", async () => {
    getMock.mockResolvedValue({
      audit: [{ ...DRAIN_ROW, operator_id: NIL_OPERATOR_ID }],
      count: 1,
    });
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: /fleet.drain.set/ }));
    const flagged = await screen.findByTestId("audit-nil-operator");
    expect(flagged.textContent).toMatch(/operator not recorded/);
  });
});

describe("the two refusals", () => {
  it("says a reach the writer did not compute is UNSTATED, not zero", async () => {
    getMock.mockResolvedValue({
      audit: [{ ...DRAIN_ROW, metadata: { reason: "because" } }],
      count: 1,
    });
    await openPanel();
    expect(screen.getByTestId("audit-blast-unstated")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /fleet.drain.set/ }));
    const blast = await screen.findByTestId(
      `audit-blast-${DRAIN_ROW.audit_id}`
    );
    expect(blast.textContent).toMatch(/unknown/);
    expect(blast.textContent).toMatch(/not zero/);
  });

  it("says a failed read is a failed read, not an empty trail", async () => {
    getMock.mockRejectedValue(new Error("GET failed: 403 - not_coord_admin"));
    await openPanel();
    const err = await screen.findByTestId("operator-audit-error");
    expect(err.textContent).toMatch(/could not read/);
    expect(err.textContent).toMatch(
      /says nothing about whether anyone changed/
    );
    expect(err.textContent).toContain("403");
  });

  it("an EMPTY feed says the read succeeded", async () => {
    getMock.mockResolvedValue({ audit: [], count: 0 });
    await openPanel();
    await waitFor(() =>
      expect(
        screen.getByText(/this is a measurement, not a failed look/i)
      ).toBeTruthy()
    );
  });
});
