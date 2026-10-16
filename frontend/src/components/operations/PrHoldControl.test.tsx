/**
 * PrHoldControl — the shared operator hold / release control (plan
 * `2026-10-04-coord-pr-hold-without-github-drafts`, Phase 4).
 *
 * The contracts both consuming surfaces depend on:
 *   1. An UNKNOWN hold (failed read, or an older coord with no `hold` key)
 *      renders amber `–`, never "not held".
 *   2. Hold REQUIRES a reason — the confirm is disabled until one is typed,
 *      and the reason reaches the wire.
 *   3. Release confirms first, and another tenant's hold offers no Release.
 *   4. Errors are honest — coord's `{error, message}` reaches the toast.
 *   5. Non-admins see no actions (hidden, not disabled).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  }),
}));

const authState = { isCoordAdmin: true };
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: authState.isCoordAdmin }),
}));

import { PrHoldControl } from "./PrHoldControl";
import type { PrHoldFields } from "./prHold";

const HELD: PrHoldFields = {
  hold: {
    held_by: "agent:5f1c0000-0000-4000-8000-000000000000",
    reason: "waiting on web#1680 to deploy",
    kind: "migration_order",
    since: "2026-10-16T12:00:00Z",
  },
};

function renderControl(
  overrides: Partial<React.ComponentProps<typeof PrHoldControl>> = {}
) {
  const onActed = vi.fn();
  render(
    <PrHoldControl
      repo="qontinui/qontinui-coord"
      prNumber={900}
      prState="open"
      hold={{ hold: null }}
      hasActiveProposal={false}
      onActed={onActed}
      {...overrides}
    />
  );
  return { onActed };
}

function errorResponse(status: number, body: unknown): Response {
  return {
    ok: false,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  authState.isCoordAdmin = true;
});

describe("PrHoldControl", () => {
  describe("hold state", () => {
    it("renders amber '–' and no 'not held' claim when the read failed", () => {
      renderControl({ hold: { hold: null, hold_unknown: true } });
      const dash = screen.getByTestId("pr-hold-unknown");
      expect(dash.textContent).toBe("–");
      expect(dash.className).toContain("amber");
      // Holding is still safe to offer; releasing is not.
      expect(screen.getByTestId("pr-hold-place")).toBeInTheDocument();
      expect(screen.queryByTestId("pr-hold-release")).not.toBeInTheDocument();
    });

    it("treats an absent `hold` key as UNKNOWN (an older coord)", () => {
      renderControl({ hold: {} });
      expect(screen.getByTestId("pr-hold-unknown")).toBeInTheDocument();
    });

    it("shows holder, kind, reason and age on a held PR", () => {
      renderControl({ hold: HELD });
      const summary = screen.getByTestId("pr-hold-summary");
      expect(summary.textContent).toContain("agent 5f1c0000");
      expect(summary.textContent).toContain("waiting on a migration");
      expect(summary.textContent).toContain("waiting on web#1680 to deploy");
      expect(screen.getByTestId("pr-hold-release")).toBeInTheDocument();
      expect(screen.queryByTestId("pr-hold-place")).not.toBeInTheDocument();
    });

    it("offers no Release for another tenant's hold, and shows no reason", () => {
      renderControl({
        hold: {
          hold: {
            held_by: "another_tenant",
            reason: "",
            kind: "",
            since: null,
          },
        },
      });
      expect(screen.getByTestId("pr-hold-summary").textContent).toContain(
        "another tenant"
      );
      expect(screen.queryByTestId("pr-hold-release")).not.toBeInTheDocument();
      expect(screen.queryByTestId("pr-hold-place")).not.toBeInTheDocument();
    });

    it("renders nothing for a merged PR or a branch-only row", () => {
      const { container } = render(
        <PrHoldControl
          repo="qontinui/qontinui-coord"
          prNumber={900}
          prState="merged"
          hold={{ hold: null }}
          hasActiveProposal={false}
        />
      );
      expect(container).toBeEmptyDOMElement();
      const { container: c2 } = render(
        <PrHoldControl
          repo="qontinui/qontinui-coord"
          prNumber={null}
          prState="open"
          hold={{ hold: null }}
          hasActiveProposal={false}
        />
      );
      expect(c2).toBeEmptyDOMElement();
    });
  });

  describe("placing a hold", () => {
    it("requires a reason and sends it", async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
      const { onActed } = renderControl();

      fireEvent.click(screen.getByTestId("pr-hold-place"));
      const confirm = screen.getByTestId("pr-hold-place-confirm");
      expect(confirm).toBeDisabled();

      fireEvent.change(screen.getByTestId("pr-hold-reason"), {
        target: { value: "  waiting on review  " },
      });
      expect(confirm).not.toBeDisabled();
      fireEvent.click(confirm);

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const [url, init] = fetchMock.mock.calls[0] as [
        string,
        { method: string; body: string },
      ];
      expect(url).toContain("/prs/qontinui/qontinui-coord/900/hold");
      expect(JSON.parse(init.body)).toEqual({
        held: true,
        reason: "waiting on review",
      });
      await waitFor(() => expect(onActed).toHaveBeenCalled());
      expect(toastSuccess).toHaveBeenCalled();
    });

    it("warns about an in-flight merge attempt", () => {
      renderControl({ hasActiveProposal: true });
      fireEvent.click(screen.getByTestId("pr-hold-place"));
      expect(
        screen.getByText(/already in flight for this PR/)
      ).toBeInTheDocument();
    });
  });

  describe("releasing a hold", () => {
    it("confirms before releasing", async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
      renderControl({ hold: HELD });

      fireEvent.click(screen.getByTestId("pr-hold-release"));
      expect(fetchMock).not.toHaveBeenCalled();
      expect(screen.getByTestId("pr-hold-release-dialog")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("pr-hold-release-confirm"));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const init = fetchMock.mock.calls[0][1] as { body: string };
      expect(JSON.parse(init.body)).toEqual({ held: false });
    });

    it("surfaces coord's refusal code and message", async () => {
      fetchMock.mockResolvedValue(
        errorResponse(403, {
          error: "not_holder",
          message: "only the holder or an operator may release this hold",
        })
      );
      renderControl({ hold: HELD });
      fireEvent.click(screen.getByTestId("pr-hold-release"));
      fireEvent.click(screen.getByTestId("pr-hold-release-confirm"));

      await waitFor(() => expect(toastError).toHaveBeenCalled());
      const [title, opts] = toastError.mock.calls[0] as [
        string,
        { description: string },
      ];
      expect(title).toContain("#900");
      expect(opts.description).toContain("not_holder");
      expect(opts.description).toContain("only the holder");
    });
  });

  it("hides every action from a non-admin", () => {
    authState.isCoordAdmin = false;
    renderControl({ hold: HELD });
    expect(screen.queryByTestId("pr-hold-release")).not.toBeInTheDocument();
    // The hold itself is still shown: knowing a PR is held is not privileged.
    expect(screen.getByTestId("pr-hold-summary")).toBeInTheDocument();
  });
});
