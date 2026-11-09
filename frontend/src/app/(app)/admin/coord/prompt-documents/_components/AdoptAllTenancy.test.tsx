/**
 * Adopt-all under a real `TenantProvider`: which project the page's reads
 * were SERVED in.
 *
 * What is pinned, and why each would fail silently:
 *
 * 1. **A provider that SEEDS the project is not a project switch.** On a
 *    fresh browser no project is stored at mount; the first reads go out with
 *    none and are served the home project, and the provider then stores that
 *    same home project. Reading the seed as a switch refused every open.
 * 2. **A stale stored id reconciled to the home project is not a switch
 *    either** — coord's override is fail-soft and served home all along.
 * 3. **Until the provider has loaded, or when it failed, the project is
 *    UNKNOWN and adopt-all is not offered** — even with coord's not-system
 *    answer already latched.
 * 3b. **A provider that loaded BEFORE this page mounted names nothing about
 *    it.** The layout's provider outlives client-side navigation and never
 *    follows another tab's write; a stored project that is not a member is
 *    then UNKNOWN, not the provider's stale project.
 * 4. **The project is named from the membership list**, never from the raw
 *    stored id.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getMock = vi.fn();
const postMock = vi.fn();
const listTenantsMock = vi.fn();

vi.mock("@/services/service-factory", async () => {
  const { withVerbFetch } = await import("@/test/verbFetch");
  return {
    httpClient: withVerbFetch({
      get: (...args: unknown[]) => getMock(...args),
      post: (...args: unknown[]) => postMock(...args),
      patch: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    }),
  };
});
vi.mock("@/lib/api/operations/tenants", () => ({
  listTenants: (...args: unknown[]) => listTenantsMock(...args),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { PromptDocumentList } from "./PromptDocumentList";
import { TenantProvider } from "@/contexts/tenant-context";
import type { PromptDocumentSummary } from "../types";

const LIST = "/api/v1/operations/coord/prompt-documents";
const STATUS = `${LIST}/auto-publish/status`;
const TENANT_KEY = "qontinui.active_tenant_id";
const NOT_SYSTEM_TENANT = new Error(
  `GET ${STATUS} failed: 403 - ${JSON.stringify({
    error: "FORBIDDEN",
    message: JSON.stringify({ error: "not_system_tenant", detail: "x" }),
  })}`
);
const TENANTS = {
  tenants: [{ id: "t-home", slug: "bauhaus-b2b", name: "Bauhaus B2B" }],
  active_tenant_id: "t-home",
};

function flagged(name: string): PromptDocumentSummary {
  return {
    id: name,
    kind: "policy",
    name,
    description: null,
    format: "markdown",
    default_source: null,
    current_version: 2,
    updated_by: "x",
    updated_at: "2026-11-07T00:00:00Z",
    upstream_publication_version: null,
    latest_publication_version: 1,
    local_modified: true,
    update_available: true,
  };
}

/** Hold `/tenants` until the test releases it. */
function holdTenants(answer: () => Promise<unknown>) {
  let release: (() => void) | undefined;
  listTenantsMock.mockImplementation(
    () =>
      new Promise((resolve, reject) => {
        release = () => void answer().then(resolve, reject);
      })
  );
  return () => release?.();
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  listTenantsMock.mockReset();
  localStorage.clear();
  getMock.mockImplementation((url: string) => {
    if (url === STATUS) return Promise.reject(NOT_SYSTEM_TENANT);
    if (url === LIST) {
      return Promise.resolve({ documents: [flagged("a")], degraded: null });
    }
    return Promise.reject(new Error(url));
  });
  postMock.mockResolvedValue({
    adopted: true,
    kind: "policy",
    name: "a",
    from_version: 2,
    to_version: 3,
    publication_version: 1,
    local_modified: true,
  });
});
afterEach(() => localStorage.clear());

describe("adopt-all and the project the page was served in", () => {
  it("is not offered before the project list loads, and a provider SEED is not a switch", async () => {
    const release = holdTenants(async () => TENANTS);
    render(
      <TenantProvider>
        <PromptDocumentList />
      </TenantProvider>
    );
    await screen.findByTestId("doc-row-policy-a");
    // Coord's not-system answer has LATCHED (it withdraws the publish-mode
    // control) — and still nothing is offered: the project it was served in
    // is UNKNOWN until the provider has reconciled.
    await waitFor(() =>
      expect(
        screen.queryByTestId("doc-publish-mode-policy-a")
      ).not.toBeInTheDocument()
    );
    expect(screen.queryByTestId("adopt-all")).not.toBeInTheDocument();

    release();
    await waitFor(() =>
      expect(localStorage.getItem(TENANT_KEY)).toBe("t-home")
    );
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("adopt-all"));
    await screen.findByTestId("adopt-all-candidates");
    expect(
      screen.queryByTestId("adopt-all-tenant-changed")
    ).not.toBeInTheDocument();
    // Named from the membership list.
    expect(screen.getByTestId("adopt-all-tenant")).toHaveTextContent(
      "Project: Bauhaus B2B"
    );
    await user.click(screen.getByTestId("adopt-all-confirm"));
    await screen.findByTestId("adopt-all-summary");
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it("treats a stale stored id the provider reconciled to home as the same project", async () => {
    localStorage.setItem(TENANT_KEY, "t-gone");
    const release = holdTenants(async () => TENANTS);
    render(
      <TenantProvider>
        <PromptDocumentList />
      </TenantProvider>
    );
    await screen.findByTestId("doc-row-policy-a");
    release();
    await waitFor(() =>
      expect(localStorage.getItem(TENANT_KEY)).toBe("t-home")
    );
    await userEvent.setup().click(await screen.findByTestId("adopt-all"));
    expect(
      await screen.findByTestId("adopt-all-candidates")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("adopt-all-tenant-changed")
    ).not.toBeInTheDocument();
  });

  it("names nothing about a page mounted under a provider that loaded before it", async () => {
    // The provider loaded long ago, in A.
    localStorage.setItem(TENANT_KEY, "t-a");
    listTenantsMock.mockResolvedValue({
      tenants: [{ id: "t-a", slug: "a", name: "Project A" }],
      active_tenant_id: "t-a",
    });
    let navigate: (() => void) | undefined;
    function Shell() {
      const [here, setHere] = useState(false);
      navigate = () => setHere(true);
      return here ? <PromptDocumentList /> : <p data-testid="elsewhere" />;
    }
    render(
      <TenantProvider>
        <Shell />
      </TenantProvider>
    );
    await waitFor(() => expect(listTenantsMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));
    // Another tab switches to S, which this provider's list does not hold;
    // then this tab navigates here client-side.
    localStorage.setItem(TENANT_KEY, "t-s");
    await act(async () => {
      navigate?.();
    });
    await screen.findByTestId("doc-row-policy-a");
    await waitFor(() =>
      expect(
        screen.queryByTestId("doc-publish-mode-policy-a")
      ).not.toBeInTheDocument()
    );
    // The provider says A; the page's reads went to S. Not offered.
    expect(screen.queryByTestId("adopt-all")).not.toBeInTheDocument();
  });

  it("serves a page mounted under an already-loaded provider in the stored project when it is a member", async () => {
    // The provider loaded long ago, in A; it also lists B.
    localStorage.setItem(TENANT_KEY, "t-a");
    listTenantsMock.mockResolvedValue({
      tenants: [
        { id: "t-a", slug: "a", name: "Project A" },
        { id: "t-b", slug: "b", name: "Project B" },
      ],
      active_tenant_id: "t-a",
    });
    let navigate: (() => void) | undefined;
    function Shell() {
      const [here, setHere] = useState(false);
      navigate = () => setHere(true);
      return here ? <PromptDocumentList /> : <p data-testid="elsewhere" />;
    }
    render(
      <TenantProvider>
        <Shell />
      </TenantProvider>
    );
    await waitFor(() => expect(listTenantsMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));
    // Another tab switches to B — a member — and this tab navigates here.
    localStorage.setItem(TENANT_KEY, "t-b");
    await act(async () => {
      navigate?.();
    });
    // B is served as asked, so B is this page's project: offered, and opens.
    await userEvent.setup().click(await screen.findByTestId("adopt-all"));
    expect(
      await screen.findByTestId("adopt-all-candidates")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("adopt-all-tenant-changed")
    ).not.toBeInTheDocument();
  });

  it("is not offered when the project list failed to load", async () => {
    localStorage.setItem(TENANT_KEY, "t-home");
    const release = holdTenants(async () => {
      throw new Error("GET /tenants failed: 502 - upstream");
    });
    render(
      <TenantProvider>
        <PromptDocumentList />
      </TenantProvider>
    );
    await screen.findByTestId("doc-row-policy-a");
    release();
    await waitFor(() => expect(listTenantsMock).toHaveBeenCalled());
    // Give the failed load time to settle, then confirm nothing is offered.
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("adopt-all")).not.toBeInTheDocument();
  });
});
