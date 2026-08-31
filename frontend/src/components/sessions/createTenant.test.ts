/**
 * `createTenant` transport tests — the retry hazard, not the copy.
 *
 * Plan `2026-08-28-tenant-creation-followup-defects-from-the-preemptive-sweep`
 * Phase 4 #3 (V7). Tenant creation is the one POST in this file where a retry
 * is not a free repeat of the same question:
 *
 *   - the web proxy's coord budget is 5s (`operations.py` `_COORD_TIMEOUT`)
 *     and a timeout maps to `504 timeout waiting for coord`, which describes
 *     OUR clock, not coord's transaction;
 *   - `HttpClient` retries every `>= 500`, so the identical POST went out
 *     again;
 *   - coord's create is a plain INSERT that REJECTS a slug collision, so if
 *     the slow transaction committed, the retry lands on the unique-violation
 *     arm and the operator is told their own successful project "is taken".
 *
 * These drive the REAL `createTenant` through the REAL `httpClient` singleton
 * with only `fetch` stubbed, because the defect was that `createTenant` passed
 * no opt-out — a test that constructed its own `HttpClient` would prove the
 * option works (already covered in `http-client.test.ts`) while assuming the
 * exact thing that was missing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTenant, TenantCreateError } from "./api";

/** Stub `fetch` with a fixed status and count the POSTs that reach it. */
function countedFetch(
  status: number,
  body = "{}"
): { calls: () => number; methods: () => string[] } {
  let calls = 0;
  const methods: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      calls += 1;
      methods.push(String(init?.method ?? "GET"));
      return new Response(body, {
        status,
        headers: { "Content-Type": "application/json" },
      });
    })
  );
  return { calls: () => calls, methods: () => methods };
}

describe("createTenant retry policy", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("issues exactly ONE POST for a 504 — never re-creates the project", async () => {
    const counter = countedFetch(504, JSON.stringify({ detail: "timeout" }));

    // Fake timers so a regression (which retries with 1s+2s+4s+8s of backoff)
    // cannot merely be slow — it would hang the test without them.
    vi.useFakeTimers();
    const pending = createTenant({ display_name: "My Pizzeria" }).catch(
      (e: unknown) => e
    );
    await vi.advanceTimersByTimeAsync(30_000);
    const err = await pending;

    expect(err).toBeInstanceOf(TenantCreateError);
    expect((err as TenantCreateError).status).toBe(504);
    // The whole point. Before the fix this was 5 (see the measured count in
    // `http-client.test.ts`: the first request plus `executeWithRetry`'s own
    // initial call plus three retries).
    expect(counter.calls()).toBe(1);
    expect(counter.methods()).toEqual(["POST"]);
  });

  it("issues exactly ONE POST for a 500 and a 502 too", async () => {
    // 502 is "coord is not reachable" and 500 carries coord's own 5xx
    // verbatim (e.g. the cap-lookup failure). Neither is safe to repeat: the
    // proxy raises them from a point where it cannot know whether coord's
    // transaction committed.
    for (const status of [500, 502, 503]) {
      vi.unstubAllGlobals();
      const counter = countedFetch(status);
      vi.useFakeTimers();
      const pending = createTenant({ display_name: "My Pizzeria" }).catch(
        () => null
      );
      await vi.advanceTimersByTimeAsync(30_000);
      await pending;
      vi.useRealTimers();
      expect(counter.calls(), `status ${status}`).toBe(1);
    }
  });

  it("does not retry the 429 creation cap either", async () => {
    // A deliberate, persistent policy answer — four more round-trips reach the
    // same sentence.
    const counter = countedFetch(429);
    vi.useFakeTimers();
    const pending = createTenant({ display_name: "My Pizzeria" }).catch(
      () => null
    );
    // 429 does NOT use the exponential backoff: `handleRateLimitRetry` waits
    // `Retry-After` or a 60s default, so a regression here costs ~4 minutes.
    // Advanced past that so a failure is a COUNT, not a 20s test timeout.
    await vi.advanceTimersByTimeAsync(300_000);
    await pending;
    expect(counter.calls()).toBe(1);
  });

  it("still surfaces coord's structured operands from the single answer", async () => {
    // Not retrying must not cost the parse: the one response still yields the
    // code AND the operands the message is about.
    countedFetch(
      403,
      JSON.stringify({
        detail: JSON.stringify({
          error: "tenant_cap_reached",
          cap: 5,
          created: 5,
        }),
      })
    );
    const err = (await createTenant({ display_name: "x" }).catch(
      (e: unknown) => e
    )) as TenantCreateError;
    expect(err).toBeInstanceOf(TenantCreateError);
    expect(err.code).toBe("tenant_cap_reached");
    expect(err.cap).toBe(5);
    expect(err.created).toBe(5);
  });
});
