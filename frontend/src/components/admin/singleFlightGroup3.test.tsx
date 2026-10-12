/**
 * D5 of plan `2026-09-25-fleet-worktree-slots-hang-mechanism-and-safe-reland`,
 * applied to the polling surfaces PR #1508 left on a bare `setInterval`
 * (group 3: `/admin/coord/questions`, `/admin/coord/notifications`, the agent
 * claims dashboard, the prompt-injections dashboard, `OutputViewer`, the merge
 * onboarding wizard (its precondition poll AND its audit-status poll) and
 * `ConnectedOrgs`' post-enroll poll).
 *
 * Per surface, where a retrying `httpClient` sits between the page and the
 * wire: a 504 answer costs ONE request per route for that tick (no
 * `RetryStrategy` chain); a tick that finds the previous request outstanding
 * sends nothing; and the surface polls again once the outstanding one settles.
 *
 * Like `components/operations/coordDashboardPolls.test.tsx`, this runs against
 * the REAL `HttpClient` and stubs only `fetch`, because the property under
 * test is how many requests reach the wire; a mocked `httpClient.get` would
 * count calls to our own code and stay green if the retry policy were dropped.
 *
 * `AgentClaimsDashboard` reads through raw `fetch` (there is no retry layer to
 * switch off), so only its no-overlap rule is asserted.
 *
 * Mutations run when this was written, each red then reverted: the
 * `useSingleFlightPoll` call in `OutputViewer` put back on a bare
 * `setInterval`, and `COORD_DASHBOARD_POLL_OPTIONS` dropped from the
 * prompt-injections read.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { TokenManager } from "@/services/auth/token-manager";

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/services/service-factory", () => ({
  get httpClient() {
    return holder.client;
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/coord",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

// `CoordAdminOnly` reads `useAuth().isCoordAdmin`; unmocked it throws without
// a provider.
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: true }),
}));

// The wizard names the runner on THIS machine from the active runner context.
vi.mock("@/contexts/active-runner-context", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/contexts/active-runner-context")>();
  return {
    ...actual,
    useRunnerTarget: () => ({
      kind: "runner" as const,
      runner: { id: "dev-local", port: 9901, name: "Local" },
      locality: "local" as const,
    }),
  };
});

import { HttpClient } from "@/services/http-client";
import CoordQuestionsPage from "@/app/(app)/admin/coord/questions/page";
import CoordNotificationsPage from "@/app/(app)/admin/coord/notifications/page";
import AgentClaimsDashboard from "@/components/admin/agent-claims/AgentClaimsDashboard";
import PromptInjectionsDashboard from "@/components/admin/prompt-injections/PromptInjectionsDashboard";
import { OutputViewer } from "@/components/operations/OutputViewer";
import {
  AuditStep,
  MergeOrchestrationOnboarding,
} from "@/components/operations/MergeOrchestrationOnboarding";
import { ConnectedOrgs } from "@/components/operations/ConnectedOrgs";

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

/** Path + query of a fetched URL, with the API base stripped. */
function pathOf(input: unknown): string {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof Request
        ? input.url
        : String(input);
  try {
    const u = new URL(raw, "http://localhost");
    return `${u.pathname}${u.search}`;
  } catch {
    return raw;
  }
}

function methodOf(input: unknown, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (input instanceof Request) return input.method.toUpperCase();
  return "GET";
}

interface Wire {
  /** Requests per URL. */
  counts: () => Map<string, number>;
  total: () => number;
}

function wireOf(urls: string[]): Wire {
  return {
    counts: () => {
      const m = new Map<string, number>();
      for (const u of urls) m.set(u, (m.get(u) ?? 0) + 1);
      return m;
    },
    total: () => urls.length,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Every request answers `status` with `body`. */
function stubFetch(status: number, body: unknown): Wire {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      urls.push(pathOf(input));
      return json(status, body);
    })
  );
  return wireOf(urls);
}

/** Requests hang until released (as a 504). */
function stubHangingFetch(): Wire & { releaseAll: () => void } {
  const urls: string[] = [];
  const pending: ((r: Response) => void)[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (input: unknown) =>
        new Promise<Response>((resolve) => {
          urls.push(pathOf(input));
          pending.push(resolve);
        })
    )
  );
  return {
    ...wireOf(urls),
    releaseAll: () => {
      while (pending.length) pending.shift()!(json(504, {}));
    },
  };
}

/**
 * Route by path + method. A handler answering `"hang"` leaves the request open
 * until `releaseAll` answers it 504.
 */
function stubRouted(
  answer: (path: string, method: string) => Response | "hang"
): Wire & { releaseAll: (answer?: () => Response) => void } {
  const urls: string[] = [];
  const pending: ((r: Response) => void)[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: unknown, init?: RequestInit) => {
      const path = pathOf(input);
      urls.push(path);
      const a = answer(path, methodOf(input, init));
      if (a !== "hang") return Promise.resolve(a);
      return new Promise<Response>((resolve) => pending.push(resolve));
    })
  );
  return {
    ...wireOf(urls),
    releaseAll: (answer: () => Response = () => json(504, {})) => {
      while (pending.length) pending.shift()!(answer());
    },
  };
}

/** A socket that can never be built, so push-first streams poll. */
class NoWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  constructor() {
    throw new Error("no WebSocket in group 3");
  }
}

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

interface PollCase {
  name: string;
  mount: () => unknown;
  /** The fastest timer that drives a read on this surface. */
  intervalMs: number;
  /** Only these routes are held to the one-request rule. */
  only?: RegExp;
}

/** The surfaces group 3 covers, each reading through the real `HttpClient`. */
const POLLS: PollCase[] = [
  {
    // Four reads on the first load, and on every degraded tick.
    name: "/admin/coord/questions",
    mount: () => render(<CoordQuestionsPage />),
    intervalMs: 10_000,
  },
  {
    name: "/admin/coord/notifications",
    mount: () => render(<CoordNotificationsPage />),
    intervalMs: 10_000,
  },
  {
    name: "PromptInjectionsDashboard",
    mount: () => render(<PromptInjectionsDashboard />),
    intervalMs: 10_000,
  },
  {
    name: "OutputViewer",
    mount: () => render(<OutputViewer runnerId="r1" taskRunId="t1" />),
    intervalMs: 5_000,
  },
  {
    // The wizard's own timer; its children do not poll.
    name: "MergeOrchestrationOnboarding (precondition poll)",
    mount: () => render(<MergeOrchestrationOnboarding />),
    intervalMs: 5_000,
    only: /precondition-status/,
  },
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "debug").mockImplementation(() => {});
  vi.stubGlobal("WebSocket", NoWebSocket);
  holder.client = new HttpClient(tokenManager());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function limited(wire: Wire, only?: RegExp): Map<string, number> {
  const out = new Map<string, number>();
  for (const [url, n] of wire.counts()) {
    if (only && !only.test(url)) continue;
    out.set(url, n);
  }
  return out;
}

describe.each(POLLS)("$name (D5)", (c) => {
  // Longer than the first retry's 1 s backoff, shorter than the next tick.
  const windowMs = Math.min(9_000, c.intervalMs - 500);

  it("a 504 from coord costs one request per route", async () => {
    const wire = stubFetch(504, { error: "gateway_timeout" });
    c.mount();
    await advance(windowMs);
    const counts = limited(wire, c.only);
    expect(counts.size).toBeGreaterThan(0);
    for (const [url, n] of counts) expect(n, url).toBe(1);
  });

  it("sends nothing on a tick while the previous request is outstanding", async () => {
    const wire = stubHangingFetch();
    c.mount();
    await advance(c.intervalMs * 3);
    // Every route was asked exactly once, however many ticks went by.
    const counts = wire.counts();
    expect(counts.size).toBeGreaterThan(0);
    for (const [url, n] of counts) expect(n, url).toBe(1);

    const before = wire.total();
    await act(async () => {
      wire.releaseAll();
      await vi.advanceTimersByTimeAsync(0);
    });
    await advance(c.intervalMs * 2);
    // Released, the surface polls again.
    expect(wire.total()).toBeGreaterThan(before);
  });
});

describe("/admin/coord/notifications (D5)", () => {
  it("a 503 answer costs one request", async () => {
    const wire = stubFetch(503, { error: "schema_migration_pending" });
    render(<CoordNotificationsPage />);
    await advance(9_000);
    expect([...wire.counts().values()]).toEqual([1]);
  });
});

describe("AgentClaimsDashboard (D5; raw fetch, so no retry layer to assert)", () => {
  it("sends nothing on a tick while the previous request is outstanding", async () => {
    const wire = stubHangingFetch();
    render(<AgentClaimsDashboard />);
    await advance(30_000);
    // Five poll effects. Two of them (the top-level gates read and the gates
    // section's own) ask for the same route; every other route once.
    const counts = wire.counts();
    expect(counts.size).toBeGreaterThan(0);
    for (const [url, n] of counts) {
      expect(n, url).toBe(url.includes("/gates/list") ? 2 : 1);
    }

    const before = wire.total();
    await act(async () => {
      wire.releaseAll();
      await vi.advanceTimersByTimeAsync(0);
    });
    await advance(20_000);
    expect(wire.total()).toBeGreaterThan(before);
  });
});

describe("AuditStep audit-status poll (D5)", () => {
  function startAudit(statusAnswer: () => Response | "hang") {
    const wire = stubRouted((path, method) => {
      if (path.includes("/onboarding/audit-status")) return statusAnswer();
      if (method === "POST" && path.includes("/onboarding/audit")) {
        return json(202, {
          agent_id: "agent-1",
          repo: "a/b",
          status: "running",
        });
      }
      return json(404, {});
    });
    render(<AuditStep ready />);
    fireEvent.change(screen.getByPlaceholderText("qontinui/qontinui-coord"), {
      target: { value: "a/b" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Audit" }));
    return wire;
  }
  const statusCount = (w: Wire) =>
    [...w.counts()]
      .filter(([u]) => u.includes("/audit-status"))
      .reduce((n, [, k]) => n + k, 0);

  it("a 504 costs one request for that tick", async () => {
    const wire = startAudit(() => json(504, {}));
    // The first read is immediate; the next tick is 4 s later.
    await advance(3_500);
    expect(statusCount(wire)).toBe(1);
  });

  it("sends nothing on a tick while the previous request is outstanding, then polls again", async () => {
    const wire = startAudit(() => "hang");
    await advance(20_000);
    expect(statusCount(wire)).toBe(1);

    await act(async () => {
      wire.releaseAll();
      await vi.advanceTimersByTimeAsync(0);
    });
    await advance(10_000);
    expect(statusCount(wire)).toBeGreaterThan(1);
  });
});

describe("ConnectedOrgs post-enroll poll (D5)", () => {
  const EMPTY_ORG = {
    account_login: "acme",
    account_type: "Organization",
    installation_id: 111,
    repos: [],
  };

  /** Mount read answers; the enroll POST answers 202; poll reads answer `poll`. */
  async function enroll(poll: () => Response | "hang") {
    let accountReads = 0;
    const wire = stubRouted((path, method) => {
      if (method === "POST") return json(202, { enrolled: "spawned" });
      if (path.includes("/pr-merge/onboarding/accounts")) {
        accountReads += 1;
        return accountReads === 1
          ? json(200, { accounts: [EMPTY_ORG] })
          : poll();
      }
      return json(404, {});
    });
    render(<ConnectedOrgs />);
    await advance(0);
    fireEvent.click(screen.getByTestId("enroll-repos-acme"));
    await advance(0);
    return wire;
  }
  const accountReads = (w: Wire) =>
    [...w.counts()]
      .filter(([u]) => u.includes("/pr-merge/onboarding/accounts"))
      .reduce((n, [, k]) => n + k, 0);

  it("a 504 costs one request per tick", async () => {
    const wire = await enroll(() => json(504, {}));
    // One tick (3 s): the mount read plus ONE poll read, not a retry chain.
    await advance(3_500);
    expect(accountReads(wire)).toBe(2);
  });

  it("sends nothing on a tick while the previous read is outstanding, then polls again", async () => {
    const wire = await enroll(() => "hang");
    await advance(15_000);
    // The mount read and the one poll read still open.
    expect(accountReads(wire)).toBe(2);

    // Answer the open reads with an (empty) accounts list: a failure would
    // replace the list with an error line and unmount the row that polls.
    await act(async () => {
      wire.releaseAll(() => json(200, { accounts: [EMPTY_ORG] }));
      await vi.advanceTimersByTimeAsync(0);
    });
    await advance(9_000);
    expect(accountReads(wire)).toBeGreaterThan(2);
  });
});
