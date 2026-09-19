import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const getMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => getMock(...args),
    post: vi.fn(),
    fetch: vi.fn(),
  },
}));

// The feed is admin-gated; hoisted so a test can flip it per case.
const authState = vi.hoisted(() => ({
  isCoordAdmin: true,
  loading: false,
  user: { id: "u-1" } as { id: string } | null,
}));
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({
    isCoordAdmin: authState.isCoordAdmin,
    loading: authState.loading,
    user: authState.user,
  }),
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
  resource_key: "22222222-2222-2222-2222-222222222222",
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
  authState.isCoordAdmin = true;
  authState.loading = false;
  authState.user = { id: "u-1" };
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

  it("sends no resource_key until the search is applied", async () => {
    getMock.mockResolvedValue({ audit: [DRAIN_ROW], count: 1 });
    await openPanel();
    expect(getMock.mock.calls[0]?.[0] as string).not.toContain("resource_key=");
  });

  it("filters by resource_key on Apply, and stops on Clear", async () => {
    getMock.mockResolvedValue({ audit: [DRAIN_ROW], count: 1 });
    await openPanel();
    getMock.mockClear();

    fireEvent.change(screen.getByTestId("operator-audit-resource-key"), {
      target: { value: "22222222-2222-2222-2222-222222222222" },
    });
    fireEvent.click(screen.getByTestId("operator-audit-resource-key-apply"));
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    expect(getMock.mock.calls[0]?.[0] as string).toContain(
      "resource_key=22222222-2222-2222-2222-222222222222"
    );

    getMock.mockClear();
    fireEvent.click(screen.getByTestId("operator-audit-resource-key-clear"));
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    expect(getMock.mock.calls[0]?.[0] as string).not.toContain("resource_key=");
  });
});

describe("authorization-check noise", () => {
  const NOISE_ROW: AuditRow = {
    audit_id: "aud-noise",
    operator_id: "11111111-1111-1111-1111-111111111111",
    action: "rbac.allow",
    resource_kind: "http.route",
    resource_key: "GET /admin/coord/audit/recent",
    metadata: { method: "GET" },
    occurred_at: "2026-08-31T12:05:00Z",
  };

  it("hides require_role rows by default, and counts them rather than dropping them silently", async () => {
    getMock.mockResolvedValue({ audit: [DRAIN_ROW, NOISE_ROW], count: 2 });
    await openPanel();

    expect(
      await screen.findByTestId(`audit-row-${DRAIN_ROW.audit_id}`)
    ).toBeTruthy();
    expect(screen.queryByTestId(`audit-row-${NOISE_ROW.audit_id}`)).toBeNull();
    expect(screen.getByText(/1 hidden/)).toBeTruthy();
  });

  it("shows them again when the toggle is switched off", async () => {
    getMock.mockResolvedValue({ audit: [DRAIN_ROW, NOISE_ROW], count: 2 });
    await openPanel();
    await screen.findByTestId(`audit-row-${DRAIN_ROW.audit_id}`);

    fireEvent.click(screen.getByTestId("operator-audit-hide-auth-checks"));
    expect(
      await screen.findByTestId(`audit-row-${NOISE_ROW.audit_id}`)
    ).toBeTruthy();
  });

  it("says so, rather than rendering a bare empty state, when every row in the window is noise", async () => {
    getMock.mockResolvedValue({ audit: [NOISE_ROW], count: 1 });
    await openPanel();
    const hidden = await screen.findByTestId("operator-audit-all-hidden");
    expect(hidden.textContent).toMatch(/authorization checks/);
  });
});

describe("a drain is answerable — who, when, why, and how far", () => {
  it("shows the action, the operator, the reason and the blast radius", async () => {
    getMock.mockResolvedValue({ audit: [DRAIN_ROW], count: 1 });
    await openPanel();

    const row = await screen.findByTestId(`audit-row-${DRAIN_ROW.audit_id}`);
    // R8 — the LABEL reaches the screen, the enum reaches a data attribute.
    expect(row.textContent).toContain("Drained a machine");
    expect(
      row
        .querySelector("[data-audit-action]")
        ?.getAttribute("data-audit-action")
    ).toBe("fleet.drain.set");
    fireEvent.click(screen.getByRole("button", { name: /Drained a machine/ }));

    const detail = await screen.findByTestId(
      `audit-detail-${DRAIN_ROW.audit_id}`
    );
    expect(detail.textContent).toContain(
      "11111111-1111-1111-1111-111111111111"
    );
    expect(detail.textContent).toContain("clippy failing 2/2 on this host");
    const blast = screen.getByTestId(`audit-blast-${DRAIN_ROW.audit_id}`);
    expect(blast.textContent).toContain("22222222-2222-2222-2222-222222222222");
    expect(blast.textContent).toContain("drained");
    expect(blast.textContent).toContain("2026-09-01T12:00:00Z");
  });

  it("calls out a nil operator instead of rendering it as a person", async () => {
    getMock.mockResolvedValue({
      audit: [{ ...DRAIN_ROW, operator_id: NIL_OPERATOR_ID }],
      count: 1,
    });
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: /Drained a machine/ }));
    const flagged = await screen.findByTestId("audit-nil-operator");
    expect(flagged.textContent).toMatch(/operator not recorded/);
  });
});

describe("R8 — no internal vocabulary on the row", () => {
  it("renders an UNMAPPED action as its own id, not as a friendly placeholder", async () => {
    // The id is a real fact and a working filter term. "Unknown action" is
    // neither, and would hide the one string an operator could act on.
    getMock.mockResolvedValue({
      audit: [{ ...DRAIN_ROW, action: "fleet.something.new" }],
      count: 1,
    });
    await openPanel();
    const row = await screen.findByTestId(`audit-row-${DRAIN_ROW.audit_id}`);
    const identity = row.querySelector("[data-audit-action]");
    expect(identity?.textContent).toBe("fleet.something.new");
    expect(identity?.getAttribute("data-audit-action-mapped")).toBe("false");
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
    fireEvent.click(screen.getByRole("button", { name: /Drained a machine/ }));
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

  it("a body with NO `audit` key is unavailable, not an empty trail", async () => {
    // A response that never mentioned the feed stated nothing about it.
    getMock.mockResolvedValue({ count: 0 });
    await openPanel();
    const err = await screen.findByTestId("operator-audit-error");
    expect(err.textContent).toMatch(/stated\s+nothing about what was written/);
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

describe("OperatorAuditPanel — access and ordering", () => {
  it("issues no read for a non-admin, and says why rather than showing an error", async () => {
    authState.isCoordAdmin = false;
    render(<OperatorAuditPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Operator audit/i }));
    expect(screen.getByTestId("operator-audit-admin-only")).toBeTruthy();
    expect(screen.queryByTestId("operator-audit-error")).toBeNull();
    // Give any stray effect a turn to fire.
    await new Promise((r) => setTimeout(r, 0));
    expect(getMock).not.toHaveBeenCalled();
  });

  it("says nothing about access while the user is still loading", async () => {
    // `isCoordAdmin` reads false until the user loads; an admin must not be
    // told the feed is admin-only during that window, and no read is issued.
    authState.isCoordAdmin = false;
    authState.loading = true;
    authState.user = null;
    render(<OperatorAuditPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Operator audit/i }));
    expect(screen.queryByTestId("operator-audit-admin-only")).toBeNull();
    expect(screen.queryByTestId("operator-audit-error")).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(getMock).not.toHaveBeenCalled();
  });

  it("never lets an older, slower response overwrite a newer one", async () => {
    // First read hangs until released; the Refresh read answers immediately
    // with a DIFFERENT row, which must be what stays on screen.
    let releaseFirst: (v: unknown) => void = () => {};
    const NEWER: AuditRow = {
      ...DRAIN_ROW,
      audit_id: "aud-newer",
      action: "fleet.drain.clear",
    };
    getMock
      .mockImplementationOnce(
        () => new Promise((resolve) => (releaseFirst = resolve))
      )
      .mockResolvedValueOnce({ audit: [NEWER], count: 1 });
    await openPanel();
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId("operator-audit-refresh"));
    await waitFor(() =>
      expect(document.body.textContent).toContain("Undrained a machine")
    );
    // The stale first response now lands carrying another row; it must be
    // dropped, and the newer response's row must survive it.
    await act(async () => {
      releaseFirst({ audit: [DRAIN_ROW], count: 1 });
    });
    expect(document.body.textContent).toContain("Undrained a machine");
    expect(document.body.textContent).not.toContain("Drained a machine");
  });
});
