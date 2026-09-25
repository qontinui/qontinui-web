/**
 * T6 of plan `2026-09-25-fleet-worktree-slots-hang-mechanism-and-safe-reland`:
 * each surface in `POLLS` below, on getting a 504 (or a 503 deadline), sends
 * ONE request per coord route for that tick — no `RetryStrategy` chain — and
 * a tick that finds the previous request outstanding sends nothing.
 *
 * `POLLS` is exactly what D5 covers: the Dev Ops dashboard's coord polls, the
 * pipeline page's stuck-PR panel, and the two pollers the coord layout mounts
 * on every `/admin/coord/*` page (the nav's fleet alarm badge and the red-main
 * banner). It is NOT every coord poll in the console; the other
 * `/admin/coord` pages are out of this plan's scope.
 *
 * These run against the REAL `HttpClient` (only `fetch` is stubbed, and
 * `WebSocket` is stubbed to fail so every push-first stream sits on its
 * polling fallback), because the property under test is how many requests
 * reach the wire. A mocked `httpClient.get` would count calls to our own code,
 * and would stay green if the retry policy were dropped.
 *
 * Requests are counted PER URL, so a surface that reads several routes in one
 * batch is held to one request per route. Web-local routes that deliberately
 * keep the client's default retries are named per surface in `retryExempt`.
 *
 * Mutations run when this was written, each red then reverted:
 * `COORD_DASHBOARD_POLL_OPTIONS` set to `{}` (the client's default 3-retry
 * budget), and the in-flight check removed from `useSingleFlight`'s tick.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook } from "@testing-library/react";
import type { ReactElement } from "react";
import type { TokenManager } from "@/services/auth/token-manager";

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/services/service-factory", () => ({
  get httpClient() {
    return holder.client;
  },
}));

import { HttpClient } from "@/services/http-client";
import { useFleetWorktreeSlots } from "./useFleetWorktreeSlots";
import { useFleetResourceSamples } from "./useFleetResourceSamples";
import { useFleetVolumes } from "./useFleetVolumes";
import { useFleetHealth } from "./useFleetHealth";
import { useFleetDrain } from "./useFleetDrain";
import { useCiRunnerMirror } from "./useCiRunnerMirror";
import { useSymbolClaimsStream } from "./useSymbolClaimsStream";
import { useCiStatusStream } from "./useCiStatusStream";
import { useDevActionsStream } from "./useDevActionsStream";
import { useDeviceStatusStream } from "./useDeviceStatusStream";
import { useMigrationQueueStream } from "./useMigrationQueueStream";
import { useMergePipelineData } from "./useMergePipelineData";
import {
  useDeviceFleetSessions,
  useDeviceReadiness,
} from "./useRunnerWindDown";
import { FleetTestTargetsPanel } from "./FleetTestTargetsPanel";
import { FleetOverview } from "./FleetOverview";
import { StuckPrRecoveryPanel } from "./StuckPrRecoveryPanel";
import { useFleetAlarmBadge } from "@/components/admin/coord/useFleetAlarmBadge";
import { RedMainBanner } from "@/components/admin/coord/RedMainBanner";
import {
  CI_STATUS_POLL_FALLBACK_MS,
  DEVICE_STATUS_POLL_FALLBACK_MS,
} from "./utils";

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

/** Every request answers `status` with `body`. */
function stubFetch(status: number, body: unknown): Wire {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      urls.push(pathOf(input));
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
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
      while (pending.length) {
        pending.shift()!(
          new Response(JSON.stringify({}), {
            status: 504,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
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
    throw new Error("no WebSocket in T6");
  }
}

const DEVICE = "3f4c1a52-9a1e-4b6f-9f0f-8c2f0f0a11bd";

function FleetOverviewHost(): ReactElement {
  const noop = async () => {};
  return (
    <FleetOverview
      health={{ data: null, loading: true, error: null, refresh: noop }}
      ciMachines={{ state: "loading" }}
      drain={{ read: { state: "loading" }, refresh: noop }}
      deviceStatus={{
        byHostname: new Map(),
        connected: false,
        error: null,
        seeded: false,
        everSeeded: false,
        refetch: noop,
      }}
      nowMs={0}
      ciRunnerMirror={{ state: "loading" }}
    />
  );
}

interface PollCase {
  name: string;
  mount: () => unknown;
  /** The fastest timer that drives a read on this surface. */
  intervalMs: number;
  /**
   * How long to watch a failing first read for retries. Longer than the
   * first retry's 1 s backoff, shorter than the next scheduled read.
   * Defaults to min(9 s, interval - 0.5 s).
   */
  windowMs?: number;
  /** Web-local routes on this surface that keep the default retries. */
  retryExempt?: RegExp;
  /** When set, only these routes are held to the one-request rule. */
  coordOnly?: RegExp;
}

const hook = (use: () => unknown) => () => renderHook(use);

/** The surfaces D5 covers — see the header. Nothing else is claimed. */
const POLLS: PollCase[] = [
  {
    name: "useFleetWorktreeSlots",
    mount: hook(() => useFleetWorktreeSlots()),
    intervalMs: 30_000,
  },
  {
    name: "useFleetResourceSamples",
    mount: hook(() => useFleetResourceSamples()),
    intervalMs: 30_000,
  },
  {
    name: "useFleetVolumes",
    mount: hook(() => useFleetVolumes()),
    intervalMs: 30_000,
  },
  {
    name: "useFleetHealth",
    mount: hook(() => useFleetHealth()),
    intervalMs: 10_000,
  },
  {
    name: "useFleetDrain",
    mount: hook(() => useFleetDrain()),
    intervalMs: 30_000,
  },
  {
    name: "useCiRunnerMirror",
    mount: hook(() => useCiRunnerMirror()),
    intervalMs: 60_000,
  },
  {
    name: "useSymbolClaimsStream",
    mount: hook(() => useSymbolClaimsStream()),
    intervalMs: 30_000,
  },
  {
    name: "useCiStatusStream",
    mount: hook(() => useCiStatusStream()),
    intervalMs: CI_STATUS_POLL_FALLBACK_MS,
  },
  {
    name: "useDevActionsStream",
    mount: hook(() => useDevActionsStream()),
    intervalMs: 10_000,
  },
  {
    name: "useDeviceStatusStream",
    mount: hook(() => useDeviceStatusStream()),
    intervalMs: DEVICE_STATUS_POLL_FALLBACK_MS,
  },
  {
    name: "useMigrationQueueStream",
    mount: hook(() => useMigrationQueueStream("qontinui-web")),
    intervalMs: 15_000,
  },
  // Its own single-flight batches run no closer than 3 s apart.
  {
    name: "useMergePipelineData",
    mount: hook(() => useMergePipelineData()),
    intervalMs: 15_000,
    windowMs: 2_500,
  },
  {
    name: "useDeviceReadiness",
    mount: hook(() => useDeviceReadiness(DEVICE)),
    intervalMs: 15_000,
  },
  {
    name: "useDeviceFleetSessions",
    mount: hook(() => useDeviceFleetSessions(DEVICE)),
    intervalMs: 15_000,
  },
  {
    name: "FleetTestTargetsPanel",
    mount: () => render(<FleetTestTargetsPanel />),
    intervalMs: 15_000,
    retryExempt: /\/api\/v1\/fleet\/(apps|test-targets)$/,
  },
  {
    // The component's own 5 s loop reads two web-local routes; the coord
    // reads it mounts (volumes, symbol claims) are held to the rule.
    name: "FleetOverview",
    mount: () => render(<FleetOverviewHost />),
    intervalMs: 5_000,
    retryExempt: /\/api\/v1\/operations\/fleet(\/tasks)?$/,
  },
  {
    // The panel's own reads; the tenant-default-repo lookup is a one-shot.
    name: "StuckPrRecoveryPanel",
    mount: () => render(<StuckPrRecoveryPanel repo="qontinui/qontinui-web" />),
    intervalMs: 30_000,
    coordOnly: /stuck-nudges|\/pr-merge\//,
  },
  {
    name: "useFleetAlarmBadge",
    mount: hook(() => useFleetAlarmBadge()),
    intervalMs: 60_000,
  },
  {
    name: "RedMainBanner",
    mount: () => render(<RedMainBanner />),
    intervalMs: 10_000,
  },
];

function coordCounts(
  wire: Wire,
  exempt?: RegExp,
  only?: RegExp
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [url, n] of wire.counts()) {
    if (exempt && exempt.test(url.split("?")[0])) continue;
    if (only && !only.test(url)) continue;
    out.set(url, n);
  }
  return out;
}

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

describe.each(POLLS)("$name (T6)", (c) => {
  const windowMs = c.windowMs ?? Math.min(9_000, c.intervalMs - 500);

  it("a 504 from coord costs one request per route", async () => {
    const wire = stubFetch(504, { error: "gateway_timeout" });
    c.mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(windowMs);
    });
    const counts = coordCounts(wire, c.retryExempt, c.coordOnly);
    expect(counts.size).toBeGreaterThan(0);
    for (const [url, n] of counts) expect(n, url).toBe(1);
  });

  it("a 503 deadline costs one request per route", async () => {
    const wire = stubFetch(503, { error: "deadline", budget_ms: 4000 });
    c.mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(windowMs);
    });
    const counts = coordCounts(wire, c.retryExempt, c.coordOnly);
    expect(counts.size).toBeGreaterThan(0);
    for (const [url, n] of counts) expect(n, url).toBe(1);
  });

  it("sends nothing on a tick while the previous request is outstanding", async () => {
    const wire = stubHangingFetch();
    c.mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(c.intervalMs * 3);
    });
    // Every route — web-local ones included — was asked exactly once.
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

describe("what the operator reads", () => {
  it("worktree slots: a 503 deadline is UNKNOWN naming the budget", async () => {
    stubFetch(503, { error: "deadline", budget_ms: 4000 });
    const { result } = renderHook(() => useFleetWorktreeSlots());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.error).toBe(
      "coord read deadline (4000 ms) exceeded — unknown"
    );
    expect(result.current.data).toBeNull();
  });

  it("worktree slots: a route_disabled 404 reads as disabled by operator", async () => {
    stubFetch(404, { error: "route_disabled" });
    const { result } = renderHook(() => useFleetWorktreeSlots());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.error).toBe("disabled by operator");
  });

  it("worktree slots: a plain 404 keeps the not-shipped wording", async () => {
    stubFetch(404, { detail: "Not Found" });
    const { result } = renderHook(() => useFleetWorktreeSlots());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.error).toMatch(
      /^coord does not serve the fleet worktree-slots route yet/
    );
  });

  it("volumes: a 503 deadline is unavailable, naming the budget, never an empty read", async () => {
    stubFetch(503, { error: "deadline", budget_ms: 4000 });
    const { result } = renderHook(() => useFleetVolumes());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.state).toBe("unavailable");
    expect(
      result.current.state === "unavailable" && result.current.reason
    ).toContain("coord read deadline (4000 ms) exceeded — unknown");
  });

  it("volumes: a route_disabled 404 says disabled by operator", async () => {
    stubFetch(404, { error: "route_disabled" });
    const { result } = renderHook(() => useFleetVolumes());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(
      result.current.state === "unavailable" && result.current.reason
    ).toContain("disabled by operator");
  });

  it("volumes: a 200 still parses into the same ok read as before", async () => {
    stubFetch(200, {
      devices: [
        {
          device_id: "d1",
          hostname: "host-a",
          volumes: [
            {
              volume: "C:",
              total_bytes: 100,
              free_bytes: 40,
              observed_at: "2026-09-25T00:00:00Z",
            },
          ],
        },
      ],
      count: 1,
    });
    const { result } = renderHook(() => useFleetVolumes());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.state).toBe("ok");
    if (result.current.state === "ok") {
      expect(
        result.current.byHostname.get("host-a")?.volumes[0]?.free_bytes
      ).toBe(40);
    }
  });
});
