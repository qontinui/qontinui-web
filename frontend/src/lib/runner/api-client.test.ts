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

    await expect(runnerFetch("/health")).rejects.toBeInstanceOf(
      RunnerApiError
    );
  });
});
