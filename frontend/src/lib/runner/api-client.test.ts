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

import { afterEach, describe, expect, it, vi } from "vitest";

import { runnerFetch, RunnerApiError } from "./api-client";
import { CROSS_ORIGIN_REFUSED } from "./origin-refusal";

const originalLocation = window.location;

function stubOrigin(origin: string) {
  Object.defineProperty(window, "location", {
    value: { ...originalLocation, origin, href: `${origin}/build/workflows` },
    writable: true,
  });
}

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

    await expect(runnerFetch("/health")).rejects.toMatchObject({
      name: "RunnerApiError",
      status: 0,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
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

    await expect(runnerFetch("/health")).resolves.toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain(
      "http://localhost:9876/health"
    );
  });

  it("surfaces real connection failures unchanged on localhost origins", async () => {
    stubOrigin("http://localhost:3001");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))
    );

    await expect(runnerFetch("/health")).rejects.toBeInstanceOf(RunnerApiError);
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

    const err = await runnerFetch("/shell-commands/x/run", {
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

    const err = (await runnerFetch("/x").catch(
      (e: unknown) => e
    )) as RunnerApiError;
    expect(err.message).toBe("Runner API error: 403 Forbidden");
    expect(err.code).toBeUndefined();
  });
});
