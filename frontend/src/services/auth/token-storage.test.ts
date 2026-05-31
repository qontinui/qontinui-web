import { describe, it, expect, beforeEach, vi } from "vitest";

// purgeStaleSession only fires in remote-backend mode (a missing sessionStorage
// Bearer is unambiguously stale only there — see the method's SCOPE doc). Mock
// ApiConfig so individual tests can toggle the mode; default is remote (true).
const { apiConfigMock } = vi.hoisted(() => ({ apiConfigMock: { remote: true } }));
vi.mock("../api-config", () => ({
  ApiConfig: {
    get IS_REMOTE_BACKEND() {
      return apiConfigMock.remote;
    },
  },
}));

import { TokenStorage } from "./token-storage";

/**
 * Tests for TokenStorage.purgeStaleSession — the "logged-out tab thinks it has
 * a session" fix.
 *
 * A session is STALE when an auth marker (`is_authenticated` flag OR a persisted
 * `refresh_token_expiry`) is present but no usable access token exists. The
 * usable-token check: getAccessToken() non-empty AND (no token-expiry OR expiry
 * still in the future). On stale, everything is cleared and true is returned.
 *
 * jsdom provides localStorage/sessionStorage and document.cookie.
 */

const TOKEN_EXPIRY_KEY = "token_expiry";
const REFRESH_TOKEN_EXPIRY_KEY = "refresh_token_expiry";
const AUTHENTICATED_KEY = "is_authenticated";
const SESSION_ACCESS_TOKEN_KEY = "auth_bearer_access_token";
const AUTH_MARKER_COOKIE = "qontinui_auth";

function setMarkerCookie() {
  document.cookie = `${AUTH_MARKER_COOKIE}=1; Path=/; SameSite=Lax`;
}

function hasMarkerCookie(): boolean {
  return document.cookie
    .split(";")
    .some((c) => c.trim().startsWith(`${AUTH_MARKER_COOKIE}=1`));
}

describe("TokenStorage.purgeStaleSession", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    // Best-effort clear of the marker cookie between tests.
    document.cookie = `${AUTH_MARKER_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
    // Default to remote-backend mode (where purge is active). The same-origin
    // gate test flips this off explicitly.
    apiConfigMock.remote = true;
  });

  it("(a) purges when is_authenticated=true but no sessionStorage token", () => {
    localStorage.setItem(AUTHENTICATED_KEY, "true");
    setMarkerCookie();
    // Construct AFTER seeding storage so the constructor restore reflects the
    // (absent) sessionStorage token — mirrors a reopened browser.
    const storage = new TokenStorage();

    expect(hasMarkerCookie()).toBe(true);

    const purged = storage.purgeStaleSession();

    expect(purged).toBe(true);
    expect(localStorage.getItem(AUTHENTICATED_KEY)).toBeNull();
    expect(storage.isAuthenticated()).toBe(false);
    expect(storage.getAccessToken()).toBeNull();
    expect(hasMarkerCookie()).toBe(false);
  });

  it("(b) does NOT purge when a valid non-expired token + markers are present", () => {
    sessionStorage.setItem(SESSION_ACCESS_TOKEN_KEY, "valid-access-token");
    localStorage.setItem(AUTHENTICATED_KEY, "true");
    localStorage.setItem(
      TOKEN_EXPIRY_KEY,
      String(Date.now() + 60 * 60 * 1000) // 1h in the future
    );
    localStorage.setItem(
      REFRESH_TOKEN_EXPIRY_KEY,
      String(Date.now() + 24 * 60 * 60 * 1000)
    );
    setMarkerCookie();
    const storage = new TokenStorage();

    const purged = storage.purgeStaleSession();

    expect(purged).toBe(false);
    expect(localStorage.getItem(AUTHENTICATED_KEY)).toBe("true");
    expect(storage.getAccessToken()).toBe("valid-access-token");
    expect(hasMarkerCookie()).toBe(true);
  });

  it("(c) purges when refresh_token_expiry is set but no token", () => {
    localStorage.setItem(
      REFRESH_TOKEN_EXPIRY_KEY,
      String(Date.now() + 7 * 24 * 60 * 60 * 1000)
    );
    setMarkerCookie();
    const storage = new TokenStorage();

    const purged = storage.purgeStaleSession();

    expect(purged).toBe(true);
    expect(localStorage.getItem(REFRESH_TOKEN_EXPIRY_KEY)).toBeNull();
    expect(hasMarkerCookie()).toBe(false);
  });

  it("(d) is a no-op when no markers are present", () => {
    const storage = new TokenStorage();

    const purged = storage.purgeStaleSession();

    expect(purged).toBe(false);
    expect(localStorage.getItem(AUTHENTICATED_KEY)).toBeNull();
    expect(localStorage.getItem(REFRESH_TOKEN_EXPIRY_KEY)).toBeNull();
  });

  it("purges when a marker + an EXPIRED token are present (token unusable)", () => {
    sessionStorage.setItem(SESSION_ACCESS_TOKEN_KEY, "expired-access-token");
    localStorage.setItem(AUTHENTICATED_KEY, "true");
    localStorage.setItem(
      TOKEN_EXPIRY_KEY,
      String(Date.now() - 60 * 1000) // expired 1m ago
    );
    setMarkerCookie();
    const storage = new TokenStorage();

    const purged = storage.purgeStaleSession();

    expect(purged).toBe(true);
    expect(storage.getAccessToken()).toBeNull();
    expect(localStorage.getItem(AUTHENTICATED_KEY)).toBeNull();
    expect(hasMarkerCookie()).toBe(false);
  });

  it("(e) does NOT purge in same-origin (cookie-backed) mode, even with marker + no token", () => {
    // Same-origin / local-dev sessions are backed by the HttpOnly refresh cookie,
    // so a missing sessionStorage Bearer is normal and recoverable. The gate must
    // skip the purge here (otherwise it tears down valid cookie sessions like the
    // Spec CI crawler's). Regression guard for the IS_REMOTE_BACKEND gate.
    apiConfigMock.remote = false;
    localStorage.setItem(AUTHENTICATED_KEY, "true");
    localStorage.setItem(TOKEN_EXPIRY_KEY, String(Date.now() + 60 * 60 * 1000));
    setMarkerCookie();
    const storage = new TokenStorage();

    const purged = storage.purgeStaleSession();

    expect(purged).toBe(false);
    expect(localStorage.getItem(AUTHENTICATED_KEY)).toBe("true");
    expect(hasMarkerCookie()).toBe(true);
  });
});
