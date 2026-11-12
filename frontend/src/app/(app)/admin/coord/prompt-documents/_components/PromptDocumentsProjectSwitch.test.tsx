/**
 * The prompt-documents page when THIS tab switches project through the
 * provider — through the REAL `HttpClient`, so every assertion is about where
 * a request was actually sent (`fetch` is faked; it answers by the
 * `X-Qontinui-Active-Tenant` header each request carried, and a request with
 * none in `home`).
 *
 * What is pinned:
 *
 * 1. **The page follows the switch**: it re-reads its rows and re-takes the
 *    status read, both pinned to the new project — on EVERY switch, back to
 *    the project it mounted in too, and back to the provider's own project.
 * 2. **An older list read never lands over a newer one** — rows, error or
 *    loading flag — and a switch re-reads whenever the NEWEST read sent went
 *    out in another project, so a switch back before the previous switch's
 *    read answered still ends on the page's own rows.
 * 3. **Adopt all is offered only over rows read in the page's project** —
 *    the project a read was SENT in, which another tab's switch can make
 *    differ from the one stored when it answers.
 * 4. **The publish surface is the new project's**: a refusal another project
 *    earned does not hide the system tenant's publish controls once its own
 *    status read has answered (and does hide them until then), and the
 *    previous project's auto-publish state does not linger on the rows.
 *
 * The page's own project switchers (ProjectSelector, CoordProjectCreateDialog)
 * reload the page after setting the project, so following a switch without a
 * reload is defensive. These tests drive the provider's setter WITHOUT that
 * reload, which is the case the following exists for.
 * 5. **The adopt-all dialog names the project its run is pinned to**, never
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
const C = "t-charlie";
type Sent = { method: string; url: string; tenant: string | null };
let sent: Sent[] = [];
/** The project a request with no header is served in. */
let home = SYS;
/** The system tenant's auto-publish candidates, as its status read serves them. */
let systemCandidates: unknown[] = [];
/** Run when a row write's PATCH arrives (before it is answered). */
let onPatch: (() => void) | null = null;

/**
 * Hold the `nth` (1-based) list read, or status read, served in a project
 * until the test releases it — then answer it as usual, or, given
 * `failWith`, with that HTTP status.
 */
type Hold = {
  kind: "list" | "status";
  tenant: string;
  nth: number;
  failWith?: number;
};
type HeldRequest = Hold & {
  gate: Promise<void>;
  release: () => void;
  seen: boolean;
};
let holds: HeldRequest[] = [];
/** Per `kind:project`, how many requests have been served. */
let served: Record<string, number> = {};
function hold(spec: Hold): { release: () => void; arrived: () => boolean } {
  let open: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const entry: HeldRequest = {
    ...spec,
    gate,
    release: () => open(),
    seen: false,
  };
  holds.push(entry);
  return { release: entry.release, arrived: () => entry.seen };
}

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
  [C]: [row("charlie-only")],
  [SYS]: [row("sys1")],
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

async function heldIfAsked(
  kind: Hold["kind"],
  tenant: string
): Promise<HeldRequest | undefined> {
  const key = `${kind}:${tenant}`;
  served[key] = (served[key] ?? 0) + 1;
  const entry = holds.find(
    (h) => h.kind === kind && h.tenant === tenant && h.nth === served[key]
  );
  if (entry) {
    entry.seen = true;
    await entry.gate;
  }
  return entry;
}

beforeEach(() => {
  localStorage.clear();
  sent = [];
  home = SYS;
  systemCandidates = [];
  onPatch = null;
  holds = [];
  served = {};
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
      const project = tenant ?? home;
      if (url.includes("/auto-publish/status")) {
        const held = await heldIfAsked("status", project);
        if (held?.failWith) {
          return json(held.failWith, { error: "BAD_REQUEST", message: "no" });
        }
        return project === SYS
          ? json(200, {
              candidates: systemCandidates,
              count: 2,
              publishing_enabled: true,
            })
          : json(403, {
              error: "FORBIDDEN",
              message: JSON.stringify({
                error: "not_system_tenant",
                detail: "x",
              }),
            });
      }
      if (method === "PATCH") {
        onPatch?.();
        return json(200, row("bravo-only"));
      }
      if (method === "GET" && /\/coord\/prompt-documents(\?|$)/.test(url)) {
        const held = await heldIfAsked("list", project);
        if (held?.failWith) {
          return json(held.failWith, { error: "FORBIDDEN", message: "no" });
        }
        return json(200, { documents: rowsFor[project] ?? [], degraded: null });
      }
      return json(404, { error: "NOT_FOUND", message: "Not Found" });
    })
  );
});
afterEach(() => {
  for (const h of holds) h.release();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const after = (from: number) => sent.slice(from);
const listReads = (list: Sent[]) =>
  list
    .filter(
      (s) => s.method === "GET" && /\/coord\/prompt-documents(\?|$)/.test(s.url)
    )
    .map((s) => s.tenant);
const statusReads = (list: Sent[]) =>
  list
    .filter((s) => s.url.includes("/auto-publish/status"))
    .map((s) => s.tenant);
const rowsShown = () =>
  ["alpha-only", "bravo-only", "charlie-only", "sys1"].filter((n) =>
    screen.queryByTestId(`doc-row-policy-${n}`)
  );
const settle = (ms = 50) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

/** Mount in B (a member) beside `others`, with a handle on this tab's switch. */
function mountIn(
  page: string,
  others: string[]
): { switchTo: (id: string) => Promise<void> } {
  listTenantsMock.mockResolvedValue({
    tenants: [page, ...others].map((id) => ({ id, slug: id, name: id })),
    active_tenant_id: page,
  });
  localStorage.setItem(KEY, page);
  let setter: (id: string) => void = () => {};
  function Switcher() {
    setter = useTenant().setActiveTenantId;
    return null;
  }
  render(
    <TenantProvider>
      <Switcher />
      <PromptDocumentList />
    </TenantProvider>
  );
  return {
    // The app's own switch: the provider's setter (it writes storage in
    // this tab, which fires no storage event here).
    switchTo: async (id: string) => {
      await act(async () => setter(id));
    },
  };
}

/** Set bravo-only's agent write tier, as an operator would. */
async function setBravoTier() {
  const user = userEvent.setup();
  await user.click(screen.getByTestId("doc-access-toggle-policy-bravo-only"));
  await user.click(
    await screen.findByTestId("doc-access-tier-policy-bravo-only-deny")
  );
}

describe("this tab switches project through the provider", () => {
  it("is followed: the rows and the status are re-read in the new project", async () => {
    const { switchTo } = mountIn(B, [SYS]);
    await screen.findByTestId("adopt-all", {}, { timeout: 5000 });
    const before = sent.length;

    await switchTo(SYS);

    expect(
      await screen.findByTestId("doc-row-policy-sys1")
    ).toBeInTheDocument();
    expect(listReads(after(before))).toEqual([SYS]);
    expect(statusReads(after(before))).toEqual([SYS]);
  }, 20_000);

  it("brings the system tenant's publish controls back after switching into it", async () => {
    // B's mount read latched not_system_tenant, stamped B. That says nothing
    // about the system tenant, whose own 200 must not be hidden behind it.
    const { switchTo } = mountIn(B, [SYS]);
    await screen.findByTestId("adopt-all", {}, { timeout: 5000 });

    await switchTo(SYS);
    await screen.findByTestId("doc-row-policy-sys1", {}, { timeout: 5000 });

    expect(
      await screen.findByTestId("publish-all", {}, { timeout: 5000 })
    ).toHaveTextContent("Publish all changed (2)");
    expect(
      screen.getByTestId("doc-publish-mode-policy-sys1")
    ).toBeInTheDocument();
    expect(screen.queryByTestId("adopt-all")).not.toBeInTheDocument();
  }, 20_000);

  it("re-takes the status read on every switch, back to the mount project too, and drops the previous project's publish state", async () => {
    // The system tenant's status names a held candidate under a name B also
    // has: a badge for it must not survive the switch back to B.
    systemCandidates = [
      {
        kind: "policy",
        name: "bravo-only",
        publish_mode: "auto",
        held: true,
        held_tokens: [{ token: "x" }],
      },
    ];
    const { switchTo } = mountIn(B, [SYS]);
    await screen.findByTestId("adopt-all", {}, { timeout: 5000 });

    await switchTo(SYS);
    await screen.findByTestId("doc-row-policy-sys1", {}, { timeout: 5000 });
    await screen.findByTestId("publish-all", {}, { timeout: 5000 });

    await switchTo(B);
    await screen.findByTestId(
      "doc-row-policy-bravo-only",
      {},
      {
        timeout: 5000,
      }
    );
    await waitFor(() => expect(statusReads(sent)).toEqual([B, SYS, B]));
    await settle();

    expect(
      screen.queryByTestId("doc-auto-publish-held-policy-bravo-only")
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("publish-all")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("doc-publish-mode-policy-bravo-only")
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("adopt-all")).toHaveTextContent(
      "Adopt all updates (1)"
    );
  }, 20_000);

  it("counts a failed status read in the new project as its answer, not the previous project's refusal", async () => {
    // The system tenant's status read fails without a refusal (a 400 that
    // retires nothing): the page holds no answer saying it is NOT the system
    // tenant, so B's refusal no longer hides the system tenant's controls.
    const { switchTo } = mountIn(B, [SYS]);
    await screen.findByTestId("adopt-all", {}, { timeout: 5000 });
    const failed = hold({ kind: "status", tenant: SYS, nth: 1, failWith: 400 });
    await switchTo(SYS);
    await screen.findByTestId("doc-row-policy-sys1", {}, { timeout: 5000 });
    await waitFor(() => expect(failed.arrived()).toBe(true));
    await settle();
    // Still out: B's refusal stands.
    expect(
      screen.queryByTestId("doc-publish-mode-policy-sys1")
    ).not.toBeInTheDocument();

    failed.release();
    expect(
      await screen.findByTestId(
        "doc-publish-mode-policy-sys1",
        {},
        {
          timeout: 5000,
        }
      )
    ).toBeInTheDocument();
  }, 20_000);

  it("drops an older list read that answers after a newer one", async () => {
    const { switchTo } = mountIn(B, [SYS]);
    await screen.findByTestId("adopt-all", {}, { timeout: 5000 });
    // B's NEXT list read — the re-read after a row write — is held.
    const late = hold({ kind: "list", tenant: B, nth: 2 });
    await setBravoTier();
    await waitFor(() => expect(late.arrived()).toBe(true));

    await switchTo(SYS);
    await screen.findByTestId("doc-row-policy-sys1", {}, { timeout: 5000 });

    // B's read now answers — after the system tenant's.
    late.release();
    await settle(100);
    expect(rowsShown()).toEqual(["sys1"]);
  }, 20_000);

  it("re-reads the page's project when it switches back before the previous switch's read answered", async () => {
    const { switchTo } = mountIn(B, [C]);
    await screen.findByTestId("adopt-all", {}, { timeout: 5000 });
    const cRows = hold({ kind: "list", tenant: C, nth: 1 });
    await switchTo(C);
    await waitFor(() => expect(cRows.arrived()).toBe(true));
    const before = sent.length;

    // Back to B while C's read is still out; then C's answers.
    await switchTo(B);
    await settle();
    cRows.release();
    await settle(100);

    expect(listReads(after(before))).toEqual([B]);
    expect(rowsShown()).toEqual(["bravo-only"]);
    expect(
      await screen.findByTestId("adopt-all", {}, { timeout: 5000 })
    ).toHaveTextContent("Adopt all updates (1)");
  }, 20_000);

  it("does not raise the error banner for an older read that fails after a newer one answered", async () => {
    const { switchTo } = mountIn(B, [SYS]);
    await screen.findByTestId("adopt-all", {}, { timeout: 5000 });
    const late = hold({ kind: "list", tenant: B, nth: 2, failWith: 403 });
    await setBravoTier();
    await waitFor(() => expect(late.arrived()).toBe(true));
    await switchTo(SYS);
    await screen.findByTestId("doc-row-policy-sys1", {}, { timeout: 5000 });

    late.release();
    await settle(100);
    expect(
      screen.queryByTestId("prompt-documents-error")
    ).not.toBeInTheDocument();
    expect(rowsShown()).toEqual(["sys1"]);
  }, 20_000);

  it("offers Adopt all only over rows read in the page's project", async () => {
    const { switchTo } = mountIn(B, [C]);
    await screen.findByTestId("adopt-all", {}, { timeout: 5000 });
    // C's first list read is held; its status read is not.
    const rows = hold({ kind: "list", tenant: C, nth: 1 });

    await switchTo(C);
    await waitFor(() => expect(statusReads(sent)).toEqual([B, C]));
    await waitFor(() => expect(rows.arrived()).toBe(true));
    await settle();
    // C answered not_system_tenant, C is stored, C is the page's project —
    // but the rows on screen are still B's.
    expect(rowsShown()).toEqual(["bravo-only"]);
    expect(screen.queryByTestId("adopt-all")).not.toBeInTheDocument();

    rows.release();
    await screen.findByTestId(
      "doc-row-policy-charlie-only",
      {},
      {
        timeout: 5000,
      }
    );
    expect(
      await screen.findByTestId("adopt-all", {}, { timeout: 5000 })
    ).toHaveTextContent("Adopt all updates (1)");
  }, 20_000);

  it("follows a switch back to the project the provider had loaded in", async () => {
    // The provider loaded in A; another tab stores B; this tab navigates
    // here client-side, then switches to C and back to A.
    listTenantsMock.mockResolvedValue({
      tenants: [A, B, C].map((id) => ({ id, slug: id, name: id })),
      active_tenant_id: A,
    });
    localStorage.setItem(KEY, A);
    let show: (v: boolean) => void = () => {};
    let setter: (id: string) => void = () => {};
    function Nav() {
      const [here, setHere] = useState(false);
      show = setHere;
      setter = useTenant().setActiveTenantId;
      return here ? <PromptDocumentList /> : <div />;
    }
    render(
      <TenantProvider>
        <Nav />
      </TenantProvider>
    );
    await waitFor(() => expect(listTenantsMock).toHaveBeenCalled());
    await settle(20);
    localStorage.setItem(KEY, B);
    await act(async () => show(true));
    await screen.findByTestId(
      "doc-row-policy-bravo-only",
      {},
      {
        timeout: 5000,
      }
    );
    await act(async () => setter(C));
    await screen.findByTestId(
      "doc-row-policy-charlie-only",
      {},
      {
        timeout: 5000,
      }
    );
    const before = sent.length;

    await act(async () => setter(A));
    await screen.findByTestId(
      "doc-row-policy-alpha-only",
      {},
      {
        timeout: 5000,
      }
    );
    await settle();

    expect(rowsShown()).toEqual(["alpha-only"]);
    expect(listReads(after(before))).toEqual([A]);
    expect(statusReads(after(before))).toEqual([A]);
  }, 20_000);
});

describe("another tab's switch", () => {
  it("keeps a row write's re-read in the page's project, so Adopt all returns over its own rows after the other tab switches back", async () => {
    mountIn(B, [SYS]);
    await screen.findByTestId("adopt-all", {}, { timeout: 5000 });
    // A row write here goes out in B; another tab stores the system tenant
    // while it is in flight — past the page's call-time guard, with no event
    // reaching this tab yet. Its re-read is pinned to B.
    onPatch = () => localStorage.setItem(KEY, SYS);
    const reread = hold({ kind: "list", tenant: B, nth: 2 });
    await setBravoTier();
    await waitFor(() => expect(reread.arrived()).toBe(true));
    // Not offered while the system tenant is stored.
    expect(screen.queryByTestId("adopt-all")).not.toBeInTheDocument();
    // That tab switches back; the re-read (sent in B) answers.
    localStorage.setItem(KEY, B);
    reread.release();
    await settle();
    expect(screen.getByTestId("doc-row-policy-bravo-only")).toBeInTheDocument();
    expect(screen.queryByTestId("doc-row-policy-sys1")).not.toBeInTheDocument();
  }, 20_000);
});

describe("a fresh browser", () => {
  it("keeps the publish controls hidden while the page's own status read is out, and offers Adopt all once its rows are read in its project", async () => {
    // Nothing stored; the provider reconciles to home, B, which is not the
    // system tenant. The mount reads carry no project.
    home = B;
    listTenantsMock.mockResolvedValue({
      tenants: [{ id: B, slug: "b", name: "Bravo" }],
      active_tenant_id: B,
    });
    const retake = hold({ kind: "status", tenant: B, nth: 2 });
    render(
      <TenantProvider>
        <PromptDocumentList />
      </TenantProvider>
    );
    await screen.findByTestId(
      "doc-row-policy-bravo-only",
      {},
      {
        timeout: 5000,
      }
    );
    await waitFor(() => expect(retake.arrived()).toBe(true));
    await settle();
    // The mount read's refusal carries no project; until the re-take pinned
    // to B answers, it is not overruled.
    expect(
      screen.queryByTestId("doc-publish-mode-policy-bravo-only")
    ).not.toBeInTheDocument();

    retake.release();
    expect(
      await screen.findByTestId("adopt-all", {}, { timeout: 5000 })
    ).toHaveTextContent("Adopt all updates (1)");
    expect(listReads(sent)).toEqual([null, B]);
    expect(statusReads(sent)).toEqual([null, B]);
  }, 20_000);
});

describe("a page whose first reads went out before its project was known", () => {
  it("keeps showing the load, not an empty corpus, when a superseded read answers first", async () => {
    // Nothing stored: the mount read goes out with no project (served B);
    // once the provider reconciles to B the page re-reads, pinned. Both are
    // held; the superseded one answers first.
    home = B;
    listTenantsMock.mockResolvedValue({
      tenants: [{ id: B, slug: "b", name: "Bravo" }],
      active_tenant_id: B,
    });
    const mountRead = hold({ kind: "list", tenant: B, nth: 1 });
    const reread = hold({ kind: "list", tenant: B, nth: 2 });
    render(
      <TenantProvider>
        <PromptDocumentList />
      </TenantProvider>
    );
    await waitFor(() => expect(reread.arrived()).toBe(true));
    mountRead.release();
    await settle();
    expect(screen.getByText("Loading documents…")).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^kind-band-empty-/)).toEqual([]);

    reread.release();
    expect(
      await screen.findByTestId(
        "doc-row-policy-bravo-only",
        {},
        {
          timeout: 5000,
        }
      )
    ).toBeInTheDocument();
  }, 20_000);

  it("withholds the publish controls while a stale id's re-take is out", async () => {
    // The stored id is not a member; coord serves it home, B. The provider
    // reconciles to B, and the status read is re-taken pinned to B.
    home = B;
    listTenantsMock.mockResolvedValue({
      tenants: [{ id: B, slug: "b", name: "Bravo" }],
      active_tenant_id: B,
    });
    localStorage.setItem(KEY, "t-stale");
    rowsFor["t-stale"] = [row("bravo-only")];
    const retake = hold({ kind: "status", tenant: B, nth: 1 });
    try {
      render(
        <TenantProvider>
          <PromptDocumentList />
        </TenantProvider>
      );
      await screen.findByTestId(
        "doc-row-policy-bravo-only",
        {},
        {
          timeout: 5000,
        }
      );
      await waitFor(() => expect(retake.arrived()).toBe(true));
      await settle();
      // The held refusal is the stale id's; B's own answer is not in yet.
      expect(
        screen.queryByTestId("doc-publish-mode-policy-bravo-only")
      ).not.toBeInTheDocument();

      retake.release();
      expect(
        await screen.findByTestId("adopt-all", {}, { timeout: 5000 })
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("doc-publish-mode-policy-bravo-only")
      ).not.toBeInTheDocument();
      expect(statusReads(sent)).toEqual(["t-stale", B]);
    } finally {
      delete rowsFor["t-stale"];
    }
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
    await settle(20);
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
