import { TokenResponse } from "@/types/auth-types";
import { TokenStorage } from "./token-storage";
import { TokenValidator } from "./token-validator";

/**
 * TokenManager - Single Responsibility: Coordinate token operations
 * Orchestrates token storage, validation, and provides a simple API
 * This is a facade that delegates to specialized services
 */
export class TokenManager {
  private storage: TokenStorage;
  private validator: TokenValidator;

  constructor(storage: TokenStorage, validator: TokenValidator) {
    this.storage = storage;
    this.validator = validator;
  }

  /**
   * Store new tokens (in memory for Authorization header, plus expiry in localStorage)
   */
  setTokens(tokens: TokenResponse): void {
    // Expiry source order: the bearer's own `exp` claim first (authoritative,
    // and immune to a sibling tab's shared timestamp), then the issuer's
    // `expires_in`. The fallback is load-bearing: without it an undecodable
    // bearer left the PREVIOUS token's `token_expiry` in place — so the
    // staleness predicates answered for a token no longer held, and (once it
    // was in the past) the proactive scheduler re-fired on its floor every ten
    // seconds, spending a Cognito token exchange each time.
    const expiry =
      this.validator.extractExpiry(tokens.access_token) ??
      (tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null);

    // Calculate refresh token expiry from expires_in and refresh_expires_in
    const refreshExpiry = tokens.refresh_expires_in
      ? Date.now() + tokens.refresh_expires_in * 1000
      : null;

    this.storage.saveAccessToken(tokens.access_token);
    this.storage.saveRefreshToken(tokens.refresh_token);
    if (expiry !== null) {
      this.storage.saveTokenExpiry(expiry);
    } else {
      // Neither source yielded one — drop the stale value rather than letting
      // it speak for a token it does not describe.
      this.storage.clearTokenExpiry();
    }
    if (refreshExpiry) {
      this.storage.saveRefreshTokenExpiry(refreshExpiry);
    }
  }

  /**
   * Persist the authentication flag without setting tokens.
   *
   * Used by cookie-based session restore when a valid HttpOnly-cookie session
   * is confirmed but no in-memory tokens exist (e.g. after a page refresh).
   */
  setAuthenticated(): void {
    this.storage.setAuthenticated();
  }

  /**
   * Clear all tokens
   */
  clearTokens(): void {
    this.storage.clearAll();
  }

  /**
   * Detect-and-clear a stale session synchronously at boot. A session is stale
   * when an auth marker (the `is_authenticated` flag or a persisted
   * `refresh_token_expiry`) is present but no usable access token exists —
   * e.g. a reopened browser whose tab-scoped sessionStorage Bearer token is
   * gone. Returns true if it purged. Delegates to the storage layer.
   */
  purgeStaleSession(): boolean {
    return this.storage.purgeStaleSession();
  }

  /**
   * Get current access token
   */
  getAccessToken(): string | null {
    return this.storage.getAccessToken();
  }

  /**
   * Get current refresh token
   */
  getRefreshToken(): string | null {
    return this.storage.getRefreshToken();
  }

  /**
   * Get the persisted token expiry timestamp (raw localStorage read).
   *
   * Prefer `getAccessTokenExpiry()` for any refresh/staleness decision — see
   * the cross-tab caveat documented there.
   */
  getTokenExpiry(): number | null {
    return this.storage.getTokenExpiry();
  }

  /**
   * Expiry of the bearer THIS TAB actually holds, decoded from the token's own
   * `exp` claim, falling back to the persisted timestamp when no token is in
   * hand (e.g. a cookie-restored session).
   *
   * The distinction is load-bearing for silent refresh: `token_expiry` lives in
   * localStorage and is therefore SHARED between tabs, while the bearer itself
   * lives in tab-scoped sessionStorage. Once a sibling tab renews its own
   * bearer it pushes a far-future `token_expiry` into the shared store, which
   * would otherwise convince this tab that its older, genuinely-expiring token
   * is still fresh — so it would neither renew proactively nor treat its 401s
   * as refreshable, and would 401 forever. Reading the claim off the token in
   * hand is immune to that.
   */
  getAccessTokenExpiry(): number | null {
    const token = this.storage.getAccessToken();
    if (token) {
      const derived = this.validator.extractExpiry(token);
      if (derived !== null) return derived;
    }
    return this.storage.getTokenExpiry();
  }

  /**
   * Check if we have a valid session
   *
   * HttpOnly Cookie Migration:
   * - Tokens are now in HttpOnly cookies, not accessible to JavaScript
   * - We use authentication state flag from localStorage for UI state
   * - Actual validation happens on backend via cookie authentication
   * - We also check token expiry to trigger proactive refresh
   */
  hasValidToken(): boolean {
    // Check authentication state flag (set on login, cleared on logout)
    const isAuthenticated = this.storage.isAuthenticated();

    // Check token expiry for proactive refresh logic
    const expiry = this.storage.getTokenExpiry();

    // If not authenticated flag, definitely not valid
    if (!isAuthenticated) {
      return false;
    }

    // If authenticated flag is set, check expiry
    // If access token is expired, we might need to refresh (but session is still valid)
    const isValid = this.validator.hasValidSession(
      isAuthenticated,
      isAuthenticated,
      expiry
    );

    return isValid;
  }

  /**
   * Check if user is authenticated (has authentication state flag set)
   * This is used for quick auth checks before making API calls
   */
  isAuthenticated(): boolean {
    return this.storage.isAuthenticated();
  }

  /**
   * Check if access token is expired.
   *
   * Keyed on `getAccessTokenExpiry()` (the token in hand) rather than the
   * shared localStorage timestamp, so a sibling tab's refresh cannot mask this
   * tab's own expiry.
   */
  isAccessTokenExpired(): boolean {
    const expiry = this.getAccessTokenExpiry();
    if (!expiry) return true;
    return this.validator.isTokenExpired(expiry);
  }

  /**
   * Check if access token will expire soon
   */
  isAccessTokenExpiringSoon(thresholdMs: number = 60000): boolean {
    const expiry = this.getAccessTokenExpiry();
    if (!expiry) return false;
    return this.validator.isTokenExpiringSoon(expiry, thresholdMs);
  }

  /**
   * Get time until access token expires
   */
  getTimeUntilExpiry(): number {
    const expiry = this.getAccessTokenExpiry();
    if (!expiry) return 0;
    return this.validator.getTimeUntilExpiry(expiry);
  }

  /**
   * Get refresh token expiry timestamp
   */
  getRefreshTokenExpiry(): number | null {
    return this.storage.getRefreshTokenExpiry();
  }

  /**
   * Check if refresh token is expired
   */
  isRefreshTokenExpired(): boolean {
    const expiry = this.storage.getRefreshTokenExpiry();
    if (!expiry) return true;
    return this.validator.isTokenExpired(expiry);
  }

  /**
   * Check if refresh token will expire soon
   */
  isRefreshTokenExpiringSoon(
    thresholdMs: number = 7 * 24 * 60 * 60 * 1000
  ): boolean {
    const expiry = this.storage.getRefreshTokenExpiry();
    if (!expiry) return false;
    return this.validator.isTokenExpiringSoon(expiry, thresholdMs);
  }

  /**
   * Get time until refresh token expires
   */
  getTimeUntilRefreshExpiry(): number {
    const expiry = this.storage.getRefreshTokenExpiry();
    if (!expiry) return 0;
    return this.validator.getTimeUntilExpiry(expiry);
  }
}
