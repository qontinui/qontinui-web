/**
 * Regression tests for the loopback-origin gate in runnerFetch
 * (prod console noise, 2026-06-07).
 *
 * BUG: every runner query (useRunnerHealth 10s poll on /build/workflows,
 * /extension/status 5s poll, …) fetched http://localhost:9876 from ANY
 * origin. On production pages (qontinui.io) Chrome's Local Network Access
 * blocks public→loopback, so each poll was a guaranteed net::ERR_FAILED
 * console line — the request could never succeed.
 *
 * FIX: when the runner base is loopback AND the page origin is not
 * localhost, runnerFetch fast-fails with the same offline error shape
 * WITHOUT touching the network, and useRunnerQuery doesn't start poll
 * timers at all.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const relayFetch = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => relayFetch(...args) },
}));
vi.mock("@/services/api-config", () => ({
  ApiConfig: { API_BASE_URL: "https://api.test" },
}));

import {
  RUNNER_ORIGIN_UNREACHABLE,
  runnerFetch,
  RunnerApiError,
  isRunnerNeedsLocalError,
  useRunnerQuery,
} from "./api-client";
import { CROSS_ORIGIN_REFUSED } from "./origin-refusal";
import { __resetRunnerLocalityCache } from "./locality";
import type { RunnerTarget } from "./target";

const originalLocation = window.location;

function stubOrigin(origin: string) {
  Object.defineProperty(window, "location", {
    value: { ...originalLocation, origin, href: `${origin}/build/workflows` },
    writable: true,
  });
}

// "List loaded, no runner listed": the default local base.
const DEFAULT: RunnerTarget = { kind: "default_local" };

beforeEach(() => {
  relayFetch.mockReset();
  __resetRunnerLocalityCache();
});

describe("runnerFetch loopback-origin gate", () => {
  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
    });
    vi.unstubAllGlobals();
  });

  it("fast-fails on a public origin WITHOUT calling fetch", async () => {
    stubOrigin("https://qontinui.io");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const err = await runnerFetch(DEFAULT, "/health").catch((e: unknown) => e);
    expect(err).toMatchObject({
      name: "RunnerApiError",
      status: 0,
      code: RUNNER_ORIGIN_UNREACHABLE,
    });
    // An unreachable origin is not a relay refusal, and nothing was sent.
    expect(isRunnerNeedsLocalError(err)).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(relayFetch).not.toHaveBeenCalled();
  });

  it("still fetches from a localhost origin", async () => {
    stubOrigin("http://localhost:3001");
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(runnerFetch(DEFAULT, "/health")).resolves.toEqual({
      ok: true,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toBe(
      "http://127.0.0.1:9876/health"
    );
  });

  it("surfaces real connection failures unchanged on localhost origins", async () => {
    stubOrigin("http://localhost:3001");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))
    );

    await expect(runnerFetch(DEFAULT, "/health")).rejects.toBeInstanceOf(
      RunnerApiError
    );
  });
});

/**
 * The runner's origin guard (plan 2026-09-17-runner-loopback-api-accepts-any-origin)
 * refuses a Trusted-origin page calling a route off its allowlist with a typed
 * 403 whose body the page CAN read. Before this, runnerFetch threw the generic
 * "Runner API error: 403 Forbidden", which reads as a broken runner.
 */
describe("runnerFetch origin-guard refusal", () => {
  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
    });
    vi.unstubAllGlobals();
  });

  it("renders CROSS_ORIGIN_REFUSED as a typed, actionable error", async () => {
    stubOrigin("http://localhost:3001");
    const body = {
      success: false,
      code: CROSS_ORIGIN_REFUSED,
      error: "cross-origin request refused",
      context: {
        origin: "http://localhost:3001",
        class: "trusted",
        method: "POST",
        route_pattern: "/shell-commands/{id}/run",
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), {
          status: 403,
          statusText: "Forbidden",
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    const err = await runnerFetch(DEFAULT, "/shell-commands/x/run", {
      method: "POST",
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RunnerApiError);
    const apiErr = err as RunnerApiError;
    expect(apiErr.status).toBe(403);
    expect(apiErr.code).toBe(CROSS_ORIGIN_REFUSED);
    expect(apiErr.originRefusal?.routePattern).toBe("/shell-commands/{id}/run");
    expect(apiErr.message).toContain("CROSS_ORIGIN_REFUSED");
    expect(apiErr.message).toContain("POST /shell-commands/{id}/run");
    expect(apiErr.message).toContain("http://localhost:3001");
    expect(apiErr.message).toContain("QONTINUI_RUNNER_ALLOWED_ORIGINS");
    expect(apiErr.message).toContain("api.allowed_origins");
    expect(apiErr.message).not.toContain("Runner API error: 403");
  });

  it("aborts a 403 whose body stalls instead of hanging", async () => {
    stubOrigin("http://localhost:3001");
    // Headers arrive, the body never does — the stream only ends when the
    // request's abort signal fires, which is how a real fetch body behaves.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            init?.signal?.addEventListener("abort", () =>
              controller.error(new DOMException("aborted", "AbortError"))
            );
          },
        });
        return Promise.resolve(
          new Response(body, { status: 403, statusText: "Forbidden" })
        );
      })
    );

    const started = Date.now();
    const err = (await runnerFetch(DEFAULT, "/x", { timeoutMs: 50 }).catch(
      (e: unknown) => e
    )) as RunnerApiError;
    expect(err).toBeInstanceOf(RunnerApiError);
    expect(err.status).toBe(403);
    expect(err.message).toBe("Runner API error: 403 Forbidden");
    expect(Date.now() - started).toBeLessThan(2000);
  }, 3000);

  it("does not read the body of a non-403 error", async () => {
    stubOrigin("http://localhost:3001");
    const resp = new Response(
      JSON.stringify({ success: false, code: CROSS_ORIGIN_REFUSED }),
      { status: 500, statusText: "Internal Server Error" }
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(resp));

    const err = (await runnerFetch(DEFAULT, "/x").catch(
      (e: unknown) => e
    )) as RunnerApiError;
    expect(err.message).toBe("Runner API error: 500 Internal Server Error");
    expect(err.code).toBeUndefined();
    expect(resp.bodyUsed).toBe(false);
  });

  it("keeps the generic message for an unrelated 403", async () => {
    stubOrigin("http://localhost:3001");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: false, code: "OTHER" }), {
          status: 403,
          statusText: "Forbidden",
        })
      )
    );

    const err = (await runnerFetch(DEFAULT, "/x").catch(
      (e: unknown) => e
    )) as RunnerApiError;
    expect(err.message).toBe("Runner API error: 403 Forbidden");
    expect(err.code).toBeUndefined();
  });
});

/**
 * useRunnerQuery while the active runner's locality is re-measured: a refusal
 * from a previous measurement must not linger as the current state.
 */
describe("useRunnerQuery measuring state", () => {
  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
    });
    vi.unstubAllGlobals();
  });

  it("clears a previous refusal's error and offline flag while measuring", async () => {
    stubOrigin("http://localhost:3001");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    let target: RunnerTarget = {
      kind: "unavailable",
      reason: "resolver_unavailable",
    };

    const { result, rerender } = renderHook(() =>
      useRunnerQuery(target, "/health")
    );
    await waitFor(() => expect(result.current.isOffline).toBe(true));
    expect(result.current.error).toMatch(/device resolver did not answer/);
    expect(result.current.errorCode).toBe("RUNNER_RESOLVER_UNAVAILABLE");

    target = { kind: "pending" };
    rerender();
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.isOffline).toBe(false);
    expect(result.current.isLoading).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(relayFetch).not.toHaveBeenCalled();
  });
});

/**
 * A shared poll is pinned to the target+route it was created for. A tick that
 * fires after the active runner changed, but before React has torn the old
 * subscription down, must fetch the OLD runner — the result is delivered to
 * (and tagged for) the old runner's subscribers.
 */
describe("shared poll route pinning", () => {
  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
    });
    vi.unstubAllGlobals();
  });

  it("a tick between a target change and cleanup fetches the entry's own runner", async () => {
    stubOrigin("http://localhost:3001");
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    );
    vi.stubGlobal("fetch", fetchSpy);
    const a: RunnerTarget = {
      kind: "runner",
      runner: { id: "a", port: 9876 },
      locality: "local",
    };
    const b: RunnerTarget = {
      kind: "runner",
      runner: { id: "b", port: 9877 },
      locality: "local",
    };
    let target = a;

    const { result, rerender } = renderHook(() =>
      useRunnerQuery(target, "/pinned", { pollInterval: 60_000 })
    );
    await waitFor(() => expect(result.current.data).toEqual({ ok: true }));
    fetchSpy.mockClear();

    // A poll tick fires (the visibility-resume path runs every shared poll
    // at once) as the target switches — the old entry still fetches its own
    // runner.
    target = b;
    document.dispatchEvent(new Event("visibilitychange"));
    rerender();

    await act(async () => {});
    const urls = fetchSpy.mock.calls.map((call) => String(call[0]));
    expect(urls[0]).toBe("http://127.0.0.1:9876/pinned");
    // And the new target's subscription fetched the new runner.
    expect(urls).toContain("http://127.0.0.1:9877/pinned");
  });
});
