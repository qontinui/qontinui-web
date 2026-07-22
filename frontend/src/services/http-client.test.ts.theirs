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
import { HttpClient } from "./http-client";
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

function makeTokenManager(overrides: Partial<Record<keyof FakeTokenManager, unknown>> = {}): FakeTokenManager {
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
    vi.fn(async () =>
      new Response(JSON.stringify({}), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    ),
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

    const r1 = await client.fetch("https://api.test/api/v1/operations/device-status");
    expect(r1.status).toBe(403);
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(tm.clearTokens).toHaveBeenCalled();

    // A second poll that also 403s must NOT re-fire the handler (debounced).
    const r2 = await client.fetch("https://api.test/api/v1/operations/merge/queue");
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
        String(args[0]).includes("attempting token refresh"),
      ),
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

    const r = await client.fetch("https://api.test/api/v1/operations/device-status");
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

    const r = await client.fetch("https://api.test/api/v1/operations/device-status");
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
      }),
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
      const client = new HttpClient(makeTokenManager() as unknown as TokenManager);
      await client.fetch(url);
      expect(captured.current["X-Qontinui-Active-Tenant"]).toBe(TENANT);
    });
  }

  it("omits the header when no tenant is selected", async () => {
    const captured = captureFetchHeaders();
    const client = new HttpClient(makeTokenManager() as unknown as TokenManager);
    await client.fetch("https://api.test/api/v1/operations/fleet");
    expect(captured.current["X-Qontinui-Active-Tenant"]).toBeUndefined();
  });

  it("does NOT attach the header on unrelated (non-proxy) URLs", async () => {
    localStorage.setItem(ACTIVE_TENANT_STORAGE_KEY, TENANT);
    const captured = captureFetchHeaders();
    const client = new HttpClient(makeTokenManager() as unknown as TokenManager);
    await client.fetch("https://api.test/api/v1/projects");
    expect(captured.current["X-Qontinui-Active-Tenant"]).toBeUndefined();
  });

  it("does NOT attach the header on /constraints/ (runner proxy, not coord)", async () => {
    localStorage.setItem(ACTIVE_TENANT_STORAGE_KEY, TENANT);
    const captured = captureFetchHeaders();
    const client = new HttpClient(makeTokenManager() as unknown as TokenManager);
    await client.fetch("https://api.test/api/v1/constraints/active");
    expect(captured.current["X-Qontinui-Active-Tenant"]).toBeUndefined();
  });

  it("does NOT attach the header on skipAuth requests", async () => {
    localStorage.setItem(ACTIVE_TENANT_STORAGE_KEY, TENANT);
    const captured = captureFetchHeaders();
    const client = new HttpClient(makeTokenManager() as unknown as TokenManager);
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
        }),
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
              { status: 400, headers: { "Content-Type": "application/json" } },
            )
          : new Response(JSON.stringify({}), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            }),
      ),
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
      }),
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
