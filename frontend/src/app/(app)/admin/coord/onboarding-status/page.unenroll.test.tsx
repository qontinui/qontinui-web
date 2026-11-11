/**
 * Stopping governance of a repo, entered where an operator enters it: the
 * bare-visit `/admin/coord/onboarding-status` page, rendering the REAL
 * Connected Organizations card (plan
 * `2026-11-08-coord-keeps-governing-repos-a-narrowed-installation-dropped`
 * Phase 8, its arming).
 *
 * The page's own suite (`page.test.tsx`) replaces the card with a stub to pin
 * the page's wiring; this one keeps the card and replaces only the wire. The
 * requests leave through the REAL `HttpClient` — `fetch` is the one stub — so
 * what is asserted is what a browser sends: one DELETE, never re-sent,
 * carrying the reason and, as `X-Qontinui-Active-Tenant`, the project the
 * consent dialog named. That header is the tenant the web proxy forwards to
 * coord (`backend/tests/test_operations_onboarding_unenroll.py` pins the
 * forwarding), so it is the tenant the un-enrollment lands in — never the
 * operator's home tenant, which the 2026-11-08 header-less cleanup wrote into
 * (plan, Why). Then the card's re-read moves the repo to the un-enrolled list,
 * with its undo (Re-enroll) beside it.
 *
 * Here the browser's stored selection IS the dialog's project, so this test
 * cannot tell a pinned header from one read again at send time. The pin is
 * proven where it lives: `unenrollRepo` names the tenant
 * (`lib/api/operations/prMergeOnboarding.test.ts`), and `HttpClient` keeps a
 * caller-named tenant on a replay after a token refresh
 * (`services/http-client.test.ts`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { HttpClient } from "@/services/http-client";
import type { TokenManager } from "@/services/auth/token-manager";

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/services/service-factory", () => ({
  get httpClient() {
    return holder.client;
  },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

// The page's other cards do their own reads on mount; they are not under test.
vi.mock("@/components/operations/OnboardingDoctor", () => ({
  OnboardingDoctor: () => null,
}));
vi.mock("@/components/operations/RepoTenantBindings", () => ({
  RepoTenantBindings: () => null,
}));

/** The project selected in the sidebar, of which the operator is an admin. */
const PROJECT = {
  id: "6e00ba36-342e-4afd-b674-b34b559f85ce",
  slug: "whitespace-engine",
  name: "Whitespace engine",
  roles: ["admin"],
};

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({
    user: { is_superuser: false, coord_is_admin: true },
    isCoordAdmin: true,
  }),
}));
vi.mock("@/contexts/tenant-context", () => ({
  useTenant: () => ({
    tenants: [PROJECT],
    activeTenantId: PROJECT.id,
    isMultiTenant: false,
    loading: false,
    error: null,
    setActiveTenantId: () => undefined,
    refresh: async () => true,
  }),
}));

// The consent dialog's confirm is a `DestructiveButton`, which refuses
// untrusted clicks, and jsdom cannot produce a trusted one. The gate itself is
// pinned in `components/ui/destructive-button.test.tsx`.
vi.mock("@/components/ui/destructive-button", () => ({
  isSyntheticClick: () => false,
  DestructiveButton: (props: Record<string, unknown>) => (
    <button type="button" {...props} />
  ),
}));

import OnboardingStatusPage from "./page";

const ACCOUNTS_URL = "/api/v1/operations/pr-merge/onboarding/accounts";

const ENROLLED = {
  accounts: [
    {
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
    },
  ],
  bound_away: [],
};

const UNENROLLED = {
  ...ENROLLED,
  accounts: [
    {
      ...ENROLLED.accounts[0],
      repos: [
        {
          repo: "portofino/web",
          state: "unenrolled",
          merge_enabled: null,
          merge_enabled_resolved: null,
          merge_posture: null,
          profile_source: null,
          unenrolled_at: "2026-11-08T17:00:00Z",
          unenrolled_by: "operator:5f0c2a1e-0000-4000-8000-000000000001",
          unenroll_reason: "archived",
        },
      ],
    },
  ],
};

function tokenManager(): TokenManager {
  return {
    getAccessToken: () => "tok",
    getRefreshToken: () => "refresh",
    getAccessTokenExpiry: () => Date.now() + 60 * 60 * 1000,
    isAccessTokenExpired: () => false,
    isAccessTokenExpiringSoon: () => false,
    isAuthenticated: () => true,
    clearTokens: () => {},
  } as unknown as TokenManager;
}

interface Sent {
  url: string;
  method: string;
  headers: Headers;
}

/**
 * The wire. Accounts reads answer the enrolled list until the DELETE has
 * landed and the un-enrolled list after it; the DELETE answers coord's
 * bodiless 204. Anything else is a 404, so a stray read is visible.
 */
function stubWire(): Sent[] {
  const sent: Sent[] = [];
  let removed = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      sent.push({ url, method, headers: new Headers(init?.headers) });
      if (method === "DELETE") {
        removed = true;
        return new Response(null, { status: 204 });
      }
      if (url === ACCOUNTS_URL) {
        return new Response(JSON.stringify(removed ? UNENROLLED : ENROLLED), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("{}", { status: 404 });
    })
  );
  return sent;
}

describe("/admin/coord/onboarding-status — Stop governing", () => {
  beforeEach(() => {
    holder.client = new HttpClient(tokenManager());
    // Where the real HttpClient reads the sidebar's selection from.
    localStorage.setItem("qontinui.active_tenant_id", PROJECT.id);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("an administrator of the selected project stops governing a repo with one DELETE carrying the reason and the project, and sees it move to the un-enrolled list with Re-enroll beside it", async () => {
    const sent = stubWire();
    render(<OnboardingStatusPage />);

    fireEvent.click(await screen.findByTestId("stop-governing-portofino/web"));
    const dialog = await screen.findByTestId("stop-governing-dialog");
    expect(
      within(dialog).getByTestId("stop-governing-dialog-project")
    ).toHaveTextContent("Whitespace engine");
    fireEvent.change(within(dialog).getByTestId("stop-governing-reason"), {
      target: { value: "archived" },
    });
    fireEvent.click(
      within(dialog).getByTestId("stop-governing-dialog-confirm")
    );

    const outcome = await screen.findByTestId("unenroll-outcome-portofino");
    await waitFor(() =>
      expect(outcome).toHaveAttribute("data-outcome", "done")
    );

    const deletes = sent.filter((s) => s.method === "DELETE");
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.url).toBe(
      "/api/v1/operations/pr-merge/onboarding/repos/portofino/web?reason=archived"
    );
    expect(deletes[0]!.headers.get("X-Qontinui-Active-Tenant")).toBe(
      PROJECT.id
    );
    expect(deletes[0]!.headers.get("Authorization")).toBe("Bearer tok");

    // The repo moved: no doctor link, and its undo is on its row.
    expect(screen.queryByTestId("connected-org-repo-portofino/web")).toBeNull();
    const row = screen.getByTestId(
      "connected-org-repo-unenrolled-portofino/web"
    );
    expect(
      within(row).getByTestId("reenroll-repo-portofino/web")
    ).toBeEnabled();
    expect(
      screen.getByTestId("unenrolled-detail-portofino/web")
    ).toHaveTextContent(/^removed .* by an operator: archived$/);
  });
});
