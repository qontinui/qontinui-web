/**
 * The prompt-documents list after ANOTHER tab switches project — through the
 * REAL `HttpClient`, so every assertion is about where a request was actually
 * sent (`fetch` is faked; it answers by the `X-Qontinui-Active-Tenant` header
 * each request carried, and a request with none in the system tenant).
 *
 * The HTTP client reads the stored project per request, so after another
 * tab's switch an unpinned write from this page would land in the OTHER
 * project while the rows on screen are this page's. What is pinned:
 *
 * 1. **Another tab's switch disables the list's controls and says so, with a
 *    Reload** (the `storage` event, or the stored project already differing
 *    when the page's project becomes known); switching back clears it.
 * 2. **Every door raced past that — no event yet, or a dialog already open —
 *    is refused at call time**: nothing is sent. One test per door, each
 *    reaching it past every other guard, so removing any ONE guard fails a
 *    test here.
 * 3. **THIS tab's own switch through the provider raises nothing**: the page
 *    follows it, and its writes go to the project it followed.
 * 4. **The guarded doors keep one identity across renders**: a re-render of
 *    the list does not re-fetch the history dialog's versions or reset the
 *    version the operator selected.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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
const B = "t-bravo";
const DOC = "/coord/prompt-documents/policy/bravo-only";
type Sent = { method: string; url: string; tenant: string | null };
let sent: Sent[] = [];

/** A request held until the test releases it. */
type Hold = {
  match: RegExp;
  gate: Promise<void>;
  release: () => void;
  seen: boolean;
};
let holds: Hold[] = [];
/** Hold the next GET whose URL matches `match`. */
function hold(match: RegExp): { release: () => void; arrived: () => boolean } {
  let open: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const entry: Hold = { match, gate, release: () => open(), seen: false };
  holds.push(entry);
  return { release: entry.release, arrived: () => entry.seen };
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
/** A clause plan with nothing to resolve: Merge applies on one click. */
const mergePlan = {
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
      clause: "tempo",
      decision: "take_upstream_edit",
      requires_choice: false,
      base: mergeSide,
      local: mergeSide,
      upstream: { ...mergeSide, action: "b" },
    },
  ],
  conflicts: [],
  noop: false,
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  localStorage.clear();
  sent = [];
  holds = [];
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
      const held = holds.find((h) => !h.seen && h.match.test(url));
      if (held && method === "GET") {
        held.seen = true;
        await held.gate;
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
      if (method !== "GET") {
        // Every write: an answer the hooks accept. The tests here assert
        // whether it was SENT, not what it did.
        return json(200, { ...row("bravo-only"), body: "saved" });
      }
      if (url.includes("/coord/prompt-document-publications/")) {
        const version = Number(url.split("/").pop());
        return json(200, {
          publication_id: `p${version}`,
          kind: "policy",
          name: "bravo-only",
          publication_version: version,
          format: "markdown",
          description: null,
          release_note: null,
          content_sha256: "x",
          source_version: version,
          published_by: "x",
          published_at: "2026-11-01T00:00:00Z",
          body: `published body v${version}`,
        });
      }
      if (url.includes("/upstream-merge?")) return json(200, mergePlan);
      if (/\/clauses$/.test(url)) {
        return json(200, [clause("first", 0), clause("second", 1)]);
      }
      if (/\/versions$/.test(url)) {
        return json(200, {
          document_id: "d",
          kind: "policy",
          name: "bravo-only",
          current_version: 7,
          versions: [7, 6, 5].map(versionMeta),
          total: 3,
        });
      }
      if (/\/versions\/\d+$/.test(url)) {
        const n = Number(url.split("/").pop());
        return json(200, {
          ...versionMeta(n),
          document_id: "d",
          body: `body v${n}`,
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
  function Switcher() {
    setter = useTenant().setActiveTenantId;
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

  it("the editor's history link reads no version list", async () => {
    await mountIn();
    await user().click(screen.getByTestId("doc-edit-policy-bravo-only"));
    const link = await screen.findByTestId("doc-show-history");
    await waitFor(() =>
      expect(screen.getByTestId("doc-body")).toHaveValue(`body in ${B}`)
    );
    anotherTabStoresSilently(SYS);
    const before = sent.length;

    await user().click(link);

    await expectNotice();
    await settle();
    expect(sentSince(before, "GET", /\/versions/)).toEqual([]);
  }, 20_000);

  it("the history dialog, already open, reads no version snapshot", async () => {
    await mountIn();
    await openHistoryDialog();
    anotherTabStoresSilently(SYS);
    const before = sent.length;

    await user().click(screen.getByTestId("version-5"));

    await expectNotice();
    await settle();
    expect(sentSince(before, "GET", /\/versions/)).toEqual([]);
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

  it("the upstream dialog reads no publication once its body read lands after the switch", async () => {
    await mountIn();
    const bodyRead = hold(/\/coord\/prompt-documents\/policy\/bravo-only$/);
    await user().click(screen.getByTestId("doc-upstream-policy-bravo-only"));
    await waitFor(() => expect(bodyRead.arrived()).toBe(true));
    anotherTabStoresSilently(SYS);
    const before = sent.length;

    bodyRead.release();

    await expectNotice();
    await settle();
    expect(
      after(before).filter((s) =>
        s.url.includes("/coord/prompt-document-publications/")
      )
    ).toEqual([]);
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

  it("the upstream dialog, already open, reads no merge plan", async () => {
    await mountIn();
    await openUpstreamDialog();
    anotherTabStoresSilently(SYS);
    const before = sent.length;

    await user().click(screen.getByTestId("upstream-merge-clauses"));

    await expectNotice();
    await settle();
    expect(sentSince(before, "GET", /\/upstream-merge/)).toEqual([]);
  }, 20_000);

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

describe("the guarded doors' identity", () => {
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
});
