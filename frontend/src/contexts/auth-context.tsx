"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
  useRef,
} from "react";
import { createLogger } from "@/lib/logger";
import { isPublic } from "@/lib/public-routes";
import { authService } from "@/services/service-factory";
import { User } from "@/types/auth-types";
import { pageStateDB } from "@/stores/page-state";
import { clearExtractionConfig } from "@/hooks/use-extraction-config";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  /**
   * Convenience selector: true iff the current user can mutate the
   * coordination layer (coord tenant admin). Mutation controls on the
   * AI-Dev coord pages gate on this; non-admin members may still VIEW.
   */
  isCoordAdmin: boolean;
  /** Convenience selector for the derived account-tier label (or null). */
  accountType: User["account_type"];
  logout: () => Promise<void>;
  updateUser: (data: Partial<User>) => Promise<void>;
  /**
   * Establish a session from externally-minted tokens (e.g. the Cognito
   * hosted-UI Authorization Code + PKCE flow). Stores the tokens via the
   * existing token-storage layer, hydrates the user from the backend (which
   * dual-accepts Cognito JWTs), sets the in-memory user, and broadcasts the
   * login to other tabs — i.e. everything `login()` does, minus the
   * username/password backend call.
   */
  completeExternalLogin: (tokens: {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  }) => Promise<User>;
}

const logger = createLogger("AuthContext");

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Boot-time user-hydration resilience.
 *
 * `checkAuth` awaits `getCurrentUser()` to populate the user before it flips
 * `loading` to false (which is what dismisses the `(app)` layout's full-screen
 * `AuthLoadingShell` "Loading..." gate). A SINGLE bare `fetch` with no timeout
 * means that if `/users/me` stalls — e.g. a cold Next dev-server route compile
 * racing the first authenticated navigation (the style-gate co-pilot CAPTURE-
 * UNAVAILABLE flake), or a slow/hung backend in production — the whole app is
 * pinned behind that spinner indefinitely with no recovery.
 *
 * So the bootstrap fetch is bounded: each attempt gets `BOOTSTRAP_USER_FETCH_
 * TIMEOUT_MS`, and a timed-out/transient-failed attempt is RETRIED (the
 * cookie-backed session is still valid — a timeout is "didn't answer in time",
 * not "unauthenticated"). A 401/403 is authoritative (not retried). After the
 * retry budget we give up so `loading` still resolves to false and the caller's
 * existing not-authenticated path runs, rather than spinning forever.
 */
const BOOTSTRAP_USER_FETCH_TIMEOUT_MS = 10_000;
const BOOTSTRAP_USER_FETCH_MAX_ATTEMPTS = 3;

/** True for an HTTP 401/403 thrown by `getCurrentUser` (authoritative — don't retry). */
function isUnauthorizedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b(401|403)\b/.test(msg);
}

// Cross-tab auth event types
type AuthBroadcastMessage =
  | { type: "LOGIN"; user: User }
  | { type: "LOGOUT" }
  | { type: "USER_UPDATE"; user: User }
  | { type: "TOKEN_REFRESH" };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const hasAttemptedRestore = useRef(false);

  useEffect(() => {
    checkAuth();

    // Initialize BroadcastChannel for cross-tab synchronization
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      const channel = new BroadcastChannel("auth_channel");
      channelRef.current = channel;

      // Listen for auth events from other tabs
      channel.onmessage = (event: MessageEvent<AuthBroadcastMessage>) => {
        logger.debug("Received broadcast message:", event.data);

        switch (event.data.type) {
          case "LOGIN":
            // Another tab logged in - update local state
            logger.debug("Syncing login from another tab");
            setUser(event.data.user);
            break;

          case "LOGOUT":
            // Another tab logged out - clear local state ONLY. The tab that
            // initiated the logout drives the Cognito hosted-UI sign-out
            // redirect; other tabs must not each navigate to /logout (pass
            // `false`), they just drop their local session and go home.
            logger.debug("Syncing logout from another tab");
            void authService.logout(false);
            setUser(null);
            if (window.location.pathname !== "/") {
              window.location.href = "/";
            }
            break;

          case "USER_UPDATE":
            // Another tab updated user - sync changes
            logger.debug("Syncing user update from another tab");
            setUser(event.data.user);
            break;

          case "TOKEN_REFRESH":
            // Another tab refreshed token - reload user data
            logger.debug("Token refreshed in another tab, reloading user");
            checkAuth();
            break;
        }
      };

      logger.debug("BroadcastChannel initialized for cross-tab sync");
    }

    // Listen for session expiry (only in browser)
    if (typeof window !== "undefined") {
      const handleSessionExpired = () => {
        logger.info("Session expired event received:", {
          timestamp: new Date().toISOString(),
          currentUser: user?.username || "none",
        });

        setUser(null);

        // On a PUBLIC route, an absent/expired token is NORMAL, but
        // HttpClient treats a 401 with an absent token as session expiry
        // since #491 — so this handler fires there too, and a global
        // redirect to /login is actively harmful:
        //   - / (and other marketing routes): an anonymous visitor's
        //     bootstrap `/users/me` 401 bounces them off the public
        //     landing page to /login — intermittently, racing the page
        //     render (observed flaking the marketing E2E suite, and it
        //     hits real visitors too).
        //   - /login: redirecting hard-reloads the page we're already
        //     on; each reload creates a fresh HttpClient whose fire-once
        //     guard resets, re-firing this handler in a loop (~15
        //     reloads/sec observed live on prod 2026-06-07, sign-in
        //     unusable — fixed by #500 + #503).
        //   - /auth/callback: redirecting ABORTS the in-flight PKCE
        //     token-exchange fetch ("[AuthCallback] Cognito callback
        //     failed: TypeError: Failed to fetch", observed live on prod
        //     2026-06-07 right after a session-expired halt) — every
        //     login bounced back to /login even after the loop fix.
        // Drop the local user state and stay put; the page's own auth flow
        // owns what happens next. Protected routes are still redirected —
        // by the middleware + AppAuthGate (which add `?next=`) when they
        // see the now-null user — so this global redirect is only needed
        // as a backstop there. Uses the SAME public-route classifier as
        // the middleware (see lib/public-routes) so the two never drift.
        const path = window.location.pathname;
        if (isPublic(path)) {
          logger.info(
            `Session expired on public route ${path} — skipping redirect`
          );
          return;
        }

        logger.info("Redirecting to /login due to session expiry");
        window.location.href = "/login";
      };

      logger.debug("Registering session-expired event listener");
      window.addEventListener("session-expired", handleSessionExpired);

      return () => {
        logger.debug("Cleaning up event listeners");
        window.removeEventListener("session-expired", handleSessionExpired);

        // Close BroadcastChannel
        if (channelRef.current) {
          channelRef.current.close();
          channelRef.current = null;
        }
      };
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Proactive silent token refresh.
   *
   * The Cognito bearer (the ID token) expires on the app client's
   * `IdTokenValidity`; without renewal the user is bounced to `/login` the
   * moment it lapses. Arming this while a user is signed in renews the bearer
   * shortly BEFORE `exp`, so the session continues transparently instead of
   * waiting for a request to 401 first.
   *
   * Keyed on whether a user is signed in (not the user object) so an unrelated
   * `updateUser` doesn't churn the timer. `TokenRefreshService` owns the rest
   * of the idleness contract: one self-rescheduling timeout, disarmed while the
   * tab is hidden, and never armed at all while signed out.
   */
  const isSignedIn = !!user;
  useEffect(() => {
    if (!isSignedIn) return undefined;
    authService.startProactiveRefresh();
    return () => authService.stopProactiveRefresh();
  }, [isSignedIn]);

  /**
   * Hydrate the user via `getCurrentUser()` with a per-attempt timeout and a
   * bounded retry, so a stalled `/users/me` can't pin the app behind the
   * AuthLoadingShell forever (see BOOTSTRAP_USER_FETCH_* above). A 401/403 is
   * authoritative and re-thrown immediately; a timeout/transient error is
   * retried. Throws the last error if every attempt fails (caller decides).
   */
  const getCurrentUserResilient = async (): Promise<User> => {
    let lastErr: unknown;
    for (
      let attempt = 1;
      attempt <= BOOTSTRAP_USER_FETCH_MAX_ATTEMPTS;
      attempt++
    ) {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        BOOTSTRAP_USER_FETCH_TIMEOUT_MS
      );
      try {
        return await authService.getCurrentUser(controller.signal);
      } catch (err) {
        lastErr = err;
        // 401/403 = authoritatively not-authenticated; retrying won't help.
        if (isUnauthorizedError(err)) throw err;
        logger.warn(
          `getCurrentUser attempt ${attempt}/${BOOTSTRAP_USER_FETCH_MAX_ATTEMPTS} ` +
            `failed (timeout or transient); ${
              attempt < BOOTSTRAP_USER_FETCH_MAX_ATTEMPTS
                ? "retrying"
                : "giving up"
            }:`,
          err
        );
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr;
  };

  const checkAuth = async () => {
    logger.debug("Checking authentication...");
    try {
      // Purge a stale session BEFORE reading any auth state. A reopened browser
      // keeps the localStorage markers (`is_authenticated`, `refresh_token_expiry`)
      // and the `qontinui_auth` marker cookie, but its tab-scoped sessionStorage
      // Bearer token is gone — so the tab would otherwise render as
      // "authenticated" with no usable token (and pop a spurious session-expiry
      // warning). This synchronous storage clear runs before the first
      // authenticated render and before overlays mount, so a stale tab boots
      // cleanly logged-out. No-op for genuine sessions and genuine logged-out tabs.
      if (authService.tokenManager.purgeStaleSession()) {
        logger.info("Purged stale session at boot (markers without a usable token)");
      }

      const isAuth = authService.isAuthenticated();
      logger.debug("Is authenticated:", isAuth);

      if (isAuth) {
        // Renew the bearer before hydrating the user if it is spent.
        //
        // `isRefreshDue()` is checked ALONGSIDE `isAccessTokenExpired()`, not
        // instead of it, because the two cover different holes:
        //   - isAccessTokenExpired() carries TokenValidator's 5-minute
        //     clock-skew grace, so for five minutes after `exp` it says "not
        //     expired" while the backend already rejects the token. Booting in
        //     that window without refreshing means /users/me 401s and the catch
        //     below signs the user out — the logout this whole change removes.
        //   - isRefreshDue() is skew-free but needs a known expiry, so it
        //     returns false when no `token_expiry` is stored; that case is
        //     exactly what isAccessTokenExpired() reports as expired.
        if (authService.isAccessTokenExpired() || authService.isRefreshDue()) {
          logger.debug("Access token is spent, attempting refresh...");
          const refreshSuccess = await authService.refreshAccessToken();

          if (!refreshSuccess) {
            logger.info("Token refresh failed, user needs to re-login");
            // Background cleanup — clear local state only, do not redirect the
            // browser to the Cognito hosted-UI logout.
            void authService.logout(false);
            return;
          }

          logger.debug("Token refresh successful");
        }

        logger.debug("Fetching current user...");
        const currentUser = await getCurrentUserResilient();
        logger.debug("Current user:", currentUser);
        setUser(currentUser);
      } else {
        logger.debug("No valid auth token found");

        // Cookie-based session restore: on a fresh load the in-memory tokens
        // and the `is_authenticated` flag are gone, but valid HttpOnly auth
        // cookies may still establish a session on the backend. Optimistically
        // probe /users/me once per mount. This recovers refresh/deep-link
        // sessions that the flag-only fast path would otherwise bounce to
        // /login (the dev auto-login effect can't help on a production build).
        if (!hasAttemptedRestore.current) {
          hasAttemptedRestore.current = true;
          logger.debug(
            "Attempting cookie-based session restore via getCurrentUser..."
          );
          try {
            const restoredUser = await getCurrentUserResilient();
            logger.info(
              "Cookie-based session restore succeeded for user:",
              restoredUser.username
            );
            setUser(restoredUser);
            // Persist the auth flag so subsequent loads take the fast path.
            authService.setAuthenticated();
          } catch (restoreError) {
            // No valid cookie session (e.g. 401). Leave the user logged-out.
            // IMPORTANT: do NOT call authService.logout() here — a failed
            // optimistic probe must not trigger logout side-effects (backend
            // logout call / unrelated state clearing).
            logger.debug(
              "Cookie-based session restore did not establish a session:",
              restoreError
            );
          }
        }
      }
    } catch (error) {
      logger.error("Auth check failed:", error);
      // Background cleanup — clear local state only, no hosted-UI redirect.
      void authService.logout(false);
    } finally {
      logger.debug("Setting loading to false");
      setLoading(false);
    }
  };

  const completeExternalLogin = async (tokens: {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  }): Promise<User> => {
    // Store the Cognito tokens through the token-storage layer so the
    // HttpClient attaches `Authorization: Bearer <cognito access_token>` on
    // every request and the middleware marker cookie is set. `setTokens`
    // derives the access-token expiry from the JWT `exp` claim; the refresh
    // fields are best-effort (Cognito refresh tokens are opaque/optional, and
    // the app re-auths via the hosted UI rather than a password refresh
    // endpoint).
    authService.tokenManager.setTokens({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? "",
      token_type: "bearer",
      expires_in: tokens.expires_in,
      refresh_expires_in: tokens.expires_in,
    });

    // Hydrate the user from the backend, which dual-accepts Cognito JWTs.
    const loggedInUser = await authService.getCurrentUser();
    setUser(loggedInUser);

    // Broadcast the login to other tabs.
    if (channelRef.current) {
      channelRef.current.postMessage({
        type: "LOGIN",
        user: loggedInUser,
      } as AuthBroadcastMessage);
      logger.debug("Broadcasted LOGIN event to other tabs (external login)");
    }

    return loggedInUser;
  };

  const logout = async () => {
    // Clear page state from IndexedDB before logout
    if (user?.id) {
      try {
        logger.debug("Clearing page state for user:", user.id);
        await pageStateDB.clearUserData(user.id);
        logger.debug("Page state cleared successfully");
      } catch (error) {
        logger.error("Failed to clear page state:", error);
        // Continue with logout even if page state cleanup fails
      }
    }

    // Clear extraction config from localStorage
    clearExtractionConfig();
    logger.debug("Extraction config cleared");

    setUser(null);

    // Broadcast logout event to other tabs (they clear local state only — see
    // the LOGOUT broadcast handler — without each redirecting to /logout).
    if (channelRef.current) {
      channelRef.current.postMessage({
        type: "LOGOUT",
      } as AuthBroadcastMessage);
      logger.debug("Broadcasted LOGOUT event to other tabs");
    }

    // Clears local token state, then redirects this tab to the Cognito
    // hosted-UI `/logout` (true SSO sign-out). Cognito redirects back to the
    // app's `/login` page afterwards, so no extra navigation is needed here —
    // this call ends in a full-page redirect and does not return.
    await authService.logout();
  };

  const updateUser = async (data: Partial<User>) => {
    try {
      // This would need to be implemented in the auth service
      // For now, just update the local state
      const updatedUser = user ? { ...user, ...data } : null;
      setUser(updatedUser);

      // Broadcast user update event to other tabs
      if (channelRef.current && updatedUser) {
        channelRef.current.postMessage({
          type: "USER_UPDATE",
          user: updatedUser,
        } as AuthBroadcastMessage);
        logger.debug("Broadcasted USER_UPDATE event to other tabs");
      }
    } catch (error) {
      logger.error("User update failed:", error);
      throw error;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        // Coord admins manage coordination; qontinui superusers (staff) are a
        // superset and keep the full access they had before the per-page gating.
        isCoordAdmin:
          user?.coord_is_admin === true || user?.is_superuser === true,
        accountType: user?.account_type ?? null,
        logout,
        updateUser,
        completeExternalLogin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
