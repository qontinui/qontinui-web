/**
 * The prompt-documents PAGE's settings after another tab switches project.
 *
 * Renders the real page with the real settings controls, through the REAL
 * `HttpClient` (`fetch` is faked per URL, and records the
 * `X-Qontinui-Active-Tenant` header each request carried), so every assertion
 * about a pin is about where a request was actually sent. Two properties:
 *
 * 1. **A settings write raced past the page's disabled fieldset is refused.**
 *    A confirmation renders outside the fieldset, and a click can land before
 *    the other tab's `storage` event does. Each test opens the control's
 *    confirmation — or, for the compliance settings, which have none, readies
 *    the save — while this page's project is stored, then another tab stores a
 *    different one (its event not yet arrived), then confirms. Nothing may be
 *    sent: the page's call-time guard, which the list hands up, refuses the
 *    write and raises the notice.
 * 2. **A settings request in flight across the switch stays in the page's
 *    project.** Every section write re-issued after a 429, or replayed after a
 *    token refresh, with the other project stored meanwhile; the read-back each
 *    write takes; every section read retried after a 503; a read sent after the
 *    switch is stored; and the page's own auto-publish status re-take after a
 *    dial write. The page pins them to the project the list hands up with its
 *    guard, so each is told apart from an unpinned request by where it went —
 *    also when that project becomes known only after the page mounted, as on a
 *    hard load under the layout's tenant provider.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
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

import PromptDocumentsPage from "../page";
import { TenantProvider } from "@/contexts/tenant-context";

const KEY = "qontinui.active_tenant_id";
/** The page's project. */
const B = "t-bravo";
/** The project another tab switches to. */
const SYS = "t-system";

type Sent = { method: string; url: string; tenant: string | null };
let sent: Sent[] = [];

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

function view(domain: string, level: string) {
  return {
    domain,
    effective_level: level,
    master_enabled: true,
    resolved_scope: "tenant",
    can_edit: true,
    keys_not_shown: [],
    keys_not_shown_source: null,
  };
}

const COMPLIANCE_CONFIG = {
  enabled: true,
  mode: "nudge",
  max_attempts: 1,
  enforced_clause_ref: "policy/planning-and-scope#finish-to-zero",
  applicable: true,
  applicability_reason: "applicable",
  clause_resolved_via: "registry",
  prompt_document_version: 7,
  current_version: 3,
};

/** Kind-tier rows served beside `audience_profile`; a test adds one. */
let extraKindRows: unknown[] = [];

function answer(url: string): unknown {
  if (url.includes("/auto-publish/status")) {
    return { candidates: [], count: 0, publishing_enabled: true };
  }
  if (url.includes("/fleet-policy")) {
    const domain = new URL(url, "http://x").searchParams.get("domain") ?? "";
    const level =
      domain === "policy_write"
        ? "tightening_only"
        : domain === "policy_upstream"
          ? "notify"
          : "off";
    return view(domain, level);
  }
  if (url.includes("/prompt-document-kind-tiers")) {
    return {
      kinds: [
        {
          kind: "audience_profile",
          tier: null,
          unreadable: false,
          builtin_default_tier: "deny",
          effective_tier: "deny",
          effective_source: "default",
        },
        ...extraKindRows,
      ],
      vocabulary: ["deny", "allow", "allow_with_notification"],
      notification_enforced: false,
      warning: "x",
    };
  }
  if (url.includes("/session-compliance/config/versions")) {
    return { versions: [] };
  }
  if (url.includes("/session-compliance/config")) return COMPLIANCE_CONFIG;
  if (url.includes("/session-compliance/sessions")) return { sessions: [] };
  if (url.includes("/session-compliance/outstanding")) return { items: [] };
  if (/\/coord\/prompt-documents(\?|$)/.test(url)) {
    return { documents: [], degraded: null };
  }
  return null;
}

/**
 * Every write answers as accepted, in the shape its hook reads: the refusal
 * tests assert it was not SENT, the in-flight tests where it was sent.
 */
function written(url: string, body: string | null): unknown {
  const sentBody = JSON.parse(body ?? "{}") as Record<string, unknown>;
  if (url.endsWith("/fleet-policy")) {
    const domain = String(sentBody.domain);
    const level = String(sentBody.level);
    return {
      ok: true,
      domain,
      written_level: level,
      written_master_enabled: true,
      versioned: true,
      version: 2,
      updated_by: "operator@example.com",
      effective: view(domain, level),
      readback_error: null,
    };
  }
  if (url.endsWith("/session-compliance/config")) {
    return { ...COMPLIANCE_CONFIG, ...sentBody, current_version: 4 };
  }
  return { ok: true };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  sent = [];
  insides = [];
  extraKindRows = [];
  listTenantsMock.mockReset();
  token.expiry = Date.now() + 3_600_000;
  token.onRefresh = null;
  localStorage.clear();
  localStorage.setItem(KEY, B);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      const tenant =
        ((init?.headers ?? {}) as Record<string, string>)[
          "X-Qontinui-Active-Tenant"
        ] ?? null;
      sent.push({ method, url, tenant });
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
      return json(
        200,
        method === "GET"
          ? answer(url)
          : written(url, typeof init?.body === "string" ? init.body : null)
      );
    })
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

const user = () => userEvent.setup({ pointerEventsCheck: 0 });
const settle = (ms = 50) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
/** Requests sent since `from` whose method and URL match. */
const sentSince = (from: number, method: string, match: RegExp) =>
  sent.slice(from).filter((s) => s.method === method && match.test(s.url));

/** Another tab stores a different project; its event has not arrived. */
const anotherTabStoresSilently = () => localStorage.setItem(KEY, SYS);
const writesSince = (from: number) =>
  sent.slice(from).filter((s) => s.method !== "GET");

async function expectRefused(before: number) {
  expect(
    await screen.findByTestId("prompt-documents-cross-tab")
  ).toBeInTheDocument();
  expect(writesSince(before)).toEqual([]);
}

function radio(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`no #${id}`);
  return el;
}

describe("a settings write raced past the page's fieldset is refused", () => {
  it("the policy-write dial's 'full' confirmation sends nothing", async () => {
    render(<PromptDocumentsPage />);
    await screen.findByTestId("policy-write-dial", {}, { timeout: 5000 });
    await user().click(radio("policy-write-full"));
    await screen.findByTestId("policy-write-confirm");
    anotherTabStoresSilently();
    const before = sent.length;

    await user().click(screen.getByRole("button", { name: /set to full/i }));

    await expectRefused(before);
  });

  it("the upstream dial's 'auto' confirmation sends nothing", async () => {
    render(<PromptDocumentsPage />);
    await screen.findByTestId("policy-upstream-dial", {}, { timeout: 5000 });
    await user().click(radio("policy-upstream-auto"));
    await screen.findByTestId("policy-upstream-confirm");
    anotherTabStoresSilently();
    const before = sent.length;

    await user().click(screen.getByRole("button", { name: /set to auto/i }));

    await expectRefused(before);
  });

  it("the auto-publish dial's 'on' confirmation sends nothing", async () => {
    render(<PromptDocumentsPage />);
    await user().click(
      await screen.findByTestId(
        "policy-auto-publish-level-on",
        {},
        { timeout: 5000 }
      )
    );
    await screen.findByTestId("policy-auto-publish-confirm");
    anotherTabStoresSilently();
    const before = sent.length;

    await user().click(
      screen.getByTestId("policy-auto-publish-confirm-accept")
    );

    await expectRefused(before);
  });

  it("the kind-tier 'Open the kind' confirmation sends nothing", async () => {
    render(<PromptDocumentsPage />);
    await screen.findByTestId(
      "kind-tier-row-audience_profile",
      {},
      { timeout: 5000 }
    );
    await user().click(screen.getByRole("button", { name: "allow" }));
    const open = await screen.findByRole("button", { name: /Open the kind/i });
    anotherTabStoresSilently();
    const before = sent.length;

    await user().click(open);

    await expectRefused(before);
  });

  it("the session-compliance save sends nothing", async () => {
    render(<PromptDocumentsPage />);
    const attempts = await screen.findByTestId(
      "compliance-max-attempts",
      {},
      { timeout: 5000 }
    );
    await user().clear(attempts);
    await user().type(attempts, "2");
    anotherTabStoresSilently();
    const before = sent.length;

    await user().click(screen.getByTestId("compliance-save"));

    await expectRefused(before);
  });
});

/** The fleet-policy write every dial sends. */
const DIAL_WRITE = /\/fleet-policy$/;
/** The kind-tier list read, which a tier write re-takes. */
const KIND_TIERS = /\/prompt-document-kind-tiers$/;
/** The page's one auto-publish status read. */
const STATUS = /\/auto-publish\/status$/;

/**
 * One settings write the page sends, and how to send it: `setup` runs before
 * the page renders, `arrange` brings it to the click that sends it, `send` is
 * that click. `reread` is the read-back the write takes itself, when it takes
 * one.
 */
type SectionWrite = {
  label: string;
  method: string;
  route: RegExp;
  setup?: () => void;
  arrange: () => Promise<void>;
  send: () => Promise<void>;
  reread?: RegExp;
};

const SECTION_WRITES: SectionWrite[] = [
  {
    label: "kind tiers: a kind's tier",
    method: "PUT",
    route: /\/prompt-document-kind-tiers\/audience_profile$/,
    reread: KIND_TIERS,
    arrange: async () => {
      await screen.findByTestId(
        "kind-tier-row-audience_profile",
        {},
        { timeout: 5000 }
      );
    },
    // `deny` closes a kind, so it applies on one click.
    send: () =>
      user().click(
        within(screen.getByTestId("kind-tier-row-audience_profile")).getByRole(
          "button",
          { name: "deny" }
        )
      ),
  },
  {
    label: "kind tiers: a kind's clear",
    method: "DELETE",
    route: /\/prompt-document-kind-tiers\/initiative$/,
    reread: KIND_TIERS,
    // A kind with a stored tier, so Clear is offered.
    setup: () => {
      extraKindRows = [
        {
          kind: "initiative",
          tier: "allow",
          unreadable: false,
          builtin_default_tier: "allow_with_notification",
          effective_tier: "allow",
          effective_source: "tenant",
        },
      ];
    },
    arrange: async () => {
      await screen.findByTestId(
        "kind-tier-row-initiative",
        {},
        { timeout: 5000 }
      );
    },
    send: () =>
      user().click(
        within(screen.getByTestId("kind-tier-row-initiative")).getByRole(
          "button",
          { name: "clear" }
        )
      ),
  },
  {
    label: "the policy-write dial",
    method: "PUT",
    route: DIAL_WRITE,
    arrange: async () => {
      await screen.findByTestId("policy-write-dial", {}, { timeout: 5000 });
      await user().click(radio("policy-write-full"));
      await screen.findByTestId("policy-write-confirm");
    },
    send: () =>
      user().click(screen.getByRole("button", { name: /set to full/i })),
  },
  {
    label: "the upstream dial",
    method: "PUT",
    route: DIAL_WRITE,
    arrange: async () => {
      await screen.findByTestId("policy-upstream-dial", {}, { timeout: 5000 });
      await user().click(radio("policy-upstream-auto"));
      await screen.findByTestId("policy-upstream-confirm");
    },
    send: () =>
      user().click(screen.getByRole("button", { name: /set to auto/i })),
  },
  {
    label: "the auto-publish dial",
    method: "PUT",
    route: DIAL_WRITE,
    // The dial's write re-takes the PAGE's status read (`onLevelChanged`).
    reread: STATUS,
    arrange: async () => {
      await user().click(
        await screen.findByTestId(
          "policy-auto-publish-level-on",
          {},
          { timeout: 5000 }
        )
      );
      await screen.findByTestId("policy-auto-publish-confirm");
    },
    send: () =>
      user().click(screen.getByTestId("policy-auto-publish-confirm-accept")),
  },
  {
    label: "session compliance: the settings save",
    method: "PUT",
    route: /\/session-compliance\/config$/,
    reread: /\/session-compliance\/config\/versions$/,
    arrange: async () => {
      const attempts = await screen.findByTestId(
        "compliance-max-attempts",
        {},
        { timeout: 5000 }
      );
      await user().clear(attempts);
      await user().type(attempts, "2");
    },
    send: () => user().click(screen.getByTestId("compliance-save")),
  },
];

/** The write was sent twice, both times in the page's project, as were its re-reads. */
async function expectSentInPage(before: number, write: SectionWrite) {
  await waitFor(
    () => expect(sentSince(before, write.method, write.route)).toHaveLength(2),
    { timeout: 5000 }
  );
  expect(localStorage.getItem(KEY)).toBe(SYS);
  expect(
    sentSince(before, write.method, write.route).map((s) => s.tenant)
  ).toEqual([B, B]);
  const reread = write.reread;
  if (reread) {
    await waitFor(
      () => expect(sentSince(before, "GET", reread)).not.toHaveLength(0),
      { timeout: 5000 }
    );
    await settle();
    // Every re-read the write took, in the page's project.
    const rereads = sentSince(before, "GET", reread).map((s) => s.tenant);
    expect(new Set(rereads)).toEqual(new Set([B]));
  }
}

describe("a settings write sent before the switch and re-issued after it lands in the page's project", () => {
  const rows = SECTION_WRITES.map((write) => [write.label, write] as const);

  it.each(rows)(
    "%s: a 429 with the other project stored inside the answer",
    async (_label, write) => {
      write.setup?.();
      render(<PromptDocumentsPage />);
      await write.arrange();
      await settle();
      // The write goes out in the page's project; another tab switches
      // project inside its 429, so the client's re-issue is built with the
      // OTHER one stored.
      inAnswerTo(write.method, write.route, anotherTabStoresSilently, 429);
      const before = sent.length;

      await write.send();

      await expectSentInPage(before, write);
    },
    20_000
  );

  it.each(rows)(
    "%s: replayed after a token refresh with the other project stored during the refresh",
    async (_label, write) => {
      write.setup?.();
      render(<PromptDocumentsPage />);
      await write.arrange();
      await settle();
      // The write is answered 401 on a stale token; another tab switches
      // project while this one refreshes, so the replay is built with the
      // OTHER project stored.
      token.expiry = Date.now() - 1000;
      token.onRefresh = anotherTabStoresSilently;
      inAnswerTo(write.method, write.route, () => {}, 401);
      const before = sent.length;

      await write.send();

      await expectSentInPage(before, write);
    },
    20_000
  );
});

describe("a settings read in flight across the switch stays in the page's project", () => {
  it.each([
    ["kind tiers", KIND_TIERS],
    ["the policy-write dial", /\/fleet-policy\?domain=policy_write$/],
    ["the upstream dial", /\/fleet-policy\?domain=policy_upstream$/],
    ["the auto-publish dial", /\/fleet-policy\?domain=policy_auto_publish$/],
    ["session compliance's settings", /\/session-compliance\/config$/],
    [
      "session compliance's settings history",
      /\/session-compliance\/config\/versions$/,
    ],
    ["session compliance's verdicts", /\/session-compliance\/sessions\?/],
    ["session compliance's ledger", /\/session-compliance\/outstanding$/],
  ] as const)(
    "%s: answered 503 with the switch inside the answer, retried in the page's project",
    async (_label, route) => {
      inAnswerTo("GET", route, anotherTabStoresSilently, 503);

      render(<PromptDocumentsPage />);

      await waitFor(() => expect(sentSince(0, "GET", route)).toHaveLength(2), {
        timeout: 5000,
      });
      expect(localStorage.getItem(KEY)).toBe(SYS);
      expect(sentSince(0, "GET", route).map((s) => s.tenant)).toEqual([B, B]);
    },
    20_000
  );

  it("session compliance's Refresh, clicked after another tab stored a project, reads all four in the page's project", async () => {
    render(<PromptDocumentsPage />);
    await screen.findByTestId(
      "compliance-enforcement-panel",
      {},
      { timeout: 5000 }
    );
    await settle();
    anotherTabStoresSilently();
    const before = sent.length;

    await user().click(screen.getByTestId("compliance-refresh"));

    const reads = /\/session-compliance\//;
    await waitFor(
      () => expect(sentSince(before, "GET", reads)).toHaveLength(4),
      {
        timeout: 5000,
      }
    );
    expect(sentSince(before, "GET", reads).map((s) => s.tenant)).toEqual([
      B,
      B,
      B,
      B,
    ]);
  }, 20_000);
});

describe("the page's auto-publish status read", () => {
  it("after a dial write, the status re-take carries the page's project", async () => {
    render(<PromptDocumentsPage />);
    await user().click(
      await screen.findByTestId(
        "policy-auto-publish-level-on",
        {},
        { timeout: 5000 }
      )
    );
    await screen.findByTestId("policy-auto-publish-confirm");
    await settle();
    // The write is answered 200 with another tab's switch made INSIDE its
    // answer, so the re-take after it is sent with the other project stored.
    inAnswerTo("PUT", DIAL_WRITE, anotherTabStoresSilently);
    const before = sent.length;

    await user().click(
      screen.getByTestId("policy-auto-publish-confirm-accept")
    );

    await waitFor(
      () => expect(sentSince(before, "GET", STATUS)).toHaveLength(1),
      { timeout: 5000 }
    );
    await settle();
    expect(localStorage.getItem(KEY)).toBe(SYS);
    expect(sentSince(before, "PUT", DIAL_WRITE).map((s) => s.tenant)).toEqual([
      B,
    ]);
    expect(sentSince(before, "GET", STATUS).map((s) => s.tenant)).toEqual([B]);
  }, 20_000);
});

describe("the page's project known only after the page mounted", () => {
  it("a settings write sent once the provider has answered lands in the page's project", async () => {
    // A hard load: the layout's provider is still reading the membership list
    // when the page mounts, so the page's project is UNKNOWN at first and the
    // list hands the page no pin. Once the provider answers, the page's
    // project is the one it loaded in.
    let answer: () => void = () => {};
    listTenantsMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = () =>
            resolve({
              tenants: [
                { id: B, slug: "b", name: "Bravo" },
                { id: SYS, slug: "s", name: "System" },
              ],
              active_tenant_id: B,
            });
        })
    );
    render(
      <TenantProvider>
        <PromptDocumentsPage />
      </TenantProvider>
    );
    await screen.findByTestId("policy-write-dial", {}, { timeout: 5000 });
    await settle();
    await act(async () => answer());
    await settle();
    await user().click(radio("policy-write-full"));
    await screen.findByTestId("policy-write-confirm");
    inAnswerTo("PUT", DIAL_WRITE, anotherTabStoresSilently, 429);
    const before = sent.length;

    await user().click(screen.getByRole("button", { name: /set to full/i }));

    await waitFor(
      () => expect(sentSince(before, "PUT", DIAL_WRITE)).toHaveLength(2),
      { timeout: 5000 }
    );
    expect(localStorage.getItem(KEY)).toBe(SYS);
    expect(sentSince(before, "PUT", DIAL_WRITE).map((s) => s.tenant)).toEqual([
      B,
      B,
    ]);
  }, 20_000);
});
