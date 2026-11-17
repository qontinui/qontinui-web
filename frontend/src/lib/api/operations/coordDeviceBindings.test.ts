/**
 * `unbindFleetDevices` sends the removal EXACTLY ONCE, through the REAL
 * `HttpClient` retry chain (plan
 * `2026-11-15-stale-ci-hosts-and-devices-are-removable-from-the-web-console`
 * Phase 3).
 *
 * The console tests replace `httpClient.fetch` wholesale, so they can only see
 * the options this module passes — not whether the client would re-issue the
 * POST. Here the client is real and the network (`fetch`) is scripted: a 429
 * with a 1 s `Retry-After` and a 503 are each answered, the clock is advanced
 * far past any backoff, and exactly one request may have gone out. A repeat
 * would read the first attempt's `unbound` rows back as `already_absent`.
 *
 * Each case has a control on the same client proving its scripted answer is
 * one the chain DOES retry, so a single request is not passing for want of a
 * retryable answer. The two are held by different options: a 429 is retried
 * for every method, so only `maxRetries: 0` stops it; a 503 on a POST is held
 * by `idempotent: false` as well (the method rule) — that case fails if
 * either option is dropped in favour of `idempotent: true` without
 * `maxRetries: 0`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TokenManager } from "@/services/auth/token-manager";

const DEV = "c3c3c3c3-0000-4000-8000-00000000000c";
/** Far past the default chain (1 s + 2 s + 4 s, or 4 x Retry-After: 1). */
const PAST_EVERY_BACKOFF_MS = 30_000;

const tokenManager = {
  getAccessToken: () => "tok",
  getRefreshToken: () => "refresh",
  getAccessTokenExpiry: () => Date.now() + 60 * 60 * 1000,
  isAccessTokenExpired: () => false,
  isAccessTokenExpiringSoon: () => false,
  isAuthenticated: () => true,
  clearTokens: () => {},
} as unknown as TokenManager;

const client = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/services/service-factory", () => ({
  get httpClient() {
    return client.current;
  },
}));

import { HttpClient } from "@/services/http-client";
import { unbindFleetDevices } from "./coordDeviceBindings";

/** Answer every network call with `status`; count the calls. */
function scriptNetwork(status: number, headers: Record<string, string> = {}) {
  const calls: RequestInit[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push(init ?? {});
      return new Response(JSON.stringify({ detail: "busy" }), {
        status,
        headers: { "Content-Type": "application/json", ...headers },
      });
    })
  );
  return calls;
}

/** Settle `pending` with the fake clock advanced past every backoff. */
async function settle<T>(
  pending: Promise<T>
): Promise<PromiseSettledResult<T>> {
  const outcome = Promise.allSettled([pending]).then(([r]) => r!);
  await vi.advanceTimersByTimeAsync(PAST_EVERY_BACKOFF_MS);
  return outcome;
}

describe("unbindFleetDevices — no re-issue through the real retry chain", () => {
  beforeEach(() => {
    client.current = new HttpClient(tokenManager);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("control: the same client re-issues a plain POST that drew this 429", async () => {
    const calls = scriptNetwork(429, { "Retry-After": "1" });
    const http = client.current as HttpClient;
    const result = await settle(
      http.fetch("https://api.test/control", { method: "POST", body: "{}" })
    );
    expect(result.status).toBe("fulfilled");
    expect(calls.length).toBeGreaterThan(1);
  });

  it("a 429 is answered once: no second request goes out", async () => {
    const calls = scriptNetwork(429, { "Retry-After": "1" });
    const result = await settle(unbindFleetDevices([DEV]));
    expect(result.status).toBe("rejected");
    expect(String((result as PromiseRejectedResult).reason)).toContain("429");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("POST");
  });

  it("control: the same client re-issues an idempotent POST that drew this 503", async () => {
    const calls = scriptNetwork(503);
    const http = client.current as HttpClient;
    const result = await settle(
      http.fetch("https://api.test/control", {
        method: "POST",
        body: "{}",
        idempotent: true,
      })
    );
    expect(result.status).toBe("fulfilled");
    expect(calls.length).toBeGreaterThan(1);
  });

  it("a 503 is answered once: no second request goes out", async () => {
    const calls = scriptNetwork(503);
    const result = await settle(unbindFleetDevices([DEV]));
    expect(result.status).toBe("rejected");
    expect(String((result as PromiseRejectedResult).reason)).toContain("503");
    expect(calls).toHaveLength(1);
  });
});
