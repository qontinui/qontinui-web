/**
 * D5 of plan `2026-09-25-fleet-worktree-slots-hang-mechanism-and-safe-reland`,
 * applied to the `/admin/coord/*` pages that PR #1508 left on a bare
 * `setInterval` (group 1: agents, agents/[agent_id], federation, history,
 * memory, policies, pull-decisions).
 *
 * For every page: a 504 answer costs ONE request per route for that tick (no
 * `RetryStrategy` chain), a tick that finds the previous request outstanding
 * sends nothing, and the page polls again once the outstanding one settles.
 *
 * Like `components/operations/coordDashboardPolls.test.tsx`, this runs against
 * the REAL `HttpClient` and stubs only `fetch`: the property under test is how
 * many requests reach the wire, which a mocked `httpClient.get` cannot see.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import type { ReactElement } from "react";
import type { TokenManager } from "@/services/auth/token-manager";

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/services/service-factory", () => ({
  get httpClient() {
    return holder.client;
  },
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ agent_id: "agent-1" }),
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// The recent-agents page mounts this tile, which owns a poll of its own that
// is covered by `components/operations/coordDashboardPolls.test.tsx`.
vi.mock("@/components/operations", () => ({
  DevActionsTile: () => null,
}));

// The policies page also mounts a design-policies section. Its read is a
// one-shot web-local load on mount (not a timer, not coord-proxied), so it is
// out of D5's scope and would only add its own default-retry requests here.
vi.mock("../policies/_components/DesignPoliciesSection", () => ({
  DesignPoliciesSection: () => null,
}));

import { HttpClient } from "@/services/http-client";
import CoordAgentsRecentPage from "../agents/page";
import CoordAgentLogPage from "../agents/[agent_id]/page";
import CoordFederationPage from "../federation/page";
import CoordHistoryPage from "../history/page";
import CoordMemoryListPage from "../memory/page";
import CoordPoliciesPage from "../policies/page";
import CoordPullDecisionsPage from "../pull-decisions/page";

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

interface Wire {
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

/** Requests hang until released. */
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

interface PollCase {
  name: string;
  Page: () => ReactElement;
  /** The page's poll interval. */
  intervalMs: number;
}

const POLLS: PollCase[] = [
  { name: "agents", Page: CoordAgentsRecentPage, intervalMs: 5_000 },
  { name: "agents/[agent_id]", Page: CoordAgentLogPage, intervalMs: 5_000 },
  { name: "federation", Page: CoordFederationPage, intervalMs: 30_000 },
  // Two `useSection` polls: one route per status, each held to the rule.
  { name: "history", Page: CoordHistoryPage, intervalMs: 30_000 },
  { name: "memory", Page: CoordMemoryListPage, intervalMs: 15_000 },
  { name: "policies", Page: CoordPoliciesPage, intervalMs: 30_000 },
  { name: "pull-decisions", Page: CoordPullDecisionsPage, intervalMs: 15_000 },
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "debug").mockImplementation(() => {});
  holder.client = new HttpClient(tokenManager());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe.each(POLLS)("/admin/coord/$name (D5)", ({ Page, intervalMs }) => {
  // Longer than the first retry's 1 s backoff, shorter than the next tick.
  const windowMs = Math.min(9_000, intervalMs - 500);

  it("a 504 costs exactly one request per route for that tick", async () => {
    const wire = stubFetch(504, { error: "gateway_timeout" });
    render(<Page />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(windowMs);
    });
    const counts = wire.counts();
    expect(counts.size).toBeGreaterThan(0);
    for (const [url, n] of counts) expect(n, url).toBe(1);
  });

  it("sends no second request while one is outstanding, and polls again after it settles", async () => {
    const wire = stubHangingFetch();
    render(<Page />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(intervalMs * 3);
    });
    const counts = wire.counts();
    expect(counts.size).toBeGreaterThan(0);
    for (const [url, n] of counts) expect(n, url).toBe(1);

    const before = wire.total();
    await act(async () => {
      wire.releaseAll();
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(intervalMs * 2);
    });
    expect(wire.total()).toBeGreaterThan(before);
  });
});
