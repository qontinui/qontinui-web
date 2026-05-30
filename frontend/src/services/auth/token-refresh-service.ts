import { TokenManager } from "./token-manager";
import { createLogger } from "@/lib/logger";

const log = createLogger("TokenRefresh");

/**
 * TokenRefreshService - Single Responsibility: Handle token-expiry recovery.
 *
 * Authentication is Cognito-only. The app holds a Cognito access token (minted
 * by the hosted-UI Authorization Code + PKCE flow); there is NO backend
 * password-refresh endpoint to silently mint a new one. When the access token
 * expires the only recovery is to re-authenticate through the Cognito hosted
 * UI, so `refreshAccessToken()` cannot transparently refresh — it treats the
 * session as expired: it clears local token state and dispatches the
 * `session-expired` event, which the auth context handles by routing the user
 * to `/login` (where they re-enter the hosted-UI flow).
 */
export class TokenRefreshService {
  private tokenManager: TokenManager;

  constructor(tokenManager: TokenManager) {
    this.tokenManager = tokenManager;
  }

  /**
   * Cognito-only: there is no silent refresh. Clear local token state and
   * signal session expiry so the user is sent back through the hosted UI.
   * Always resolves `false` (no refreshed token is available).
   */
  async refreshAccessToken(): Promise<boolean> {
    log.debug("No backend refresh under Cognito-only auth — session expired");
    this.tokenManager.clearTokens();

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("session-expired"));
    }

    return false;
  }

  /** Refresh is never in flight — there is no asynchronous refresh anymore. */
  isRefreshing(): boolean {
    return false;
  }
}
