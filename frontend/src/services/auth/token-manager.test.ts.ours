/**
 * TokenManager expiry-source tests.
 *
 * THE CROSS-TAB HAZARD silent refresh introduces: the bearer lives in
 * tab-scoped `sessionStorage`, but `token_expiry` lives in `localStorage`,
 * which every tab on the origin SHARES. Once tab A renews its bearer it writes
 * a far-future `token_expiry`; if tab B keyed its staleness checks on that
 * shared value it would conclude its own, older token was still fresh — so it
 * would neither renew proactively nor treat its 401s as refreshable, and would
 * 401 forever with no recovery.
 *
 * `getAccessTokenExpiry()` therefore reads the `exp` claim off the token THIS
 * tab actually holds, and only falls back to the stored timestamp when no
 * bearer is in hand (a cookie-restored session).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import { TokenManager } from "./token-manager";
import { TokenStorage } from "./token-storage";
import { TokenValidator } from "./token-validator";

const SECOND_MS = 1000;
const HOUR_MS = 60 * 60 * 1000;

/** Build an unsigned JWT whose payload carries the given `exp` (seconds). */
function jwtExpiringAt(expMs: number): string {
  const payload = btoa(
    JSON.stringify({ sub: "u1", exp: Math.floor(expMs / SECOND_MS) })
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${payload}.signature`;
}

function makeManager(): TokenManager {
  return new TokenManager(new TokenStorage(), new TokenValidator());
}

describe("TokenManager.getAccessTokenExpiry", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("prefers the held token's own `exp` over a sibling tab's shared token_expiry", () => {
    const manager = makeManager();
    const mine = Date.now() + 30 * SECOND_MS;

    manager.setTokens({
      access_token: jwtExpiringAt(mine),
      refresh_token: "rt",
      token_type: "bearer",
      expires_in: 30,
      refresh_expires_in: 0,
    });

    // A sibling tab refreshed and pushed a far-future expiry into the SHARED
    // localStorage key. This tab's own bearer is still about to lapse.
    localStorage.setItem("token_expiry", String(Date.now() + 3 * HOUR_MS));

    expect(manager.getAccessTokenExpiry()).toBe(
      Math.floor(mine / SECOND_MS) * SECOND_MS
    );
    // ...and every staleness predicate follows the token, not the shared value.
    expect(manager.isAccessTokenExpiringSoon(60 * SECOND_MS)).toBe(true);
    expect(manager.getTimeUntilExpiry()).toBeLessThanOrEqual(30 * SECOND_MS);
  });

  it("reports an actually-lapsed held token as expired despite a fresh shared timestamp", () => {
    const manager = makeManager();

    manager.setTokens({
      access_token: jwtExpiringAt(Date.now() - HOUR_MS),
      refresh_token: "rt",
      token_type: "bearer",
      expires_in: 0,
      refresh_expires_in: 0,
    });
    localStorage.setItem("token_expiry", String(Date.now() + 3 * HOUR_MS));

    // An hour past `exp` is well outside TokenValidator's 5-minute skew grace.
    expect(manager.isAccessTokenExpired()).toBe(true);
    expect(manager.getTimeUntilExpiry()).toBe(0);
  });

  it("falls back to the stored timestamp when no bearer is held (cookie-restored session)", () => {
    const manager = makeManager();
    const stored = Date.now() + HOUR_MS;
    localStorage.setItem("token_expiry", String(stored));

    expect(manager.getAccessTokenExpiry()).toBe(stored);
    expect(manager.getTokenExpiry()).toBe(stored);
  });

  it("falls back to the stored timestamp when the held token is malformed", () => {
    const manager = makeManager();
    const stored = Date.now() + HOUR_MS;

    manager.setTokens({
      access_token: "not-a-jwt",
      refresh_token: "rt",
      token_type: "bearer",
      expires_in: 3600,
      refresh_expires_in: 0,
    });
    localStorage.setItem("token_expiry", String(stored));

    expect(manager.getAccessTokenExpiry()).toBe(stored);
  });

  it("a refresh-grant setTokens leaves the refresh-token expiry untouched", () => {
    const manager = makeManager();
    const refreshExpiry = Date.now() + 30 * 24 * HOUR_MS;
    localStorage.setItem("refresh_token_expiry", String(refreshExpiry));

    // `refresh_expires_in: 0` is what TokenRefreshService passes — Cognito's
    // refresh grant returns no new refresh token, so its expiry must not move.
    manager.setTokens({
      access_token: jwtExpiringAt(Date.now() + 3 * HOUR_MS),
      refresh_token: "rt",
      token_type: "bearer",
      expires_in: 10800,
      refresh_expires_in: 0,
    });

    expect(manager.getRefreshTokenExpiry()).toBe(refreshExpiry);
    expect(manager.getRefreshToken()).toBe("rt");
  });
});
