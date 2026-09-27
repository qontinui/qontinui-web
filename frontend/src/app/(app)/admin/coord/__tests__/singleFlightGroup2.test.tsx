/**
 * D5 of plan `2026-09-25-fleet-worktree-slots-hang-mechanism-and-safe-reland`,
 * applied to the `/admin/coord/*` surfaces PR #1508 left on a bare
 * `setInterval` or default retries (group 2: spawn — which keeps its own
 * generation guard and only gained the no-retry option — work-units' plan-difficulty read, deploys,
 * git-ops, the PRs page's deploy strip, releases, trees, lands).
 *
 * For every surface: a 504 answer costs ONE request per route for that tick
 * (no `RetryStrategy` chain), a tick that finds the previous request
 * outstanding sends nothing, and the surface polls again once the outstanding
 * one settles.
 *
 * Like `components/operations/coordDashboardPolls.test.tsx`, this runs against
 * the REAL `HttpClient` and stubs only `fetch`: the property under test is how
 * many requests reach the wire, which a mocked `httpClient.get` cannot see.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
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
  useSearchParams: () =>
    new URLSearchParams("device_id=c1c1c1c1-0000-4000-8000-000000000001"),
  useParams: () => ({}),
}));

// `/spawn` gates its "New session" button behind `<CoordAdminOnly>`; an
// unmocked `useAuth` throws without a provider.
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: true }),
}));

// `/lands` pre-fills its preview form from a one-shot tenant lookup that is
// neither a timer nor part of D5.
vi.mock("@/components/operations/useTenantDefaultRepo", () => ({
  useTenantDefaultRepo: () => ({ defaultRepo: null, loading: false }),
}));

import { HttpClient } from "@/services/http-client";
import CoordSpawnPage from "../spawn/page";
import CoordDeploysPage from "../deploys/page";
import CoordGitOpsPage from "../git-ops/page";
import CoordReleasesPage from "../releases/page";
import CoordTreesPage from "../trees/page";
import CoordLandsPage from "../lands/page";
import { DeployStatusStrip } from "../prs/_components/DeployStatusStrip";
import {
  DIFFICULTY_POLL_MS,
  usePlanDifficulty,
} from "../work-units/usePlanDifficulty";

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

interface PollCase {
  name: string;
  mount: () => unknown;
  /** The fastest timer that drives a read on this surface. */
  intervalMs: number;
}

const POLLS: PollCase[] = [
  {
    name: "/spawn",
    mount: () => render(<CoordSpawnPage />),
    intervalMs: 15_000,
  },
  {
    name: "usePlanDifficulty",
    mount: () => renderHook(() => usePlanDifficulty()),
    intervalMs: DIFFICULTY_POLL_MS,
  },
  {
    name: "/deploys",
    mount: () => render(<CoordDeploysPage />),
    intervalMs: 30_000,
  },
  {
    // One flight, TWO routes: each is asked once per tick.
    name: "/git-ops",
    mount: () => render(<CoordGitOpsPage />),
    intervalMs: 30_000,
  },
  {
    name: "DeployStatusStrip",
    mount: () => render(<DeployStatusStrip />),
    // 15 s while degraded, which a failing read always is.
    intervalMs: 15_000,
  },
  {
    name: "/releases",
    mount: () => render(<CoordReleasesPage />),
    intervalMs: 30_000,
  },
  {
    name: "/trees (by device)",
    mount: () => render(<CoordTreesPage />),
    intervalMs: 10_000,
  },
  {
    name: "/trees (contention)",
    mount: () => {
      const r = render(<CoordTreesPage />);
      fireEvent.click(screen.getByTestId("coord-trees-tab-contention"));
      return r;
    },
    intervalMs: 10_000,
  },
  {
    // The lands poll and the calibration panel's own precision poll.
    name: "/lands",
    mount: () => render(<CoordLandsPage />),
    intervalMs: 30_000,
  },
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

describe.each(POLLS)("$name (D5)", (c) => {
  // Longer than the first retry's 1 s backoff, shorter than the next read.
  const windowMs = Math.min(9_000, c.intervalMs - 500);

  it("a 504 from coord costs one request per route", async () => {
    const wire = stubFetch(504, { error: "gateway_timeout" });
    c.mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(windowMs);
    });
    const counts = wire.counts();
    expect(counts.size).toBeGreaterThan(0);
    for (const [url, n] of counts) expect(n, url).toBe(1);
  });

  it("sends nothing on a tick while the previous request is outstanding", async () => {
    const wire = stubHangingFetch();
    c.mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(c.intervalMs * 3);
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
      await vi.advanceTimersByTimeAsync(c.intervalMs * 2);
    });
    // Released, the surface polls again.
    expect(wire.total()).toBeGreaterThan(before);
  });
});

describe("a changed filter is answered at once (supersedeOnChange)", () => {
  it("/deploys asks the new service filter while the old read is still out", async () => {
    const wire = stubHangingFetch();
    render(<CoordDeploysPage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(wire.total()).toBe(1);

    // The first read never answers; the operator types a filter meanwhile.
    fireEvent.change(screen.getByTestId("coord-deploys-service-filter"), {
      target: { value: "backend" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(wire.total()).toBe(2);
    expect(
      [...wire.counts().keys()].some((u) => u.includes("service=backend"))
    ).toBe(true);
  });
});
