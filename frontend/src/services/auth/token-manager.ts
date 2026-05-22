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
    const expiry = this.validator.extractExpiry(tokens.access_token);

    // Calculate refresh token expiry from expires_in and refresh_expires_in
    const refreshExpiry = tokens.refresh_expires_in
      ? Date.now() + tokens.refresh_expires_in * 1000
      : null;

    this.storage.saveAccessToken(tokens.access_token);
    this.storage.saveRefreshToken(tokens.refresh_token);
    if (expiry) {
      this.storage.saveTokenExpiry(expiry);
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
   * Get token expiry timestamp
   */
  getTokenExpiry(): number | null {
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
   * Check if access token is expired
   */
  isAccessTokenExpired(): boolean {
    const expiry = this.storage.getTokenExpiry();
    if (!expiry) return true;
    return this.validator.isTokenExpired(expiry);
  }

  /**
   * Check if access token will expire soon
   */
  isAccessTokenExpiringSoon(thresholdMs: number = 60000): boolean {
    const expiry = this.storage.getTokenExpiry();
    if (!expiry) return false;
    return this.validator.isTokenExpiringSoon(expiry, thresholdMs);
  }

  /**
   * Get time until access token expires
   */
  getTimeUntilExpiry(): number {
    const expiry = this.storage.getTokenExpiry();
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
