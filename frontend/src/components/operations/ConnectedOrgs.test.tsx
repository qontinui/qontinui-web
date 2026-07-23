/**
 * Tests for the "Enroll / Sync repositories" button on the Connected
 * Organizations card (plan `2026-07-19-web-onboarding-enroll-now-button`).
 *
 * Under test:
 *   - the button label reflects enrollment state — "Enroll repositories"
 *     (primary) for an org with 0 repos, "Sync repositories" (ghost) for an
 *     already-enrolled org;
 *   - clicking POSTs to the installation enroll proxy with `maxRetries: 0`
 *     (a GitHub-fanning write must never be silently retried);
 *   - coord's `202 {enrolled:"spawned"}` (no repos array) starts a poll of the
 *     accounts endpoint, and once a re-poll returns repos they render;
 *   - the error branch maps coord's status onto human copy for 403 / 404.
 *
 * Mirrors the mocked-`httpClient` pattern in `MergeOrchestrationOnboarding.test.tsx`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const getMock = vi.fn();
const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => getMock(...args),
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

import { ConnectedOrgs } from "./ConnectedOrgs";

const EMPTY_ORG = {
  account_login: "acme",
  account_type: "Organization",
  installation_id: 111,
  repos: [],
};

const ENROLLED_ORG = {
  account_login: "portofino",
  account_type: "Organization",
  installation_id: 222,
  repos: [{ repo: "portofino/web", rollout_state: "dry_run", profile_source: "auto" }],
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("<ConnectedOrgs> enroll/sync button", () => {
  beforeEach(() => {
    getMock.mockReset();
    fetchMock.mockReset();
  });

  it("labels the button by enrollment state (Enroll vs Sync)", async () => {
    getMock.mockResolvedValue({ accounts: [EMPTY_ORG, ENROLLED_ORG] });
    render(<ConnectedOrgs />);

    const enrollBtn = await screen.findByTestId("enroll-repos-acme");
    expect(enrollBtn.textContent).toBe("Enroll repositories");

    const syncBtn = screen.getByTestId("enroll-repos-portofino");
    expect(syncBtn.textContent).toBe("Sync repositories");
  });

  it("POSTs to the installation enroll proxy with maxRetries: 0", async () => {
    getMock.mockResolvedValue({ accounts: [EMPTY_ORG] });
    fetchMock.mockResolvedValue(jsonResponse({ enrolled: "spawned" }, 202));
    render(<ConnectedOrgs />);

    const btn = await screen.findByTestId("enroll-repos-acme");
    fireEvent.click(btn);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, opts] = fetchMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toContain("/pr-merge/onboarding/installations/111/enroll");
    expect(opts.method).toBe("POST");
    expect(opts.maxRetries).toBe(0);
  });

  it("202 spawn starts the poll and renders repos when they appear", async () => {
    vi.useFakeTimers();
    try {
      getMock
        .mockResolvedValueOnce({ accounts: [EMPTY_ORG] }) // mount
        .mockResolvedValue({
          accounts: [
            {
              ...EMPTY_ORG,
              repos: [
                { repo: "acme/web", rollout_state: "dry_run", profile_source: "auto" },
              ],
            },
          ],
        }); // subsequent polls
      fetchMock.mockResolvedValue(jsonResponse({ enrolled: "spawned" }, 202));
      render(<ConnectedOrgs />);

      // Flush the mount fetch.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      const btn = screen.getByTestId("enroll-repos-acme");
      fireEvent.click(btn);

      // Flush the enroll POST promise (installs the poll interval + status msg).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByTestId("enroll-status-acme").textContent).toContain(
        "Enrolling repositories"
      );

      // Advance one poll tick → refetch → repos now present → they render.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(screen.getByTestId("connected-org-repo-acme/web")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("maps a 403 to the admin-required copy", async () => {
    getMock.mockResolvedValue({ accounts: [EMPTY_ORG] });
    fetchMock.mockResolvedValue(
      jsonResponse({ error: "installation_not_owned_by_tenant" }, 403)
    );
    render(<ConnectedOrgs />);

    const btn = await screen.findByTestId("enroll-repos-acme");
    fireEvent.click(btn);

    const err = await screen.findByTestId("enroll-error-acme");
    expect(err.textContent).toContain("admin of the tenant");
  });

  it("maps a 404 to the connect-first copy", async () => {
    getMock.mockResolvedValue({ accounts: [EMPTY_ORG] });
    fetchMock.mockResolvedValue(
      jsonResponse({ error: "installation_not_mapped" }, 404)
    );
    render(<ConnectedOrgs />);

    const btn = await screen.findByTestId("enroll-repos-acme");
    fireEvent.click(btn);

    const err = await screen.findByTestId("enroll-error-acme");
    expect(err.textContent).toContain("Connect this organization first");
  });
});
