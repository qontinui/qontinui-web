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
 *   - the error branch maps coord's status onto human copy for 403 / 404;
 *   - "Stop governing" (plan
 *     `2026-11-08-coord-keeps-governing-repos-a-narrowed-installation-dropped`
 *     Phase 8): offered only to an administrator of the ACTIVE tenant and
 *     never while presenting; a reason is required; one DELETE carries it;
 *     a double-click sends one request; the read-back moves the row to the
 *     un-enrolled list, and a read-back that gives up says UNKNOWN; a refusal
 *     renders coord's code; the coverage principals render in words, with no
 *     Re-enroll and the App-access hint in its place. The derivations those
 *     flows render are enumerated in `ConnectedOrgsUnenroll.test.tsx`.
 *
 * Mirrors the mocked-`httpClient` pattern in `MergeOrchestrationOnboarding.test.tsx`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

// The accounts READ and the enroll/restore WRITES both go through
// `httpClient.fetch` (`lib/api/operations/prMergeOnboarding.ts`). The read is
// answered by `accountsMock` (its resolved value is the parsed body; a
// rejection is the transport failing) and kept out of `fetchMock`, so every
// `fetchMock` count below is a count of writes only.
const accountsMock = vi.fn();
const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: async (...args: unknown[]) => {
      if (String(args[0]).endsWith("/pr-merge/onboarding/accounts")) {
        const body: unknown = await accountsMock(...args);
        return new Response(JSON.stringify(body), { status: 200 });
      }
      return fetchMock(...args);
    },
  },
}));

// Re-enroll and Stop governing are gated on `isActiveTenantCoordAdmin`: the
// ACTIVE tenant's own `roles`, the `coord_is_admin` union only when those are
// absent, and a superuser always. So a test flips `tenantState` (the active
// tenant's roles) to change who is admin there, and `authState.user` to model
// "admin of SOME tenant" or staff. Hoisted so a test can flip them per case.
const authState = vi.hoisted(() => ({
  user: { is_superuser: false, coord_is_admin: true },
}));
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({
    user: authState.user,
    isCoordAdmin: authState.user.coord_is_admin,
  }),
}));

const tenantState = vi.hoisted(() => ({
  tenants: [] as { id: string; slug: string; name: string; roles?: string[] }[],
  activeTenantId: null as string | null,
}));
vi.mock("@/contexts/tenant-context", () => ({
  useTenant: () => ({
    tenants: tenantState.tenants,
    activeTenantId: tenantState.activeTenantId,
    isMultiTenant: tenantState.tenants.length > 1,
    loading: false,
    error: null,
    setActiveTenantId: () => undefined,
    refresh: async () => true,
  }),
}));

// The consent dialog's confirm is a `DestructiveButton`, which refuses
// untrusted clicks, and jsdom cannot produce a trusted one (`isTrusted` is
// non-configurable on real events). The gate itself is pinned in
// `components/ui/destructive-button.test.tsx`; here it is replaced so the flow
// past the confirm is testable at all — the stub the runners page test uses.
vi.mock("@/components/ui/destructive-button", () => ({
  isSyntheticClick: () => false,
  DestructiveButton: (props: Record<string, unknown>) => (
    <button type="button" {...props} />
  ),
}));

import { FixedPresentationMode } from "@/components/presentation";
import {
  ConnectedOrgs,
  groupBoundAway,
  mergePostureLabel,
  pollTimeoutMessage,
} from "./ConnectedOrgs";

/** The tenant the operator has selected in the sidebar. */
const ACTIVE_TENANT = {
  id: "6e00ba36-342e-4afd-b674-b34b559f85ce",
  slug: "whitespace-engine",
  name: "Whitespace engine",
};

/** Where the browser stores the sidebar's selection (`HttpClient` reads it). */
const ACTIVE_TENANT_KEY = "qontinui.active_tenant_id";

/**
 * The active tenant's roles; the user is admin of SOME tenant either way. The
 * browser's stored selection agrees with the page's, as `TenantProvider`
 * leaves it.
 */
function setActiveTenantRoles(roles: string[] | undefined): void {
  tenantState.tenants = [{ ...ACTIVE_TENANT, roles }];
  tenantState.activeTenantId = ACTIVE_TENANT.id;
  authState.user = { is_superuser: false, coord_is_admin: true };
  localStorage.setItem(ACTIVE_TENANT_KEY, ACTIVE_TENANT.id);
}

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
    accountsMock.mockReset();
    fetchMock.mockReset();
    setActiveTenantRoles(["admin"]);
  });

  it("labels the button by enrollment state (Enroll vs Sync)", async () => {
    accountsMock.mockResolvedValue({ accounts: [EMPTY_ORG, ENROLLED_ORG] });
    render(<ConnectedOrgs />);

    const enrollBtn = await screen.findByTestId("enroll-repos-acme");
    expect(enrollBtn.textContent).toBe("Enroll repositories");

    const syncBtn = screen.getByTestId("enroll-repos-portofino");
    expect(syncBtn.textContent).toBe("Sync repositories");
  });

  it("POSTs to the installation enroll proxy with maxRetries: 0", async () => {
    accountsMock.mockResolvedValue({ accounts: [EMPTY_ORG] });
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
      accountsMock
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
    accountsMock.mockResolvedValue({ accounts: [EMPTY_ORG] });
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
    accountsMock.mockResolvedValue({ accounts: [EMPTY_ORG] });
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
    accountsMock.mockReset();
    fetchMock.mockReset();
    setActiveTenantRoles(["admin"]);
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
    accountsMock.mockResolvedValue({ accounts: [POSTURE_ORG] });
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
    accountsMock.mockResolvedValue({ accounts: [POSTURE_ORG] });
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
    accountsMock.mockResolvedValue({ accounts: [TOMBSTONE_ORG] });
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

  it("offers Re-enroll to an administrator of the ACTIVE tenant, not to an admin of another", async () => {
    accountsMock.mockResolvedValue({ accounts: [TOMBSTONE_ORG] });
    const { unmount } = render(<ConnectedOrgs />);
    expect(
      await screen.findByTestId("reenroll-repo-portofino/infra")
    ).toBeInTheDocument();
    unmount();

    // Admin of SOME tenant (`coord_is_admin` stays true) but a developer in
    // the selected one: the restore route would refuse, so no control.
    setActiveTenantRoles(["developer"]);
    render(<ConnectedOrgs />);
    await screen.findByTestId("connected-org-repo-unenrolled-portofino/infra");
    expect(screen.queryByTestId("reenroll-repo-portofino/infra")).toBeNull();
  });

  it("Re-enroll POSTs the restore proxy and polls until the row flips to enrolled", async () => {
    vi.useFakeTimers();
    try {
      accountsMock
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
    accountsMock.mockResolvedValue({ accounts: [TOMBSTONE_ORG] });
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
      accountsMock.mockResolvedValue({ accounts: [TOMBSTONE_ORG] });
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

describe("<ConnectedOrgs> repos bound to another tenant", () => {
  const MERYTS_ORG = {
    account_login: "Meryts",
    account_type: "Organization",
    installation_id: 333,
    repos: [
      { repo: "Meryts/site", merge_enabled: null, profile_source: "auto" },
      {
        repo: "Meryts/bauhaus-b2b-shop",
        state: "unenrolled",
        merge_enabled: null,
        profile_source: null,
        unenrolled_at: "2026-10-01T09:00:00Z",
        unenrolled_by: "ops@example.com",
        unenroll_reason: "moved",
      },
    ],
  };
  const BOUND_AWAY = [
    {
      repo: "meryts/bauhaus-b2b-dev-notes",
      bound_tenant_id: "ce1ec20c-9cf1-427a-857d-81d6449cc6e4",
      bound_tenant_slug: "bauhaus-b2b",
    },
    {
      repo: "meryts/bauhaus-b2b-shop",
      bound_tenant_id: "ce1ec20c-9cf1-427a-857d-81d6449cc6e4",
      bound_tenant_slug: "bauhaus-b2b",
    },
  ];

  beforeEach(() => {
    accountsMock.mockReset();
    fetchMock.mockReset();
    setActiveTenantRoles(["admin"]);
  });

  it("renders bound-away repos under their org as 'bound to <slug>' with no Re-enroll", async () => {
    accountsMock.mockResolvedValue({
      accounts: [MERYTS_ORG],
      bound_away: BOUND_AWAY,
    });
    render(<ConnectedOrgs />);

    const devNotes = await screen.findByTestId(
      "connected-org-repo-bound-away-meryts/bauhaus-b2b-dev-notes"
    );
    expect(devNotes.textContent).toContain("bound to bauhaus-b2b");
    // The tombstoned row of a bound-away repo is the binding's, not a
    // Re-enroll candidate: it renders as bound away, once.
    expect(
      screen.getByTestId(
        "connected-org-repo-bound-away-meryts/bauhaus-b2b-shop"
      )
    ).toBeTruthy();
    expect(
      screen.queryByTestId("reenroll-repo-Meryts/bauhaus-b2b-shop")
    ).toBeNull();
    expect(
      screen.queryByTestId(
        "connected-org-repo-unenrolled-Meryts/bauhaus-b2b-shop"
      )
    ).toBeNull();
    // The org's own enrolled repo is untouched.
    expect(screen.getByTestId("connected-org-repo-Meryts/site")).toBeTruthy();
  });

  it("renders nothing new when coord does not send bound_away", async () => {
    accountsMock.mockResolvedValue({ accounts: [MERYTS_ORG] });
    render(<ConnectedOrgs />);

    await screen.findByTestId("connected-org-repo-Meryts/site");
    expect(screen.queryByText(/bound to/)).toBeNull();
    // Without the field, the tombstone keeps its Re-enroll as before.
    expect(
      screen.getByTestId("reenroll-repo-Meryts/bauhaus-b2b-shop")
    ).toBeTruthy();
  });

  it("says the bound-away repos are UNKNOWN when coord sends bindings_error", async () => {
    accountsMock.mockResolvedValue({
      accounts: [MERYTS_ORG],
      bindings_error: "the per-repo binding list could not be read",
    });
    render(<ConnectedOrgs />);

    const unknown = await screen.findByTestId(
      "connected-orgs-bindings-unknown"
    );
    expect(unknown.textContent).toContain("UNKNOWN");
    // coord's own reason travels in the title, not as wire jargon in the line.
    expect(unknown.getAttribute("title")).toBe(
      "the per-repo binding list could not be read"
    );
    // The accounts still render beside it.
    expect(screen.getByTestId("connected-org-repo-Meryts/site")).toBeTruthy();
  });

  it("a measured-empty bound_away is not UNKNOWN", async () => {
    accountsMock.mockResolvedValue({ accounts: [MERYTS_ORG], bound_away: [] });
    render(<ConnectedOrgs />);
    await screen.findByTestId("connected-org-repo-Meryts/site");
    expect(screen.queryByTestId("connected-orgs-bindings-unknown")).toBeNull();
  });

  it("an older coord that sends neither key says nothing about bindings", async () => {
    accountsMock.mockResolvedValue({ accounts: [MERYTS_ORG] });
    render(<ConnectedOrgs />);
    await screen.findByTestId("connected-org-repo-Meryts/site");
    expect(screen.queryByTestId("connected-orgs-bindings-unknown")).toBeNull();
  });

  it("renders a bound-away repo no listed org owns, beside the account list", async () => {
    const stray = {
      repo: "elsewhere/repo",
      bound_tenant_id: "t",
      bound_tenant_slug: "other",
    };
    accountsMock.mockResolvedValue({
      accounts: [MERYTS_ORG],
      bound_away: [stray],
    });
    render(<ConnectedOrgs />);

    const unmatched = await screen.findByTestId(
      "connected-orgs-bound-away-unmatched"
    );
    expect(unmatched.textContent).toContain("elsewhere/repo");
    expect(unmatched.textContent).toContain("bound to other");
    expect(screen.getByTestId("connected-org-repo-Meryts/site")).toBeTruthy();
  });

  it("renders unmatched bound-away repos when no organization is connected", async () => {
    accountsMock.mockResolvedValue({
      accounts: [],
      bound_away: [BOUND_AWAY[0]],
    });
    render(<ConnectedOrgs />);

    // The empty state still renders — and the bound-away row beside it.
    await screen.findByTestId("connected-orgs-empty");
    const unmatched = screen.getByTestId("connected-orgs-bound-away-unmatched");
    expect(
      unmatched.querySelector(
        '[data-testid="connected-org-repo-bound-away-meryts/bauhaus-b2b-dev-notes"]'
      )
    ).not.toBeNull();
    expect(
      screen.getByTestId("bound-away-tenant-meryts/bauhaus-b2b-dev-notes")
        .textContent
    ).toBe("bound to bauhaus-b2b");
  });

  it("re-reads in place when bindingsVersion changes, without a remount", async () => {
    accountsMock.mockResolvedValueOnce({ accounts: [MERYTS_ORG] });
    const { rerender } = render(<ConnectedOrgs bindingsVersion={0} />);
    await screen.findByTestId("connected-org-repo-Meryts/site");
    expect(accountsMock).toHaveBeenCalledTimes(1);
    // A re-render with the SAME version reads nothing.
    rerender(<ConnectedOrgs bindingsVersion={0} />);
    expect(accountsMock).toHaveBeenCalledTimes(1);

    const card = screen.getByTestId("connected-orgs");
    accountsMock.mockResolvedValueOnce({
      accounts: [MERYTS_ORG],
      bound_away: [BOUND_AWAY[0]],
    });
    rerender(<ConnectedOrgs bindingsVersion={1} />);

    await screen.findByTestId(
      "connected-org-repo-bound-away-meryts/bauhaus-b2b-dev-notes"
    );
    expect(accountsMock).toHaveBeenCalledTimes(2);
    // Same element: the card was re-read in place, not remounted.
    expect(screen.getByTestId("connected-orgs")).toBe(card);
  });

  it("groupBoundAway keeps a repo no listed org owns instead of dropping it", () => {
    const stray = {
      repo: "elsewhere/repo",
      bound_tenant_id: "t",
      bound_tenant_slug: "other",
    };
    const { byLogin, unmatched } = groupBoundAway(
      [...BOUND_AWAY, stray],
      [MERYTS_ORG]
    );
    expect(byLogin.get("meryts")?.map((b) => b.repo)).toEqual([
      "meryts/bauhaus-b2b-dev-notes",
      "meryts/bauhaus-b2b-shop",
    ]);
    expect(unmatched).toEqual([stray]);
  });
});

/**
 * "Stop governing" — plan
 * `2026-11-08-coord-keeps-governing-repos-a-narrowed-installation-dropped`
 * Phase 8. Every flow enters through the rendered card: the enrolled row's
 * control, the consent dialog, the DELETE on the wire (`fetchMock`), and the
 * accounts read-back (`accountsMock`).
 */
describe("<ConnectedOrgs> Stop governing (un-enroll)", () => {
  const OPERATOR = "operator:5f0c2a1e-0000-4000-8000-000000000001";

  const GOVERNED_ORG = {
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
    ],
  };

  /** What coord lists once the un-enrollment has landed. */
  const UNENROLLED_ORG = {
    ...GOVERNED_ORG,
    repos: [
      {
        repo: "portofino/web",
        state: "unenrolled",
        merge_enabled: null,
        merge_enabled_resolved: null,
        merge_posture: null,
        profile_source: null,
        unenrolled_at: "2026-11-08T17:00:00Z",
        unenrolled_by: OPERATOR,
        unenroll_reason: "archived",
      },
    ],
  };

  const COVERAGE_ORG = {
    account_login: "jspinak",
    account_type: "User",
    installation_id: 333,
    repos: [
      {
        repo: "jspinak/bdo",
        state: "unenrolled",
        merge_enabled: null,
        profile_source: null,
        unenrolled_at: "2026-11-05T10:52:28Z",
        unenrolled_by: "webhook:installation_repositories",
        unenroll_reason: "installation_repositories: removed",
      },
      {
        repo: "jspinak/brobot",
        state: "unenrolled",
        merge_enabled: null,
        profile_source: null,
        unenrolled_at: "2026-11-08T16:00:00Z",
        unenrolled_by: "reconcile:installation_coverage",
        unenroll_reason:
          "the GitHub App installation no longer covers this repository",
      },
      {
        repo: "jspinak/notes",
        state: "unenrolled",
        merge_enabled: null,
        profile_source: null,
        unenrolled_at: "2026-11-01T09:00:00Z",
        unenrolled_by: OPERATOR,
        unenroll_reason: "moved to a monorepo",
      },
    ],
  };

  /**
   * The web backend's own 504 for a write whose outcome is unknown, composed
   * by `http_exception_handler` (the shape `RepoTenantBindings.test.tsx`
   * pins): the legacy top level plus the refusal envelope.
   */
  function webRefusal(
    status: number,
    discriminator: string,
    code: string,
    detail: string
  ): Response {
    return jsonResponse(
      {
        error: status === 504 ? "GATEWAY_TIMEOUT" : "BAD_GATEWAY",
        message: detail,
        timestamp: 0,
        path: "/api/v1/operations/pr-merge/onboarding/repos/portofino/web",
        refusal: {
          code,
          discriminator,
          next_action: {
            kind: "retry_later",
            target:
              status === 504 ? "whether the change was applied" : undefined,
          },
          glossary_terms: ["coord"],
          detail,
          source: "web_backend",
          observed_at: "2026-11-08T17:00:00Z",
        },
      },
      status
    );
  }

  const noContent = () => new Response(null, { status: 204 });

  beforeEach(() => {
    accountsMock.mockReset();
    fetchMock.mockReset();
    setActiveTenantRoles(["admin"]);
  });

  /** Open the dialog on `repo`'s row and type `reason` into it. */
  async function openAndType(repo: string, reason: string) {
    fireEvent.click(await screen.findByTestId(`stop-governing-${repo}`));
    const dialog = await screen.findByTestId("stop-governing-dialog");
    fireEvent.change(within(dialog).getByTestId("stop-governing-reason"), {
      target: { value: reason },
    });
    return dialog;
  }

  const deleteCalls = () =>
    fetchMock.mock.calls.filter(
      (c) => (c[1] as { method?: string } | undefined)?.method === "DELETE"
    );

  it("offers Stop governing only to an administrator of the ACTIVE tenant", async () => {
    accountsMock.mockResolvedValue({ accounts: [GOVERNED_ORG] });
    const first = render(<ConnectedOrgs />);
    const control = await screen.findByTestId("stop-governing-portofino/web");
    expect(control).toHaveTextContent("Stop governing…");
    // Every enrolled row carries one, so its name says which repo it acts on.
    expect(control).toHaveAccessibleName("Stop governing portofino/web");
    first.unmount();

    // Admin of SOME tenant, but a developer in the selected one: the route's
    // `require_coord_tenant_admin_target` would refuse, so no control.
    setActiveTenantRoles(["developer"]);
    const second = render(<ConnectedOrgs />);
    await screen.findByTestId("connected-org-repo-portofino/web");
    expect(screen.queryByTestId("stop-governing-portofino/web")).toBeNull();
    second.unmount();

    // Staff pass the backend gate, so they get the control.
    setActiveTenantRoles(["developer"]);
    authState.user = { is_superuser: true, coord_is_admin: false };
    render(<ConnectedOrgs />);
    expect(
      await screen.findByTestId("stop-governing-portofino/web")
    ).toBeInTheDocument();
  });

  it("mounts no Stop governing and no Re-enroll while presenting, but keeps the App-access hint", async () => {
    accountsMock.mockResolvedValue({ accounts: [GOVERNED_ORG, COVERAGE_ORG] });
    render(
      <FixedPresentationMode presenting>
        <ConnectedOrgs />
      </FixedPresentationMode>
    );
    await screen.findByTestId("connected-org-repo-portofino/web");
    expect(screen.queryByTestId("stop-governing-portofino/web")).toBeNull();
    expect(screen.queryByTestId("reenroll-repo-jspinak/notes")).toBeNull();
    expect(
      screen.getByTestId("unenrolled-app-access-hint-jspinak/bdo")
    ).toBeInTheDocument();
  });

  it("requires a reason: the confirm stays disabled for an empty or blank one, and nothing is sent", async () => {
    accountsMock.mockResolvedValue({ accounts: [GOVERNED_ORG] });
    render(<ConnectedOrgs />);
    const dialog = await openAndType("portofino/web", "");
    const confirm = within(dialog).getByTestId("stop-governing-dialog-confirm");
    expect(confirm).toBeDisabled();

    const reason = within(dialog).getByTestId("stop-governing-reason");
    fireEvent.change(reason, { target: { value: "   \n " } });
    expect(confirm).toBeDisabled();
    fireEvent.blur(reason);
    expect(
      within(dialog).getByTestId("stop-governing-reason-error")
    ).toHaveTextContent("A reason is required.");
    fireEvent.click(confirm);
    expect(deleteCalls()).toHaveLength(0);

    // The cap is the proxy's, so a reason the browser lets through is never
    // refused for its length.
    expect(reason).toHaveAttribute("maxLength", "500");
  });

  it("names the repo and the selected project, and says what does not come back", async () => {
    accountsMock.mockResolvedValue({ accounts: [GOVERNED_ORG] });
    render(<ConnectedOrgs />);
    const dialog = await openAndType("portofino/web", "archived");
    expect(dialog).toHaveTextContent("Stop governing portofino/web?");
    expect(
      within(dialog).getByTestId("stop-governing-dialog-project")
    ).toHaveTextContent("Whitespace engine");
    expect(dialog).toHaveTextContent(
      "Re-adding it to the GitHub App does not bring it back."
    );
    expect(dialog).toHaveTextContent(
      "per-repository merge settings are deleted"
    );
  });

  it("sends ONE DELETE with the trimmed reason, then reads back until the row moves to the un-enrolled list", async () => {
    accountsMock
      .mockResolvedValueOnce({ accounts: [GOVERNED_ORG] }) // mount
      .mockResolvedValue({ accounts: [UNENROLLED_ORG] }); // read-back
    fetchMock.mockImplementation(async () => noContent());
    render(<ConnectedOrgs />);
    const dialog = await openAndType(
      "portofino/web",
      "  archived — the service moved  "
    );
    fireEvent.click(
      within(dialog).getByTestId("stop-governing-dialog-confirm")
    );

    const outcome = await screen.findByTestId("unenroll-outcome-portofino");
    await waitFor(() =>
      expect(outcome).toHaveAttribute("data-outcome", "done")
    );
    expect(outcome).toHaveTextContent(
      "Coord no longer governs portofino/web: it is listed below as un-enrolled. Re-enroll it there to undo."
    );

    expect(deleteCalls()).toHaveLength(1);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/pr-merge/onboarding/repos/portofino/web?reason=archived%20%E2%80%94%20the%20service%20moved",
      {
        method: "DELETE",
        idempotent: false,
        maxRetries: 0,
        // The project the dialog named, pinned — not read again at send time.
        headers: { "X-Qontinui-Active-Tenant": ACTIVE_TENANT.id },
      },
    ]);
    // The row moved: no doctor link, a tombstone row whose undo is beside it.
    expect(screen.queryByTestId("connected-org-repo-portofino/web")).toBeNull();
    expect(
      screen.getByTestId("connected-org-repo-unenrolled-portofino/web")
    ).toBeInTheDocument();
    expect(screen.getByTestId("reenroll-repo-portofino/web")).toBeEnabled();
    expect(screen.queryByTestId("stop-governing-dialog")).toBeNull();
  });

  it("a double-click on the confirm sends one DELETE, and the row's control is disabled while it is in flight", async () => {
    let release!: (r: Response) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((r) => {
          release = r;
        })
    );
    accountsMock
      .mockResolvedValueOnce({ accounts: [GOVERNED_ORG] })
      .mockResolvedValue({ accounts: [UNENROLLED_ORG] });
    render(<ConnectedOrgs />);
    const dialog = await openAndType("portofino/web", "archived");
    const confirm = within(dialog).getByTestId("stop-governing-dialog-confirm");
    // Both presses inside ONE act: the first press has not re-rendered
    // anything yet when the second lands.
    act(() => {
      confirm.click();
      confirm.click();
    });
    expect(deleteCalls()).toHaveLength(1);

    const control = screen.getByTestId("stop-governing-portofino/web");
    expect(control).toBeDisabled();
    expect(control).toHaveAttribute("aria-busy", "true");
    expect(control).toHaveTextContent("Stopping…");
    expect(control).toHaveAccessibleName(
      "Stopping governance of portofino/web"
    );
    expect(screen.getByTestId("unenroll-outcome-portofino")).toHaveAttribute(
      "data-outcome",
      "sending"
    );
    fireEvent.click(control);
    expect(screen.queryByTestId("stop-governing-dialog")).toBeNull();

    await act(async () => {
      release(noContent());
    });
    await waitFor(() =>
      expect(screen.getByTestId("unenroll-outcome-portofino")).toHaveAttribute(
        "data-outcome",
        "done"
      )
    );
    expect(deleteCalls()).toHaveLength(1);
  });

  it("refuses at confirm when another tab moved the browser's selected project, and sends nothing", async () => {
    accountsMock.mockResolvedValue({ accounts: [GOVERNED_ORG] });
    render(<ConnectedOrgs />);
    const dialog = await openAndType("portofino/web", "archived");
    // Another tab switched projects: the stored selection, which every other
    // request on this page carries, is no longer the project this page shows.
    localStorage.setItem(ACTIVE_TENANT_KEY, "another-project-id");
    fireEvent.click(
      within(dialog).getByTestId("stop-governing-dialog-confirm")
    );

    const moved = within(dialog).getByTestId(
      "stop-governing-dialog-project-moved"
    );
    expect(moved).toHaveAttribute("role", "alert");
    expect(moved).toHaveTextContent("Nothing was sent.");
    expect(deleteCalls()).toHaveLength(0);
    expect(screen.queryByTestId("unenroll-outcome-portofino")).toBeNull();

    // Back in agreement (the other tab switched back): the same dialog sends,
    // pinned to the project it names.
    fetchMock.mockImplementation(async () => noContent());
    localStorage.setItem(ACTIVE_TENANT_KEY, ACTIVE_TENANT.id);
    fireEvent.click(
      within(dialog).getByTestId("stop-governing-dialog-confirm")
    );
    await waitFor(() => expect(deleteCalls()).toHaveLength(1));
    expect(
      (deleteCalls()[0]![1] as { headers?: Record<string, string> }).headers
    ).toEqual({ "X-Qontinui-Active-Tenant": ACTIVE_TENANT.id });
  });

  it.each<[string, string | null]>([
    ["no selection", null],
    ["a blank selection", "   "],
  ])(
    "refuses while no project is selected (%s): says why, keeps the confirm disabled, and sends nothing until one is",
    async (_case, selection) => {
      // The project list has not loaded, as `TenantProvider` holds it then: the
      // page's selection is the stored one, absent or blank. With no active
      // tenant to read roles from, the control's gate falls back to
      // `coord_is_admin`, so the control still renders and the dialog opens.
      tenantState.tenants = [];
      tenantState.activeTenantId = selection;
      if (selection === null) localStorage.removeItem(ACTIVE_TENANT_KEY);
      else localStorage.setItem(ACTIVE_TENANT_KEY, selection);
      accountsMock.mockResolvedValue({ accounts: [GOVERNED_ORG] });
      const view = render(<ConnectedOrgs />);
      const dialog = await openAndType("portofino/web", "archived");

      const noProject = within(dialog).getByTestId(
        "stop-governing-dialog-no-project"
      );
      expect(noProject).toHaveAttribute("role", "alert");
      expect(noProject).toHaveTextContent("nothing can be sent");
      expect(
        within(dialog).getByTestId("stop-governing-dialog-project")
      ).toHaveTextContent("none selected");
      const confirm = within(dialog).getByTestId(
        "stop-governing-dialog-confirm"
      );
      expect(confirm).toBeDisabled();
      fireEvent.click(confirm);
      expect(deleteCalls()).toHaveLength(0);
      expect(screen.queryByTestId("unenroll-outcome-portofino")).toBeNull();

      // The list loads: the same dialog names the project and sends, pinned to it.
      setActiveTenantRoles(["admin"]);
      view.rerender(<ConnectedOrgs />);
      expect(
        within(dialog).queryByTestId("stop-governing-dialog-no-project")
      ).toBeNull();
      expect(
        within(dialog).getByTestId("stop-governing-dialog-project")
      ).toHaveTextContent("Whitespace engine");
      fetchMock.mockImplementation(async () => noContent());
      fireEvent.click(
        within(dialog).getByTestId("stop-governing-dialog-confirm")
      );
      await waitFor(() => expect(deleteCalls()).toHaveLength(1));
      expect(
        (deleteCalls()[0]![1] as { headers?: Record<string, string> }).headers
      ).toEqual({ "X-Qontinui-Active-Tenant": ACTIVE_TENANT.id });
    }
  );

  it("says UNKNOWN — never done — when the read-back gives up with the repo still listed as enrolled", async () => {
    vi.useFakeTimers();
    try {
      // Coord answers 204, yet every read still lists the repo as enrolled.
      accountsMock.mockResolvedValue({ accounts: [GOVERNED_ORG] });
      fetchMock.mockImplementation(async () => noContent());
      render(<ConnectedOrgs />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      fireEvent.click(screen.getByTestId("stop-governing-portofino/web"));
      fireEvent.change(screen.getByTestId("stop-governing-reason"), {
        target: { value: "archived" },
      });
      fireEvent.click(screen.getByTestId("stop-governing-dialog-confirm"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const outcome = screen.getByTestId("unenroll-outcome-portofino");
      expect(outcome).toHaveAttribute("data-outcome", "reading-back");

      // Run the read-back to its cap (20 × 3 s).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20 * 3000 + 10);
      });
      expect(outcome).toHaveAttribute("data-outcome", "unknown");
      expect(outcome).toHaveTextContent(
        "Whether coord stopped governing portofino/web is UNKNOWN: after 60 s of re-reading, coord still lists it as enrolled."
      );
      expect(outcome).not.toHaveTextContent("no longer governs");
      // The control is usable again, and only one DELETE was ever sent.
      expect(screen.getByTestId("stop-governing-portofino/web")).toBeEnabled();
      expect(deleteCalls()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a read-back whose re-reads fail ends in UNKNOWN, and the card keeps its list instead of an error line", async () => {
    vi.useFakeTimers();
    try {
      accountsMock
        .mockResolvedValueOnce({ accounts: [GOVERNED_ORG] }) // mount
        .mockRejectedValue(new TypeError("Failed to fetch")); // read-back
      fetchMock.mockImplementation(async () => noContent());
      render(<ConnectedOrgs />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      fireEvent.click(screen.getByTestId("stop-governing-portofino/web"));
      fireEvent.change(screen.getByTestId("stop-governing-reason"), {
        target: { value: "archived" },
      });
      fireEvent.click(screen.getByTestId("stop-governing-dialog-confirm"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20 * 3000 + 10);
      });
      expect(screen.queryByTestId("connected-orgs-error")).toBeNull();
      const outcome = screen.getByTestId("unenroll-outcome-portofino");
      expect(outcome).toHaveAttribute("data-outcome", "unknown");
      expect(outcome).toHaveTextContent(
        "coord's repositories could not be re-read"
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders coord's refusal code with BackendErrorMessage, and starts no read-back", async () => {
    accountsMock.mockResolvedValue({ accounts: [GOVERNED_ORG] });
    fetchMock.mockImplementation(async () =>
      jsonResponse({ error: "strategy_admin_required" }, 403)
    );
    render(<ConnectedOrgs />);
    const dialog = await openAndType("portofino/web", "archived");
    fireEvent.click(
      within(dialog).getByTestId("stop-governing-dialog-confirm")
    );

    const outcome = await screen.findByTestId("unenroll-outcome-portofino");
    await waitFor(() =>
      expect(outcome).toHaveAttribute("data-outcome", "refused")
    );
    expect(outcome).toHaveAttribute("role", "alert");
    expect(outcome).toHaveTextContent(
      "Coord did not stop governing portofino/web: 403 — strategy_admin_required"
    );
    expect(
      outcome.querySelector('[data-refusal="unstructured"]')
    ).toHaveTextContent("strategy_admin_required");
    expect(
      within(outcome).getByTestId("unenroll-failure-detail")
    ).toHaveAttribute("data-refusal-code", "strategy_admin_required");
    // The repo is still governed, and the control is usable again.
    expect(screen.getByTestId("stop-governing-portofino/web")).toBeEnabled();
    expect(deleteCalls()).toHaveLength(1);
  });

  it.each([
    [
      true,
      "Coord found no enrollment of portofino/web in this project to remove. Coord recorded an un-enrollment of portofino/web for this project anyway",
    ],
    [
      false,
      "Coord found no enrollment of portofino/web in this project to remove. Coord recorded nothing.",
    ],
  ])(
    "a 404 says whether coord recorded an un-enrollment anyway (tombstoned: %s)",
    async (tombstoned, sentence) => {
      accountsMock.mockResolvedValue({ accounts: [GOVERNED_ORG] });
      fetchMock.mockImplementation(async () =>
        jsonResponse(
          {
            error: "repo not found: portofino/web",
            tombstoned,
            note: "coord's own explanation",
          },
          404
        )
      );
      render(<ConnectedOrgs />);
      const dialog = await openAndType("portofino/web", "archived");
      fireEvent.click(
        within(dialog).getByTestId("stop-governing-dialog-confirm")
      );
      const outcome = await screen.findByTestId("unenroll-outcome-portofino");
      await waitFor(() =>
        expect(outcome).toHaveAttribute("data-outcome", "refused")
      );
      expect(outcome).toHaveTextContent("404 — repo not found: portofino/web");
      expect(outcome).toHaveTextContent(sentence);
    }
  );

  it("reads back a write that may have landed (the web's write timeout) before saying anything", async () => {
    accountsMock
      .mockResolvedValueOnce({ accounts: [GOVERNED_ORG] })
      .mockResolvedValue({ accounts: [UNENROLLED_ORG] });
    fetchMock.mockImplementation(async () =>
      webRefusal(
        504,
        "coord_write_timeout",
        "upstream_timeout",
        "timeout waiting for coord"
      )
    );
    render(<ConnectedOrgs />);
    const dialog = await openAndType("portofino/web", "archived");
    fireEvent.click(
      within(dialog).getByTestId("stop-governing-dialog-confirm")
    );
    const outcome = await screen.findByTestId("unenroll-outcome-portofino");
    await waitFor(() =>
      expect(outcome).toHaveAttribute("data-outcome", "done")
    );
    expect(
      screen.getByTestId("reenroll-repo-portofino/web")
    ).toBeInTheDocument();
  });

  it("a definite transport refusal (coord unreachable) is refused, not read back", async () => {
    accountsMock.mockResolvedValue({ accounts: [GOVERNED_ORG] });
    fetchMock.mockImplementation(async () =>
      webRefusal(
        502,
        "coord_unreachable",
        "upstream_unavailable",
        "coord is not reachable"
      )
    );
    render(<ConnectedOrgs />);
    const dialog = await openAndType("portofino/web", "archived");
    fireEvent.click(
      within(dialog).getByTestId("stop-governing-dialog-confirm")
    );
    const outcome = await screen.findByTestId("unenroll-outcome-portofino");
    await waitFor(() =>
      expect(outcome).toHaveAttribute("data-outcome", "refused")
    );
    expect(outcome.querySelector('[data-refusal="structured"]')).not.toBeNull();
  });

  it("coverage principals render in words, with no Re-enroll and the App-access hint in its place", async () => {
    accountsMock.mockResolvedValue({ accounts: [COVERAGE_ORG] });
    render(<ConnectedOrgs />);

    for (const repo of ["jspinak/bdo", "jspinak/brobot"]) {
      const row = await screen.findByTestId(
        `connected-org-repo-unenrolled-${repo}`
      );
      expect(row).toHaveAttribute("data-unenroll-cause", "coverage");
      const detail = screen.getByTestId(`unenrolled-detail-${repo}`);
      expect(detail).toHaveTextContent(
        /^removed .*: GitHub App access was removed$/
      );
      // coord's raw principal is reachable, but not on the line itself.
      expect(detail.textContent).not.toMatch(/webhook:|reconcile:/);
      expect(detail.getAttribute("title")).toMatch(
        /^(webhook:installation_repositories|reconcile:installation_coverage) — /
      );
      expect(screen.queryByTestId(`reenroll-repo-${repo}`)).toBeNull();
      expect(
        screen.getByTestId(`unenrolled-app-access-hint-${repo}`)
      ).toHaveTextContent(
        `Add ${repo} to the coord GitHub App's repository access to bring it back`
      );
    }

    // A decision names its actor class, and keeps its Re-enroll.
    const notes = screen.getByTestId(
      "connected-org-repo-unenrolled-jspinak/notes"
    );
    expect(notes).toHaveAttribute("data-unenroll-cause", "decision");
    expect(
      screen.getByTestId("unenrolled-detail-jspinak/notes")
    ).toHaveTextContent(/^removed .* by an operator: moved to a monorepo$/);
    expect(
      screen.getByTestId("reenroll-repo-jspinak/notes")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("unenrolled-app-access-hint-jspinak/notes")
    ).toBeNull();
  });
});
