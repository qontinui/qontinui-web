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
 *    confirmation — or, for a control that has none (the compliance save, a
 *    kind's Clear), readies it — while this page's project is stored, then
 *    another tab stores a different one (its event not yet arrived), then
 *    confirms. Nothing may be sent: the page's call-time guard, which each
 *    section's hook asks beside its send (the page's provider), refuses the
 *    write and raises the notice.
 * 2. **A settings request in flight across the switch stays in the page's
 *    project.** Every section write re-issued after a 429, or replayed after a
 *    token refresh, with the other project stored meanwhile; the read-back each
 *    write takes; every section read retried after a 503; a read sent after the
 *    switch is stored; and the page's own auto-publish status re-take after a
 *    dial write. The page pins them to the project its provider pins the
 *    list's rows to, so each is told apart from an unpinned request by where
 *    it went — also when that project becomes known only after the page
 *    mounted, as on a hard load under the layout's tenant provider. On a
 *    first visit, with nothing stored, no settings read is sent at all until
 *    the page's project is known: each section says it is waiting, then
 *    reads once, pinned to it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StrictMode } from "react";
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

/**
 * Hold the next request matching in flight, after its header was recorded,
 * until the returned `release(status)` runs; it is then answered with that
 * status (a 503, say), or for a 200 with coord's state as it stood when the
 * request ARRIVED: a read coord served before a write landed, delivered only
 * after it.
 */
type Held = { method: string; match: RegExp; status: Promise<number> };
let helds: Held[] = [];
function holdNextSnapshot(
  method: string,
  match: RegExp
): (status: number) => void {
  let release: (status: number) => void = () => {};
  const status = new Promise<number>((resolve) => {
    release = resolve;
  });
  helds.push({ method, match, status });
  return (s) => release(s);
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

/**
 * Coord's state, as the requests below read and change it, reset for every
 * test: each dial's level, each kind's stored tier beside `audience_profile`
 * (which has none; `null` once cleared), and the session-compliance settings
 * and their history. A read answers from it; a write changes it.
 */
const DIAL_LEVELS: Record<string, string> = {
  policy_write: "tightening_only",
  policy_upstream: "notify",
};
let levels: Record<string, string> = { ...DIAL_LEVELS };
let kindTiers: Record<string, string | null> = {};
let complianceConfig: Record<string, unknown> = { ...COMPLIANCE_CONFIG };
let complianceVersions: Record<string, unknown>[] = [];

const BUILTIN_TIER: Record<string, string> = {
  audience_profile: "deny",
  initiative: "allow_with_notification",
};
function kindRow(kind: string, tier: string | null) {
  const builtin = BUILTIN_TIER[kind] ?? "deny";
  return {
    kind,
    tier,
    unreadable: false,
    builtin_default_tier: builtin,
    effective_tier: tier ?? builtin,
    effective_source: tier ? "tenant" : "default",
  };
}

function answer(url: string): unknown {
  if (url.includes("/auto-publish/status")) {
    return { candidates: [], count: 0, publishing_enabled: true };
  }
  if (url.includes("/fleet-policy")) {
    const domain = new URL(url, "http://x").searchParams.get("domain") ?? "";
    return view(domain, levels[domain] ?? "off");
  }
  if (url.includes("/prompt-document-kind-tiers")) {
    return {
      // `audience_profile` is always listed; a tier stored for it, or for any
      // other kind, is the one its row carries.
      kinds: Object.entries({ audience_profile: null, ...kindTiers }).map(
        ([kind, tier]) => kindRow(kind, tier)
      ),
      vocabulary: ["deny", "allow", "allow_with_notification"],
      notification_enforced: false,
      warning: "x",
    };
  }
  if (url.includes("/session-compliance/config/versions")) {
    return { versions: complianceVersions };
  }
  if (url.includes("/session-compliance/config")) return complianceConfig;
  if (url.includes("/session-compliance/sessions")) return { sessions: [] };
  if (url.includes("/session-compliance/outstanding")) return { items: [] };
  if (/\/coord\/prompt-documents(\?|$)/.test(url)) {
    return { documents: [], degraded: null };
  }
  return null;
}

/**
 * Every write is accepted, changes coord's state, and answers in the shape
 * its hook reads: the refusal tests assert it was not SENT, the in-flight
 * tests where it was sent.
 */
function written(method: string, url: string, body: string | null): unknown {
  const sentBody = JSON.parse(body ?? "{}") as Record<string, unknown>;
  if (url.endsWith("/fleet-policy")) {
    const domain = String(sentBody.domain);
    const level = String(sentBody.level);
    levels[domain] = level;
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
  const kind = /\/prompt-document-kind-tiers\/([^/?]+)$/.exec(url)?.[1];
  if (kind !== undefined) {
    kindTiers[kind] = method === "DELETE" ? null : String(sentBody.tier);
    return { ok: true };
  }
  if (url.endsWith("/session-compliance/config")) {
    complianceConfig = {
      ...complianceConfig,
      ...sentBody,
      current_version: Number(complianceConfig.current_version) + 1,
    };
    complianceVersions = [
      {
        version_number: complianceConfig.current_version,
        enabled: complianceConfig.enabled,
        mode: complianceConfig.mode,
        enforced_clause_ref: complianceConfig.enforced_clause_ref,
        max_attempts: complianceConfig.max_attempts,
        edited_by: "operator@example.com",
        created_at: "2026-11-15T12:00:00Z",
      },
      ...complianceVersions,
    ];
    return complianceConfig;
  }
  return { ok: true };
}

/** What coord answers a request with, as its state stands now. */
function respond(method: string, url: string, body: string | null): unknown {
  return method === "GET" ? answer(url) : written(method, url, body);
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  sent = [];
  insides = [];
  helds = [];
  levels = { ...DIAL_LEVELS };
  kindTiers = {};
  complianceConfig = { ...COMPLIANCE_CONFIG };
  complianceVersions = [];
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
      const body = typeof init?.body === "string" ? init.body : null;
      sent.push({ method, url, tenant });
      const held = helds.findIndex(
        (h) => h.method === method && h.match.test(url)
      );
      if (held >= 0) {
        const [entry] = helds.splice(held, 1);
        // Coord's answer as it stood when the request arrived.
        const snapshot = respond(method, url, body);
        const status = entry ? await entry.status : 200;
        if (status !== 200) {
          return json(status, {
            error: "TRANSIENT",
            message: `answered ${status}`,
          });
        }
        return json(200, snapshot);
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
      return json(200, respond(method, url, body));
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

  it("the kind-tier Clear sends nothing", async () => {
    // A kind with a stored tier, so Clear is offered. It closes or reopens
    // nothing it asks about first: it applies on one click.
    kindTiers = { initiative: "allow" };
    render(<PromptDocumentsPage />);
    const row = await screen.findByTestId(
      "kind-tier-row-initiative",
      {},
      { timeout: 5000 }
    );
    anotherTabStoresSilently();
    const before = sent.length;

    await user().click(within(row).getByRole("button", { name: "clear" }));

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

/** Every read the settings sections send on mount, by section. */
const SETTINGS_READS = [
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
] as const;

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
      kindTiers = { initiative: "allow" };
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
  it.each(SETTINGS_READS)(
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

/**
 * A hard load on a first visit: nothing is stored, and the layout's provider
 * is still reading the membership list when the page mounts, so the page's
 * project is UNKNOWN at first and its provider pins nothing. The returned
 * function answers that read; the provider then stores Bravo and the page's
 * project is Bravo.
 */
function firstVisit(): () => void {
  localStorage.clear();
  return membershipPending();
}

/**
 * A hard load: the layout's provider is still reading the membership list
 * when the page mounts. The returned function answers it, with Bravo the
 * server's choice: the provider keeps a stored member project, and stores
 * Bravo when none is stored.
 */
function membershipPending(): () => void {
  let answerMembership: () => void = () => {};
  listTenantsMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        answerMembership = () =>
          resolve({
            tenants: [
              { id: B, slug: "b", name: "Bravo" },
              { id: SYS, slug: "s", name: "System" },
            ],
            active_tenant_id: B,
          });
      })
  );
  return () => answerMembership();
}

function renderUnderTenantProvider() {
  render(
    <TenantProvider>
      <PromptDocumentsPage />
    </TenantProvider>
  );
}

/** The line each settings section shows while the page has no project. */
const WAITING = [
  "kind-tier-waiting",
  "policy-write-waiting",
  "policy-upstream-waiting",
  "policy-auto-publish-waiting",
  "compliance-waiting",
];

/** Every settings read sent so far, as `[label, tenants]` per section read. */
const settingsReadTenants = () =>
  SETTINGS_READS.map(
    ([label, route]) =>
      [label, sentSince(0, "GET", route).map((s) => s.tenant)] as const
  );
/** The same, expecting `tenants` for every read. */
const everyReadIn = (tenants: (string | null)[]) =>
  SETTINGS_READS.map(([label]) => [label, tenants] as const);

describe("the page's settings are read only under the page's project", () => {
  it("with nothing stored at mount, no settings read is sent until the provider answers; then each goes out once, pinned to Bravo", async () => {
    const answerMembership = firstVisit();
    renderUnderTenantProvider();
    for (const id of WAITING) {
      await screen.findByTestId(id, {}, { timeout: 5000 });
    }
    await settle(150);
    expect(settingsReadTenants()).toEqual(everyReadIn([]));

    await act(async () => answerMembership());
    await waitFor(
      () => {
        for (const [, route] of SETTINGS_READS) {
          expect(sentSince(0, "GET", route)).toHaveLength(1);
        }
      },
      { timeout: 5000 }
    );
    await settle(150);

    expect(settingsReadTenants()).toEqual(everyReadIn([B]));
    for (const id of WAITING) {
      expect(screen.queryByTestId(id)).not.toBeInTheDocument();
    }
  }, 20_000);

  it("while the page has no project, a Refresh or a filter change sends nothing, and every section says it is waiting", async () => {
    // The membership read is never answered here.
    firstVisit();
    renderUnderTenantProvider();
    await screen.findByTestId("compliance-waiting", {}, { timeout: 5000 });
    await settle(150);

    await user().click(screen.getByTestId("compliance-refresh"));
    await user().click(screen.getByTestId("compliance-verdict-filter"));
    await user().click(await screen.findByRole("option", { name: "Verified" }));
    await settle(150);

    expect(settingsReadTenants()).toEqual(everyReadIn([]));
    // Nothing has been read, so there is nothing to page through, and no
    // section claims a read in flight.
    expect(
      screen.queryByTestId("compliance-sessions-next")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        /^Loading…$|Reading the dial…|Loading enforcement settings…|Loading session verdicts…/
      )
    ).not.toBeInTheDocument();
    for (const id of WAITING) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  }, 20_000);

  it("if the provider never yields a project, nothing is read or written, and every section keeps saying it is waiting", async () => {
    localStorage.clear();
    listTenantsMock.mockRejectedValue(new Error("membership read failed"));
    renderUnderTenantProvider();
    await screen.findByTestId("compliance-waiting", {}, { timeout: 5000 });
    await settle(300);

    expect(settingsReadTenants()).toEqual(everyReadIn([]));
    expect(writesSince(0)).toEqual([]);
    for (const id of WAITING) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  }, 20_000);

  it("with a project stored at mount, each settings read goes out once, pinned, at mount", async () => {
    // Bravo is stored, and the layout's provider is still reading.
    const answerMembership = membershipPending();
    renderUnderTenantProvider();
    await waitFor(
      () => {
        for (const [, route] of SETTINGS_READS) {
          expect(sentSince(0, "GET", route)).toHaveLength(1);
        }
      },
      { timeout: 5000 }
    );
    for (const id of WAITING) {
      expect(screen.queryByTestId(id)).not.toBeInTheDocument();
    }

    await act(async () => answerMembership());
    await settle(200);

    expect(settingsReadTenants()).toEqual(everyReadIn([B]));
  }, 20_000);

  it("a settings write sent once the provider has answered lands in the page's project", async () => {
    // A first visit on a hard load: nothing is stored, and the layout's
    // provider is still reading the membership list when the page mounts, so
    // the page's project is UNKNOWN at first and its provider pins nothing.
    // Once the provider answers it stores Bravo, and the page's project and
    // pin are Bravo. A resolver that kept the pin it had at mount would never
    // name a project, so the dial would never read or offer a level.
    const PW = /\/fleet-policy\?domain=policy_write$/;
    const answerMembership = firstVisit();
    renderUnderTenantProvider();
    await screen.findByTestId("policy-write-waiting", {}, { timeout: 5000 });
    await settle();
    // No project at mount, so nothing was read.
    expect(sentSince(0, "GET", PW)).toEqual([]);
    await act(async () => answerMembership());
    await waitFor(
      () => expect(sentSince(0, "GET", PW).map((s) => s.tenant)).toEqual([B]),
      { timeout: 5000 }
    );
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

/**
 * A settings read in flight when a save lands, answered after the save's own
 * result with coord's state as it stood when the read ARRIVED (before the
 * save): session compliance drops it, as every settings hook drops a read a
 * landed write superseded (round 4). The page offers this race through
 * compliance's Refresh; the other sections' controls wait for their reads,
 * so their hooks hold it in their own suites (`usePromptDocumentKindTiers`,
 * `usePolicyAutoPublishPolicy`, `useTenantFleetPolicyDial`).
 */
describe("a settings read sent before a save and answered after it", () => {
  const CONFIG = /\/session-compliance\/config$/;
  const HISTORY = /\/session-compliance\/config\/versions$/;
  /** Every PUT sent so far. */
  const puts = () => sent.filter((s) => s.method === "PUT");

  async function saveAttempts(value: string) {
    const attempts = screen.getByTestId("compliance-max-attempts");
    await user().clear(attempts);
    await user().type(attempts, value);
    await user().click(screen.getByTestId("compliance-save"));
    await waitFor(() => expect(puts()).toHaveLength(1), { timeout: 5000 });
    await settle(80);
  }

  it("session compliance: a saved setting stays shown", async () => {
    render(<PromptDocumentsPage />);
    await screen.findByTestId("compliance-max-attempts", {}, { timeout: 5000 });
    await settle(80);
    const releaseRefresh = holdNextSnapshot("GET", CONFIG);
    await user().click(screen.getByTestId("compliance-refresh"));
    await waitFor(() => expect(sentSince(0, "GET", CONFIG)).toHaveLength(2), {
      timeout: 5000,
    });

    await saveAttempts("2");
    expect(screen.getByTestId("compliance-max-attempts")).toHaveValue(2);

    await act(async () => releaseRefresh(200));
    await settle(80);
    expect(screen.getByTestId("compliance-max-attempts")).toHaveValue(2);
  }, 20_000);

  it("session compliance: a saved version stays in the history", async () => {
    render(<PromptDocumentsPage />);
    await screen.findByTestId("compliance-max-attempts", {}, { timeout: 5000 });
    await user().click(screen.getByTestId("compliance-config-history-toggle"));
    await settle(80);
    const releaseRefresh = holdNextSnapshot("GET", HISTORY);
    await user().click(screen.getByTestId("compliance-refresh"));
    await waitFor(() => expect(sentSince(0, "GET", HISTORY)).toHaveLength(2), {
      timeout: 5000,
    });

    await saveAttempts("2");
    await waitFor(
      () =>
        expect(
          screen.getByTestId("compliance-config-history")
        ).toHaveTextContent("v4"),
      { timeout: 5000 }
    );

    await act(async () => releaseRefresh(200));
    await settle(80);
    expect(screen.getByTestId("compliance-config-history")).toHaveTextContent(
      "v4"
    );
  }, 20_000);
});

/**
 * StrictMode, the app router's development default, mounts every effect
 * twice. The round-4 review's demonstration, kept for the gated read.
 */
describe("StrictMode (the app router's dev default): the first read still goes out once", () => {
  it("nothing is read before the page knows its project; then each read goes out exactly once, pinned", async () => {
    const answerMembership = firstVisit();
    render(
      <StrictMode>
        <TenantProvider>
          <PromptDocumentsPage />
        </TenantProvider>
      </StrictMode>
    );
    await screen.findByTestId("compliance-waiting", {}, { timeout: 5000 });
    await settle(150);
    expect(settingsReadTenants()).toEqual(everyReadIn([]));

    await act(async () => answerMembership());
    await settle(300);

    expect(settingsReadTenants()).toEqual(everyReadIn([B]));
  }, 20_000);

  it("with a project stored at mount, each read goes out exactly once, pinned", async () => {
    render(
      <StrictMode>
        <PromptDocumentsPage />
      </StrictMode>
    );
    await screen.findByTestId("compliance-max-attempts", {}, { timeout: 5000 });
    await settle(300);

    expect(settingsReadTenants()).toEqual(everyReadIn([B]));
  }, 20_000);
});
