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
  isAccessTokenExpired: ReturnType<typeof vi.fn>;
  isAccessTokenExpiringSoon: ReturnType<typeof vi.fn>;
  isAuthenticated: ReturnType<typeof vi.fn>;
  clearTokens: ReturnType<typeof vi.fn>;
}

function makeTokenManager(overrides: Partial<Record<keyof FakeTokenManager, unknown>> = {}): FakeTokenManager {
  return {
    getAccessToken: vi.fn(() => "tok"),
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

  it("fires session-expired on a 403 with no token at all", async () => {
    mockFetchOnce(403);
    const tm = makeTokenManager({
      getAccessToken: vi.fn(() => null),
      isAccessTokenExpired: vi.fn(() => true),
    });
    const client = new HttpClient(tm as unknown as TokenManager);
    const onExpired = vi.fn();
    client.setSessionExpiredHandler(onExpired);

    await client.fetch("https://api.test/api/v1/operations/fleet");
    expect(onExpired).toHaveBeenCalledTimes(1);
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
