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
 *    first visit, with nothing stored, the sections' mount reads go out
 *    before there is a project to pin them to, pinned to the project stored
 *    then: none. Each is re-taken once, pinned, when the page's project is
 *    known; a 503 is not retried in another tab's project, and the answer
 *    to a replay after a token refresh, which goes in it, is not shown.
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

import { toast } from "sonner";
import PromptDocumentsPage from "../page";
import { TenantProvider } from "@/contexts/tenant-context";

const KEY = "qontinui.active_tenant_id";
/** The page's project. */
const B = "t-bravo";
/** The project another tab switches to. */
const SYS = "t-system";

type Sent = {
  method: string;
  url: string;
  tenant: string | null;
  body: string | null;
};
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
 * status (a 503, say), or with the route's own answer for a 200, as coord's
 * state stands at release.
 */
type Held = {
  method: string;
  match: RegExp;
  status: Promise<number>;
  snapshot: boolean;
};
let helds: Held[] = [];
function hold(
  method: string,
  match: RegExp,
  snapshot: boolean
): (status: number) => void {
  let release: (status: number) => void = () => {};
  const status = new Promise<number>((resolve) => {
    release = resolve;
  });
  helds.push({ method, match, status, snapshot });
  return (s) => release(s);
}
function holdNext(method: string, match: RegExp): (status: number) => void {
  return hold(method, match, false);
}
/**
 * As {@link holdNext}, but a 200 is answered with coord's state as it stood
 * when the request ARRIVED: a read coord served before a write landed,
 * delivered only after it.
 */
function holdNextSnapshot(
  method: string,
  match: RegExp
): (status: number) => void {
  return hold(method, match, true);
}

/**
 * What a GET sent in the OTHER project (`SYS`) is answered with, by route,
 * where a test needs that project's answer told apart from the page's on the
 * page. A route not listed answers as it does in the page's project.
 */
let otherProjectAnswers: { match: RegExp; body: unknown }[] = [];

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
      kinds: [
        kindRow("audience_profile", null),
        ...Object.entries(kindTiers).map(([kind, tier]) => kindRow(kind, tier)),
      ],
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

/** What coord answers a request with: the OTHER project's answer where set. */
function respond(
  method: string,
  url: string,
  tenant: string | null,
  body: string | null
): unknown {
  const other =
    method === "GET" && tenant === SYS
      ? otherProjectAnswers.find((a) => a.match.test(url))
      : undefined;
  if (other) return other.body;
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
  otherProjectAnswers = [];
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
      sent.push({ method, url, tenant, body });
      const held = helds.findIndex(
        (h) => h.method === method && h.match.test(url)
      );
      if (held >= 0) {
        const [entry] = helds.splice(held, 1);
        // A snapshot is coord's answer as it stood when the request arrived.
        const snapshot = entry?.snapshot
          ? respond(method, url, tenant, body)
          : undefined;
        const status = entry ? await entry.status : 200;
        if (status !== 200) {
          return json(status, {
            error: "TRANSIENT",
            message: `answered ${status}`,
          });
        }
        if (snapshot !== undefined) return json(200, snapshot);
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
      return json(200, respond(method, url, tenant, body));
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

/**
 * A session verdict, a ledger item and a history row that only the OTHER
 * project has.
 */
const OTHER_SESSION = {
  id: "sc-other",
  claude_session_id: "sess-other-project",
  verdict: "not_applicable",
  reason: "enforcement_disabled",
  report: { items: [] },
  reconciliation: { items: [], unreconciled_refs: [] },
  checked_at: "2026-11-01T12:00:00Z",
  finalized: true,
};
const OTHER_ITEM = {
  claude_session_id: "sess-other-project",
  checked_at: "2026-11-01T12:00:00Z",
  ref: "the other project's follow-up",
  state: "deferred",
  reason: "out of scope",
};
const OTHER_VERSION = {
  version_number: 42,
  enabled: true,
  mode: "nudge",
  enforced_clause_ref: "policy/planning-and-scope#finish-to-zero",
  max_attempts: 9,
  edited_by: "other-project-editor@example.com",
  created_at: "2026-11-01T12:00:00Z",
};

/**
 * One settings read whose answer the page shows: what the OTHER project
 * answers it with, and a check that passes only while the page shows its
 * own project's answer, not that one. `open` runs once the page has
 * answered, before the switch, where the answer is shown only on request.
 */
type ShownRead = {
  label: string;
  route: RegExp;
  other: unknown;
  open?: () => Promise<void>;
  showsOwn: () => void;
};

const SHOWN_READS: ShownRead[] = [
  {
    label: "kind tiers",
    route: KIND_TIERS,
    other: {
      ...(answer("/prompt-document-kind-tiers") as Record<string, unknown>),
      kinds: [
        ...(answer("/prompt-document-kind-tiers") as { kinds: unknown[] })
          .kinds,
        {
          kind: "initiative",
          tier: "allow",
          unreadable: false,
          builtin_default_tier: "allow_with_notification",
          effective_tier: "allow",
          effective_source: "tenant",
        },
      ],
    },
    showsOwn: () => {
      expect(
        screen.getByTestId("kind-tier-row-audience_profile")
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("kind-tier-row-initiative")
      ).not.toBeInTheDocument();
    },
  },
  {
    label: "the policy-write dial",
    route: /\/fleet-policy\?domain=policy_write$/,
    other: view("policy_write", "full"),
    showsOwn: () =>
      expect(screen.getByTestId("policy-write-in-force")).toHaveTextContent(
        /In force:\s*tightening_only/
      ),
  },
  {
    label: "the auto-publish dial",
    route: /\/fleet-policy\?domain=policy_auto_publish$/,
    other: view("policy_auto_publish", "on"),
    showsOwn: () =>
      expect(
        screen.getByTestId("policy-auto-publish-in-force")
      ).toHaveTextContent(/In force:\s*off/),
  },
  {
    label: "session compliance's settings",
    route: /\/session-compliance\/config$/,
    other: { ...COMPLIANCE_CONFIG, max_attempts: 5 },
    showsOwn: () =>
      expect(screen.getByTestId("compliance-max-attempts")).toHaveValue(1),
  },
  {
    label: "session compliance's settings history",
    route: /\/session-compliance\/config\/versions$/,
    other: { versions: [OTHER_VERSION] },
    open: () =>
      user().click(screen.getByTestId("compliance-config-history-toggle")),
    showsOwn: () =>
      expect(
        screen.getByTestId("compliance-config-history")
      ).not.toHaveTextContent("other-project-editor"),
  },
  {
    label: "session compliance's verdicts",
    route: /\/session-compliance\/sessions\?/,
    other: { sessions: [OTHER_SESSION] },
    showsOwn: () => {
      expect(screen.getByTestId("compliance-sessions")).toBeInTheDocument();
      expect(
        screen.queryByTestId("compliance-session-sess-other-project")
      ).not.toBeInTheDocument();
    },
  },
  {
    label: "session compliance's ledger",
    route: /\/session-compliance\/outstanding$/,
    other: { items: [OTHER_ITEM] },
    showsOwn: () => {
      expect(screen.getByTestId("outstanding-ledger")).toBeInTheDocument();
      expect(
        screen.queryByText("the other project's follow-up")
      ).not.toBeInTheDocument();
    },
  },
];

describe("the page's project known only after the page mounted", () => {
  it("every settings read sent before the page had a project is re-taken once, pinned to it", async () => {
    const answerMembership = firstVisit();
    renderUnderTenantProvider();
    // Every section has sent its mount reads, with no project to pin them to.
    await waitFor(
      () => {
        for (const [, route] of SETTINGS_READS) {
          expect(sentSince(0, "GET", route)).toHaveLength(1);
        }
      },
      { timeout: 5000 }
    );
    await settle();

    await act(async () => answerMembership());

    await waitFor(
      () => {
        for (const [, route] of SETTINGS_READS) {
          expect(sentSince(0, "GET", route)).toHaveLength(2);
        }
      },
      { timeout: 5000 }
    );
    await settle();
    expect(localStorage.getItem(KEY)).toBe(B);
    // Once each, and pinned to the project the page now shows.
    expect(
      SETTINGS_READS.map(([label, route]) => [
        label,
        sentSince(0, "GET", route).map((s) => s.tenant),
      ])
    ).toEqual(SETTINGS_READS.map(([label]) => [label, [null, B]]));
  }, 20_000);

  it.each(SHOWN_READS.map((read) => [read.label, read] as const))(
    "%s: the read sent before the page had a project, answered 503 after another tab's switch, is not retried in that tab's project",
    async (_label, read) => {
      otherProjectAnswers = [{ match: read.route, body: read.other }];
      const answerMembership = firstVisit();
      const releaseMountRead = holdNext("GET", read.route);
      renderUnderTenantProvider();
      await waitFor(
        () => expect(sentSince(0, "GET", read.route)).toHaveLength(1),
        { timeout: 5000 }
      );

      // The page learns its project, and the read is re-taken in it and
      // answered, while the mount read is still in flight.
      await act(async () => answerMembership());
      await waitFor(
        () => expect(sentSince(0, "GET", read.route)).toHaveLength(2),
        { timeout: 5000 }
      );
      await settle();
      await read.open?.();

      // Another tab stores its project, and the mount read is answered 503.
      // It was pinned to the project stored when it was sent, none, so it
      // is not retried: no attempt goes in the project stored now.
      anotherTabStoresSilently();
      await act(async () => releaseMountRead(503));
      await settle(150);

      expect(sentSince(0, "GET", read.route).map((s) => s.tenant)).toEqual([
        null,
        B,
      ]);
      read.showsOwn();
    },
    20_000
  );

  it.each(SHOWN_READS.map((read) => [read.label, read] as const))(
    "%s: the read sent before the page had a project, replayed after a token refresh in another tab's project, does not land over its re-take",
    async (_label, read) => {
      otherProjectAnswers = [{ match: read.route, body: read.other }];
      const answerMembership = firstVisit();
      const releaseMountRead = holdNext("GET", read.route);
      renderUnderTenantProvider();
      await waitFor(
        () => expect(sentSince(0, "GET", read.route)).toHaveLength(1),
        { timeout: 5000 }
      );

      // The page learns its project, and the read is re-taken in it and
      // answered, while the mount read is still in flight.
      await act(async () => answerMembership());
      await waitFor(
        () => expect(sentSince(0, "GET", read.route)).toHaveLength(2),
        { timeout: 5000 }
      );
      await settle();
      await read.open?.();

      // Another tab stores its project; the mount read is answered 401 on a
      // stale token. The replay after the refresh is the one attempt a pin
      // to no project cannot hold: it goes in the project stored now.
      anotherTabStoresSilently();
      token.expiry = Date.now() - 1000;
      await act(async () => releaseMountRead(401));
      await waitFor(
        () => expect(sentSince(0, "GET", read.route)).toHaveLength(3),
        { timeout: 5000 }
      );
      await settle();

      expect(sentSince(0, "GET", read.route).map((s) => s.tenant)).toEqual([
        null,
        B,
        SYS,
      ]);
      read.showsOwn();
    },
    20_000
  );

  it.each(SHOWN_READS.map((read) => [read.label, read] as const))(
    "%s: the read sent before the page had a project, failing after its re-take answered, does not show its failure",
    async (_label, read) => {
      const answerMembership = firstVisit();
      const releaseMountRead = holdNext("GET", read.route);
      renderUnderTenantProvider();
      await waitFor(
        () => expect(sentSince(0, "GET", read.route)).toHaveLength(1),
        { timeout: 5000 }
      );
      await act(async () => answerMembership());
      await waitFor(
        () => expect(sentSince(0, "GET", read.route)).toHaveLength(2),
        { timeout: 5000 }
      );
      await settle();
      await read.open?.();

      // A 400 is not retried: the replaced read fails, after its re-take
      // answered.
      await act(async () => releaseMountRead(400));
      await settle();

      expect(sentSince(0, "GET", read.route)).toHaveLength(2);
      expect(screen.queryByText(/answered 400/)).not.toBeInTheDocument();
      read.showsOwn();
    },
    20_000
  );

  it("a settings read sent pinned at mount is not re-taken when the provider answers", async () => {
    // Bravo is stored, so the page pins its mount reads to it while the
    // provider is still reading; the provider then answers Bravo.
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
    await settle();

    await act(async () => answerMembership());
    await settle(200);

    // Each once, in Bravo: every attempt of it was held to the page's project.
    expect(
      SETTINGS_READS.map(([label, route]) => [
        label,
        sentSince(0, "GET", route).map((s) => s.tenant),
      ])
    ).toEqual(SETTINGS_READS.map(([label]) => [label, [B]]));
  }, 20_000);

  it.each([
    ["kind tiers", KIND_TIERS, "kind-authorship-tier-control", "Loading…"],
    [
      "the policy-write dial",
      /\/fleet-policy\?domain=policy_write$/,
      "policy-write-dial",
      "Reading the dial…",
    ],
    [
      "the auto-publish dial",
      /\/fleet-policy\?domain=policy_auto_publish$/,
      "policy-auto-publish-dial",
      "Reading the dial…",
    ],
  ] as const)(
    "%s: the answer to the read its re-take replaced does not end the section's loading",
    async (_label, route, section, reading) => {
      const answerMembership = firstVisit();
      const releaseMountRead = holdNext("GET", route);
      renderUnderTenantProvider();
      await waitFor(() => expect(sentSince(0, "GET", route)).toHaveLength(1), {
        timeout: 5000,
      });
      // The re-take is held too, so it is still in flight below.
      const releaseRetake = holdNext("GET", route);
      await act(async () => answerMembership());
      await waitFor(() => expect(sentSince(0, "GET", route)).toHaveLength(2), {
        timeout: 5000,
      });

      await act(async () => releaseMountRead(200));
      await settle();

      // Its answer is dropped, and the section still says it is reading:
      // not an empty section that looks read.
      expect(screen.getByTestId(section)).toHaveTextContent(reading);

      await act(async () => releaseRetake(200));
      await waitFor(
        () =>
          expect(screen.getByTestId(section)).not.toHaveTextContent(reading),
        { timeout: 5000 }
      );
    },
    20_000
  );

  it("a settings write sent once the provider has answered lands in the page's project", async () => {
    // A first visit on a hard load: nothing is stored, and the layout's
    // provider is still reading the membership list when the page mounts, so
    // the page's project is UNKNOWN at first and its provider pins nothing.
    // Once the provider answers it stores Bravo, and the page's project and
    // pin are Bravo. A resolver that kept the pin it had at mount would send
    // this write unpinned, and its re-issue after the 429 would go in the
    // project the other tab stored.
    const answerMembership = firstVisit();
    renderUnderTenantProvider();
    await screen.findByTestId("policy-write-dial", {}, { timeout: 5000 });
    await settle();
    // Nothing was pinned at mount: the dial's mount read went with no project.
    expect(
      sentSince(0, "GET", /\/fleet-policy\?domain=policy_write$/)[0]?.tenant
    ).toBeNull();
    await act(async () => answerMembership());
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
 * A read in flight when a settings write lands, answered after the write's
 * own result with coord's state as it stood when the read ARRIVED (before
 * the write). Ported from the round-4 review's demonstration
 * (`retakeWriteRace.test.tsx`), whose three cases are kept as written. On a
 * first visit a write unlocks in the same provider render that defines the
 * pin, so the first write always races the re-take: each hook drops a read
 * that began before a write landed, as the shared dial does.
 */
describe("a re-take read sent before a write and answered after it", () => {
  /** Every PUT sent so far. */
  const puts = () => sent.filter((s) => s.method === "PUT");

  it("SHARED dial (policy-write, writeGeneration): the write's level stays shown", async () => {
    const PW = /\/fleet-policy\?domain=policy_write$/;
    const answerMembership = firstVisit();
    renderUnderTenantProvider();
    await waitFor(() => expect(sentSince(0, "GET", PW)).toHaveLength(1), {
      timeout: 5000,
    });
    await settle(80);
    // The confirmation is opened before the page knows its project.
    await user().click(radio("policy-write-full"));
    await screen.findByTestId("policy-write-confirm");
    const releaseRetake = holdNextSnapshot("GET", PW);
    await act(async () => answerMembership());
    await waitFor(() => expect(sentSince(0, "GET", PW)).toHaveLength(2), {
      timeout: 5000,
    });
    expect(sentSince(0, "GET", PW).map((s) => s.tenant)).toEqual([null, B]);
    await user().click(screen.getByRole("button", { name: /set to full/i }));
    await waitFor(() => expect(puts()).toHaveLength(1), { timeout: 5000 });
    await settle(80);
    expect(screen.getByTestId("policy-write-in-force")).toHaveTextContent(
      /In force:\s*full/
    );
    await act(async () => releaseRetake(200));
    await settle(80);
    expect(screen.getByTestId("policy-write-in-force")).toHaveTextContent(
      /In force:\s*full/
    );
  }, 20_000);

  it("HAND-ROLLED dial (auto-publish): the write's level stays shown", async () => {
    const AP = /\/fleet-policy\?domain=policy_auto_publish$/;
    const answerMembership = firstVisit();
    renderUnderTenantProvider();
    await waitFor(() => expect(sentSince(0, "GET", AP)).toHaveLength(1), {
      timeout: 5000,
    });
    await settle(80);
    await user().click(screen.getByTestId("policy-auto-publish-level-on"));
    await screen.findByTestId("policy-auto-publish-confirm");
    const releaseRetake = holdNextSnapshot("GET", AP);
    await act(async () => answerMembership());
    await waitFor(() => expect(sentSince(0, "GET", AP)).toHaveLength(2), {
      timeout: 5000,
    });
    expect(sentSince(0, "GET", AP).map((s) => s.tenant)).toEqual([null, B]);
    await user().click(
      screen.getByTestId("policy-auto-publish-confirm-accept")
    );
    await waitFor(() => expect(puts()).toHaveLength(1), { timeout: 5000 });
    await settle(80);
    expect(
      screen.getByTestId("policy-auto-publish-in-force")
    ).toHaveTextContent(/In force:\s*on/);
    await act(async () => releaseRetake(200));
    await settle(80);
    expect(
      screen.getByTestId("policy-auto-publish-in-force")
    ).toHaveTextContent(/In force:\s*on/);
  }, 20_000);

  it("HAND-ROLLED kind tiers: a cleared kind stays cleared", async () => {
    kindTiers = { initiative: "allow" };
    const answerMembership = firstVisit();
    renderUnderTenantProvider();
    await waitFor(
      () => expect(sentSince(0, "GET", KIND_TIERS)).toHaveLength(1),
      { timeout: 5000 }
    );
    await screen.findByTestId(
      "kind-tier-row-initiative",
      {},
      { timeout: 5000 }
    );
    await settle(80);
    const releaseRetake = holdNextSnapshot("GET", KIND_TIERS);
    await act(async () => answerMembership());
    await waitFor(
      () => expect(sentSince(0, "GET", KIND_TIERS)).toHaveLength(2),
      { timeout: 5000 }
    );
    expect(sentSince(0, "GET", KIND_TIERS).map((s) => s.tenant)).toEqual([
      null,
      B,
    ]);
    // `clear` is not disabled while the re-take is in flight.
    await user().click(
      within(screen.getByTestId("kind-tier-row-initiative")).getByRole(
        "button",
        { name: "clear" }
      )
    );
    await waitFor(
      () => expect(sentSince(0, "GET", KIND_TIERS)).toHaveLength(3),
      { timeout: 5000 }
    );
    await settle(80);
    const clearButton = () =>
      within(screen.getByTestId("kind-tier-row-initiative")).getByRole(
        "button",
        { name: "clear" }
      );
    expect(clearButton()).toBeDisabled();
    await act(async () => releaseRetake(200));
    await settle(80);
    expect(clearButton()).toBeDisabled();
  }, 20_000);

  // Session compliance's settings and history reads race a save as well. A
  // save is refused while the re-take of the settings is out (the draft may
  // have been seeded from another project's), so these two rows send the
  // racing read through Refresh.
  const CONFIG = /\/session-compliance\/config$/;
  const HISTORY = /\/session-compliance\/config\/versions$/;

  async function saveAttempts(value: string) {
    const attempts = screen.getByTestId("compliance-max-attempts");
    await user().clear(attempts);
    await user().type(attempts, value);
    await user().click(screen.getByTestId("compliance-save"));
    await waitFor(() => expect(puts()).toHaveLength(1), { timeout: 5000 });
    await settle(80);
  }

  it("HAND-ROLLED session compliance: a saved setting stays shown", async () => {
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

  it("HAND-ROLLED session compliance: a saved version stays in the history", async () => {
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
 * A compliance draft seeded from a superseded answer: on a first visit the
 * settings can be read in ANOTHER project before the page knows its own
 * (here, a mount read replayed after a token refresh once another tab has
 * switched), and the panel
 * seeds its draft from whatever is shown. Ported from the round-4 review's
 * demonstration (`complianceDraft.test.tsx`), where the operator's one edit
 * was saved into the page's project together with the other project's mode
 * and clause. The round-4 decision: when the re-take's settings land, the
 * draft is re-seeded from them even over unsaved edits, and the panel says
 * the edits were discarded.
 */
describe("a compliance draft seeded from the superseded answer", () => {
  const CFG = /\/session-compliance\/config$/;
  /** The other tab's project's settings: nothing of them may reach Bravo. */
  const SYSTEM_CONFIG = {
    ...COMPLIANCE_CONFIG,
    mode: "reopen",
    max_attempts: 5,
    enforced_clause_ref: "policy/other-project#its-clause",
  };
  const NOTE =
    "These settings were re-read for this page's project, and your unsaved edits were discarded.";
  const putsTo = (match: RegExp) =>
    sent.filter((s) => s.method === "PUT" && match.test(s.url));

  /**
   * The review's steps up to the re-take: System's settings are shown and
   * seed the draft, the page learns its project, and the re-take of the
   * settings is held in flight. Returns its release.
   */
  async function systemSeededDraft(): Promise<(status: number) => void> {
    otherProjectAnswers = [{ match: CFG, body: SYSTEM_CONFIG }];
    const answerMembership = firstVisit();
    const releaseMount = holdNext("GET", CFG);
    renderUnderTenantProvider();
    await waitFor(() => expect(sentSince(0, "GET", CFG)).toHaveLength(1), {
      timeout: 5000,
    });
    // Another tab stores its project while the mount read is in flight. The
    // read was pinned to the project stored when it was sent, none, so the
    // review's 503 is no longer retried; a 401 on a stale token is, by a
    // replay after the refresh, in that project.
    localStorage.setItem(KEY, SYS);
    token.expiry = Date.now() - 1000;
    await act(async () => releaseMount(401));
    await waitFor(() => expect(sentSince(0, "GET", CFG)).toHaveLength(2), {
      timeout: 5000,
    });
    expect(sentSince(0, "GET", CFG).map((s) => s.tenant)).toEqual([null, SYS]);
    await settle(150);
    expect(screen.getByTestId("compliance-max-attempts")).toHaveValue(5);
    // The page learns its project (the provider stores Bravo); the re-take
    // is in flight while the operator edits the one field they mean to
    // change.
    const releaseRetake = holdNext("GET", CFG);
    await act(async () => answerMembership());
    await waitFor(() => expect(sentSince(0, "GET", CFG)).toHaveLength(3), {
      timeout: 5000,
    });
    expect(sentSince(0, "GET", CFG)[2]!.tenant).toBe(B);
    expect(localStorage.getItem(KEY)).toBe(B);
    await settle(80);
    const attempts = screen.getByTestId("compliance-max-attempts");
    await user().clear(attempts);
    await user().type(attempts, "2");
    return releaseRetake;
  }

  it("is not saved into the page's project", async () => {
    const releaseRetake = await systemSeededDraft();
    await act(async () => releaseRetake(200));
    await settle(80);

    // Re-seeded from Bravo's settings, over the edit, and it says so.
    expect(screen.getByTestId("compliance-draft-retaken")).toHaveTextContent(
      NOTE
    );
    expect(screen.getByTestId("compliance-max-attempts")).toHaveValue(1);
    // Nothing is saved until it is re-edited: nothing differs from Bravo's.
    await user().click(screen.getByTestId("compliance-save"));
    await settle(80);
    expect(putsTo(CFG)).toEqual([]);

    const attempts = screen.getByTestId("compliance-max-attempts");
    await user().clear(attempts);
    await user().type(attempts, "2");
    await user().click(screen.getByTestId("compliance-save"));
    await waitFor(() => expect(putsTo(CFG)).toHaveLength(1), {
      timeout: 5000,
    });
    const put = putsTo(CFG)[0]!;
    const body = JSON.parse(put.body ?? "{}") as Record<string, unknown>;
    expect(put.tenant).toBe(B);
    expect(body.max_attempts).toBe(2);
    // Nothing read from the other project may be written into this one.
    expect(body.mode).toBe(COMPLIANCE_CONFIG.mode);
    expect(body.enforced_clause_ref).toBe(
      COMPLIANCE_CONFIG.enforced_clause_ref
    );
    // Saved: the note has said what it had to.
    expect(
      screen.queryByTestId("compliance-draft-retaken")
    ).not.toBeInTheDocument();
  }, 20_000);

  it("a save sent while the re-take of the settings is out sends nothing, and says why", async () => {
    vi.mocked(toast.error).mockClear();
    const releaseRetake = await systemSeededDraft();

    await user().click(screen.getByTestId("compliance-save"));
    await settle(80);

    expect(putsTo(CFG)).toEqual([]);
    expect(vi.mocked(toast.error).mock.calls).toEqual([
      [
        "Nothing was sent: these settings are being re-read for this page's project. Save again once they have loaded.",
      ],
    ]);
    // Once the re-take lands, the draft is Bravo's and the note says why.
    await act(async () => releaseRetake(200));
    await settle(80);
    expect(screen.getByTestId("compliance-max-attempts")).toHaveValue(1);
    expect(screen.getByTestId("compliance-draft-retaken")).toHaveTextContent(
      NOTE
    );
  }, 20_000);
});

/**
 * StrictMode, the app router's development default, mounts every effect
 * twice. Ported from the round-4 review's demonstration
 * (`retakeWriteRace.test.tsx`), as written but for its two diagnostic logs.
 */
describe("StrictMode (the app router's dev default): the re-take still runs once", () => {
  it("mount reads double-fire unpinned; each read is re-taken exactly once, pinned", async () => {
    const answerMembership = firstVisit();
    render(
      <StrictMode>
        <TenantProvider>
          <PromptDocumentsPage />
        </TenantProvider>
      </StrictMode>
    );
    await waitFor(
      () => {
        for (const [, route] of SETTINGS_READS) {
          expect(sentSince(0, "GET", route).length).toBeGreaterThanOrEqual(1);
        }
      },
      { timeout: 5000 }
    );
    await settle(150);
    const beforePin = SETTINGS_READS.map(([, route]) =>
      sentSince(0, "GET", route).map((s) => s.tenant)
    );
    await act(async () => answerMembership());
    await settle(300);
    const after = SETTINGS_READS.map(([, route]) =>
      sentSince(0, "GET", route).map((s) => s.tenant)
    );
    // Every pre-pin send is unpinned, and exactly ONE pinned re-take follows
    // per route.
    for (let i = 0; i < SETTINGS_READS.length; i++) {
      const sends = after[i]!;
      const pinned = sends.filter((t) => t === B).length;
      expect(
        sends.slice(0, beforePin[i]!.length).every((t) => t === null)
      ).toBe(true);
      expect(pinned).toBe(1);
    }
  }, 20_000);
});
