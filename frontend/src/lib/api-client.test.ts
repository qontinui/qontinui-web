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
 * V3 ("a POST answering 504 is issued exactly once") is asserted below. It was
 * deferred while PR #1225 — `HttpOptions.idempotent` and the method-aware
 * retry rule — was still open, because until it landed `httpClient.fetch`
 * retried a POST 5xx just like a GET. #1225 landed as `67e565346`, so the gate
 * is released and the assertion is written: it is the one test that proves
 * ApiClient's POSTs actually inherit the method rule rather than merely being
 * assumed to.
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

  // V3. The method rule (RFC 9110 §9.2.2) is what makes this one request
  // rather than five: a POST's 5xx is not re-issued, because a 504 from a
  // proxy in front of a slow backend says nothing about whether the side
  // effect already committed. Contrast the 5xx GET test above (5 requests)
  // and the 429 test below (429 retries for EVERY method) — between them the
  // three pin the rule to the method and the status independently, so a
  // regression in either dimension fails a named test.
  it("issues a POST answering 504 exactly once — no 5xx retry for a non-idempotent method", async () => {
    const counter = countedFetch(504);

    vi.useFakeTimers();
    const pending = apiClient.createProject({
      name: "p",
    } as never);
    const assertion = expect(pending).rejects.toThrow(
      /Failed to create project/
    );

    // Drain every timer the chain could possibly have parked on. If the POST
    // had entered the retry chain, the un-delayed second request alone would
    // already put the count at 2 before any backoff elapsed.
    await vi.advanceTimersByTimeAsync(0);
    expect(counter.calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;

    expect(counter.calls()).toBe(1);
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
