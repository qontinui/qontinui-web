/**
 * RetryStrategy tests — the optional `isRetryable` predicate on
 * `executeWithRetry` (plan `2026-09-01-httpclient-retries-post-by-default`)
 * and the `withMaxRetries` clone that keeps a per-request retry budget from
 * mutating a shared strategy.
 *
 * Every chain here is a 5xx chain: `maxRetries: 3` costs 1s + 2s + 4s of
 * backoff, so advancing 30s of fake time drains any of them.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RetryStrategy } from "./retry-strategy";

function scriptedRequest(statuses: number[]): {
  requestFn: () => Promise<Response>;
  calls: () => number;
} {
  let calls = 0;
  const requestFn = async (): Promise<Response> => {
    const status = statuses[Math.min(calls, statuses.length - 1)]!;
    calls += 1;
    return new Response(null, { status });
  };
  return { requestFn, calls: () => calls };
}

async function drain<T>(pending: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(30_000);
  return pending;
}

describe("RetryStrategy.executeWithRetry isRetryable predicate", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("without a predicate keeps the status-only behaviour (4 calls for maxRetries: 3)", async () => {
    // The chain's own count: attempt 1 runs the request, then retries on
    // attempts 1, 2 and 3, and stops once the counter passes maxRetries.
    const strategy = new RetryStrategy({ maxRetries: 3 });
    const script = scriptedRequest([503]);

    const res = await drain(strategy.executeWithRetry(script.requestFn));

    expect(res.status).toBe(503);
    expect(script.calls()).toBe(4);
  });

  it("returns the first response untouched when the predicate says no", async () => {
    const strategy = new RetryStrategy({ maxRetries: 3 });
    const script = scriptedRequest([503]);

    const res = await drain(
      strategy.executeWithRetry(script.requestFn, 1, () => false)
    );

    expect(res.status).toBe(503);
    expect(script.calls()).toBe(1);
  });

  it("threads the predicate through the recursion so it gates every later response", async () => {
    // 503, 503 are retryable under this predicate; the 500 on the third call
    // is not, so the chain must stop there — 3 calls, not the 4 the status
    // alone would produce. Dropping the predicate from the recursive call
    // makes the 500 retryable again.
    const strategy = new RetryStrategy({ maxRetries: 3 });
    const script = scriptedRequest([503, 503, 500]);

    const res = await drain(
      strategy.executeWithRetry(
        script.requestFn,
        1,
        (response) => response.status !== 500
      )
    );

    expect(res.status).toBe(500);
    expect(script.calls()).toBe(3);
  });

  it("a predicate that allows everything does not widen the status rule", async () => {
    // The predicate narrows only: a 404 is still not retried even when the
    // predicate returns true for it.
    const strategy = new RetryStrategy({ maxRetries: 3 });
    const script = scriptedRequest([404]);

    const res = await drain(
      strategy.executeWithRetry(script.requestFn, 1, () => true)
    );

    expect(res.status).toBe(404);
    expect(script.calls()).toBe(1);
  });
});

describe("RetryStrategy.withMaxRetries", () => {
  it("returns the same instance for the same budget", () => {
    const strategy = new RetryStrategy({ maxRetries: 3 });
    expect(strategy.withMaxRetries(3)).toBe(strategy);
  });

  it("returns a new strategy with the new budget and the same backoff", () => {
    const strategy = new RetryStrategy({
      maxRetries: 3,
      initialBackoffMs: 250,
      maxBackoffMs: 2_000,
    });

    const zero = strategy.withMaxRetries(0);

    expect(zero).not.toBe(strategy);
    expect(zero.getMaxRetries()).toBe(0);
    expect(strategy.getMaxRetries()).toBe(3);
    expect(zero.calculateBackoff(1)).toBe(250);
    expect(zero.calculateBackoff(10)).toBe(2_000);
  });
});
