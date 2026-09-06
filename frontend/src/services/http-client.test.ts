/**
 * HttpClient auth-rejection halt tests.
 *
 * Locks the central fix for the dashboard polling retry-storm: when a poll
 * gets a 401/403 with an expired/absent bearer, the client fires the
 * session-expired path exactly once (which redirects to /login and unmounts
 * the polling dashboards) instead of returning the response so each polling
 * loop keeps hammering the endpoint every tick.
 *
 * A 401/403 with a *still-valid* token is a feature/permission/upstream
 * error and must NOT be treated as session expiry.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { HttpClient, isRetryableStatus, type HttpOptions } from "./http-client";
import { csrfService } from "./csrf-service";
import type { TokenManager } from "./auth/token-manager";
import {
  TokenRefreshService,
  type RefreshOutcome,
} from "./auth/token-refresh-service";

interface FakeTokenManager {
  getAccessToken: ReturnType<typeof vi.fn>;
  getRefreshToken: ReturnType<typeof vi.fn>;
  getAccessTokenExpiry: ReturnType<typeof vi.fn>;
  isAccessTokenExpired: ReturnType<typeof vi.fn>;
  isAccessTokenExpiringSoon: ReturnType<typeof vi.fn>;
  isAuthenticated: ReturnType<typeof vi.fn>;
  clearTokens: ReturnType<typeof vi.fn>;
}

function makeTokenManager(
  overrides: Partial<Record<keyof FakeTokenManager, unknown>> = {}
): FakeTokenManager {
  return {
    getAccessToken: vi.fn(() => "tok"),
    getRefreshToken: vi.fn(() => "refresh"),
    // Default: an hour of life left, so the staleness predicate's "past `exp`"
    // clause is false unless a test says otherwise.
    getAccessTokenExpiry: vi.fn(() => Date.now() + 60 * 60 * 1000),
    isAccessTokenExpired: vi.fn(() => false),
    isAccessTokenExpiringSoon: vi.fn(() => false),
    isAuthenticated: vi.fn(() => true),
    clearTokens: vi.fn(),
    ...(overrides as object),
  } as FakeTokenManager;
}

function mockFetchOnce(status: number): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({}), {
          status,
          headers: { "Content-Type": "application/json" },
        })
    )
  );
}

/**
 * Count `session-expired` window events fired while `run` executes.
 *
 * The `onExpired` handler spy alone is not enough: the stub never dispatches
 * the window event, so an assertion that it was NOT called passes even if the
 * teardown were dropped entirely. Pairing every negative with a positive on the
 * REAL event is what makes those assertions load-bearing.
 */
async function countSessionExpired(run: () => Promise<void>): Promise<number> {
  let count = 0;
  const listener = () => {
    count++;
  };
  window.addEventListener("session-expired", listener);
  try {
    await run();
  } finally {
    window.removeEventListener("session-expired", listener);
  }
  return count;
}

describe("HttpClient noRetryStatuses", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function countedFetch(status: number): { calls: () => number } {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return new Response(JSON.stringify({}), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      })
    );
    return { calls: () => calls };
  }

  it("retries a 5xx by default", async () => {
    // The baseline the opt-out is measured against. MEASURED, not assumed:
    // `executeRequestWithRetry` makes the first request itself and THEN hands
    // a fresh `requestFn` to `executeWithRetry`, which runs it once more
    // before its own attempt counter applies — so `maxRetries: 3` costs FIVE
    // requests, not the four a reading of the config alone suggests. The
    // backoff between them is 1s + 2s + 4s (7s): the chain stops once the
    // attempt counter passes `maxRetries`, so a fourth wait never happens.
    const counter = countedFetch(503);
    const client = new HttpClient(
      makeTokenManager() as unknown as TokenManager
    );

    vi.useFakeTimers();
    const pending = client.fetch("https://api.test/api/v1/operations/x");
    await vi.advanceTimersByTimeAsync(30_000);
    const res = await pending;

    expect(res.status).toBe(503);
    expect(counter.calls()).toBe(5);
  });

  it("makes exactly one request for an opted-out status", async () => {
    // Coord's `503 schema_migration_pending` is deliberate and persistent for
    // the whole pre-migration window, so retrying it only multiplies the
    // request count and the time to first paint.
    const counter = countedFetch(503);
    const client = new HttpClient(
      makeTokenManager() as unknown as TokenManager
    );

    const res = await client.fetch("https://api.test/api/v1/operations/x", {
      noRetryStatuses: [503],
    });

    expect(res.status).toBe(503);
    expect(counter.calls()).toBe(1);
  });

  it("still retries OTHER 5xx on a request that opts 503 out", async () => {
    const counter = countedFetch(500);
    const client = new HttpClient(
      makeTokenManager() as unknown as TokenManager
    );

    vi.useFakeTimers();
    const pending = client.fetch("https://api.test/api/v1/operations/x", {
      noRetryStatuses: [503],
    });
    await vi.advanceTimersByTimeAsync(30_000);
    const res = await pending;

    expect(res.status).toBe(500);
    expect(counter.calls()).toBe(5);
  });

  it("does not leak the opt-out to other callers of the same client", async () => {
    // The reason this is an ARGUMENT rather than a `maxRetries` override:
    // `maxRetries` reassigns the client's SHARED retryStrategy, so using it
    // here would silently disable retries app-wide.
    const counter = countedFetch(503);
    const client = new HttpClient(
      makeTokenManager() as unknown as TokenManager
    );

    await client.fetch("https://api.test/a", { noRetryStatuses: [503] });
    expect(counter.calls()).toBe(1);

    vi.useFakeTimers();
    const pending = client.fetch("https://api.test/b");
    await vi.advanceTimersByTimeAsync(30_000);
    await pending;

    expect(counter.calls()).toBe(6); // 1 opted-out + 5 for the normal call
  });
});

/**
 * Method-aware retry (plan `2026-09-01-httpclient-retries-post-by-default`).
 *
 * Idempotent methods keep the original policy (429 + every 5xx retry).
 * POST/PATCH retry a 429 only, unless the request declares `idempotent:
 * true`; `noRetryStatuses` always narrows. The same predicate is applied
 * INSIDE the retry chain, so a 429 cannot be a side door into retrying a 5xx.
 *
 * Fake-clock sizing: a 5xx chain needs 7s (1s + 2s + 4s); a 429 chain waits
 * the `Retry-After` value per retry, so every 429 here sends `Retry-After: 1`
 * — without it the default is 60s per retry and the test times out instead of
 * failing on a count.
 */
describe("HttpClient method-aware retry", () => {
  const FIVE_XX_CHAIN_MS = 30_000;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  interface ScriptedResponse {
    status: number;
    headers?: Record<string, string>;
  }

  /**
   * Answer each call from `script` in order; the last entry repeats forever.
   * Records the `RequestInit` of every call so headers can be asserted.
   */
  function scriptedFetch(script: ScriptedResponse[]): {
    calls: () => number;
    inits: RequestInit[];
  } {
    const inits: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const step = script[Math.min(inits.length, script.length - 1)]!;
        inits.push(init ?? {});
        return new Response(JSON.stringify({}), {
          status: step.status,
          headers: { "Content-Type": "application/json", ...step.headers },
        });
      })
    );
    return { calls: () => inits.length, inits };
  }

  function makeClient(): HttpClient {
    return new HttpClient(makeTokenManager() as unknown as TokenManager);
  }

  /** Run one request under fake timers, advancing far past any 5xx chain. */
  async function run(
    client: HttpClient,
    url: string,
    options: HttpOptions
  ): Promise<Response> {
    vi.useFakeTimers();
    const pending = client.fetch(url, options);
    await vi.advanceTimersByTimeAsync(FIVE_XX_CHAIN_MS);
    return pending;
  }

  function methodRuleWarns(): number {
    return (console.warn as ReturnType<typeof vi.fn>).mock.calls.filter(
      (args: unknown[]) =>
        typeof args[0] === "string" &&
        args[0].includes("not retried because the method is non-idempotent")
    ).length;
  }

  it("V1: POST -> 500 makes exactly one request, and warns once", async () => {
    const counter = scriptedFetch([{ status: 500 }]);
    const res = await run(makeClient(), "https://api.test/things", {
      method: "POST",
      body: "{}",
    });

    expect(res.status).toBe(500);
    expect(counter.calls()).toBe(1);
    expect(methodRuleWarns()).toBe(1);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("[HttpClient] POST https://api.test/things answered 500")
    );
  });

  it("V2: GET, PUT and DELETE -> 500 still retry (5 requests each)", async () => {
    for (const method of ["GET", "PUT", "DELETE"]) {
      vi.unstubAllGlobals();
      vi.useRealTimers();
      const counter = scriptedFetch([{ status: 500 }]);
      const res = await run(makeClient(), "https://api.test/things", {
        method,
      });

      expect(res.status, method).toBe(500);
      expect(counter.calls(), method).toBe(5);
    }
    expect(methodRuleWarns()).toBe(0);
  });

  it("V3: POST + idempotent: true -> 500 retries", async () => {
    const counter = scriptedFetch([{ status: 500 }]);
    const res = await run(makeClient(), "https://api.test/search", {
      method: "POST",
      body: "{}",
      idempotent: true,
    });

    expect(res.status).toBe(500);
    expect(counter.calls()).toBe(5);
    expect(methodRuleWarns()).toBe(0);
  });

  it("V4: POST -> 429 retries for a non-idempotent method", async () => {
    const counter = scriptedFetch([
      { status: 429, headers: { "Retry-After": "1" } },
    ]);
    const res = await run(makeClient(), "https://api.test/things", {
      method: "POST",
      body: "{}",
    });

    expect(res.status).toBe(429);
    expect(counter.calls()).toBe(5);
  });

  it("V5: POST -> 429 -> 500 does NOT retry the 500 inside the chain", async () => {
    // The in-chain predicate: the 429 legitimately enters the chain, and the
    // next response is a 500. Without the predicate inside `executeWithRetry`
    // that 500 is judged by status alone and retried three more times.
    const counter = scriptedFetch([
      { status: 429, headers: { "Retry-After": "1" } },
      { status: 500 },
    ]);
    const res = await run(makeClient(), "https://api.test/things", {
      method: "POST",
      body: "{}",
    });

    expect(res.status).toBe(500);
    expect(counter.calls()).toBe(2);
    expect(methodRuleWarns()).toBe(1);
  });

  it("V6: PATCH -> 500 makes one request", async () => {
    const counter = scriptedFetch([{ status: 500 }]);
    const res = await run(makeClient(), "https://api.test/things/1", {
      method: "PATCH",
      body: "{}",
    });

    expect(res.status).toBe(500);
    expect(counter.calls()).toBe(1);
  });

  it("V6/V10: a lowercase `patch` is treated as PATCH (one request)", async () => {
    const counter = scriptedFetch([{ status: 500 }]);
    const res = await run(makeClient(), "https://api.test/things/1", {
      method: "patch",
      body: "{}",
    });

    expect(res.status).toBe(500);
    expect(counter.calls()).toBe(1);
  });

  it("V10: a lowercase `patch` still gets the X-CSRF-Token header", async () => {
    // The CSRF check is a case-sensitive membership test on the method; it
    // inherits the normalization `fetch()` does once at the top.
    vi.spyOn(csrfService, "getToken").mockReturnValue("csrf-tok");
    const counter = scriptedFetch([{ status: 200 }]);

    await run(makeClient(), "https://api.test/things/1", {
      method: "patch",
      body: "{}",
    });

    expect(counter.calls()).toBe(1);
    const headers = counter.inits[0]!.headers as Record<string, string>;
    expect(headers["X-CSRF-Token"]).toBe("csrf-tok");
    expect(counter.inits[0]!.method).toBe("PATCH");
  });

  it("V8: idempotent: true + noRetryStatuses narrows — 503 once, 502 retries", async () => {
    const client = makeClient();

    const opted = scriptedFetch([{ status: 503 }]);
    const res503 = await run(client, "https://api.test/search", {
      method: "POST",
      body: "{}",
      idempotent: true,
      noRetryStatuses: [503],
    });
    expect(res503.status).toBe(503);
    expect(opted.calls()).toBe(1);
    // A `noRetryStatuses` suppression is the caller's choice: no warn.
    expect(methodRuleWarns()).toBe(0);

    vi.unstubAllGlobals();
    vi.useRealTimers();
    const other = scriptedFetch([{ status: 502 }]);
    const res502 = await run(client, "https://api.test/search", {
      method: "POST",
      body: "{}",
      idempotent: true,
      noRetryStatuses: [503],
    });
    expect(res502.status).toBe(502);
    expect(other.calls()).toBe(5);
  });
});

describe("HttpClient maxRetries is per-request", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("V7: maxRetries: 0 on one call does not zero retries for the next default call", async () => {
    // Four production callers pass `maxRetries: 0`; before this fix the
    // option REPLACED the client's shared strategy, so every later request on
    // the singleton — GETs included — silently ran with zero retries.
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return new Response(JSON.stringify({}), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      })
    );
    const client = new HttpClient(
      makeTokenManager() as unknown as TokenManager
    );

    const first = await client.fetch("https://api.test/a", { maxRetries: 0 });
    expect(first.status).toBe(503);
    expect(calls).toBe(1);

    vi.useFakeTimers();
    const pending = client.fetch("https://api.test/b");
    await vi.advanceTimersByTimeAsync(30_000);
    const second = await pending;

    expect(second.status).toBe(503);
    expect(calls).toBe(6); // 1 unretried + 5 for the default call
  });
});

describe("isRetryableStatus", () => {
  const IDEMPOTENT = ["GET", "HEAD", "PUT", "DELETE", "OPTIONS"];
  const NON_IDEMPOTENT = ["POST", "PATCH"];

  it("retries 429 for every method", () => {
    for (const method of [...IDEMPOTENT, ...NON_IDEMPOTENT]) {
      expect(isRetryableStatus({ status: 429, method }), method).toBe(true);
    }
  });

  it("retries every 5xx on idempotent methods", () => {
    for (const method of IDEMPOTENT) {
      for (const status of [500, 502, 503, 504, 507, 520]) {
        expect(
          isRetryableStatus({ status, method }),
          `${method} ${status}`
        ).toBe(true);
      }
    }
  });

  it("does not retry a 5xx on POST/PATCH without idempotent: true", () => {
    for (const method of NON_IDEMPOTENT) {
      for (const status of [500, 502, 503, 504, 507, 520]) {
        expect(
          isRetryableStatus({ status, method }),
          `${method} ${status}`
        ).toBe(false);
        expect(
          isRetryableStatus({ status, method, idempotent: false }),
          `${method} ${status} idempotent:false`
        ).toBe(false);
      }
    }
  });

  it("idempotent: true widens the 5xx arm for POST/PATCH", () => {
    for (const method of NON_IDEMPOTENT) {
      for (const status of [500, 502, 503, 504, 507, 520]) {
        expect(
          isRetryableStatus({ status, method, idempotent: true }),
          `${method} ${status}`
        ).toBe(true);
      }
    }
  });

  it("noRetryStatuses always narrows, winning over both idempotent and the method", () => {
    expect(
      isRetryableStatus({
        status: 503,
        method: "POST",
        idempotent: true,
        noRetryStatuses: [503],
      })
    ).toBe(false);
    expect(
      isRetryableStatus({
        status: 502,
        method: "POST",
        idempotent: true,
        noRetryStatuses: [503],
      })
    ).toBe(true);
    expect(
      isRetryableStatus({ status: 503, method: "GET", noRetryStatuses: [503] })
    ).toBe(false);
    expect(
      isRetryableStatus({ status: 429, method: "GET", noRetryStatuses: [429] })
    ).toBe(false);
    expect(
      isRetryableStatus({ status: 429, method: "POST", noRetryStatuses: [429] })
    ).toBe(false);
  });

  it("never retries a non-429 status below 500", () => {
    for (const method of [...IDEMPOTENT, ...NON_IDEMPOTENT]) {
      for (const status of [200, 204, 400, 401, 403, 404, 409, 422]) {
        expect(
          isRetryableStatus({ status, method, idempotent: true }),
          `${method} ${status}`
        ).toBe(false);
      }
    }
  });

  it("compares the method case-insensitively and defaults an empty method to GET", () => {
    expect(isRetryableStatus({ status: 500, method: "get" })).toBe(true);
    expect(isRetryableStatus({ status: 500, method: "post" })).toBe(false);
    expect(isRetryableStatus({ status: 500, method: "patch" })).toBe(false);
    expect(isRetryableStatus({ status: 500, method: "" })).toBe(true);
  });
});

describe("HttpClient auth-rejection halt", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fires session-expired once on a 403 with an expired token", async () => {
    mockFetchOnce(403);
    const tm = makeTokenManager({
      getAccessToken: vi.fn(() => "expired"),
      isAccessTokenExpired: vi.fn(() => true),
    });
    const client = new HttpClient(tm as unknown as TokenManager);
    const onExpired = vi.fn();
    client.setSessionExpiredHandler(onExpired);

    const r1 = await client.fetch(
      "https://api.test/api/v1/operations/device-status"
    );
    expect(r1.status).toBe(403);
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(tm.clearTokens).toHaveBeenCalled();

    // A second poll that also 403s must NOT re-fire the handler (debounced).
    const r2 = await client.fetch(
      "https://api.test/api/v1/operations/merge/queue"
    );
    expect(r2.status).toBe(403);
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire session-expired for a fully-anonymous visitor (no tokens, no marker)", async () => {
    // An anonymous visitor on a public page (e.g. /login, /auth/callback)
    // never had a session: no access token, no refresh token, and no
    // is_authenticated marker. The 401/403 such public-page calls produce by
    // design must be returned plainly, not treated as session expiry.
    mockFetchOnce(403);
    const tm = makeTokenManager({
      getAccessToken: vi.fn(() => null),
      getRefreshToken: vi.fn(() => null),
      isAccessTokenExpired: vi.fn(() => true),
      isAuthenticated: vi.fn(() => false),
    });
    const client = new HttpClient(tm as unknown as TokenManager);
    const onExpired = vi.fn();
    client.setSessionExpiredHandler(onExpired);

    const r = await client.fetch("https://api.test/api/v1/operations/fleet");
    expect(r.status).toBe(403);
    expect(onExpired).not.toHaveBeenCalled();
    expect(tm.clearTokens).not.toHaveBeenCalled();
  });

  it("fires session-expired on a 403 with an expired access token (marker present) — #491 storm fix intact", async () => {
    mockFetchOnce(403);
    const tm = makeTokenManager({
      getAccessToken: vi.fn(() => "expired"),
      getRefreshToken: vi.fn(() => null),
      isAccessTokenExpired: vi.fn(() => true),
      isAuthenticated: vi.fn(() => true),
    });
    const client = new HttpClient(tm as unknown as TokenManager);
    const onExpired = vi.fn();
    client.setSessionExpiredHandler(onExpired);

    await client.fetch("https://api.test/api/v1/operations/fleet");
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(tm.clearTokens).toHaveBeenCalled();
  });

  it("fires session-expired on a 403 with a refresh token only (access wiped)", async () => {
    mockFetchOnce(403);
    const tm = makeTokenManager({
      getAccessToken: vi.fn(() => null),
      getRefreshToken: vi.fn(() => "refresh"),
      isAccessTokenExpired: vi.fn(() => true),
      isAuthenticated: vi.fn(() => false),
    });
    const client = new HttpClient(tm as unknown as TokenManager);
    const onExpired = vi.fn();
    client.setSessionExpiredHandler(onExpired);

    await client.fetch("https://api.test/api/v1/operations/fleet");
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it("fires session-expired on a 403 with the is_authenticated marker only (tokens wiped post-restart)", async () => {
    // Browser-restart on the cookie/non-remote path: both tokens live in
    // tab-scoped sessionStorage and are wiped on close, but the
    // is_authenticated marker (localStorage) survives — so this is a real
    // expired session, not anonymous. The marker is the load-bearing clause.
    mockFetchOnce(403);
    const tm = makeTokenManager({
      getAccessToken: vi.fn(() => null),
      getRefreshToken: vi.fn(() => null),
      isAccessTokenExpired: vi.fn(() => true),
      isAuthenticated: vi.fn(() => true),
    });
    const client = new HttpClient(tm as unknown as TokenManager);
    const onExpired = vi.fn();
    client.setSessionExpiredHandler(onExpired);

    await client.fetch("https://api.test/api/v1/operations/fleet");
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it("does NOT enter the 401-refresh branch for an anonymous visitor (no 'attempting token refresh' warn)", async () => {
    mockFetchOnce(401);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tm = makeTokenManager({
      getAccessToken: vi.fn(() => null),
      getRefreshToken: vi.fn(() => null),
      isAccessTokenExpired: vi.fn(() => true),
      isAccessTokenExpiringSoon: vi.fn(() => true),
      isAuthenticated: vi.fn(() => false),
    });
    const client = new HttpClient(tm as unknown as TokenManager);
    const onExpired = vi.fn();
    client.setSessionExpiredHandler(onExpired);

    const r = await client.fetch("https://api.test/api/v1/operations/fleet");
    expect(r.status).toBe(401);
    expect(onExpired).not.toHaveBeenCalled();
    expect(
      warnSpy.mock.calls.some((args) =>
        String(args[0]).includes("attempting token refresh")
      )
    ).toBe(false);
  });

  it("does NOT fire session-expired on a 403 with a still-valid token (feature/permission denial)", async () => {
    mockFetchOnce(403);
    const tm = makeTokenManager({
      getAccessToken: vi.fn(() => "valid"),
      isAccessTokenExpired: vi.fn(() => false),
    });
    const client = new HttpClient(tm as unknown as TokenManager);
    const onExpired = vi.fn();
    client.setSessionExpiredHandler(onExpired);

    const r = await client.fetch(
      "https://api.test/api/v1/operations/device-status"
    );
    expect(r.status).toBe(403);
    expect(onExpired).not.toHaveBeenCalled();
    expect(tm.clearTokens).not.toHaveBeenCalled();
  });

  it("does NOT fire session-expired on a 401 with a still-valid token", async () => {
    mockFetchOnce(401);
    const tm = makeTokenManager({
      getAccessToken: vi.fn(() => "valid"),
      isAccessTokenExpired: vi.fn(() => false),
      isAccessTokenExpiringSoon: vi.fn(() => false),
    });
    const client = new HttpClient(tm as unknown as TokenManager);
    const onExpired = vi.fn();
    client.setSessionExpiredHandler(onExpired);

    const r = await client.fetch(
      "https://api.test/api/v1/operations/device-status"
    );
    expect(r.status).toBe(401);
    expect(onExpired).not.toHaveBeenCalled();
  });

  it("does not fire for skipAuth requests", async () => {
    mockFetchOnce(403);
    const tm = makeTokenManager({
      getAccessToken: vi.fn(() => null),
      isAccessTokenExpired: vi.fn(() => true),
    });
    const client = new HttpClient(tm as unknown as TokenManager);
    const onExpired = vi.fn();
    client.setSessionExpiredHandler(onExpired);

    await client.fetch("https://api.test/public", { skipAuth: true });
    expect(onExpired).not.toHaveBeenCalled();
  });
});

describe("HttpClient X-Qontinui-Active-Tenant forwarding", () => {
  const ACTIVE_TENANT_STORAGE_KEY = "qontinui.active_tenant_id";
  const TENANT = "11111111-2222-3333-4444-555555555555";

  /** Stub fetch to capture the outgoing headers of the first call. */
  function captureFetchHeaders(): { current: Record<string, string> } {
    const captured = { current: {} as Record<string, string> };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        captured.current = (init?.headers as Record<string, string>) ?? {};
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      })
    );
    return captured;
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  // Every coord-proxy prefix the dashboard talks to must carry the selection.
  const SCOPED_URLS = [
    "https://api.test/api/v1/operations/fleet",
    "https://api.test/api/v1/admin-dev/overview",
    "https://api.test/api/v1/admin/agent-sessions",
  ];

  for (const url of SCOPED_URLS) {
    it(`attaches the active-tenant header on ${url}`, async () => {
      localStorage.setItem(ACTIVE_TENANT_STORAGE_KEY, TENANT);
      const captured = captureFetchHeaders();
      const client = new HttpClient(
        makeTokenManager() as unknown as TokenManager
      );
      await client.fetch(url);
      expect(captured.current["X-Qontinui-Active-Tenant"]).toBe(TENANT);
    });
  }

  it("omits the header when no tenant is selected", async () => {
    const captured = captureFetchHeaders();
    const client = new HttpClient(
      makeTokenManager() as unknown as TokenManager
    );
    await client.fetch("https://api.test/api/v1/operations/fleet");
    expect(captured.current["X-Qontinui-Active-Tenant"]).toBeUndefined();
  });

  it("does NOT attach the header on unrelated (non-proxy) URLs", async () => {
    localStorage.setItem(ACTIVE_TENANT_STORAGE_KEY, TENANT);
    const captured = captureFetchHeaders();
    const client = new HttpClient(
      makeTokenManager() as unknown as TokenManager
    );
    await client.fetch("https://api.test/api/v1/projects");
    expect(captured.current["X-Qontinui-Active-Tenant"]).toBeUndefined();
  });

  it("does NOT attach the header on /constraints/ (runner proxy, not coord)", async () => {
    localStorage.setItem(ACTIVE_TENANT_STORAGE_KEY, TENANT);
    const captured = captureFetchHeaders();
    const client = new HttpClient(
      makeTokenManager() as unknown as TokenManager
    );
    await client.fetch("https://api.test/api/v1/constraints/active");
    expect(captured.current["X-Qontinui-Active-Tenant"]).toBeUndefined();
  });

  it("does NOT attach the header on skipAuth requests", async () => {
    localStorage.setItem(ACTIVE_TENANT_STORAGE_KEY, TENANT);
    const captured = captureFetchHeaders();
    const client = new HttpClient(
      makeTokenManager() as unknown as TokenManager
    );
    await client.fetch("https://api.test/api/v1/operations/fleet", {
      skipAuth: true,
    });
    expect(captured.current["X-Qontinui-Active-Tenant"]).toBeUndefined();
  });
});

/**
 * The reactive half of the silent-refresh fix: a 401 on a spent bearer must
 * delegate to the shared TokenRefreshService and, when it succeeds, replay the
 * request — instead of tearing the session down and bouncing to /login.
 */
describe("HttpClient reactive refresh on 401", () => {
  /** Stub fetch: 401 for the first call, 200 for every one after. */
  function mockUnauthorizedThenOk(): ReturnType<typeof vi.fn> {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls++;
      return new Response(JSON.stringify({}), {
        status: calls === 1 ? 401 : 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  /** Stub fetch: always 401 (a bearer the backend keeps rejecting). */
  function mockAlwaysUnauthorized(): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({}), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  /** A TokenRefreshService stand-in with a controllable outcome. */
  function makeRefreshService(outcome: RefreshOutcome) {
    return {
      refreshWithOutcome: vi.fn(async () => outcome),
      refreshAccessToken: vi.fn(async () => outcome === "refreshed"),
    };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refreshes and replays the request when the bearer is expired", async () => {
    const fetchMock = mockUnauthorizedThenOk();
    const tm = makeTokenManager({
      getAccessToken: vi.fn(() => "expired"),
      isAccessTokenExpired: vi.fn(() => true),
    });
    const refreshService = makeRefreshService("refreshed");
    const client = new HttpClient(
      tm as unknown as TokenManager,
      undefined,
      refreshService as never
    );
    const onExpired = vi.fn();
    client.setSessionExpiredHandler(onExpired);

    const r = await client.fetch("https://api.test/api/v1/operations/fleet");

    expect(refreshService.refreshWithOutcome).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2); // original + replay
    expect(r.status).toBe(200);
    expect(onExpired).not.toHaveBeenCalled();
  });

  it("refreshes inside the clock-skew window, where neither staleness predicate fires", async () => {
    // Past `exp` but within TokenValidator's 5-minute grace: isAccessTokenExpired()
    // is false and isAccessTokenExpiringSoon() needs time REMAINING, so without
    // the explicit past-`exp` clause this 401 was misread as a still-valid-token
    // feature error and never refreshed.
    const fetchMock = mockUnauthorizedThenOk();
    const tm = makeTokenManager({
      getAccessToken: vi.fn(() => "just-lapsed"),
      getAccessTokenExpiry: vi.fn(() => Date.now() - 60 * 1000),
      isAccessTokenExpired: vi.fn(() => false),
      isAccessTokenExpiringSoon: vi.fn(() => false),
    });
    const refreshService = makeRefreshService("refreshed");
    const client = new HttpClient(
      tm as unknown as TokenManager,
      undefined,
      refreshService as never
    );

    const r = await client.fetch("https://api.test/api/v1/operations/fleet");

    expect(refreshService.refreshWithOutcome).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r.status).toBe(200);
  });

  it("does not double-fire session-expiry when the refresh is rejected", async () => {
    // TokenRefreshService already cleared the tokens and dispatched
    // `session-expired`; HttpClient must not fan the same teardown out again.
    mockUnauthorizedThenOk();
    const tm = makeTokenManager({
      getAccessToken: vi.fn(() => "expired"),
      isAccessTokenExpired: vi.fn(() => true),
    });
    const refreshService = makeRefreshService("expired");
    const client = new HttpClient(
      tm as unknown as TokenManager,
      undefined,
      refreshService as never
    );
    const onExpired = vi.fn();
    client.setSessionExpiredHandler(onExpired);

    const r = await client.fetch("https://api.test/api/v1/operations/fleet");

    expect(r.status).toBe(401);
    expect(onExpired).not.toHaveBeenCalled();

    // And a subsequent 401/403 poll stays debounced too.
    await client.fetch("https://api.test/api/v1/operations/merge/queue");
    expect(onExpired).not.toHaveBeenCalled();
  });

  it("does not refresh a 401 while the bearer is genuinely still valid", async () => {
    mockUnauthorizedThenOk();
    const tm = makeTokenManager({ getAccessToken: vi.fn(() => "valid") });
    const refreshService = makeRefreshService("refreshed");
    const client = new HttpClient(
      tm as unknown as TokenManager,
      undefined,
      refreshService as never
    );

    const r = await client.fetch("https://api.test/api/v1/operations/fleet");

    expect(refreshService.refreshWithOutcome).not.toHaveBeenCalled();
    expect(r.status).toBe(401);
  });

  /**
   * The paired POSITIVE for the "does not double-fire" assertion above: with a
   * REAL TokenRefreshService the teardown reaches the window exactly once. The
   * stub never dispatches the event, so on its own that negative assertion
   * would pass even if the teardown had been dropped entirely.
   */
  it("lets exactly ONE session-expired reach the window when the refresh grant is rejected", async () => {
    const tm = makeTokenManager({
      getAccessToken: vi.fn(() => "expired"),
      isAccessTokenExpired: vi.fn(() => true),
    });
    // Real service: a 401'd request, then Cognito authoritatively rejecting the
    // refresh token, is the whole teardown path end to end.
    const refreshService = new TokenRefreshService(
      tm as unknown as TokenManager
    );
    const client = new HttpClient(
      tm as unknown as TokenManager,
      undefined,
      refreshService
    );
    const onExpired = vi.fn();
    client.setSessionExpiredHandler(onExpired);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).includes("/oauth2/token")
          ? new Response(
              JSON.stringify({
                error: "invalid_grant",
                error_description: "Refresh Token has been revoked",
              }),
              { status: 400, headers: { "Content-Type": "application/json" } }
            )
          : new Response(JSON.stringify({}), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            })
      )
    );

    const events = await countSessionExpired(async () => {
      await client.fetch("https://api.test/api/v1/operations/fleet");
      // Three more polling ticks, all 401ing on the same dead session.
      await client.fetch("https://api.test/api/v1/operations/merge/queue");
      await client.fetch("https://api.test/api/v1/operations/fleet");
    });

    expect(events).toBe(1);
    // HttpClient defers to the service's dispatch rather than fanning its own
    // handler out on top of it.
    expect(onExpired).not.toHaveBeenCalled();
  });

  /**
   * C2 — `sessionExpiryHandled` used to be set for ANY falsy refresh result,
   * INCLUDING the `!isAuthenticated()` early return where nothing was cleared
   * and no `session-expired` was dispatched. The flag is never reset, so the
   * client dead-ended into "401ing forever, no teardown, no recovery" for the
   * life of the page — a regression against origin/main, where the equivalent
   * early return fell through to `maybeHandleAuthRejection`.
   */
  it("still tears down once when the refresh is SKIPPED because isAuthenticated() is false", async () => {
    mockAlwaysUnauthorized();
    const tm = makeTokenManager({
      // A session existed (a bearer is in hand) but the marker is gone, so no
      // refresh is attempted at all.
      getAccessToken: vi.fn(() => "expired"),
      isAccessTokenExpired: vi.fn(() => true),
      isAuthenticated: vi.fn(() => false),
    });
    const refreshService = makeRefreshService("refreshed");
    const client = new HttpClient(
      tm as unknown as TokenManager,
      undefined,
      refreshService as never
    );
    const onExpired = vi.fn();
    client.setSessionExpiredHandler(onExpired);

    const r = await client.fetch("https://api.test/api/v1/operations/fleet");

    expect(refreshService.refreshWithOutcome).not.toHaveBeenCalled();
    expect(r.status).toBe(401);
    // The teardown fires — the user is routed to re-auth instead of stranded.
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(tm.clearTokens).toHaveBeenCalledTimes(1);

    // ...and exactly once: later polling ticks stay debounced.
    await client.fetch("https://api.test/api/v1/operations/merge/queue");
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  /**
   * C1, reactive half — a transient token-endpoint failure must surface the 401
   * to the caller WITHOUT tearing a live session down.
   */
  it("surfaces the 401 and keeps the session when the refresh fails transiently", async () => {
    mockAlwaysUnauthorized();
    const tm = makeTokenManager({
      getAccessToken: vi.fn(() => "expired"),
      isAccessTokenExpired: vi.fn(() => true),
    });
    const refreshService = makeRefreshService("transient");
    const client = new HttpClient(
      tm as unknown as TokenManager,
      undefined,
      refreshService as never
    );
    const onExpired = vi.fn();
    client.setSessionExpiredHandler(onExpired);

    const events = await countSessionExpired(async () => {
      const r = await client.fetch("https://api.test/api/v1/operations/fleet");
      expect(r.status).toBe(401);
      // A later tick can still recover — nothing was latched shut.
      await client.fetch("https://api.test/api/v1/operations/merge/queue");
    });

    expect(events).toBe(0);
    expect(onExpired).not.toHaveBeenCalled();
    expect(tm.clearTokens).not.toHaveBeenCalled();
    expect(refreshService.refreshWithOutcome).toHaveBeenCalledTimes(2);
  });

  /**
   * M2 — the post-refresh replay returns straight to the caller, bypassing the
   * auth-rejection block. Without a bound, a freshly minted bearer the backend
   * keeps rejecting leaves every caller with a bare 401 forever.
   */
  it("tears down after two consecutive 401s on a freshly refreshed bearer", async () => {
    const fetchMock = mockAlwaysUnauthorized();
    const tm = makeTokenManager({
      getAccessToken: vi.fn(() => "expired"),
      isAccessTokenExpired: vi.fn(() => true),
    });
    const refreshService = makeRefreshService("refreshed");
    const client = new HttpClient(
      tm as unknown as TokenManager,
      undefined,
      refreshService as never
    );
    const onExpired = vi.fn();
    client.setSessionExpiredHandler(onExpired);

    // First round: original 401 -> refresh -> replay 401. One strike; a single
    // racing/late-propagating token is still forgiven.
    const r1 = await client.fetch("https://api.test/api/v1/operations/fleet");
    expect(r1.status).toBe(401);
    expect(onExpired).not.toHaveBeenCalled();

    // Second round: replay 401 again -> the session is declared dead.
    const r2 = await client.fetch(
      "https://api.test/api/v1/operations/merge/queue"
    );
    expect(r2.status).toBe(401);
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(tm.clearTokens).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(4); // 2 originals + 2 replays
  });

  it("resets the post-refresh counter when the replay succeeds", async () => {
    // A one-off 401 that the refresh genuinely fixes must not accumulate
    // toward the teardown bound.
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        // 401 on every original request, 200 on every replay.
        return new Response(JSON.stringify({}), {
          status: calls % 2 === 1 ? 401 : 200,
          headers: { "Content-Type": "application/json" },
        });
      })
    );
    const tm = makeTokenManager({
      getAccessToken: vi.fn(() => "expired"),
      isAccessTokenExpired: vi.fn(() => true),
    });
    const client = new HttpClient(
      tm as unknown as TokenManager,
      undefined,
      makeRefreshService("refreshed") as never
    );
    const onExpired = vi.fn();
    client.setSessionExpiredHandler(onExpired);

    for (let i = 0; i < 4; i++) {
      const r = await client.fetch("https://api.test/api/v1/operations/fleet");
      expect(r.status).toBe(200);
    }
    expect(onExpired).not.toHaveBeenCalled();
  });
});
