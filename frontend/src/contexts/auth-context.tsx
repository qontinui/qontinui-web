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
import { authService } from "@/services/service-factory";
import { User } from "@/types/auth-types";
import { pageStateDB } from "@/stores/page-state";
import { clearExtractionConfig } from "@/hooks/use-extraction-config";

interface AuthContextType {
  user: User | null;
  loading: boolean;
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
        // Check if access token is expired - if so, try to refresh it first
        if (authService.isAccessTokenExpired()) {
          logger.debug("Access token is expired, attempting refresh...");
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
