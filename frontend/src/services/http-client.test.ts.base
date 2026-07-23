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

interface FakeTokenManager {
  getAccessToken: ReturnType<typeof vi.fn>;
  getRefreshToken: ReturnType<typeof vi.fn>;
  isAccessTokenExpired: ReturnType<typeof vi.fn>;
  isAccessTokenExpiringSoon: ReturnType<typeof vi.fn>;
  isAuthenticated: ReturnType<typeof vi.fn>;
  clearTokens: ReturnType<typeof vi.fn>;
}

function makeTokenManager(overrides: Partial<Record<keyof FakeTokenManager, unknown>> = {}): FakeTokenManager {
  return {
    getAccessToken: vi.fn(() => "tok"),
    getRefreshToken: vi.fn(() => "refresh"),
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
