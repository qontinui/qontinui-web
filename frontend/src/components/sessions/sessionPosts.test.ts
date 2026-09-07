/**
 * Session-POST transport tests — the retry hazard, not the copy.
 *
 * Plan `2026-09-01-non-idempotent-session-posts-retry-into-duplicate-side-effects`
 * Phase 2. Sibling of `createTenant.test.ts`, which locks the same property
 * for the third caller of `NON_IDEMPOTENT_POST_NO_RETRY_STATUSES`.
 *
 * The defect: the web proxy's coord budget is 5s (`operations.py`
 * `_COORD_TIMEOUT`) and a timeout maps to `504 timeout waiting for coord` — a
 * statement about OUR clock, not about coord's transaction. So "coord was
 * slow" and "coord never got it" are indistinguishable from the browser, and
 * `HttpClient` resolved that ambiguity by re-issuing the identical POST (every
 * `>= 500`, up to `maxRetries: 3`). For `handoffSession` the retry plausibly
 * SUCCEEDS: coord records another durable `handoff_request` event and
 * publishes another JetStream subject to the target machine, which
 * materializes another child session — several children from one click.
 *
 * These drive the REAL `handoffSession` / `stealSession` through the REAL
 * `httpClient` singleton with only `fetch` stubbed, because the defect was
 * that those functions passed no opt-out. A test that constructed its own
 * `HttpClient` would prove the option works (already covered in
 * `http-client.test.ts`) while assuming the exact thing that was missing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  handoffSession,
  listSessions,
  SessionsApiError,
  stealSession,
} from "./api";

/**
 * Backoff budget for a 5xx arm.
 *
 * `shouldRetry` routes `>= 500` to `handleServerErrorRetry`, i.e. exponential
 * `min(1000 * 2^(attempt-1), 10000)`. A regression costs FIVE requests (the
 * first one `executeRequestWithRetry` makes itself, plus `executeWithRetry`'s
 * own initial call, plus three retries) separated by 1s + 2s + 4s = 7s. 15s of
 * fake time clears that with margin, so a regression fails on the CALL COUNT
 * rather than on a test timeout — which would look like a different bug.
 *
 * Sized per arm deliberately: the `429` path is NOT exponential
 * (`handleRateLimitRetry` waits `Retry-After` or a 60s default, so ~180s), and
 * blanket-advancing every test to the slowest arm hides which one is which.
 */
const SERVER_ERROR_BACKOFF_BUDGET_MS = 15_000;

/** Stub `fetch` with a fixed status and count the requests that reach it. */
function countedFetch(
  status: number,
  body = "{}"
): { calls: () => number; methods: () => string[]; urls: () => string[] } {
  let calls = 0;
  const methods: string[] = [];
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls += 1;
      methods.push(String(init?.method ?? "GET"));
      urls.push(String(url));
      return new Response(body, {
        status,
        headers: { "Content-Type": "application/json" },
      });
    })
  );
  return { calls: () => calls, methods: () => methods, urls: () => urls };
}

describe("non-idempotent session POSTs — retry policy", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // V1
  it("handoffSession issues exactly ONE POST for a 504 — never a second child session", async () => {
    const counter = countedFetch(504, JSON.stringify({ detail: "timeout" }));

    vi.useFakeTimers();
    const pending = handoffSession("sess-1", {
      target_device_id: "dev-2",
    }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(SERVER_ERROR_BACKOFF_BUDGET_MS);
    const err = await pending;

    expect(err).toBeInstanceOf(SessionsApiError);
    expect((err as SessionsApiError).status).toBe(504);
    // The whole point. Before the fix this was 5.
    expect(counter.calls()).toBe(1);
    expect(counter.methods()).toEqual(["POST"]);
    expect(counter.urls()[0]).toContain("/sessions/sess-1/handoff");
  });

  it("handoffSession does not retry the other enumerated 5xx either", async () => {
    // 502 is "coord is not reachable", 503 "unconfigured / no healthy target",
    // 500 carries coord's own 5xx verbatim. None is safe to repeat: the proxy
    // raises them from a point where it cannot know whether coord committed.
    for (const status of [500, 501, 502, 503]) {
      vi.unstubAllGlobals();
      const counter = countedFetch(status);
      vi.useFakeTimers();
      const pending = handoffSession("sess-1", {
        target_device_id: "dev-2",
      }).catch(() => null);
      await vi.advanceTimersByTimeAsync(SERVER_ERROR_BACKOFF_BUDGET_MS);
      await pending;
      vi.useRealTimers();
      expect(counter.calls(), `status ${status}`).toBe(1);
    }
  });

  // V2
  it("stealSession issues exactly ONE POST for a 504 — never a duplicate steal event", async () => {
    const counter = countedFetch(504, JSON.stringify({ detail: "timeout" }));

    vi.useFakeTimers();
    const pending = stealSession("sess-9", {
      reason: "operator took over",
      machine_id: "mach-3",
    }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(SERVER_ERROR_BACKOFF_BUDGET_MS);
    const err = await pending;

    expect(err).toBeInstanceOf(SessionsApiError);
    expect((err as SessionsApiError).status).toBe(504);
    expect(counter.calls()).toBe(1);
    expect(counter.methods()).toEqual(["POST"]);
    expect(counter.urls()[0]).toContain("/sessions/sess-9/steal");
  });

  it("neither POST retries the 429 rate-limit answer", async () => {
    // A deliberate, persistent answer. This arm is NOT exponential:
    // `handleRateLimitRetry` waits `Retry-After` or a 60s default, so a
    // regression costs 3 x 60s. Advanced past that so a failure is a COUNT,
    // not a test timeout.
    const RATE_LIMIT_BACKOFF_BUDGET_MS = 200_000;
    for (const call of [
      () => handoffSession("sess-1", { target_device_id: "dev-2" }),
      () => stealSession("sess-9", { reason: "r", machine_id: "m" }),
    ]) {
      vi.unstubAllGlobals();
      const counter = countedFetch(429);
      vi.useFakeTimers();
      const pending = call().catch(() => null);
      await vi.advanceTimersByTimeAsync(RATE_LIMIT_BACKOFF_BUDGET_MS);
      await pending;
      vi.useRealTimers();
      expect(counter.calls()).toBe(1);
    }
  });

  // Control: the opt-out is per-request, not a global kill switch.
  it("still retries a 500 on the module's GETs — the opt-out is scoped", async () => {
    // `listSessions` is a GET: re-issuing it has no side effect, so retry is
    // the correct behaviour and must survive this fix. Five requests is the
    // MEASURED default (see `http-client.test.ts`), not a reading of
    // `maxRetries: 3`.
    const counter = countedFetch(500);

    vi.useFakeTimers();
    const pending = listSessions().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(SERVER_ERROR_BACKOFF_BUDGET_MS);
    const err = await pending;

    expect(err).toBeInstanceOf(SessionsApiError);
    expect(counter.calls()).toBe(5);
    expect(counter.methods()).toEqual(["GET", "GET", "GET", "GET", "GET"]);
  });
});
