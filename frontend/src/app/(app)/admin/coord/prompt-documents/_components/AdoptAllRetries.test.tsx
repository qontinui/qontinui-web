/**
 * Adopt-all through the REAL `HttpClient`: which project each attempt of a
 * request was actually sent in.
 *
 * The client builds headers afresh on each attempt and, left alone, reads the
 * stored project each time — so a request retried, or replayed after a token
 * refresh, after another tab switched project goes to the new one, and the
 * answer (or the write) belongs to a project nobody chose. Only global `fetch`
 * is faked here; it answers by the `X-Qontinui-Active-Tenant` header each
 * attempt actually carried (no header: the home project).
 *
 * What is pinned:
 *
 * 1. **The page's status read keeps its project across retries**, so a retry
 *    cannot latch another project's not-system answer for the system tenant.
 * 2. **The re-ask at open keeps its project across retries.**
 * 3. **An adopt POST retried on 429 lands in the run's project** — with the
 *    switch made synchronously in the 429 answer, so the client's immediate
 *    re-issue would carry the NEW project if the write were not pinned.
 * 4. **A request with no project to pin is not retried.**
 * 5. **Adopt all is never offered over another project's rows, nor while
 *    another project is stored.** Row writes themselves are not pinned (the
 *    page-wide cross-tab hazard is pre-existing and not this change's), so a
 *    row write after another tab's switch lands in, and re-reads, that
 *    project.
 * 6. **A `null`-pinned status read replayed after a token refresh under
 *    another project does not count** once the provider has reconciled: the
 *    read is re-taken pinned to the page's project.
 *
 * The client's backoff is real (about a second before a third attempt), so
 * these run on real time with generous timeouts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/** The access token's expiry; a test sets it in the past to force a refresh. */
const token = vi.hoisted(() => ({
  expiry: 0,
  onRefresh: null as (() => void) | null,
}));
const listTenantsMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/service-factory", async () => {
  const { HttpClient } = await import("@/services/http-client");
  const tokens = {
    getAccessToken: () => "tok",
    getRefreshToken: () => "refresh",
    getAccessTokenExpiry: () => token.expiry,
    // Inside the grace window: stale by expiry, not "expired", so a 401 is
    // refreshed and replayed rather than ending the session.
    isAccessTokenExpired: () => false,
    isAccessTokenExpiringSoon: () => false,
    isAuthenticated: () => true,
    clearTokens: () => {},
  };
  const refresher = {
    refreshWithOutcome: async () => {
      token.onRefresh?.();
      token.expiry = Date.now() + 3_600_000;
      return "refreshed";
    },
  };
  return {
    httpClient: new HttpClient(
      tokens as unknown as ConstructorParameters<typeof HttpClient>[0],
      undefined,
      refresher as unknown as ConstructorParameters<typeof HttpClient>[2]
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
import { TenantProvider } from "@/contexts/tenant-context";

const KEY = "qontinui.active_tenant_id";
const SYS = "t-system";
const B = "t-b";
type Sent = { method: string; url: string; tenant: string | null };

let sent: Sent[] = [];
/** Per project: how many upcoming status reads answer 503 first. */
let status503: Record<string, number> = {};
/** How many upcoming status reads answer 401 first (forcing a refresh). */
let status401 = 0;
/** Per project: how many upcoming adopt POSTs answer 429 first. */
let adopt429: Record<string, number> = {};
/** The status a row write's PATCH is answered with. */
let patchStatus = 200;
/** Run 100 ms after a status read is answered 503 — "another tab". */
let onTransient: (() => void) | null = null;
/** Run synchronously inside a 429 answer, after its header was recorded. */
let switchNow: (() => void) | null = null;
/** Run when a status read arrives (before it is answered). */
let onStatus: (() => void) | null = null;
/** The project an unpinned (header-less) request is served in. */
let home = SYS;
/** Per project: the rows its list read answers. */
let rowsFor: Record<string, unknown[]> = {};

function row(name: string, extra: Record<string, unknown> = {}) {
  return {
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
    ...extra,
  };
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const notSystem = () =>
  json(403, {
    error: "FORBIDDEN",
    message: JSON.stringify({ error: "not_system_tenant", detail: "x" }),
  });

beforeEach(() => {
  localStorage.clear();
  sent = [];
  status503 = {};
  patchStatus = 200;
  status401 = 0;
  adopt429 = {};
  onTransient = null;
  switchNow = null;
  onStatus = null;
  home = SYS;
  rowsFor = {};
  token.expiry = Date.now() + 3_600_000;
  token.onRefresh = null;
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
      const key = tenant ?? "none";
      const served = tenant ?? home;
      if (url.includes("/auto-publish/status")) {
        onStatus?.();
        if (status401 > 0) {
          status401 -= 1;
          return json(401, { error: "UNAUTHORIZED", message: "expired" });
        }
        if ((status503[key] ?? 0) > 0) {
          status503[key] = (status503[key] ?? 0) - 1;
          setTimeout(() => onTransient?.(), 100);
          return json(503, {
            error: "SERVICE_UNAVAILABLE",
            message: "gateway",
          });
        }
        return served === SYS
          ? json(200, { candidates: [], count: 1 })
          : notSystem();
      }
      if (url.includes("/upstream-adopt")) {
        if ((adopt429[key] ?? 0) > 0) {
          adopt429[key] = (adopt429[key] ?? 0) - 1;
          switchNow?.();
          return json(429, { error: "RATE_LIMITED", message: "slow down" });
        }
        return json(200, {
          adopted: true,
          kind: "policy",
          name: "coordination",
          from_version: 7,
          to_version: 8,
          publication_version: 1,
          local_modified: true,
        });
      }
      if (method === "PATCH") {
        return patchStatus === 200
          ? json(200, row("a"))
          : json(patchStatus, { error: "CONFLICT", message: "moved" });
      }
      if (method === "GET" && /\/coord\/prompt-documents(\?|$)/.test(url)) {
        return json(200, {
          documents: rowsFor[served] ?? [row("coordination")],
          degraded: null,
        });
      }
      return json(404, { error: "NOT_FOUND", message: "Not Found" });
    })
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const statusTenants = () =>
  sent
    .filter((s) => s.url.includes("/auto-publish/status"))
    .map((s) => s.tenant);
const adoptTenants = () =>
  sent.filter((s) => s.url.includes("/upstream-adopt")).map((s) => s.tenant);
const listTenantsSent = () =>
  sent
    .filter(
      (s) => s.method === "GET" && /\/coord\/prompt-documents(\?|$)/.test(s.url)
    )
    .map((s) => s.tenant);

describe("pinned requests through the real HttpClient", () => {
  it("keeps the page's status read in its project across retries", async () => {
    localStorage.setItem(KEY, SYS);
    status503[SYS] = 2;
    // Another tab switches to B while this one backs off.
    onTransient = () => localStorage.setItem(KEY, B);
    render(<PromptDocumentList />);
    await screen.findByTestId("doc-row-policy-coordination");
    await vi.waitFor(() => expect(statusTenants()).toHaveLength(3), {
      timeout: 6000,
    });
    // Every attempt went to the system tenant, which answered 200.
    expect(statusTenants()).toEqual([SYS, SYS, SYS]);
    localStorage.setItem(KEY, SYS);
    expect(
      await screen.findByTestId("publish-all", {}, { timeout: 3000 })
    ).toHaveTextContent("Publish all changed (1)");
    expect(screen.queryByTestId("adopt-all")).not.toBeInTheDocument();
  }, 20_000);

  it("keeps the re-ask at open, and the adopt it allows, in the page's project", async () => {
    localStorage.setItem(KEY, B);
    render(<PromptDocumentList />);
    const button = await screen.findByTestId(
      "adopt-all",
      {},
      { timeout: 5000 }
    );
    // The re-ask at open: 503 twice in B; another tab switches to the system
    // tenant during the backoff, and back to B when the retry arrives.
    status503[B] = 2;
    onTransient = () => localStorage.setItem(KEY, SYS);
    onStatus = () => {
      // The retry after the backoff is the page's 4th status read.
      if (statusTenants().length >= 4) localStorage.setItem(KEY, B);
    };
    const user = userEvent.setup();
    const before = statusTenants().length;
    await user.click(button);
    await screen.findByTestId("adopt-all-candidates", {}, { timeout: 6000 });
    expect(statusTenants().slice(before)).toEqual([B, B, B]);
    // The adopt it allows: 429 once in B, and another tab switches to the
    // system tenant INSIDE that answer — so the client's immediate re-issue
    // reads the system tenant unless the write is pinned.
    onStatus = null;
    onTransient = null;
    adopt429[B] = 1;
    switchNow = () => localStorage.setItem(KEY, SYS);
    await user.click(screen.getByTestId("adopt-all-confirm"));
    await screen.findByTestId("adopt-all-summary", {}, { timeout: 6000 });
    // Both attempts of the write went to B — never the system tenant.
    expect(adoptTenants()).toEqual([B, B]);
  }, 30_000);

  it("does not retry a request with no project to pin", async () => {
    // Nothing stored: the status read has no header to pin, so it is not
    // retried — a retry would read whatever another tab stored meanwhile.
    status503.none = 1;
    onTransient = () => localStorage.setItem(KEY, B);
    render(<PromptDocumentList />);
    await screen.findByTestId("doc-row-policy-coordination");
    await new Promise((r) => setTimeout(r, 1500));
    expect(statusTenants()).toEqual([null]);
  }, 20_000);

  /** B is the page's project; the system tenant holds three updatable policies. */
  async function inBravoBesideTheSystemTenant() {
    listTenantsMock.mockResolvedValue({
      tenants: [
        { id: B, slug: "b", name: "B" },
        { id: SYS, slug: "sys", name: "System" },
      ],
      active_tenant_id: B,
    });
    rowsFor = {
      [B]: [row("a")],
      [SYS]: [row("a"), row("sys1"), row("sys2")],
    };
    localStorage.setItem(KEY, B);
    render(
      <TenantProvider>
        <PromptDocumentList />
      </TenantProvider>
    );
    expect(
      await screen.findByTestId("adopt-all", {}, { timeout: 5000 })
    ).toHaveTextContent("Adopt all updates (1)");
  }

  /** Set a row's agent write tier, as an operator would. */
  async function setTier() {
    const user = userEvent.setup();
    await user.click(screen.getByTestId("doc-access-toggle-policy-a"));
    await user.click(
      await screen.findByTestId("doc-access-tier-policy-a-deny")
    );
  }

  it("never offers the button over another project's rows after a row write lands in it", async () => {
    await inBravoBesideTheSystemTenant();
    // Another tab switches to the system tenant; then a row write here. It is
    // not pinned, so it and its re-read go to the system tenant.
    localStorage.setItem(KEY, SYS);
    const listReadsBefore = listTenantsSent().length;
    await setTier();
    await waitFor(() =>
      expect(listTenantsSent().length).toBeGreaterThan(listReadsBefore)
    );
    // The rows on screen are now the system tenant's three updatable
    // policies — and the button is not offered over them.
    expect(
      await screen.findByTestId("doc-row-policy-sys1", {}, { timeout: 5000 })
    ).toBeInTheDocument();
    expect(screen.queryByTestId("adopt-all")).not.toBeInTheDocument();
  }, 20_000);

  it("withdraws the button while another project is stored, even over the page's own rows", async () => {
    await inBravoBesideTheSystemTenant();
    // Another tab switches; a row write here is refused by coord (no
    // re-read), so the rows stay the page's own and only the stored project
    // has changed by the time the page renders again.
    localStorage.setItem(KEY, SYS);
    patchStatus = 409;
    const patchesBefore = sent.filter((s) => s.method === "PATCH").length;
    await setTier();
    await waitFor(() =>
      expect(sent.filter((s) => s.method === "PATCH").length).toBe(
        patchesBefore + 1
      )
    );
    await waitFor(() =>
      expect(screen.queryByTestId("adopt-all")).not.toBeInTheDocument()
    );
    expect(screen.getByTestId("doc-row-policy-a")).toBeInTheDocument();
    expect(screen.queryByTestId("doc-row-policy-sys1")).not.toBeInTheDocument();
  }, 20_000);

  it("does not count a null-pinned read replayed under another project once the provider has reconciled", async () => {
    // Home is the system tenant; nothing stored. The page's null-pinned
    // status read hits a 401; during the refresh another tab stores B, so the
    // replay goes to B and is answered not_system_tenant.
    let releaseTenants: (() => void) | undefined;
    listTenantsMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseTenants = () =>
            resolve({
              tenants: [
                { id: SYS, slug: "sys", name: "System" },
                { id: B, slug: "b", name: "B" },
              ],
              active_tenant_id: SYS,
            });
        })
    );
    token.expiry = Date.now() - 1000;
    status401 = 1;
    token.onRefresh = () => localStorage.setItem(KEY, B);
    render(
      <TenantProvider>
        <PromptDocumentList />
      </TenantProvider>
    );
    await screen.findByTestId("doc-row-policy-coordination");
    await vi.waitFor(() => expect(statusTenants()).toEqual([null, B]), {
      timeout: 5000,
    });
    // The provider reconciles its own null to home: the system tenant. The
    // read is re-taken pinned to it, and answers as the system tenant does.
    await act(async () => {
      releaseTenants?.();
    });
    await vi.waitFor(() => expect(statusTenants()).toEqual([null, B, SYS]), {
      timeout: 5000,
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("adopt-all")).not.toBeInTheDocument();
    expect(adoptTenants()).toEqual([]);
  }, 20_000);
});
