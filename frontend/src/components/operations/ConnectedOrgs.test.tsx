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

// The Re-enroll action is admin-gated through `CoordAdminOnly`, which reads
// `useAuth().isCoordAdmin`. Hoisted so a test can flip it per case.
const authState = vi.hoisted(() => ({ isCoordAdmin: true }));
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: authState.isCoordAdmin }),
}));

import {
  ConnectedOrgs,
  mergePostureLabel,
  pollTimeoutMessage,
} from "./ConnectedOrgs";

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
  repos: [{ repo: "portofino/web", merge_enabled: false, profile_source: "auto" }],
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
    authState.isCoordAdmin = true;
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
                { repo: "acme/web", merge_enabled: null, profile_source: "auto" },
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

/**
 * P2 / P3 of plan
 * `2026-09-05-tenant-onboarding-friction-and-multi-tenant-device-visibility`:
 * the resolved merge posture is ALWAYS shown per enrolled row (the pin badge
 * stays as the secondary override indicator), un-enrolled tombstones render
 * greyed with who/when/why and an admin-gated Re-enroll, and the enroll poll's
 * timeout names the tombstoned repos instead of calling them slow.
 */
describe("<ConnectedOrgs> merge posture + tombstones", () => {
  beforeEach(() => {
    getMock.mockReset();
    fetchMock.mockReset();
    authState.isCoordAdmin = true;
  });

  const POSTURE_ORG = {
    account_login: "acme",
    account_type: "Organization",
    installation_id: 111,
    repos: [
      {
        repo: "acme/default",
        state: "enrolled",
        merge_enabled: null,
        merge_enabled_resolved: true,
        merge_posture: "default",
        profile_source: "auto",
      },
      {
        repo: "acme/pinned-on",
        state: "enrolled",
        merge_enabled: true,
        merge_enabled_resolved: true,
        merge_posture: "pinned_on",
        profile_source: "auto",
      },
      {
        repo: "acme/pinned-off",
        state: "enrolled",
        merge_enabled: false,
        merge_enabled_resolved: false,
        merge_posture: "pinned_off",
        profile_source: "auto",
      },
      {
        repo: "acme/paused",
        state: "enrolled",
        merge_enabled: null,
        merge_enabled_resolved: false,
        merge_posture: "tenant_paused",
        profile_source: "auto",
      },
      {
        repo: "acme/automerge-off",
        state: "enrolled",
        merge_enabled: null,
        merge_enabled_resolved: false,
        merge_posture: "auto_merge_off",
        profile_source: "auto",
      },
      // Older coord: no posture fields at all.
      { repo: "acme/legacy", merge_enabled: null, profile_source: "auto" },
    ],
  };

  const TOMBSTONE_ORG = {
    account_login: "portofino",
    account_type: "Organization",
    installation_id: 222,
    repos: [
      {
        repo: "portofino/web",
        state: "enrolled",
        merge_enabled: null,
        merge_enabled_resolved: true,
        merge_posture: "default",
        profile_source: "auto",
      },
      {
        repo: "portofino/infra",
        state: "unenrolled",
        merge_enabled: null,
        merge_enabled_resolved: null,
        merge_posture: null,
        profile_source: null,
        unenrolled_at: "2026-09-01T09:00:00Z",
        unenrolled_by: "ops@example.com",
        unenroll_reason: "archived",
      },
    ],
  };

  it("labels every merge_posture value, and null as unknown", () => {
    expect(mergePostureLabel("default")).toBe("merge on (default)");
    expect(mergePostureLabel("pinned_on")).toBe("merge on (pinned)");
    expect(mergePostureLabel("pinned_off")).toBe("merge off (pinned)");
    expect(mergePostureLabel("tenant_paused")).toBe("merge paused (tenant)");
    expect(mergePostureLabel("auto_merge_off")).toBe("auto-merge off (tenant)");
    expect(mergePostureLabel(null)).toBe("merge posture unknown");
    expect(mergePostureLabel(undefined)).toBe("merge posture unknown");
    expect(mergePostureLabel("something_new")).toBe("merge posture unknown");
  });

  it("renders an ALWAYS-present posture indicator per enrolled row, linked to merge settings", async () => {
    getMock.mockResolvedValue({ accounts: [POSTURE_ORG] });
    render(<ConnectedOrgs />);

    const expected: Record<string, string> = {
      "acme/default": "merge on (default)",
      "acme/pinned-on": "merge on (pinned)",
      "acme/pinned-off": "merge off (pinned)",
      "acme/paused": "merge paused (tenant)",
      "acme/automerge-off": "auto-merge off (tenant)",
      "acme/legacy": "merge posture unknown",
    };
    for (const [repo, label] of Object.entries(expected)) {
      const el = await screen.findByTestId(`merge-posture-${repo}`);
      expect(el).toHaveTextContent(label);
      expect(el).toHaveAttribute("href", "/admin/coord/merge-settings");
    }
  });

  it("keeps the raw pin badge as a SECOND indicator, only when a pin is set", async () => {
    getMock.mockResolvedValue({ accounts: [POSTURE_ORG] });
    render(<ConnectedOrgs />);

    await screen.findByTestId("merge-posture-acme/default");
    expect(screen.getByTestId("merge-pin-acme/pinned-on")).toHaveTextContent(
      "merge pinned on"
    );
    expect(screen.getByTestId("merge-pin-acme/pinned-off")).toHaveTextContent(
      "merge pinned off"
    );
    // Inheriting rows carry the posture badge and NO pin badge.
    expect(screen.queryByTestId("merge-pin-acme/default")).toBeNull();
    expect(screen.queryByTestId("merge-pin-acme/paused")).toBeNull();
    expect(screen.queryByTestId("merge-pin-acme/legacy")).toBeNull();
  });

  it("renders an un-enrolled row greyed with who/when/why and counts it separately", async () => {
    getMock.mockResolvedValue({ accounts: [TOMBSTONE_ORG] });
    render(<ConnectedOrgs />);

    const row = await screen.findByTestId(
      "connected-org-repo-unenrolled-portofino/infra"
    );
    expect(row).toHaveTextContent("portofino/infra");
    const detail = screen.getByTestId("unenrolled-detail-portofino/infra");
    expect(detail).toHaveTextContent(/^removed .* by ops@example\.com: archived$/);
    // Not a doctor link — the repo has no enrollment to inspect.
    expect(screen.queryByTestId("connected-org-repo-portofino/infra")).toBeNull();
    // It is not counted as enrolled.
    expect(
      screen.getByTestId("connected-org-repo-count-portofino")
    ).toHaveTextContent("1 repository enrolled");
    expect(
      screen.getByTestId("connected-org-unenrolled-count-portofino")
    ).toHaveTextContent("1 un-enrolled");
  });

  it("offers Re-enroll to a coord admin and hides it from everyone else", async () => {
    getMock.mockResolvedValue({ accounts: [TOMBSTONE_ORG] });
    const { unmount } = render(<ConnectedOrgs />);
    expect(
      await screen.findByTestId("reenroll-repo-portofino/infra")
    ).toBeInTheDocument();
    unmount();

    authState.isCoordAdmin = false;
    render(<ConnectedOrgs />);
    await screen.findByTestId("connected-org-repo-unenrolled-portofino/infra");
    expect(screen.queryByTestId("reenroll-repo-portofino/infra")).toBeNull();
  });

  it("Re-enroll POSTs the restore proxy and polls until the row flips to enrolled", async () => {
    vi.useFakeTimers();
    try {
      getMock
        .mockResolvedValueOnce({ accounts: [TOMBSTONE_ORG] }) // mount
        .mockResolvedValue({
          accounts: [
            {
              ...TOMBSTONE_ORG,
              repos: [
                TOMBSTONE_ORG.repos[0],
                {
                  repo: "portofino/infra",
                  state: "enrolled",
                  merge_enabled: null,
                  merge_enabled_resolved: true,
                  merge_posture: "default",
                  profile_source: "auto",
                },
              ],
            },
          ],
        });
      fetchMock.mockResolvedValue(
        jsonResponse(
          {
            restored: true,
            enrolled: "spawned",
            installation_id: 222,
            repo: "portofino/infra",
          },
          202
        )
      );
      render(<ConnectedOrgs />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      fireEvent.click(screen.getByTestId("reenroll-repo-portofino/infra"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchMock.mock.calls[0] as [string, Record<string, unknown>];
      expect(url).toContain("/pr-merge/onboarding/repos/portofino/infra/restore");
      expect(opts.method).toBe("POST");
      expect(opts.maxRetries).toBe(0);
      expect(screen.getByTestId("enroll-status-portofino").textContent).toContain(
        "Re-enrolling portofino/infra"
      );

      // One poll tick → the row is enrolled → the tombstone row is gone and
      // the repo is a doctor link again.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(screen.getByTestId("connected-org-repo-portofino/infra")).toBeTruthy();
      expect(
        screen.queryByTestId("connected-org-repo-unenrolled-portofino/infra")
      ).toBeNull();
      expect(screen.queryByTestId("enroll-status-portofino")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("maps the restore 404 onto copy that says whether the tombstone was cleared", async () => {
    getMock.mockResolvedValue({ accounts: [TOMBSTONE_ORG] });
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: "no_installation_for_owner", owner: "portofino", restored: true },
        404
      )
    );
    render(<ConnectedOrgs />);

    fireEvent.click(await screen.findByTestId("reenroll-repo-portofino/infra"));

    const err = await screen.findByTestId("enroll-error-portofino");
    expect(err.textContent).toContain("un-enrollment was cleared");
    expect(err.textContent).toContain("for portofino");
  });

  it("names the tombstoned repos when the enroll poll times out, instead of 'taking longer'", async () => {
    vi.useFakeTimers();
    try {
      // Every poll returns the same shape: the enrolled count never grows,
      // because the only repo left to enroll is the tombstoned one.
      getMock.mockResolvedValue({ accounts: [TOMBSTONE_ORG] });
      fetchMock.mockResolvedValue(jsonResponse({ enrolled: "spawned" }, 202));
      render(<ConnectedOrgs />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      fireEvent.click(screen.getByTestId("enroll-repos-portofino"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      // Run the poll to its cap (20 × 3s).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20 * 3000 + 10);
      });

      const status = screen.getByTestId("enroll-status-portofino");
      expect(status.textContent).toBe(
        "1 repository is deliberately un-enrolled (tombstoned) and was skipped — re-enroll them below."
      );
      expect(status.textContent).not.toContain("taking longer");
    } finally {
      vi.useRealTimers();
    }
  });

  it("pollTimeoutMessage keeps the old copy when nothing is tombstoned, and its own for a restore", () => {
    expect(pollTimeoutMessage("enroll", 0)).toBe(
      "Enrollment is taking longer than expected — refresh to check."
    );
    expect(pollTimeoutMessage("enroll", 2)).toBe(
      "2 repositories are deliberately un-enrolled (tombstoned) and were skipped — re-enroll them below."
    );
    expect(pollTimeoutMessage("restore", 2)).toBe(
      "Re-enroll is taking longer than expected — refresh to check."
    );
  });
});
