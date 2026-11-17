/**
 * The prompt-documents list after ANOTHER tab switches project — through the
 * REAL `HttpClient`, so every assertion is about where a request was actually
 * sent (`fetch` is faked; it answers by the `X-Qontinui-Active-Tenant` header
 * each request carried, and a request with none in the system tenant).
 *
 * The HTTP client reads the stored project per ATTEMPT — the first send, each
 * retry, the replay after a token refresh — so after another tab's switch an
 * unpinned request from this page would land in, or answer from, the OTHER
 * project while the rows on screen are this page's. What is pinned:
 *
 * 1. **Another tab's switch disables the list's controls and says so, with a
 *    Reload** (the `storage` event, or the stored project already differing
 *    when the page's project becomes known); switching back clears it.
 * 2. **Every write door raced past that — no event yet, or a dialog already
 *    open — is refused at call time**: nothing is sent. One test per door,
 *    each reaching it past every other guard, so removing any ONE guard fails
 *    a test here. So is opening a row's dialog.
 * 3. **A dialog's READS are not refused but pinned**: one sent while another
 *    project is stored is answered by the page's project and renders its data
 *    (a refused read would render as an empty one).
 * 4. **Everything in flight across the switch stays in the page's project**:
 *    a read retried after a 503, every write re-issued after a 429 or replayed
 *    after a token refresh, and the re-read each write takes.
 * 5. **THIS tab's own switch through the provider raises nothing**: the page
 *    follows it, and its writes go to the project it followed.
 * 6. **The dialogs' doors and readers keep one identity across renders**: a
 *    re-render of the list — a parent's, or the `saving` flag toggling through
 *    a restore — does not re-fetch the history dialog's versions or reset the
 *    version the operator selected.
 *
 * Every pin assertion is made while a DIFFERENT project is stored than the one
 * the request was pinned to, so an unpinned request is told apart from a
 * pinned one by where it went.
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
  // A refresh that succeeds — after running `token.onRefresh`, which is where
  // another tab's switch lands while this one refreshes.
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
// A clause's delete starts on a `DestructiveButton`, which refuses untrusted
// clicks, and jsdom cannot produce a trusted one (`isTrusted` is
// non-configurable on real events). The gate itself is pinned in
// `components/ui/destructive-button.test.tsx`; here it is replaced so the
// delete can be sent at all — the same stub `runners/page.test.tsx` uses.
vi.mock("@/components/ui/destructive-button", () => ({
  isSyntheticClick: () => false,
  DestructiveButton: (props: Record<string, unknown>) => (
    <button type="button" {...props} />
  ),
}));

import { PromptDocumentList } from "./PromptDocumentList";
import { TenantProvider, useTenant } from "@/contexts/tenant-context";

const KEY = "qontinui.active_tenant_id";
const SYS = "t-system";
const B = "t-bravo";
const DOC = "/coord/prompt-documents/policy/bravo-only";
/** bravo-only's own route: its body read, and its PATCH. */
const BODY = /\/coord\/prompt-documents\/policy\/bravo-only$/;
/** The list read. */
const LIST = /\/coord\/prompt-documents$/;
/** bravo-only's clause list read, and the clause create. */
const CLAUSES = /\/clauses$/;
type Sent = { method: string; url: string; tenant: string | null };
let sent: Sent[] = [];

/** A request held until the test releases it. */
type Hold = {
  method: string;
  match: RegExp;
  gate: Promise<void>;
  release: () => void;
  seen: boolean;
};
let holds: Hold[] = [];
/** Hold the next request (a GET unless `method` says otherwise) whose URL matches `match`. */
function hold(
  match: RegExp,
  method = "GET"
): { release: () => void; arrived: () => boolean } {
  let open: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const entry: Hold = {
    method,
    match,
    gate,
    release: () => open(),
    seen: false,
  };
  holds.push(entry);
  return { release: entry.release, arrived: () => entry.seen };
}

/**
 * Run `run` INSIDE the answer to the next request matching — after its header
 * was recorded, before it is answered: another tab's switch landing while the
 * request is in flight. With `status`, that answer is the status (a 429, a
 * 503, a 401) rather than the route's own, so the client re-issues the request
 * after the switch.
 */
type Inside = {
  method: string;
  match: RegExp;
  run: () => void;
  status?: number;
};
let insides: Inside[] = [];
function inAnswerTo(
  method: string,
  match: RegExp,
  run: () => void,
  status?: number
) {
  insides.push({ method, match, run, status });
}

const row = (name: string) => ({
  id: name,
  kind: "policy",
  name,
  description: null,
  format: "markdown",
  // A shipped default, so the editor offers Restore to default.
  default_source: `prompt_doc/policy/${name}/v1`,
  current_version: 7,
  updated_by: "x",
  updated_at: "2026-11-07T00:00:00Z",
  upstream_publication_version: 1,
  latest_publication_version: 2,
  local_modified: true,
  update_available: true,
  agent_write_effective_tier: "allow",
  agent_write_tier: "allow",
  agent_write_source: "operator",
});
const rowsFor: Record<string, unknown[]> = {
  [B]: [row("bravo-only")],
  [SYS]: [row("sys1")],
};
const versionMeta = (n: number) => ({
  id: `v${n}`,
  version_number: n,
  description: null,
  edited_by: "x",
  created_at: "2026-11-01T00:00:00Z",
});
const clause = (id: string, position: number) => ({
  clause_id: id,
  category: "testing",
  status: "active",
  tier: null,
  trigger: "when",
  action: "do",
  bounds: "",
  escalate_if: "",
  anti_triggers: [],
  depends_on: [],
  links: [],
  position,
  source: null,
});
const mergeSide = {
  clause_id: "x",
  category: "testing",
  status: "active",
  tier: null,
  trigger: null,
  action: "a",
  bounds: null,
  escalate_if: null,
  anti_triggers: [],
  depends_on: [],
  links: [],
};
/**
 * A clause plan with nothing to resolve: Merge applies on one click. Its one
 * clause is named after the project that served it, so the view shows whose
 * plan it is.
 */
const mergePlanIn = (served: string) => ({
  mode: "clauses",
  kind: "policy",
  name: "bravo-only",
  current_version: 7,
  tracked_publication_version: 1,
  publication_version: 2,
  publication_release_note: null,
  base_source: "tracked_publication",
  base_publication_version: 1,
  base_known: true,
  entries: [
    {
      clause: `tempo-in-${served}`,
      decision: "take_upstream_edit",
      requires_choice: false,
      base: mergeSide,
      local: mergeSide,
      upstream: { ...mergeSide, action: "b" },
    },
  ],
  conflicts: [],
  noop: false,
});
/** A publication of bravo-only, as the project that served it holds it. */
const publicationIn = (version: number, served: string) => ({
  publication_id: `p${version}`,
  kind: "policy",
  name: "bravo-only",
  publication_version: version,
  format: "markdown",
  description: null,
  release_note: `published from ${served}`,
  content_sha256: "x",
  source_version: version,
  published_by: "x",
  published_at: "2026-11-01T00:00:00Z",
  body: `published body v${version} in ${served}`,
});
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  localStorage.clear();
  sent = [];
  holds = [];
  insides = [];
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
      const served = tenant ?? SYS;
      const held = holds.find(
        (h) => !h.seen && h.method === method && h.match.test(url)
      );
      if (held) {
        held.seen = true;
        await held.gate;
      }
      const inside = insides.findIndex(
        (i) => i.method === method && i.match.test(url)
      );
      if (inside >= 0) {
        const [entry] = insides.splice(inside, 1);
        entry?.run();
        if (entry?.status !== undefined) {
          return json(entry.status, {
            error: "TRANSIENT",
            message: `answered ${entry.status}`,
          });
        }
      }
      if (url.includes("/auto-publish/status")) {
        // The system tenant has one changed document: Publish all is offered.
        return served === SYS
          ? json(200, { candidates: [], count: 1, publishing_enabled: true })
          : json(403, {
              error: "FORBIDDEN",
              message: JSON.stringify({
                error: "not_system_tenant",
                detail: "x",
              }),
            });
      }
      if (method === "POST" && url.endsWith("/publish-all")) {
        const body = JSON.parse(String(init?.body ?? "{}"));
        return body.dry_run === false
          ? json(200, { dry_run: false, results: [] })
          : json(200, {
              dry_run: true,
              candidates: [
                {
                  kind: "policy",
                  name: "sys1",
                  current_version: 7,
                  next_publication_version: 2,
                },
              ],
            });
      }
      if (method === "POST" && /\/publish$/.test(url)) {
        return json(200, {
          published: true,
          publication: publicationIn(2, served),
          lint: [],
          lint_is_advisory: true,
          immutable: "x",
        });
      }
      if (method !== "GET") {
        // Every write: an answer the hooks accept. The tests here assert
        // whether it was SENT, and where, not what it did.
        return json(200, { ...row("bravo-only"), body: "saved" });
      }
      if (url.includes("/coord/prompt-document-publications/")) {
        const version = Number(url.split("/").pop());
        return json(200, publicationIn(version, served));
      }
      if (url.includes("/upstream-merge?")) {
        return json(200, mergePlanIn(served));
      }
      if (/\/clauses$/.test(url)) {
        return json(200, [clause("first", 0), clause("second", 1)]);
      }
      if (/\/versions$/.test(url)) {
        return json(200, {
          document_id: "d",
          kind: "policy",
          name: "bravo-only",
          current_version: 7,
          // Each version names the project that served the list.
          versions: [7, 6, 5].map((n) => ({
            ...versionMeta(n),
            edited_by: `editor in ${served}`,
          })),
          total: 3,
        });
      }
      if (/\/versions\/\d+$/.test(url)) {
        const n = Number(url.split("/").pop());
        return json(200, {
          ...versionMeta(n),
          document_id: "d",
          body: `body v${n} in ${served}`,
        });
      }
      if (/\/coord\/prompt-documents\/policy\/[^/?]+$/.test(url)) {
        const name = url.split("/").pop() as string;
        return json(200, { ...row(name), body: `body in ${served}` });
      }
      if (/\/coord\/prompt-documents(\?|$)/.test(url)) {
        return json(200, { documents: rowsFor[served] ?? [], degraded: null });
      }
      return json(404, { error: "NOT_FOUND", message: "Not Found" });
    })
  );
});
afterEach(() => {
  for (const h of holds) h.release();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

const user = () => userEvent.setup({ pointerEventsCheck: 0 });
const after = (from: number) => sent.slice(from);
/** Requests sent since `from` whose method and URL match. */
const sentSince = (from: number, method: string, match: RegExp) =>
  after(from).filter((s) => s.method === method && match.test(s.url));
const settle = (ms = 50) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

/** Another tab writes the stored project: the event only OTHER tabs get. */
function anotherTabStores(tenant: string) {
  localStorage.setItem(KEY, tenant);
  window.dispatchEvent(
    new StorageEvent("storage", { key: KEY, newValue: tenant })
  );
}
/** Another tab writes the stored project, and its event has not arrived. */
function anotherTabStoresSilently(tenant: string) {
  localStorage.setItem(KEY, tenant);
}

function membership(active: string) {
  return {
    tenants: [
      { id: B, slug: "b", name: "Bravo" },
      { id: SYS, slug: "s", name: "System" },
    ],
    active_tenant_id: active,
  };
}

/** Mount in `page` under the provider, with a handle on this tab's switch. */
async function mountIn(page: string = B) {
  listTenantsMock.mockResolvedValue(membership(page));
  localStorage.setItem(KEY, page);
  let setter: (id: string) => void = () => {};
  let refresh: () => Promise<boolean> = async () => true;
  function Switcher() {
    const tenant = useTenant();
    setter = tenant.setActiveTenantId;
    refresh = tenant.refresh;
    return null;
  }
  // A FRESH element each time: re-rendering with the same element object
  // lets React bail out of the whole tree, which would render nothing anew.
  const tree = () => (
    <TenantProvider>
      <Switcher />
      <PromptDocumentList />
    </TenantProvider>
  );
  const view = render(tree());
  const name = page === SYS ? "sys1" : "bravo-only";
  await screen.findByTestId(`doc-row-policy-${name}`, {}, { timeout: 5000 });
  await settle();
  return {
    rerender: () => view.rerender(tree()),
    switchTo: async (id: string) => {
      await act(async () => setter(id));
    },
    /**
     * The provider's `refresh()` (a project rename calls it), held open: the
     * provider sits in `loading` — the page's project UNKNOWN — until the
     * returned release answers it.
     */
    refreshHeld: async (): Promise<() => void> => {
      let answer: () => void = () => {};
      listTenantsMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            answer = () => resolve(membership(page));
          })
      );
      await act(async () => {
        void refresh();
      });
      return () => answer();
    },
  };
}

/** The refusal is said — the notice is raised by the guard itself. */
async function expectNotice() {
  expect(
    await screen.findByTestId("prompt-documents-cross-tab")
  ).toHaveTextContent(
    "The active project was changed in another tab — reload to continue."
  );
}

async function openUpstreamDialog() {
  await user().click(screen.getByTestId("doc-upstream-policy-bravo-only"));
  const adopt = await screen.findByTestId(
    "upstream-adopt",
    {},
    { timeout: 5000 }
  );
  await waitFor(() => expect(adopt).toBeEnabled(), { timeout: 5000 });
}

async function openHistoryDialog() {
  await user().click(screen.getByTestId("doc-history-policy-bravo-only"));
  await screen.findByTestId("version-5", {}, { timeout: 5000 });
  await settle();
}

/** The upstream dialog's clause merge view, with Merge enabled. */
async function openMergeView() {
  await openUpstreamDialog();
  await user().click(screen.getByTestId("upstream-merge-clauses"));
  const apply = await screen.findByTestId("upstream-merge-apply");
  await waitFor(() => expect(apply).toBeEnabled());
}

/** The clause manager on bravo-only, its clauses read. */
async function openClauseManager() {
  await user().click(screen.getByTestId("doc-clauses-policy-bravo-only"));
  await screen.findByTestId("clause-row-first", {}, { timeout: 5000 });
  await settle();
}

/** Pick a category default tier in the open clause manager; Save is then enabled. */
async function chooseDefaultTier(tier: string) {
  await user().click(screen.getByTestId("category-default-tier"));
  await user().click(await screen.findByRole("option", { name: tier }));
  await waitFor(() =>
    expect(screen.getByTestId("category-default-tier-save")).toBeEnabled()
  );
}

/** Set bravo-only's agent write tier, as an operator would. */
async function setBravoTier() {
  await user().click(screen.getByTestId("doc-access-toggle-policy-bravo-only"));
  await user().click(
    await screen.findByTestId("doc-access-tier-policy-bravo-only-deny")
  );
}

describe("another tab switches project", () => {
  it("disables the list's controls and says so, with a Reload; switching back clears it", async () => {
    await mountIn();
    const before = sent.length;

    await act(async () => anotherTabStores(SYS));

    await expectNotice();
    expect(
      screen.getByTestId("prompt-documents-cross-tab-reload")
    ).toBeEnabled();
    for (const id of [
      "doc-access-toggle-policy-bravo-only",
      "doc-upstream-policy-bravo-only",
      "doc-edit-policy-bravo-only",
      "doc-history-policy-bravo-only",
      "doc-clauses-policy-bravo-only",
      "doc-publish-policy-bravo-only",
      "new-document",
    ]) {
      expect(screen.getByTestId(id)).toBeDisabled();
    }
    expect(after(before).filter((s) => s.method !== "GET")).toEqual([]);

    await act(async () => anotherTabStores(B));
    await waitFor(() =>
      expect(
        screen.queryByTestId("prompt-documents-cross-tab")
      ).not.toBeInTheDocument()
    );
    expect(screen.getByTestId("doc-edit-policy-bravo-only")).toBeEnabled();
  }, 20_000);

  it("is raised when the stored project already differs as the page's project becomes known", async () => {
    // The provider is still loading when the page mounts in Bravo; another
    // tab stores the system tenant before it answers, and that tab's event
    // reached this page while it had no project to compare against.
    let answer: () => void = () => {};
    listTenantsMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = () => resolve(membership(B));
        })
    );
    localStorage.setItem(KEY, B);
    render(
      <TenantProvider>
        <PromptDocumentList />
      </TenantProvider>
    );
    await screen.findByTestId(
      "doc-row-policy-bravo-only",
      {},
      { timeout: 5000 }
    );
    await act(async () => anotherTabStores(SYS));
    await settle();
    expect(
      screen.queryByTestId("prompt-documents-cross-tab")
    ).not.toBeInTheDocument();

    await act(async () => answer());

    await expectNotice();
    expect(screen.getByTestId("doc-edit-policy-bravo-only")).toBeDisabled();
  }, 20_000);
});

describe("while the provider refreshes", () => {
  it("keeps the notice up: the page's project is not forgotten while UNKNOWN", async () => {
    const { refreshHeld } = await mountIn();
    await act(async () => anotherTabStores(SYS));
    await expectNotice();

    const release = await refreshHeld();
    await settle();

    expect(
      screen.getByTestId("prompt-documents-cross-tab")
    ).toBeInTheDocument();
    expect(screen.getByTestId("doc-edit-policy-bravo-only")).toBeDisabled();
    release();
  }, 20_000);

  it("refuses a write raced past the notice", async () => {
    const { refreshHeld } = await mountIn();
    anotherTabStoresSilently(SYS);
    const release = await refreshHeld();
    await settle();
    const before = sent.length;

    await user().click(
      screen.getByTestId("doc-access-toggle-policy-bravo-only")
    );
    await user().click(
      await screen.findByTestId("doc-access-tier-policy-bravo-only-deny")
    );

    await expectNotice();
    await settle();
    expect(sentSince(before, "PATCH", /./)).toEqual([]);
    release();
  }, 20_000);
});

describe("this tab switches project through the provider", () => {
  it("raises nothing, and the page's writes go to the project it followed", async () => {
    const { switchTo } = await mountIn();

    await switchTo(SYS);
    await screen.findByTestId("doc-row-policy-sys1", {}, { timeout: 5000 });
    await settle();
    expect(
      screen.queryByTestId("prompt-documents-cross-tab")
    ).not.toBeInTheDocument();

    const before = sent.length;
    await user().click(screen.getByTestId("doc-access-toggle-policy-sys1"));
    await user().click(
      await screen.findByTestId("doc-access-tier-policy-sys1-deny")
    );
    await waitFor(() =>
      expect(sentSince(before, "PATCH", /policy\/sys1$/)).toHaveLength(1)
    );
    expect(sentSince(before, "PATCH", /policy\/sys1$/)[0]?.tenant).toBe(SYS);
    expect(
      screen.queryByTestId("prompt-documents-cross-tab")
    ).not.toBeInTheDocument();
  }, 20_000);
});

describe("a door raced past the notice is refused at call time", () => {
  describe("opening a row's dialog", () => {
    it.each([
      ["Edit", "doc-edit-policy-bravo-only", "prompt-document-editor"],
      ["History", "doc-history-policy-bravo-only", "prompt-document-history"],
      ["Clauses", "doc-clauses-policy-bravo-only", "clause-manager"],
      [
        "Upstream",
        "doc-upstream-policy-bravo-only",
        "prompt-document-upstream",
      ],
      ["Publish", "doc-publish-policy-bravo-only", "prompt-document-publish"],
    ])(
      "%s: the dialog does not open and nothing is read or sent",
      async (_label, control, dialog) => {
        await mountIn();
        anotherTabStoresSilently(SYS);
        const before = sent.length;

        await user().click(screen.getByTestId(control));

        await expectNotice();
        await settle();
        expect(screen.queryByTestId(dialog)).not.toBeInTheDocument();
        // No body read, no version/clause/publication read, no write.
        expect(
          after(before).filter(
            (s) =>
              s.method !== "GET" ||
              s.url.includes(DOC) ||
              s.url.includes("/coord/prompt-document-publications/")
          )
        ).toEqual([]);
      },
      20_000
    );
  });

  it("a row's agent write tier sends no PATCH", async () => {
    await mountIn();
    anotherTabStoresSilently(SYS);
    const before = sent.length;

    await user().click(
      screen.getByTestId("doc-access-toggle-policy-bravo-only")
    );
    await user().click(
      await screen.findByTestId("doc-access-tier-policy-bravo-only-deny")
    );

    await expectNotice();
    await settle();
    expect(sentSince(before, "PATCH", /./)).toEqual([]);
  }, 20_000);

  it("a row's publish mode sends no PATCH", async () => {
    // Publish modes are offered on the system tenant's rows only.
    await mountIn(SYS);
    await screen.findByTestId(
      "doc-publish-mode-policy-sys1",
      {},
      { timeout: 5000 }
    );
    anotherTabStoresSilently(B);
    const before = sent.length;

    await user().click(screen.getByTestId("doc-publish-mode-policy-sys1"));
    await user().click(
      await screen.findByTestId("doc-publish-mode-never-policy-sys1")
    );

    await expectNotice();
    await settle();
    expect(sentSince(before, "PATCH", /./)).toEqual([]);
  }, 20_000);

  it("the create dialog, already open, sends no POST", async () => {
    await mountIn();
    await user().click(screen.getByTestId("new-document"));
    await user().type(await screen.findByTestId("create-name"), "fresh-doc");
    await user().type(screen.getByTestId("create-body"), "a body");
    anotherTabStoresSilently(SYS);
    const before = sent.length;

    await user().click(screen.getByTestId("create-submit"));

    await expectNotice();
    await settle();
    expect(sentSince(before, "POST", /./)).toEqual([]);
  }, 20_000);

  it("the editor, already open, saves nothing", async () => {
    await mountIn();
    await user().click(screen.getByTestId("doc-edit-policy-bravo-only"));
    const body = await screen.findByTestId("doc-body");
    await waitFor(() => expect(body).toHaveValue(`body in ${B}`));
    await user().type(body, " more");
    anotherTabStoresSilently(SYS);
    const before = sent.length;

    await user().click(screen.getByTestId("doc-save"));

    await expectNotice();
    await settle();
    expect(sentSince(before, "PATCH", /./)).toEqual([]);
  }, 20_000);

  it("the editor, already open, restores no default", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await mountIn();
    await user().click(screen.getByTestId("doc-edit-policy-bravo-only"));
    const restore = await screen.findByTestId("doc-restore-default");
    await waitFor(() => expect(restore).toBeEnabled());
    anotherTabStoresSilently(SYS);
    const before = sent.length;

    await user().click(restore);

    await expectNotice();
    await settle();
    expect(sentSince(before, "POST", /./)).toEqual([]);
  }, 20_000);

  it("the history dialog, already open, restores no version", async () => {
    await mountIn();
    await openHistoryDialog();
    await user().click(await screen.findByTestId("restore-version"));
    const confirm = await screen.findByTestId("restore-version-confirm-button");
    anotherTabStoresSilently(SYS);
    const before = sent.length;

    await user().click(confirm);

    await expectNotice();
    await settle();
    expect(sentSince(before, "POST", /./)).toEqual([]);
  }, 20_000);

  it.each([
    ["Adopt", "upstream-adopt", /\/upstream-adopt$/],
    ["Keep mine", "upstream-keep-mine", /\/upstream-keep$/],
  ])(
    "the upstream dialog, already open: %s sends nothing",
    async (_label, control, route) => {
      await mountIn();
      await openUpstreamDialog();
      anotherTabStoresSilently(SYS);
      const before = sent.length;

      await user().click(screen.getByTestId(control));

      await expectNotice();
      await settle();
      expect(sentSince(before, "POST", route)).toEqual([]);
      expect(after(before).filter((s) => s.method !== "GET")).toEqual([]);
    },
    20_000
  );

  it("the upstream dialog's merge view, already open, applies no merge", async () => {
    await mountIn();
    await openUpstreamDialog();
    await user().click(screen.getByTestId("upstream-merge-clauses"));
    const apply = await screen.findByTestId("upstream-merge-apply");
    await waitFor(() => expect(apply).toBeEnabled());
    anotherTabStoresSilently(SYS);
    const before = sent.length;

    await user().click(apply);

    await expectNotice();
    await settle();
    expect(sentSince(before, "POST", /./)).toEqual([]);
  }, 20_000);

  it("the publish dialog, already open, publishes nothing", async () => {
    await mountIn();
    await user().click(screen.getByTestId("doc-publish-policy-bravo-only"));
    const confirm = await screen.findByTestId("publish-confirm");
    anotherTabStoresSilently(SYS);
    const before = sent.length;

    await user().click(confirm);

    await expectNotice();
    await settle();
    expect(sentSince(before, "POST", /./)).toEqual([]);
  }, 20_000);

  it("the publish-all dialog, already open, arms no run", async () => {
    await mountIn(SYS);
    await user().click(
      await screen.findByTestId("publish-all", {}, { timeout: 5000 })
    );
    const confirm = await screen.findByTestId("publish-all-confirm");
    await waitFor(() => expect(confirm).toBeEnabled());
    anotherTabStoresSilently(B);
    const before = sent.length;

    await user().click(confirm);

    await expectNotice();
    await settle();
    expect(sentSince(before, "POST", /./)).toEqual([]);
  }, 20_000);

  it("the clause manager, already open, writes no clause", async () => {
    await mountIn();
    await user().click(screen.getByTestId("doc-clauses-policy-bravo-only"));
    await screen.findByTestId("clause-row-first", {}, { timeout: 5000 });
    anotherTabStoresSilently(SYS);
    const before = sent.length;

    await user().click(screen.getAllByTitle("Move down")[0] as HTMLElement);

    await expectNotice();
    await settle();
    expect(after(before).filter((s) => s.method !== "GET")).toEqual([]);
  }, 20_000);
});

describe("a dialog's read, sent while another project is stored, is pinned to the page's project", () => {
  // Pinned rather than refused (corrected from #2179's "reads no …" tests,
  // which recorded the refusal): a refused read renders as an empty one —
  // "No versions recorded yet." — and a pinned one cannot answer from the
  // other project. Each is sent with the system tenant stored, and is
  // answered, and rendered, as Bravo.
  it("the editor's history link reads the version list in the page's project", async () => {
    await mountIn();
    await user().click(screen.getByTestId("doc-edit-policy-bravo-only"));
    const link = await screen.findByTestId("doc-show-history");
    await waitFor(() =>
      expect(screen.getByTestId("doc-body")).toHaveValue(`body in ${B}`)
    );
    anotherTabStoresSilently(SYS);
    const before = sent.length;

    await user().click(link);

    expect(
      await screen.findAllByText(`editor in ${B}`, {}, { timeout: 5000 })
    ).not.toHaveLength(0);
    expect(localStorage.getItem(KEY)).toBe(SYS);
    expect(
      sentSince(before, "GET", /\/versions$/).map((s) => s.tenant)
    ).toEqual([B]);
    expect(screen.queryByText(`editor in ${SYS}`)).not.toBeInTheDocument();
  }, 20_000);

  it("the history dialog, already open, reads its snapshot in the page's project", async () => {
    await mountIn();
    await openHistoryDialog();
    anotherTabStoresSilently(SYS);
    const before = sent.length;

    await user().click(screen.getByTestId("version-5"));

    await waitFor(() =>
      expect(screen.getByTestId("version-diff")).toHaveTextContent(
        `body v5 in ${B}`
      )
    );
    expect(localStorage.getItem(KEY)).toBe(SYS);
    expect(
      sentSince(before, "GET", /\/versions\/\d+$/).map((s) => s.tenant)
    ).toEqual([B]);
  }, 20_000);

  it("the upstream dialog reads its publication in the page's project when its body read lands after the switch", async () => {
    await mountIn();
    const bodyRead = hold(/\/coord\/prompt-documents\/policy\/bravo-only$/);
    await user().click(screen.getByTestId("doc-upstream-policy-bravo-only"));
    await waitFor(() => expect(bodyRead.arrived()).toBe(true));
    anotherTabStoresSilently(SYS);
    const before = sent.length;

    bodyRead.release();

    expect(
      await screen.findByTestId("upstream-release-note", {}, { timeout: 5000 })
    ).toHaveTextContent(`published from ${B}`);
    expect(localStorage.getItem(KEY)).toBe(SYS);
    const publicationReads = after(before).filter((s) =>
      s.url.includes("/coord/prompt-document-publications/")
    );
    expect(publicationReads).not.toHaveLength(0);
    expect(publicationReads.every((s) => s.tenant === B)).toBe(true);
  }, 20_000);

  it("the upstream dialog, already open, reads its merge plan in the page's project", async () => {
    await mountIn();
    await openUpstreamDialog();
    anotherTabStoresSilently(SYS);
    const before = sent.length;

    await user().click(screen.getByTestId("upstream-merge-clauses"));

    expect(
      await screen.findByTestId(
        `clause-merge-entry-tempo-in-${B}`,
        {},
        { timeout: 5000 }
      )
    ).toBeInTheDocument();
    expect(localStorage.getItem(KEY)).toBe(SYS);
    expect(
      sentSince(before, "GET", /\/upstream-merge\?/).map((s) => s.tenant)
    ).toEqual([B]);
  }, 20_000);

  it("stays in the page's project through a provider refresh, while that project is briefly UNKNOWN", async () => {
    const { refreshHeld } = await mountIn();
    await openHistoryDialog();
    anotherTabStoresSilently(SYS);
    const before = sent.length;
    // A project rename re-reads the membership: the provider is loading, so
    // the page's project is UNKNOWN for the round trip. The pin is the last
    // one known, so the open dialog neither re-fetches nor sends unpinned.
    const release = await refreshHeld();
    await settle();

    await user().click(screen.getByTestId("version-5"));

    await waitFor(() =>
      expect(screen.getByTestId("version-diff")).toHaveTextContent(
        `body v5 in ${B}`
      )
    );
    expect(localStorage.getItem(KEY)).toBe(SYS);
    expect(
      sentSince(before, "GET", /\/versions(\/\d+)?$/).map((s) => s.tenant)
    ).toEqual([B]);
    release();
  }, 20_000);
});

/**
 * Mount with nothing stored and no provider: the page's project is `null` —
 * none selected — and its reads are served the home project (here the system
 * tenant, which answers a request that carries no header).
 */
async function mountInNoProject() {
  render(<PromptDocumentList />);
  await screen.findByTestId("doc-row-policy-sys1", {}, { timeout: 5000 });
  await settle();
}

describe("while the page's project is null, a dialog's read is refused once another project is stored", () => {
  // No pin can hold a read to "no project": `pinActiveTenant(null)` sends no
  // header, so the client fills in whatever is stored on every attempt. So
  // with nothing to pin, each dialog reader is refused at call time — like a
  // write door, nothing sent and the notice raised — rather than answered by
  // the project another tab stored and shown as this page's. Each read is
  // reached after another tab stored Bravo, its event not yet arrived.
  it("the editor's history link sends no version-list read", async () => {
    await mountInNoProject();
    await user().click(screen.getByTestId("doc-edit-policy-sys1"));
    const link = await screen.findByTestId("doc-show-history");
    await waitFor(() =>
      expect(screen.getByTestId("doc-body")).toHaveValue(`body in ${SYS}`)
    );
    anotherTabStoresSilently(B);
    const before = sent.length;

    await user().click(link);

    await expectNotice();
    await settle();
    expect(localStorage.getItem(KEY)).toBe(B);
    expect(sentSince(before, "GET", /\/versions$/)).toEqual([]);
    expect(screen.queryByText(`editor in ${B}`)).not.toBeInTheDocument();
  }, 20_000);

  it("the history dialog, already open, sends no snapshot read", async () => {
    await mountInNoProject();
    await user().click(screen.getByTestId("doc-history-policy-sys1"));
    await screen.findByTestId("version-5", {}, { timeout: 5000 });
    await settle();
    anotherTabStoresSilently(B);
    const before = sent.length;

    await user().click(screen.getByTestId("version-5"));

    await expectNotice();
    await settle();
    expect(localStorage.getItem(KEY)).toBe(B);
    expect(sentSince(before, "GET", /\/versions\/\d+$/)).toEqual([]);
    expect(screen.queryByText(`body v5 in ${B}`)).not.toBeInTheDocument();
  }, 20_000);

  it("the upstream dialog sends no publication read when its body read lands after the switch", async () => {
    await mountInNoProject();
    const bodyRead = hold(/\/coord\/prompt-documents\/policy\/sys1$/);
    await user().click(screen.getByTestId("doc-upstream-policy-sys1"));
    await waitFor(() => expect(bodyRead.arrived()).toBe(true));
    anotherTabStoresSilently(B);
    const before = sent.length;

    bodyRead.release();

    await expectNotice();
    await settle();
    expect(localStorage.getItem(KEY)).toBe(B);
    expect(
      after(before).filter((s) =>
        s.url.includes("/coord/prompt-document-publications/")
      )
    ).toEqual([]);
    expect(
      screen.queryByText(`published from ${B}`, { exact: false })
    ).not.toBeInTheDocument();
  }, 20_000);

  it("the upstream dialog's merge view, already open, sends no merge-plan read", async () => {
    await mountInNoProject();
    await user().click(screen.getByTestId("doc-upstream-policy-sys1"));
    const adopt = await screen.findByTestId(
      "upstream-adopt",
      {},
      { timeout: 5000 }
    );
    await waitFor(() => expect(adopt).toBeEnabled(), { timeout: 5000 });
    anotherTabStoresSilently(B);
    const before = sent.length;

    await user().click(screen.getByTestId("upstream-merge-clauses"));

    await expectNotice();
    await settle();
    expect(localStorage.getItem(KEY)).toBe(B);
    expect(sentSince(before, "GET", /\/upstream-merge\?/)).toEqual([]);
    expect(
      screen.queryByTestId(`clause-merge-entry-tempo-in-${B}`)
    ).not.toBeInTheDocument();
  }, 20_000);
});

describe("the dialogs' doors' and readers' identity", () => {
  it("survives a re-render: the history dialog keeps its selected version and re-fetches nothing", async () => {
    const { rerender } = await mountIn();
    await openHistoryDialog();
    // The dialog pre-selects v6 (newest that is not current); pick v5.
    await user().click(screen.getByTestId("version-5"));
    await waitFor(() =>
      expect(sentSince(0, "GET", /\/versions\/5$/)).toHaveLength(1)
    );
    await settle();
    const lists = sentSince(0, "GET", /\/versions$/).length;
    const snapshots = sentSince(0, "GET", /\/versions\/\d+$/).length;

    rerender();
    await settle(100);

    expect(sentSince(0, "GET", /\/versions$/)).toHaveLength(lists);
    expect(sentSince(0, "GET", /\/versions\/\d+$/)).toHaveLength(snapshots);
    expect(screen.getByTestId("version-5")).toHaveClass("border-primary");
    expect(screen.getByTestId("version-6")).not.toHaveClass("border-primary");
  }, 20_000);

  it("a successful history restore sends no version-list or snapshot GET while `saving` toggles, and exactly one version-list GET after the body re-read", async () => {
    await mountIn();
    await openHistoryDialog();
    await user().click(screen.getByTestId("version-5"));
    await waitFor(() =>
      expect(screen.getByTestId("version-diff")).toHaveTextContent(
        `body v5 in ${B}`
      )
    );
    await user().click(await screen.findByTestId("restore-version"));
    const confirm = await screen.findByTestId("restore-version-confirm-button");
    await settle();
    // The restore and the body re-read after it are held, so the stretch
    // while `saving` toggles is observed apart from what follows; another tab
    // switches project inside the restore's answer, so every read after it is
    // made with the system tenant stored.
    const restore = hold(/\/versions\/5\/restore$/, "POST");
    inAnswerTo("POST", /\/versions\/5\/restore$/, () =>
      anotherTabStoresSilently(SYS)
    );
    const body = hold(/\/coord\/prompt-documents\/policy\/bravo-only$/);
    const versionReads = (from: number) =>
      sentSince(from, "GET", /\/versions(\/\d+)?$/);
    const before = sent.length;

    await user().click(confirm);
    await waitFor(() => expect(restore.arrived()).toBe(true));
    await settle(100);
    // The restore is in flight and `saving` is set: nothing is re-fetched.
    expect(versionReads(before)).toEqual([]);

    restore.release();
    await waitFor(() => expect(body.arrived()).toBe(true), { timeout: 5000 });
    await settle(100);
    // Answered: the list was re-read (in the page's project) and `saving`
    // cleared, and the body re-read is out — still nothing re-fetched.
    expect(versionReads(before)).toEqual([]);
    expect(sentSince(before, "GET", LIST).map((s) => s.tenant)).toEqual([B]);

    const atBody = sent.length;
    body.release();
    await waitFor(
      () => expect(sentSince(atBody, "GET", /\/versions$/)).toHaveLength(1),
      { timeout: 5000 }
    );
    await settle(200);
    // The body re-read moved the dialog's target: ONE version-list read, and
    // every version read after it, in the page's project.
    expect(localStorage.getItem(KEY)).toBe(SYS);
    expect(
      sentSince(atBody, "GET", /\/versions$/).map((s) => s.tenant)
    ).toEqual([B]);
    expect(versionReads(atBody).every((s) => s.tenant === B)).toBe(true);
  }, 20_000);
});

describe("a read in flight across the switch", () => {
  it("a body read answered 503 with the switch inside the answer retries in the page's project", async () => {
    await mountIn();
    inAnswerTo("GET", BODY, () => anotherTabStoresSilently(SYS), 503);
    const before = sent.length;

    await user().click(screen.getByTestId("doc-edit-policy-bravo-only"));

    await waitFor(
      () => expect(screen.getByTestId("doc-body")).toHaveValue(`body in ${B}`),
      { timeout: 5000 }
    );
    expect(localStorage.getItem(KEY)).toBe(SYS);
    expect(sentSince(before, "GET", BODY).map((s) => s.tenant)).toEqual([B, B]);
  }, 20_000);
});

/** The other project of the two: where another tab switches the page away to. */
const otherThan = (page: string) => (page === SYS ? B : SYS);

/**
 * One write the page sends, and how to send it: `arrange` brings it to the
 * click that sends it, `send` is that click. `reread` is the re-read the write
 * takes itself, when it has one of its own (the list-level re-reads after a
 * write are checked one by one below).
 */
type Write = {
  label: string;
  page: string;
  method: string;
  route: RegExp;
  arrange?: () => Promise<void>;
  send: () => Promise<void>;
  reread?: RegExp;
};

const WRITES: Write[] = [
  {
    label: "a row's agent write tier",
    page: B,
    method: "PATCH",
    route: BODY,
    reread: LIST,
    send: setBravoTier,
  },
  {
    label: "the editor's save",
    page: B,
    method: "PATCH",
    route: BODY,
    reread: LIST,
    arrange: async () => {
      await user().click(screen.getByTestId("doc-edit-policy-bravo-only"));
      const body = await screen.findByTestId("doc-body");
      await waitFor(() => expect(body).toHaveValue(`body in ${B}`));
      await user().type(body, " more");
    },
    send: () => user().click(screen.getByTestId("doc-save")),
  },
  {
    label: "the create dialog's create",
    page: B,
    method: "POST",
    route: /\/coord\/prompt-documents\/policy$/,
    reread: LIST,
    arrange: async () => {
      await user().click(screen.getByTestId("new-document"));
      await user().type(await screen.findByTestId("create-name"), "fresh-doc");
      await user().type(screen.getByTestId("create-body"), "a body");
    },
    send: () => user().click(screen.getByTestId("create-submit")),
  },
  {
    label: "the editor's restore to default",
    page: B,
    method: "POST",
    route: /\/restore-default$/,
    reread: LIST,
    arrange: async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      await user().click(screen.getByTestId("doc-edit-policy-bravo-only"));
      const restore = await screen.findByTestId("doc-restore-default");
      await waitFor(() => expect(restore).toBeEnabled());
    },
    send: () => user().click(screen.getByTestId("doc-restore-default")),
  },
  {
    label: "the history dialog's restore",
    page: B,
    method: "POST",
    route: /\/versions\/\d+\/restore$/,
    reread: LIST,
    arrange: async () => {
      await openHistoryDialog();
      await user().click(await screen.findByTestId("restore-version"));
      await screen.findByTestId("restore-version-confirm-button");
    },
    send: () =>
      user().click(screen.getByTestId("restore-version-confirm-button")),
  },
  {
    label: "the upstream dialog's Adopt",
    page: B,
    method: "POST",
    route: /\/upstream-adopt$/,
    arrange: openUpstreamDialog,
    send: () => user().click(screen.getByTestId("upstream-adopt")),
  },
  {
    label: "the upstream dialog's Keep mine",
    page: B,
    method: "POST",
    route: /\/upstream-keep$/,
    arrange: openUpstreamDialog,
    send: () => user().click(screen.getByTestId("upstream-keep-mine")),
  },
  {
    label: "the upstream dialog's clause merge",
    page: B,
    method: "POST",
    route: /\/upstream-merge$/,
    arrange: openMergeView,
    send: () => user().click(screen.getByTestId("upstream-merge-apply")),
  },
  {
    label: "the publish dialog's publish",
    page: B,
    method: "POST",
    route: /\/publish$/,
    arrange: async () => {
      await user().click(screen.getByTestId("doc-publish-policy-bravo-only"));
      await screen.findByTestId("publish-confirm");
    },
    send: () => user().click(screen.getByTestId("publish-confirm")),
  },
  {
    label: "a row's publish mode",
    page: SYS,
    method: "PATCH",
    route: /\/policy\/sys1$/,
    arrange: async () => {
      await screen.findByTestId(
        "doc-publish-mode-policy-sys1",
        {},
        { timeout: 5000 }
      );
    },
    send: async () => {
      await user().click(screen.getByTestId("doc-publish-mode-policy-sys1"));
      await user().click(
        await screen.findByTestId("doc-publish-mode-never-policy-sys1")
      );
    },
  },
  {
    label: "Publish all changed's dry run",
    page: SYS,
    method: "POST",
    route: /\/publish-all$/,
    arrange: async () => {
      await screen.findByTestId("publish-all", {}, { timeout: 5000 });
    },
    send: () => user().click(screen.getByTestId("publish-all")),
  },
  {
    label: "the publish-all dialog's armed run",
    page: SYS,
    method: "POST",
    route: /\/publish-all$/,
    arrange: async () => {
      await user().click(
        await screen.findByTestId("publish-all", {}, { timeout: 5000 })
      );
      const confirm = await screen.findByTestId("publish-all-confirm");
      await waitFor(() => expect(confirm).toBeEnabled());
    },
    send: () => user().click(screen.getByTestId("publish-all-confirm")),
  },
  {
    label: "the clause editor's create",
    page: B,
    method: "POST",
    route: CLAUSES,
    reread: CLAUSES,
    arrange: async () => {
      await openClauseManager();
      await user().click(screen.getByTestId("clause-new"));
      await user().type(await screen.findByTestId("clause-id"), "fresh-clause");
      await user().type(screen.getByTestId("clause-trigger"), "when");
      await user().type(screen.getByTestId("clause-action"), "do");
    },
    send: () => user().click(screen.getByTestId("clause-save")),
  },
  {
    label: "the clause editor's update",
    page: B,
    method: "PATCH",
    route: /\/clauses\/first$/,
    reread: CLAUSES,
    arrange: async () => {
      await openClauseManager();
      await user().click(screen.getAllByTitle("Edit clause")[0] as HTMLElement);
      await user().type(await screen.findByTestId("clause-action"), " more");
    },
    send: () => user().click(screen.getByTestId("clause-save")),
  },
  {
    label: "a clause's delete",
    page: B,
    method: "DELETE",
    route: /\/clauses\/first$/,
    reread: CLAUSES,
    arrange: async () => {
      await openClauseManager();
      await user().click(
        screen.getAllByTitle("Delete clause")[0] as HTMLElement
      );
      await screen.findByRole("button", { name: "Delete" });
    },
    send: () => user().click(screen.getByRole("button", { name: "Delete" })),
  },
  {
    label: "a clause's move",
    page: B,
    method: "POST",
    route: /\/clauses\/reorder$/,
    reread: CLAUSES,
    arrange: openClauseManager,
    send: () =>
      user().click(screen.getAllByTitle("Move down")[0] as HTMLElement),
  },
  {
    label: "the clause import",
    page: B,
    method: "POST",
    route: CLAUSES,
    reread: CLAUSES,
    arrange: async () => {
      await openClauseManager();
      await user().click(screen.getByTestId("clause-import-open"));
      await user().click(await screen.findByTestId("clause-import-yaml"));
      await user().paste(
        "- clause_id: imported\n  trigger: when\n  action: do\n"
      );
      await waitFor(() =>
        expect(screen.getByTestId("clause-import-submit")).toBeEnabled()
      );
    },
    send: () => user().click(screen.getByTestId("clause-import-submit")),
  },
  {
    label: "the clause manager's category default tier",
    page: B,
    method: "PATCH",
    route: BODY,
    arrange: async () => {
      await openClauseManager();
      await chooseDefaultTier("ask-first");
    },
    send: () => user().click(screen.getByTestId("category-default-tier-save")),
  },
];

describe("a write sent before the switch and re-issued after it lands in the page's project", () => {
  it.each(WRITES.map((write) => [write.label, write] as const))(
    "%s: a 429 with the other project stored inside the answer",
    async (_label, write) => {
      const other = otherThan(write.page);
      await mountIn(write.page);
      await write.arrange?.();
      await settle();
      // The write goes out in the page's project; another tab switches project
      // inside its 429, so the client's re-issue is built with the OTHER one
      // stored.
      inAnswerTo(
        write.method,
        write.route,
        () => anotherTabStoresSilently(other),
        429
      );
      const before = sent.length;

      await write.send();

      await waitFor(
        () =>
          expect(sentSince(before, write.method, write.route)).toHaveLength(2),
        { timeout: 5000 }
      );
      expect(localStorage.getItem(KEY)).toBe(other);
      expect(
        sentSince(before, write.method, write.route).map((s) => s.tenant)
      ).toEqual([write.page, write.page]);
      const reread = write.reread;
      if (reread) {
        await waitFor(
          () => expect(sentSince(before, "GET", reread)).not.toHaveLength(0),
          { timeout: 5000 }
        );
        await settle();
        // Every re-read the write took, in the page's project.
        const rereads = sentSince(before, "GET", reread).map((s) => s.tenant);
        expect(new Set(rereads)).toEqual(new Set([write.page]));
      }
    },
    20_000
  );

  it("a row's agent write tier: replayed after a token refresh with the other project stored during the refresh", async () => {
    await mountIn();
    // The PATCH is answered 401 on a stale token; another tab switches project
    // while this one refreshes, so the replay is built with SYS stored.
    token.expiry = Date.now() - 1000;
    token.onRefresh = () => anotherTabStoresSilently(SYS);
    inAnswerTo("PATCH", BODY, () => {}, 401);
    const before = sent.length;

    await setBravoTier();

    await waitFor(
      () => expect(sentSince(before, "PATCH", BODY)).toHaveLength(2),
      { timeout: 5000 }
    );
    expect(localStorage.getItem(KEY)).toBe(SYS);
    expect(sentSince(before, "PATCH", BODY).map((s) => s.tenant)).toEqual([
      B,
      B,
    ]);
  }, 20_000);
});

describe("the re-read after a write is sent in the page's project", () => {
  // Each write is answered 200 with another tab's switch made INSIDE its
  // answer, so the re-read after it is sent with the other project stored.
  it.each([
    ["Adopt", openUpstreamDialog, "upstream-adopt", /\/upstream-adopt$/],
    ["Keep mine", openUpstreamDialog, "upstream-keep-mine", /\/upstream-keep$/],
    ["merge", openMergeView, "upstream-merge-apply", /\/upstream-merge$/],
  ] as const)(
    "the re-read after %s is sent in the page's project",
    async (_label, open, control, route) => {
      await mountIn();
      await open();
      inAnswerTo("POST", route, () => anotherTabStoresSilently(SYS));
      const before = sent.length;

      await user().click(screen.getByTestId(control));

      await waitFor(
        () => expect(sentSince(before, "GET", LIST)).not.toHaveLength(0),
        { timeout: 5000 }
      );
      await settle();
      expect(localStorage.getItem(KEY)).toBe(SYS);
      expect(sentSince(before, "GET", LIST).map((s) => s.tenant)).toEqual([B]);
      expect(
        screen.getByTestId("doc-row-policy-bravo-only")
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("doc-row-policy-sys1")
      ).not.toBeInTheDocument();
    },
    20_000
  );

  it("the re-read after a publish-mode change is sent in the page's project", async () => {
    await mountIn(SYS);
    await screen.findByTestId(
      "doc-publish-mode-policy-sys1",
      {},
      { timeout: 5000 }
    );
    inAnswerTo("PATCH", /\/policy\/sys1$/, () => anotherTabStoresSilently(B));
    const before = sent.length;

    await user().click(screen.getByTestId("doc-publish-mode-policy-sys1"));
    await user().click(
      await screen.findByTestId("doc-publish-mode-never-policy-sys1")
    );

    await waitFor(
      () => expect(sentSince(before, "GET", LIST)).not.toHaveLength(0),
      { timeout: 5000 }
    );
    await settle();
    expect(localStorage.getItem(KEY)).toBe(B);
    expect(sentSince(before, "GET", LIST).map((s) => s.tenant)).toEqual([SYS]);
    expect(screen.getByTestId("doc-row-policy-sys1")).toBeInTheDocument();
  }, 20_000);

  it("the re-read after a publish is sent in the page's project", async () => {
    await mountIn();
    await user().click(screen.getByTestId("doc-publish-policy-bravo-only"));
    const confirm = await screen.findByTestId("publish-confirm");
    inAnswerTo("POST", /\/publish$/, () => anotherTabStoresSilently(SYS));
    const before = sent.length;

    await user().click(confirm);

    await waitFor(
      () => expect(sentSince(before, "GET", LIST)).not.toHaveLength(0),
      { timeout: 5000 }
    );
    await settle();
    expect(localStorage.getItem(KEY)).toBe(SYS);
    expect(sentSince(before, "GET", LIST).map((s) => s.tenant)).toEqual([B]);
    expect(screen.getByTestId("doc-row-policy-bravo-only")).toBeInTheDocument();
  }, 20_000);

  it("the re-read after publish-all is sent in the page's project", async () => {
    await mountIn(SYS);
    await user().click(
      await screen.findByTestId("publish-all", {}, { timeout: 5000 })
    );
    const confirm = await screen.findByTestId("publish-all-confirm");
    await waitFor(() => expect(confirm).toBeEnabled());
    inAnswerTo("POST", /\/publish-all$/, () => anotherTabStoresSilently(B));
    const before = sent.length;

    await user().click(confirm);

    await waitFor(
      () => expect(sentSince(before, "GET", LIST)).not.toHaveLength(0),
      { timeout: 5000 }
    );
    await settle();
    expect(localStorage.getItem(KEY)).toBe(B);
    expect(sentSince(before, "GET", LIST).map((s) => s.tenant)).toEqual([SYS]);
    expect(screen.getByTestId("doc-row-policy-sys1")).toBeInTheDocument();
  }, 20_000);

  it("the re-read after a clause write is sent in the page's project", async () => {
    // The category default tier: the clause manager's write whose re-read is
    // the page's list (`useClauses` hands it to `onAttrsSaved`).
    await mountIn();
    await openClauseManager();
    await chooseDefaultTier("ask-first");
    inAnswerTo("PATCH", BODY, () => anotherTabStoresSilently(SYS));
    const before = sent.length;

    await user().click(screen.getByTestId("category-default-tier-save"));

    await waitFor(
      () => expect(sentSince(before, "GET", LIST)).not.toHaveLength(0),
      { timeout: 5000 }
    );
    await settle();
    expect(localStorage.getItem(KEY)).toBe(SYS);
    expect(sentSince(before, "GET", LIST).map((s) => s.tenant)).toEqual([B]);
  }, 20_000);
});
