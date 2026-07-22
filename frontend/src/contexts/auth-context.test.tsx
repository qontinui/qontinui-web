/**
 * Regression tests for the AuthProvider boot-time user-hydration resilience.
 *
 * BUG (style-gate co-pilot CAPTURE-UNAVAILABLE flake): `checkAuth` awaited a
 * SINGLE bare `getCurrentUser()` fetch with no timeout before flipping
 * `loading` to false. When `/users/me` stalled (a cold Next dev-server route
 * compile racing the first authenticated navigation, or a slow/hung backend in
 * prod), the whole app stayed pinned behind the `(app)` layout's full-screen
 * "Loading..." `AuthLoadingShell` indefinitely — the co-pilot route (first in
 * the style-gate manifest, so it paid the cold compile) never rendered and its
 * snapshot capture timed out.
 *
 * FIX: the bootstrap user-fetch is bounded — each attempt has a timeout and a
 * timed-out/transient attempt is RETRIED (a valid cookie session is still
 * valid; a timeout is "no answer yet", not "unauthenticated"). A 401/403 is
 * authoritative and NOT retried. After the retry budget we give up so `loading`
 * still resolves rather than hanging forever.
 *
 * These tests should FAIL against the pre-fix single-shot await (a first-call
 * rejection would have logged the user out / never recovered) and PASS after.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { AuthProvider, useAuth } from "./auth-context";

// --- Mocks: keep the AuthProvider's collaborators inert/controllable. --------
const getCurrentUser = vi.fn();
const isAuthenticated = vi.fn();
const isAccessTokenExpired = vi.fn();
const isRefreshDue = vi.fn(() => false);
const refreshAccessToken = vi.fn();
const logout = vi.fn();
const setAuthenticated = vi.fn();
const purgeStaleSession = vi.fn();
const startProactiveRefresh = vi.fn();
const stopProactiveRefresh = vi.fn();

vi.mock("@/services/service-factory", () => ({
  authService: {
    getCurrentUser: (...a: unknown[]) => getCurrentUser(...a),
    isAuthenticated: () => isAuthenticated(),
    isAccessTokenExpired: () => isAccessTokenExpired(),
    isRefreshDue: () => isRefreshDue(),
    refreshAccessToken: () => refreshAccessToken(),
    logout: (...a: unknown[]) => logout(...a),
    setAuthenticated: () => setAuthenticated(),
    startProactiveRefresh: () => startProactiveRefresh(),
    stopProactiveRefresh: () => stopProactiveRefresh(),
    tokenManager: { purgeStaleSession: () => purgeStaleSession() },
  },
}));

vi.mock("@/stores/page-state", () => ({
  pageStateDB: { clearUserData: vi.fn() },
}));

vi.mock("@/hooks/use-extraction-config", () => ({
  clearExtractionConfig: vi.fn(),
}));

function Probe() {
  const { user, loading } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="user">{user ? user.username : "none"}</span>
    </div>
  );
}

const fakeUser = { id: "u1", username: "ci-bot" };

/** An AbortError-shaped rejection, what `AbortSignal.timeout`/abort produces. */
function abortError(): Error {
  const e = new Error("The operation was aborted.");
  e.name = "AbortError";
  return e;
}

describe("AuthProvider boot-time hydration resilience", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    purgeStaleSession.mockReturnValue(false);
    isAuthenticated.mockReturnValue(true);
    isAccessTokenExpired.mockReturnValue(false);
    isRefreshDue.mockReturnValue(false);
    logout.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("recovers the user when the FIRST /users/me attempt stalls, then succeeds (no infinite Loading)", async () => {
    // First attempt rejects (timeout/abort); second resolves the real user.
    getCurrentUser
      .mockRejectedValueOnce(abortError())
      .mockResolvedValueOnce(fakeUser);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    // The gate must resolve: loading clears AND the user is hydrated via retry.
    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("user").textContent).toBe("ci-bot");
    // It retried rather than giving up on the first stall.
    expect(getCurrentUser).toHaveBeenCalledTimes(2);
    // A stall is NOT a logout — the valid session must be preserved.
    expect(logout).not.toHaveBeenCalled();
  });

  it("refreshes at boot inside the clock-skew window, where isAccessTokenExpired() still says false", async () => {
    // The bearer is past `exp` but inside TokenValidator's 5-minute skew grace,
    // so isAccessTokenExpired() reports false while the backend already rejects
    // the token. Booting without a refresh here 401'd /users/me and signed the
    // user out — so isRefreshDue() must drive the refresh too.
    isAccessTokenExpired.mockReturnValue(false);
    isRefreshDue.mockReturnValue(true);
    refreshAccessToken.mockResolvedValue(true);
    getCurrentUser.mockResolvedValue(fakeUser);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("user").textContent).toBe("ci-bot");
    expect(logout).not.toHaveBeenCalled();
  });

  it("does NOT retry on an authoritative 401 (unauthenticated is final)", async () => {
    getCurrentUser.mockRejectedValue(
      new Error("Failed to get user info: 401 - ")
    );

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("user").textContent).toBe("none");
    // 401 is authoritative — exactly one attempt, no retry storm.
    expect(getCurrentUser).toHaveBeenCalledTimes(1);
  });

  it("resolves loading=false (never hangs) even if every attempt stalls", async () => {
    getCurrentUser.mockRejectedValue(abortError());

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(
      () => {
        expect(screen.getByTestId("loading").textContent).toBe("false");
      },
      { timeout: 5_000 }
    );
    expect(screen.getByTestId("user").textContent).toBe("none");
    // Exhausted the retry budget rather than awaiting one stalled call forever.
    expect(getCurrentUser).toHaveBeenCalledTimes(3);
  });
});

/**
 * Regression tests for the /login session-expired redirect loop
 * (prod outage 2026-06-07).
 *
 * BUG: `handleSessionExpired` did `window.location.href = "/login"`
 * unconditionally. An anonymous visitor on /login whose page fired an
 * authed call got a 401 with an absent token, which HttpClient (#491)
 * treats as session expiry → redirect to /login → HARD RELOAD → fresh
 * HttpClient instance whose fire-once guard is reset → fires again.
 * Observed live at ~15 reloads/sec, making sign-in unusable.
 *
 * FIX: when already on /login, drop the local user state but skip the
 * redirect — the login form is already in front of the user.
 */
describe("session-expired redirect guard", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    vi.clearAllMocks();
    purgeStaleSession.mockReturnValue(false);
    isAuthenticated.mockReturnValue(false);
    isAccessTokenExpired.mockReturnValue(true);
    logout.mockResolvedValue(undefined);
    getCurrentUser.mockRejectedValue(
      new Error("Failed to get user info: 401 - ")
    );
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
    });
  });

  function stubLocation(pathname: string) {
    Object.defineProperty(window, "location", {
      value: {
        ...originalLocation,
        pathname,
        href: `https://qontinui.io${pathname}`,
      },
      writable: true,
    });
  }

  it("does NOT redirect (reload-loop) when session-expired fires on /login", async () => {
    stubLocation("/login");

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    window.dispatchEvent(new Event("session-expired"));

    // No navigation: href untouched → no reload → no loop.
    expect(window.location.href).toBe("https://qontinui.io/login");
  });

  it("does NOT redirect when session-expired fires on /auth/callback (would abort the in-flight PKCE token exchange)", async () => {
    stubLocation("/auth/callback");

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    window.dispatchEvent(new Event("session-expired"));

    // No navigation: the Cognito code exchange must be allowed to finish.
    expect(window.location.href).toBe("https://qontinui.io/auth/callback");
  });

  it("still redirects to /login when session-expired fires elsewhere", async () => {
    stubLocation("/dashboard");

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    window.dispatchEvent(new Event("session-expired"));

    expect(window.location.href).toBe("/login");
  });

  it("does NOT redirect when session-expired fires on the public marketing root (/) — an anonymous visitor's bootstrap 401 must not bounce them off the landing page", async () => {
    stubLocation("/");

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    window.dispatchEvent(new Event("session-expired"));

    // No navigation: the public landing page stays put for anonymous visitors.
    expect(window.location.href).toBe("https://qontinui.io/");
  });
});
