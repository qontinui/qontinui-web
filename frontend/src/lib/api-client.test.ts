/**
 * ApiClient delegation tests.
 *
 * Phase 2 of `2026-09-02-apiclient-duplicate-copies-carry-the-same-method-blind-retry`
 * folded `ApiClient.fetchWithAuth` onto the shared `HttpClient`: the class now
 * owns route shapes and response typing only, and every transport concern
 * (auth headers, CSRF, timeout, 429/5xx retry, the staleness-gated 401
 * refresh) comes from `httpClient.fetch`.
 *
 * These tests exist to prove the hand-rolled retry loop is GONE rather than
 * merely renamed, so they assert on request COUNTS and BACKOFF, which differ
 * measurably between the two implementations:
 *
 *   - ApiClient's deleted loop: 4 requests for a retried 5xx (attempt 1..4,
 *     with `attempt <= retryAttempts(3)` gating the recursion).
 *   - HttpClient's chain: 5 requests. `executeRequestWithRetry` issues the
 *     first request itself and THEN hands a fresh `requestFn` to
 *     `RetryStrategy.executeWithRetry`, which runs it once more before its own
 *     `maxRetries: 3` counter applies — so the total is 1 + 4, with
 *     1s + 2s + 4s of backoff in between.
 *
 * DEFERRED — the plan's V3 assertion ("a POST answering 504 is issued exactly
 * once") is deliberately NOT written here. `HttpOptions.idempotent` and the
 * method-aware retry rule arrive with PR #1225, which is still open; on today's
 * `main` `httpClient.fetch` retries a POST 5xx just like a GET, so that
 * assertion would fail. It lands in Phase 3, gated on #1225.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { apiClient } from "./api-client";
import { httpClient } from "@/services/service-factory";

// Recomputed exactly as api-client.ts computes it, so the expectation tracks
// the environment rather than hard-coding one deployment's shape.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "";

/** Stub the global `fetch` with a constant status and count the calls. */
function countedFetch(
  status: number,
  headers: Record<string, string> = {}
): { calls: () => number } {
  let calls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      calls += 1;
      return new Response(JSON.stringify({}), {
        status,
        headers: { "Content-Type": "application/json", ...headers },
      });
    })
  );
  return { calls: () => calls };
}

describe("ApiClient delegates its transport to HttpClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // The retry chain warns on every attempt; keep the run quiet without
    // hiding a genuine failure (the assertions are on counts, not logs).
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("routes a typed method through httpClient.fetch with the versioned URL", async () => {
    const spy = vi.spyOn(httpClient, "fetch").mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await expect(apiClient.getProjects()).resolves.toEqual([]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      `${API_BASE_URL}/api/v1/projects/`,
      expect.anything()
    );
  });

  it("retries a 5xx on HttpClient's policy — 5 requests, not ApiClient's 4", async () => {
    const counter = countedFetch(500);

    vi.useFakeTimers();
    const pending = apiClient.getProjects();
    // Assert the rejection before advancing, so the failure is never an
    // unhandled rejection racing the timer advance.
    const assertion = expect(pending).rejects.toThrow(
      /Failed to get projects: 500/
    );

    // TWO requests land before any backoff elapses: `executeRequestWithRetry`
    // issues one, then `executeWithRetry` immediately issues its own first
    // attempt. Only then does the chain park on its 1s wait. That un-delayed
    // second request is precisely the extra one ApiClient's old loop did not
    // make.
    await vi.advanceTimersByTimeAsync(0);
    expect(counter.calls()).toBe(2);

    // 1s + 2s + 4s of backoff separate the remaining three requests.
    await vi.advanceTimersByTimeAsync(999);
    expect(counter.calls()).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(counter.calls()).toBe(3);
    await vi.advanceTimersByTimeAsync(2000);
    expect(counter.calls()).toBe(4);
    await vi.advanceTimersByTimeAsync(4000);
    expect(counter.calls()).toBe(5);

    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;

    expect(counter.calls()).toBe(5);
  });

  it("retries a 429 on HttpClient's policy, honouring Retry-After", async () => {
    // `RetryStrategy.handleRateLimitRetry` waits the header's value (seconds)
    // rather than the exponential backoff, and the same maxRetries:3 counter
    // bounds the chain at five requests.
    const counter = countedFetch(429, { "Retry-After": "1" });

    vi.useFakeTimers();
    const pending = apiClient.getProjects();
    const assertion = expect(pending).rejects.toThrow(
      /Failed to get projects: 429/
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(counter.calls()).toBe(2);

    // Three fixed 1s waits, one per retry decision — the header's value, not
    // the exponential 1s/2s/4s the 5xx arm uses, and not the 60s default.
    await vi.advanceTimersByTimeAsync(1000);
    expect(counter.calls()).toBe(3);
    await vi.advanceTimersByTimeAsync(1000);
    expect(counter.calls()).toBe(4);
    await vi.advanceTimersByTimeAsync(1000);
    expect(counter.calls()).toBe(5);

    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;

    expect(counter.calls()).toBe(5);
  });

  it("delegates getWebSocketToken to HttpClient", async () => {
    const spy = vi
      .spyOn(httpClient, "getWebSocketToken")
      .mockResolvedValue("ws-tok");

    await expect(apiClient.getWebSocketToken()).resolves.toBe("ws-tok");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
