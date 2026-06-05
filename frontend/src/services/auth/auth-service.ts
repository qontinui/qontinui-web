import { User } from "@/types/auth-types";
import { TokenManager } from "./token-manager";
import { TokenRefreshService } from "./token-refresh-service";
import { ApiConfig } from "../api-config";
import { startCognitoLogout } from "./cognito-oauth";
import { createLogger } from "@/lib/logger";

const log = createLogger("AuthService");

/**
 * AuthService - Single Responsibility: Handle authentication operations.
 *
 * Authentication is Cognito-only. Sign-in / sign-up / password-reset all happen
 * in the Cognito hosted UI (Authorization Code + PKCE); the resulting Cognito
 * access token is stored via `tokenManager` and attached as `Authorization:
 * Bearer` on every request (the backend dual-accepts Cognito JWTs). There is no
 * local email/password login, registration, or backend refresh here.
 */
export class AuthService {
  public tokenManager: TokenManager;
  private refreshService: TokenRefreshService;

  constructor(tokenManager: TokenManager, refreshService: TokenRefreshService) {
    this.tokenManager = tokenManager;
    this.refreshService = refreshService;
  }

  /**
   * Log the user out.
   *
   * Clears local token/auth state, then redirects to the Cognito hosted-UI
   * `/logout` endpoint for a true SSO sign-out (revokes the Cognito session
   * cookie so a subsequent sign-in re-prompts for credentials). Cognito then
   * redirects back to the app's `/login` page.
   *
   * `redirectToCognito` is `false` for non-user-initiated teardowns (e.g.
   * cross-tab logout sync, session-expiry cleanup), which must clear local
   * state WITHOUT navigating every tab to the hosted-UI logout.
   */
  async logout(redirectToCognito: boolean = true): Promise<void> {
    // Clear authentication state from localStorage / memory.
    this.tokenManager.clearTokens();
    log.debug("Local auth state cleared");

    // Revoke the Cognito hosted-UI session (full-page redirect; never returns).
    if (redirectToCognito && typeof window !== "undefined") {
      startCognitoLogout();
    }
  }

  /**
   * Get current authenticated user.
   *
   * Attaches the stored Cognito access token as `Authorization: Bearer`; the
   * backend dual-accepts Cognito JWTs. `credentials: 'include'` keeps the
   * same-origin cookie path working in local dev.
   */
  async getCurrentUser(signal?: AbortSignal): Promise<User> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Include Authorization header if we have an in-memory access token
    const accessToken = this.tokenManager.getAccessToken();
    if (accessToken) {
      headers["Authorization"] = `Bearer ${accessToken}`;
    }

    const response = await fetch(ApiConfig.USERS_ME, {
      method: "GET",
      headers,
      credentials: "include",
      // Optional caller-supplied abort (e.g. the boot-time auth bootstrap wraps
      // this in a per-attempt timeout so a stalled /users/me — a cold Next dev
      // route compile, or a slow/hung backend in prod — can't pin the whole app
      // behind the auth-gate's "Loading..." shell forever). Absent => no abort,
      // identical to the prior behavior.
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      // A 401 is the expected "not authenticated" signal — e.g. on public
      // routes while logged out, or after a session expires — not a failure.
      // Error-logging it emitted a critical console error on every logged-out
      // page, which tripped the post-deploy public smoke. Only non-401
      // responses indicate a real problem worth surfacing.
      if (response.status !== 401) {
        log.error("getCurrentUser failed:", response.status);
      }
      throw new Error(
        `Failed to get user info: ${response.status} - ${errorText}`
      );
    }

    return response.json();
  }

  /**
   * Refresh access token
   */
  async refreshAccessToken(): Promise<boolean> {
    return this.refreshService.refreshAccessToken();
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return this.tokenManager.hasValidToken();
  }

  /**
   * Persist the authentication flag without setting tokens.
   *
   * Used by the auth context's cookie-based session restore: when a fresh
   * load has valid HttpOnly cookies but no `is_authenticated` flag,
   * getCurrentUser() succeeds via the cookies and we persist the flag so
   * subsequent loads take the fast path. This intentionally sets only the
   * UI auth flag — actual tokens remain in HttpOnly cookies.
   */
  setAuthenticated(): void {
    this.tokenManager.setAuthenticated();
  }

  /**
   * Check if access token is expired
   */
  isAccessTokenExpired(): boolean {
    return this.tokenManager.isAccessTokenExpired();
  }

  /**
   * Check if access token will expire soon
   */
  isAccessTokenExpiringSoon(thresholdMs?: number): boolean {
    return this.tokenManager.isAccessTokenExpiringSoon(thresholdMs);
  }
}
