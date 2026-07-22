/**
 * TokenRefreshService — silent Cognito refresh tests.
 *
 * BUG: the frontend stored the Cognito refresh token but never spent it, so
 * once the ID token's `exp` passed (the app client's `IdTokenValidity`) every
 * request 401'd and the user was bounced to `/login` — a hard logout roughly
 * every hour.
 *
 * FIX: `refreshAccessToken()` exchanges the stored refresh token on the Cognito
 * token endpoint (`grant_type=refresh_token`) and stores the returned
 * **id_token** as the bearer (the same convention `/auth/callback` uses at
 * login — only the ID token carries the identity claims the backend
 * provisions from). Concurrent callers share one exchange, and a proactive
 * timer renews shortly before `exp` instead of waiting for a 401.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { TokenRefreshService } from "./token-refresh-service";
import type { TokenManager } from "./token-manager";

const TOKEN_ENDPOINT = "https://auth.qontinui.io/oauth2/token";
const HOUR_MS = 60 * 60 * 1000;

/** Mirrors the service's MIN_PROACTIVE_DELAY_MS floor for a due-now wake-up. */
const MIN_DELAY_MS = 10 * 1000;

/**
 * Override `document.visibilityState`, which jsdom exposes as a prototype
 * getter (so a plain assignment is a no-op). Returns a restore function.
 */
function setVisibility(value: DocumentVisibilityState): () => void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => value,
  });
  return () => {
    delete (document as unknown as Record<string, unknown>).visibilityState;
  };
}

/**
 * A minimal stateful stand-in for TokenManager: enough state that the
 * proactive scheduler's expiry maths are exercised for real, with spies on the
 * mutations the service is expected to make.
 */
function makeTokenManager(opts: {
  refreshToken?: string | null;
  expiry?: number | null;
  authenticated?: boolean;
}) {
  const state = {
    // `??` would swallow an explicit `null` (the "no refresh token" case).
    refreshToken:
      opts.refreshToken === undefined
        ? "stored-refresh-token"
        : opts.refreshToken,
    expiry: opts.expiry === undefined ? Date.now() + HOUR_MS : opts.expiry,
    authenticated: opts.authenticated ?? true,
  };

  const tm = {
    state,
    getRefreshToken: vi.fn(() => state.refreshToken),
    getAccessTokenExpiry: vi.fn(() => state.expiry),
    isAuthenticated: vi.fn(() => state.authenticated),
    getTimeUntilExpiry: vi.fn(() =>
      state.expiry === null ? 0 : Math.max(0, state.expiry - Date.now())
    ),
    isAccessTokenExpiringSoon: vi.fn((thresholdMs: number) => {
      if (state.expiry === null) return false;
      const left = state.expiry - Date.now();
      return left < thresholdMs && left > 0;
    }),
    setTokens: vi.fn((tokens: { access_token: string; expires_in: number }) => {
      // Mirror the real TokenManager: derive the new expiry so a rescheduled
      // proactive wake-up lands on the refreshed token, not the old one.
      state.expiry = Date.now() + tokens.expires_in * 1000;
    }),
    clearTokens: vi.fn(() => {
      state.refreshToken = null;
      state.expiry = null;
      state.authenticated = false;
    }),
  };
  return tm;
}

type FakeTokenManager = ReturnType<typeof makeTokenManager>;

function asTokenManager(tm: FakeTokenManager): TokenManager {
  return tm as unknown as TokenManager;
}

/** Stub fetch with a Cognito refresh-grant success, capturing the request. */
function stubRefreshOk(idToken = "new.id.token", expiresIn = 10800) {
  const calls: {
    url: string;
    body: string;
    headers: HeadersInit | undefined;
  }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        body: String(init?.body ?? ""),
        headers: init?.headers,
      });
      return new Response(
        JSON.stringify({
          id_token: idToken,
          access_token: "new.access.token",
          expires_in: expiresIn,
          token_type: "Bearer",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    })
  );
  return calls;
}

/** Stub fetch with Cognito's rejection of a revoked/expired refresh token. */
function stubRefreshRejected() {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: "invalid_grant",
            error_description: "Refresh Token has been revoked",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        )
    )
  );
}

/** Count `session-expired` window events fired while `run` executes. */
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

describe("TokenRefreshService.refreshAccessToken", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exchanges the stored refresh token and stores the new ID token as the bearer", async () => {
    const calls = stubRefreshOk("fresh.id.token", 10800);
    const tm = makeTokenManager({ refreshToken: "rt-abc" });
    const service = new TokenRefreshService(asTokenManager(tm));

    await expect(service.refreshAccessToken()).resolves.toBe(true);

    // One form-encoded POST to the Cognito token endpoint, refresh grant.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(TOKEN_ENDPOINT);
    const body = new URLSearchParams(calls[0]!.body);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("rt-abc");
    expect(body.get("client_id")).toBeTruthy();
    // Public client — no secret, and PKCE binds the code grant, not this one.
    expect(body.get("client_secret")).toBeNull();
    expect(body.get("code_verifier")).toBeNull();

    // The ID token (not the access token) becomes the bearer, and the existing
    // refresh token is preserved — Cognito does not rotate it on this grant.
    expect(tm.setTokens).toHaveBeenCalledTimes(1);
    expect(tm.setTokens.mock.calls[0]![0]).toMatchObject({
      access_token: "fresh.id.token",
      refresh_token: "rt-abc",
      expires_in: 10800,
    });
    expect(tm.clearTokens).not.toHaveBeenCalled();
  });

  it("does NOT move the stored refresh-token expiry (that grant returns no new refresh token)", async () => {
    stubRefreshOk();
    const tm = makeTokenManager({});
    const service = new TokenRefreshService(asTokenManager(tm));

    await service.refreshAccessToken();

    // Falsy `refresh_expires_in` => TokenManager skips saveRefreshTokenExpiry.
    expect(tm.setTokens.mock.calls[0]![0]).toMatchObject({
      refresh_expires_in: 0,
    });
  });

  it("single-flights concurrent callers onto ONE token exchange", async () => {
    const calls = stubRefreshOk();
    const tm = makeTokenManager({});
    const service = new TokenRefreshService(asTokenManager(tm));

    const results = await Promise.all([
      service.refreshAccessToken(),
      service.refreshAccessToken(),
      service.refreshAccessToken(),
    ]);

    expect(results).toEqual([true, true, true]);
    expect(calls).toHaveLength(1);
    expect(tm.setTokens).toHaveBeenCalledTimes(1);
    // The mutex releases once settled, so a later refresh still works.
    expect(service.isRefreshing()).toBe(false);
    await service.refreshAccessToken();
    expect(calls).toHaveLength(2);
  });

  it("tears the session down once when Cognito rejects the refresh token", async () => {
    stubRefreshRejected();
    const tm = makeTokenManager({});
    const service = new TokenRefreshService(asTokenManager(tm));

    let result: boolean | undefined;
    const events = await countSessionExpired(async () => {
      result = await service.refreshAccessToken();
    });

    expect(result).toBe(false);
    expect(tm.clearTokens).toHaveBeenCalledTimes(1);
    expect(tm.setTokens).not.toHaveBeenCalled();
    expect(events).toBe(1);
  });

  it("tears the session down without a network call when no refresh token is stored", async () => {
    const calls = stubRefreshOk();
    const tm = makeTokenManager({ refreshToken: null });
    const service = new TokenRefreshService(asTokenManager(tm));

    let result: boolean | undefined;
    const events = await countSessionExpired(async () => {
      result = await service.refreshAccessToken();
    });

    expect(result).toBe(false);
    expect(calls).toHaveLength(0);
    expect(tm.clearTokens).toHaveBeenCalledTimes(1);
    expect(events).toBe(1);
  });

  it("treats a non-JSON / network failure as an expired session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );
    const tm = makeTokenManager({});
    const service = new TokenRefreshService(asTokenManager(tm));

    await expect(service.refreshAccessToken()).resolves.toBe(false);
    expect(tm.clearTokens).toHaveBeenCalledTimes(1);
  });
});

describe("TokenRefreshService proactive refresh", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renews shortly BEFORE expiry, then re-arms on the new expiry", async () => {
    const calls = stubRefreshOk("renewed.id.token", 10800);
    const tm = makeTokenManager({ expiry: Date.now() + HOUR_MS });
    const service = new TokenRefreshService(asTokenManager(tm));

    service.start();
    // Nothing yet — the token is nowhere near its expiry.
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(calls).toHaveLength(0);

    // Cross into the lead window (renewal is due before `exp`, not after).
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(calls).toHaveLength(1);
    expect(tm.setTokens.mock.calls[0]![0]).toMatchObject({
      access_token: "renewed.id.token",
    });

    // Re-armed against the refreshed 3h expiry: renews again, and the session
    // never lapses.
    await vi.advanceTimersByTimeAsync(3 * HOUR_MS);
    expect(calls).toHaveLength(2);

    service.stop();
  });

  it("arms no timer while signed out", async () => {
    const calls = stubRefreshOk();
    const tm = makeTokenManager({ authenticated: false });
    const service = new TokenRefreshService(asTokenManager(tm));

    service.start();
    await vi.advanceTimersByTimeAsync(6 * HOUR_MS);

    expect(calls).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    service.stop();
  });

  it("arms no timer while the tab is hidden, and catches up when it becomes visible", async () => {
    const calls = stubRefreshOk();
    const tm = makeTokenManager({ expiry: Date.now() + 60 * 1000 });
    const service = new TokenRefreshService(asTokenManager(tm));

    let restore = setVisibility("hidden");
    try {
      service.start();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(2 * HOUR_MS);
      expect(calls).toHaveLength(0);

      // Foreground again: the bearer lapsed while the tab slept, so renew now
      // rather than waiting for a request to 401.
      restore();
      restore = setVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));

      await vi.waitFor(() => expect(calls).toHaveLength(1));
    } finally {
      restore();
      service.stop();
    }
  });

  it("stop() disarms the timer and detaches the visibility listener", async () => {
    const calls = stubRefreshOk();
    const tm = makeTokenManager({ expiry: Date.now() + HOUR_MS });
    const service = new TokenRefreshService(asTokenManager(tm));

    service.start();
    expect(vi.getTimerCount()).toBe(1);
    service.stop();
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(6 * HOUR_MS);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(0);
  });

  it("stops rescheduling once the refresh token is rejected (no retry loop)", async () => {
    stubRefreshRejected();
    // Remaining life (60s) is shorter than the 6-minute lead window, so the
    // scheduler renews at the halfway point rather than instantly.
    const tm = makeTokenManager({ expiry: Date.now() + 60 * 1000 });
    const service = new TokenRefreshService(asTokenManager(tm));

    service.start();
    await vi.advanceTimersByTimeAsync(30 * 1000);
    await vi.waitFor(() => expect(tm.clearTokens).toHaveBeenCalledTimes(1));

    // Session is dead — nothing is left armed to hammer the token endpoint.
    expect(vi.getTimerCount()).toBe(0);
    service.stop();
  });

  it("never schedules a wake-up below the floor, even for an already-lapsed token", () => {
    stubRefreshOk();
    // Expired, but the marker still says authenticated (a tab returning after
    // a long sleep). The floor must keep the timer off a zero-delay hot loop.
    const tm = makeTokenManager({ expiry: Date.now() - HOUR_MS });
    const service = new TokenRefreshService(asTokenManager(tm));

    service.start();
    expect(vi.getTimerCount()).toBe(1);
    // Nothing has fired yet — the wake-up is at least MIN_DELAY_MS out.
    vi.advanceTimersByTime(MIN_DELAY_MS - 1);
    expect(tm.setTokens).not.toHaveBeenCalled();

    service.stop();
  });
});
