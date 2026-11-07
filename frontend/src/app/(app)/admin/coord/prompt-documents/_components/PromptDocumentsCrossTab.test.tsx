/**
 * The prompt-documents page after ANOTHER tab switches project, and after
 * THIS tab does — through the REAL `HttpClient`, so every assertion is about
 * where a request was actually sent (`fetch` is faked; it answers by the
 * `X-Qontinui-Active-Tenant` header each request carried).
 *
 * The page's reads are pinned to its own project, but the HTTP client reads
 * the stored project per request, so after another tab's switch an unpinned
 * write would land in the OTHER project while this page shows its own rows —
 * a per-row Adopt then replaces a policy of a project nobody here is looking
 * at. What is pinned:
 *
 * 1. **Another tab's switch disables every control and says so, with a
 *    Reload** (the `storage` event); switching back clears it.
 * 2. **A write raced past that — no event yet, or a dialog already open — is
 *    refused at call time**: nothing at all is sent.
 * 3. **THIS tab's own switch through the provider is followed**: no notice,
 *    and the page re-reads its rows and the status in the new project.
 * 4. **The adopt-all dialog names the project its run is pinned to**, never
 *    the provider's (which a client-side navigation can leave behind).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

const listTenantsMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/service-factory", async () => {
  const { HttpClient } = await import("@/services/http-client");
  const tokens = {
    getAccessToken: () => "tok",
    getRefreshToken: () => "refresh",
    getAccessTokenExpiry: () => Date.now() + 3_600_000,
    isAccessTokenExpired: () => false,
    isAccessTokenExpiringSoon: () => false,
    isAuthenticated: () => true,
    clearTokens: () => {},
  };
  return {
    httpClient: new HttpClient(
      tokens as unknown as ConstructorParameters<typeof HttpClient>[0]
    ),
  };
});
vi.mock("@/lib/api/operations/tenants", () => ({
  listTenants: (...args: unknown[]) => listTenantsMock(...args),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { PromptDocumentList } from "./PromptDocumentList";
import { TenantProvider, useTenant } from "@/contexts/tenant-context";

const KEY = "qontinui.active_tenant_id";
const SYS = "t-system";
const A = "t-alpha";
const B = "t-bravo";
type Sent = { method: string; url: string; tenant: string | null };
let sent: Sent[] = [];

const row = (name: string) => ({
  id: name,
  kind: "policy",
  name,
  description: null,
  format: "markdown",
  default_source: null,
  current_version: 7,
  updated_by: "x",
  updated_at: "2026-11-07T00:00:00Z",
  upstream_publication_version: null,
  latest_publication_version: 1,
  local_modified: true,
  update_available: true,
  agent_write_effective_tier: "allow",
  agent_write_tier: "allow",
  agent_write_source: "operator",
});
const rowsFor: Record<string, unknown[]> = {
  [A]: [row("alpha-only")],
  [B]: [row("bravo-only")],
  [SYS]: [row("bravo-only"), row("sys1")],
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** Another tab writes the stored project: the event only OTHER tabs get. */
function anotherTabStores(tenant: string) {
  localStorage.setItem(KEY, tenant);
  window.dispatchEvent(
    new StorageEvent("storage", { key: KEY, newValue: tenant })
  );
}

const after = (from: number) => sent.slice(from);
const writesOrBodyReads = (list: Sent[]) =>
  list.filter(
    (s) =>
      s.method !== "GET" ||
      /\/coord\/prompt-documents\/policy\//.test(s.url) ||
      s.url.includes("/coord/prompt-document-publications/")
  );

beforeEach(() => {
  localStorage.clear();
  sent = [];
  listTenantsMock.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      const tenant =
        ((init?.headers ?? {}) as Record<string, string>)[
          "X-Qontinui-Active-Tenant"
        ] ?? null;
      sent.push({ method, url, tenant });
      const served = tenant ?? SYS;
      if (url.includes("/auto-publish/status")) {
        return served === SYS
          ? json(200, { candidates: [], count: 0 })
          : json(403, {
              error: "FORBIDDEN",
              message: JSON.stringify({
                error: "not_system_tenant",
                detail: "x",
              }),
            });
      }
      if (url.includes("/upstream-adopt")) {
        return json(200, {
          adopted: true,
          kind: "policy",
          name: "bravo-only",
          from_version: 7,
          to_version: 8,
          publication_version: 1,
          local_modified: true,
        });
      }
      if (method === "PATCH") return json(200, row("bravo-only"));
      if (
        method === "GET" &&
        url.includes("/coord/prompt-document-publications/")
      ) {
        return json(200, {
          publication_id: "p1",
          kind: "policy",
          name: "bravo-only",
          publication_version: 1,
          format: "markdown",
          description: null,
          release_note: null,
          content_sha256: "x",
          source_version: 1,
          published_by: "x",
          published_at: "2026-11-01T00:00:00Z",
          body: "published body",
        });
      }
      if (
        method === "GET" &&
        /\/coord\/prompt-documents\/policy\/[^/?]+$/.test(url)
      ) {
        return json(200, { ...row("bravo-only"), body: `body in ${served}` });
      }
      if (method === "GET" && /\/coord\/prompt-documents(\?|$)/.test(url)) {
        return json(200, { documents: rowsFor[served] ?? [], degraded: null });
      }
      return json(404, { error: "NOT_FOUND", message: "Not Found" });
    })
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

function inBravo() {
  listTenantsMock.mockResolvedValue({
    tenants: [
      { id: B, slug: "b", name: "Bravo" },
      { id: SYS, slug: "s", name: "System" },
    ],
    active_tenant_id: B,
  });
  localStorage.setItem(KEY, B);
}

describe("another tab switches project", () => {
  it("disables every control, says so with a Reload, and sends nothing; switching back clears it", async () => {
    inBravo();
    render(
      <TenantProvider>
        <PromptDocumentList />
      </TenantProvider>
    );
    await screen.findByTestId("adopt-all", {}, { timeout: 5000 });
    const before = sent.length;

    await act(async () => anotherTabStores(SYS));

    const notice = await screen.findByTestId("prompt-documents-cross-tab");
    expect(notice).toHaveTextContent(
      "The active project was changed in another tab — reload to continue."
    );
    expect(
      screen.getByTestId("prompt-documents-cross-tab-reload")
    ).toBeEnabled();
    for (const id of [
      "doc-access-toggle-policy-bravo-only",
      "doc-upstream-policy-bravo-only",
      "doc-edit-policy-bravo-only",
      "doc-history-policy-bravo-only",
      "new-document",
    ]) {
      expect(screen.getByTestId(id)).toBeDisabled();
    }
    expect(screen.queryByTestId("adopt-all")).not.toBeInTheDocument();
    expect(writesOrBodyReads(after(before))).toEqual([]);

    // The other tab switches back: the page is its own again.
    await act(async () => anotherTabStores(B));
    await waitFor(() =>
      expect(
        screen.queryByTestId("prompt-documents-cross-tab")
      ).not.toBeInTheDocument()
    );
    expect(
      screen.getByTestId("doc-access-toggle-policy-bravo-only")
    ).toBeEnabled();
  }, 20_000);

  it("refuses a per-row Adopt raced past the event: no body read, no publication read, no POST", async () => {
    inBravo();
    render(
      <TenantProvider>
        <PromptDocumentList />
      </TenantProvider>
    );
    await screen.findByTestId("adopt-all", {}, { timeout: 5000 });
    // Stored, but the event has not arrived.
    localStorage.setItem(KEY, SYS);
    const before = sent.length;
    await userEvent
      .setup()
      .click(screen.getByTestId("doc-upstream-policy-bravo-only"));
    expect(
      await screen.findByTestId("prompt-documents-cross-tab")
    ).toBeInTheDocument();
    expect(writesOrBodyReads(after(before))).toEqual([]);
  }, 20_000);

  it("refuses Adopt from an upstream dialog that was already open", async () => {
    inBravo();
    render(
      <TenantProvider>
        <PromptDocumentList />
      </TenantProvider>
    );
    await screen.findByTestId("adopt-all", {}, { timeout: 5000 });
    const user = userEvent.setup();
    await user.click(screen.getByTestId("doc-upstream-policy-bravo-only"));
    const adopt = await screen.findByTestId(
      "upstream-adopt",
      {},
      { timeout: 5000 }
    );
    await waitFor(() => expect(adopt).toBeEnabled(), { timeout: 5000 });
    // The dialog's reads went to Bravo. Now another tab stores the system
    // tenant; its event has not arrived when Adopt is pressed.
    localStorage.setItem(KEY, SYS);
    const before = sent.length;
    await user.click(adopt);
    await new Promise((r) => setTimeout(r, 50));
    expect(
      after(before).filter((s) => s.url.includes("/upstream-adopt"))
    ).toEqual([]);
  }, 20_000);
});

describe("this tab switches project through the provider", () => {
  it("is followed: no notice, and the rows and status are re-read in the new project", async () => {
    inBravo();
    let switchTo: (id: string) => void = () => {};
    function Switcher() {
      const { setActiveTenantId } = useTenant();
      switchTo = setActiveTenantId;
      return null;
    }
    render(
      <TenantProvider>
        <Switcher />
        <PromptDocumentList />
      </TenantProvider>
    );
    await screen.findByTestId("adopt-all", {}, { timeout: 5000 });
    const before = sent.length;

    // The app's own switch: the provider's setter (it writes storage in this
    // tab, which fires no storage event here).
    await act(async () => switchTo(SYS));

    expect(
      await screen.findByTestId("doc-row-policy-sys1")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("prompt-documents-cross-tab")
    ).not.toBeInTheDocument();
    const newReads = after(before);
    expect(
      newReads
        .filter((s) => /\/coord\/prompt-documents(\?|$)/.test(s.url))
        .map((s) => s.tenant)
    ).toEqual([SYS]);
    expect(
      newReads
        .filter((s) => s.url.includes("/auto-publish/status"))
        .map((s) => s.tenant)
    ).toEqual([SYS]);
    expect(
      screen.getByTestId("doc-access-toggle-policy-bravo-only")
    ).toBeEnabled();
  }, 20_000);
});

describe("the adopt-all dialog's project", () => {
  it("names the project the run is pinned to, not the provider's", async () => {
    // The provider loaded in Alpha; another tab stores Bravo; then this tab
    // navigates here client-side. The page's reads, and the run, are Bravo's.
    listTenantsMock.mockResolvedValue({
      tenants: [
        { id: A, slug: "a", name: "Alpha" },
        { id: B, slug: "b", name: "Bravo" },
      ],
      active_tenant_id: A,
    });
    localStorage.setItem(KEY, A);
    let show: (v: boolean) => void = () => {};
    function Nav() {
      const [here, setHere] = useState(false);
      show = setHere;
      return here ? <PromptDocumentList /> : <div data-testid="elsewhere" />;
    }
    render(
      <TenantProvider>
        <Nav />
      </TenantProvider>
    );
    await waitFor(() => expect(listTenantsMock).toHaveBeenCalled());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    localStorage.setItem(KEY, B);
    await act(async () => show(true));
    const user = userEvent.setup();
    await user.click(
      await screen.findByTestId("adopt-all", {}, { timeout: 5000 })
    );
    await screen.findByTestId("adopt-all-candidates", {}, { timeout: 5000 });
    expect(screen.getByTestId("adopt-all-tenant")).toHaveTextContent(
      "Project: Bravo"
    );
    expect(screen.getByTestId("adopt-all-tenant")).not.toHaveTextContent(
      "Alpha"
    );
  }, 20_000);
});
