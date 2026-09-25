/**
 * T6 of plan `2026-09-25-fleet-worktree-slots-hang-mechanism-and-safe-reland`:
 * a coord-proxied Dev Ops poll that gets a 504 (or a 503 deadline) sends
 * EXACTLY ONE request for that tick — no `RetryStrategy` chain — and a tick
 * that finds the previous request outstanding sends nothing.
 *
 * These run against the REAL `HttpClient` (only `fetch` is stubbed), because
 * the property under test is how many requests reach the wire. A mocked
 * `httpClient.get` would count calls to our own code, and would stay green if
 * the retry policy were dropped.
 *
 * Mutation run when this was written: `COORD_DASHBOARD_POLL_OPTIONS` set to
 * `{}` (the client's default 3-retry budget) → every "one request per 504
 * tick" assertion reads 5 and the file goes red.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
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

/** Every request answers `status` with `body`; returns the request counter. */
function stubFetch(status: number, body: unknown): { calls: () => number } {
  let calls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      calls += 1;
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    })
  );
  return { calls: () => calls };
}

/** Requests hang until released; returns the counter and the release. */
function stubHangingFetch(): { calls: () => number; releaseAll: () => void } {
  let calls = 0;
  const pending: ((r: Response) => void)[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          calls += 1;
          pending.push(resolve);
        })
    )
  );
  return {
    calls: () => calls,
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

/** Every coord-proxied Dev Ops poll, with its interval. */
const POLLS: { name: string; usePoll: () => unknown; intervalMs: number }[] = [
  {
    name: "useFleetWorktreeSlots",
    usePoll: () => useFleetWorktreeSlots(),
    intervalMs: 30_000,
  },
  {
    name: "useFleetResourceSamples",
    usePoll: () => useFleetResourceSamples(),
    intervalMs: 30_000,
  },
  {
    name: "useFleetVolumes",
    usePoll: () => useFleetVolumes(),
    intervalMs: 30_000,
  },
  {
    name: "useFleetHealth",
    usePoll: () => useFleetHealth(),
    intervalMs: 10_000,
  },
  { name: "useFleetDrain", usePoll: () => useFleetDrain(), intervalMs: 30_000 },
  {
    name: "useCiRunnerMirror",
    usePoll: () => useCiRunnerMirror(),
    intervalMs: 60_000,
  },
];

/**
 * Longer than the default retry chain's whole backoff (1 s + 2 s + 4 s plus
 * jitter) and shorter than the fastest poll interval, so a retry WOULD have
 * landed inside it and no second tick has.
 */
const BACKOFF_WINDOW_MS = 9_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  holder.client = new HttpClient(tokenManager());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe.each(POLLS)("$name (T6)", ({ usePoll, intervalMs }) => {
  it("a 504 from coord costs exactly one request per tick", async () => {
    const wire = stubFetch(504, { error: "gateway_timeout" });
    renderHook(usePoll);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BACKOFF_WINDOW_MS);
    });
    expect(wire.calls()).toBe(1);

    // The next tick is the retry — one more request, still no chain.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(intervalMs);
    });
    expect(wire.calls()).toBe(2);
  });

  it("a 503 deadline costs exactly one request", async () => {
    const wire = stubFetch(503, { error: "deadline", budget_ms: 4000 });
    renderHook(usePoll);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BACKOFF_WINDOW_MS);
    });
    expect(wire.calls()).toBe(1);
  });

  it("sends nothing on a tick while the previous request is outstanding", async () => {
    const wire = stubHangingFetch();
    renderHook(usePoll);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(intervalMs * 3);
    });
    expect(wire.calls()).toBe(1);

    await act(async () => {
      wire.releaseAll();
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(intervalMs);
    });
    expect(wire.calls()).toBe(2);
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
