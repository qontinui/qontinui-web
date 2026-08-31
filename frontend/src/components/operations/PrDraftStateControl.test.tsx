/**
 * PrDraftStateControl — the shared operator draft/ready toggle.
 *
 * Covers the contracts the two consuming surfaces (`MergePipeline` on
 * `/admin/coord/fleet`, `PrsTable` on `/admin/coord/prs`) both depend on, and
 * specifically the three defects the extraction fixed:
 *
 *   1. Errors are HONEST — coord's `{error, message}` body reaches the toast,
 *      so the two distinct 404s and the 429's `retry_after_secs` are
 *      distinguishable. Asserting only "an error toast appeared" would pass
 *      against the pre-extraction code, so these assert on the text.
 *   2. Non-admins see NOTHING (the control is hidden, not disabled).
 *   3. Holding a PR with a LIVE merge proposal confirms first, because
 *      drafting does not stop that proposal.
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

import {
  PrDraftStateControl,
  describeDraftStateError,
  splitOwnerRepo,
} from "./PrDraftStateControl";

function renderControl(
  overrides: Partial<React.ComponentProps<typeof PrDraftStateControl>> = {}
) {
  const onActed = vi.fn();
  render(
    <PrDraftStateControl
      repo="qontinui/qontinui-web"
      prNumber={900}
      prState="open"
      hasActiveProposal={false}
      onActed={onActed}
      {...overrides}
    />
  );
  return { onActed };
}

/** A failed `httpClient.fetch` response carrying coord's JSON error body. */
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

describe("PrDraftStateControl", () => {
  describe("which control renders", () => {
    it("offers 'Ready for review' on a draft PR", () => {
      renderControl({ prState: "draft" });
      expect(screen.getByTestId("pr-ready-for-review")).toBeInTheDocument();
      expect(
        screen.queryByTestId("pr-convert-to-draft")
      ).not.toBeInTheDocument();
    });

    it("offers 'Convert to draft' on an open PR", () => {
      renderControl({ prState: "open" });
      expect(screen.getByTestId("pr-convert-to-draft")).toBeInTheDocument();
      expect(
        screen.queryByTestId("pr-ready-for-review")
      ).not.toBeInTheDocument();
    });

    it.each(["merged", "closed", "unknown", null, undefined])(
      "renders nothing for pr_state %s",
      (prState) => {
        renderControl({ prState: prState as string | null | undefined });
        expect(
          screen.queryByTestId("pr-convert-to-draft")
        ).not.toBeInTheDocument();
        expect(
          screen.queryByTestId("pr-ready-for-review")
        ).not.toBeInTheDocument();
      }
    );

    it("renders nothing without a PR number or a splittable repo", () => {
      renderControl({ prNumber: null });
      expect(
        screen.queryByTestId("pr-convert-to-draft")
      ).not.toBeInTheDocument();

      renderControl({ repo: "no-owner-here" });
      expect(
        screen.queryByTestId("pr-convert-to-draft")
      ).not.toBeInTheDocument();
    });

    // Defect 2: a Developer-tier member must not see a control the route 403s.
    it("renders nothing for a non-admin operator", () => {
      authState.isCoordAdmin = false;
      renderControl({ prState: "draft" });
      expect(
        screen.queryByTestId("pr-ready-for-review")
      ).not.toBeInTheDocument();
      renderControl({ prState: "open" });
      expect(
        screen.queryByTestId("pr-convert-to-draft")
      ).not.toBeInTheDocument();
    });
  });

  describe("direction asymmetry", () => {
    it("confirms the release-to-train consequence before undrafting", async () => {
      fetchMock.mockResolvedValue({ ok: true } as Response);
      const { onActed } = renderControl({ prState: "draft" });

      fireEvent.click(screen.getByTestId("pr-ready-for-review"));
      expect(fetchMock).not.toHaveBeenCalled();
      expect(
        screen.getByText(/coord will land it automatically/i)
      ).toBeInTheDocument();

      fireEvent.click(screen.getByText("Release to merge train"));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const [url, init] = fetchMock.mock.calls[0] as [
        string,
        { method: string; body: string },
      ];
      expect(url).toContain("/prs/qontinui/qontinui-web/900/draft-state");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual({ draft: false });
      await waitFor(() => expect(onActed).toHaveBeenCalledTimes(1));
    });

    it("holds in one click when no proposal is in flight", async () => {
      fetchMock.mockResolvedValue({ ok: true } as Response);
      renderControl({ prState: "open", hasActiveProposal: false });

      fireEvent.click(screen.getByTestId("pr-convert-to-draft"));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
      expect(JSON.parse(init.body)).toEqual({ draft: true });
      expect(
        screen.queryByTestId("pr-hold-hazard-dialog")
      ).not.toBeInTheDocument();
    });
  });

  // Defect 3: drafting does NOT cancel an already-cut merge proposal, so the
  // hold action must not imply "drafting = stop".
  describe("in-flight-proposal hazard", () => {
    it("warns before holding a PR that has a live proposal", async () => {
      fetchMock.mockResolvedValue({ ok: true } as Response);
      renderControl({ prState: "open", hasActiveProposal: true });

      fireEvent.click(screen.getByTestId("pr-convert-to-draft"));
      expect(fetchMock).not.toHaveBeenCalled();
      expect(screen.getByTestId("pr-hold-hazard-dialog")).toBeInTheDocument();
      expect(
        screen.getByText(/will not stop its merge attempt/i)
      ).toBeInTheDocument();

      fireEvent.click(screen.getByText("Convert to draft anyway"));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
      expect(JSON.parse(init.body)).toEqual({ draft: true });
    });
  });

  // Defect 1: the pre-extraction control toasted only `HTTP <status>`, which
  // makes the two 404s indistinguishable and drops the 429's retry hint.
  describe("error honesty", () => {
    it("distinguishes the two 404s", async () => {
      fetchMock.mockResolvedValue(
        errorResponse(404, {
          error: "pr_not_found",
          message: "PR #900 not found on qontinui/qontinui-web",
        })
      );
      renderControl({ prState: "open" });
      fireEvent.click(screen.getByTestId("pr-convert-to-draft"));
      await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
      const notFound = toastError.mock.calls[0][1] as { description: string };
      expect(notFound.description).toContain("pr_not_found");
      expect(notFound.description).toContain("not found on");

      toastError.mockReset();
      fetchMock.mockResolvedValue(
        errorResponse(404, {
          error: "repo_not_registered_to_tenant",
          message: "repo qontinui/other is not registered to your tenant",
        })
      );
      renderControl({ prState: "open" });
      fireEvent.click(screen.getAllByTestId("pr-convert-to-draft")[1]);
      await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
      const wrongTenant = toastError.mock.calls[0][1] as {
        description: string;
      };
      expect(wrongTenant.description).toContain(
        "repo_not_registered_to_tenant"
      );
      // The whole point: the two 404s must not read the same.
      expect(wrongTenant.description).not.toEqual(notFound.description);
    });

    it("surfaces retry_after_secs on a 429", async () => {
      fetchMock.mockResolvedValue(
        errorResponse(429, {
          error: "rate_limited",
          message: "draft-state rate limit reached",
          retry_after_secs: 42,
        })
      );
      renderControl({ prState: "open" });
      fireEvent.click(screen.getByTestId("pr-convert-to-draft"));
      await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
      const { description } = toastError.mock.calls[0][1] as {
        description: string;
      };
      expect(description).toContain("retry after 42s");
    });

    it("does not fire onActed on a failed flip", async () => {
      fetchMock.mockResolvedValue(errorResponse(403, { error: "forbidden" }));
      const { onActed } = renderControl({ prState: "open" });
      fireEvent.click(screen.getByTestId("pr-convert-to-draft"));
      await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
      expect(onActed).not.toHaveBeenCalled();
    });
  });

  describe("describeDraftStateError", () => {
    it("unwraps a body the proxy nested under `detail`", () => {
      expect(
        describeDraftStateError(
          404,
          JSON.stringify({ detail: { error: "pr_not_found", message: "nope" } })
        )
      ).toBe("HTTP 404 — pr_not_found — nope");
    });

    it("falls back to the raw body when it is not JSON", () => {
      expect(describeDraftStateError(502, "upstream exploded")).toBe(
        "HTTP 502 — upstream exploded"
      );
    });

    it("falls back to the bare status on an empty body", () => {
      expect(describeDraftStateError(500, "")).toBe("HTTP 500");
    });

    it("renders FastAPI's string-shaped detail", () => {
      expect(
        describeDraftStateError(400, JSON.stringify({ detail: "bad draft" }))
      ).toBe("HTTP 400 — bad draft");
    });
  });

  describe("splitOwnerRepo", () => {
    it.each([
      ["qontinui/qontinui-web", ["qontinui", "qontinui-web"]],
      ["a/b/c", ["a", "b/c"]],
    ])("splits %s", (input, expected) => {
      expect(splitOwnerRepo(input as string)).toEqual(expected);
    });

    it.each(["", "noslash", "/leading", "trailing/"])("rejects %s", (input) => {
      expect(splitOwnerRepo(input)).toBeNull();
    });
  });
});
