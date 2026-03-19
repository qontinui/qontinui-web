/**
 * TokenStorage - Dual auth strategy: in-memory tokens + HttpOnly cookies
 *
 * The backend sets HttpOnly cookies for XSS protection, AND returns tokens in
 * the response body. We store the tokens in memory (not localStorage) so the
 * HttpClient can include them as Authorization headers.
 *
 * This dual approach is needed because cross-origin cookie delivery
 * (localhost:3001 -> localhost:8000) is unreliable in development:
 * SameSite=lax cookies may not be sent on cross-origin fetch() requests
 * depending on browser version and platform.
 *
 * The backend's CookieOrBearerScheme checks cookies first, then falls back
 * to the Authorization header, so both paths work.
 *
 * In-memory storage means tokens are lost on page refresh, but the HttpOnly
 * cookies serve as a fallback and the refresh flow recovers gracefully.
 */
export class TokenStorage {
  private readonly TOKEN_EXPIRY_KEY = "token_expiry";
  private readonly REFRESH_TOKEN_EXPIRY_KEY = "refresh_token_expiry";
  private readonly AUTHENTICATED_KEY = "is_authenticated";

  // In-memory token storage (not localStorage — cleared on page refresh)
  // This is the primary auth mechanism for API calls via Authorization header.
  // HttpOnly cookies provide backup auth on the backend side.
  private accessToken: string | null = null;
  private refreshTokenValue: string | null = null;

  /**
   * Save access token in memory for Authorization header usage.
   * Also sets the authentication flag in localStorage for UI state.
   */
  saveAccessToken(token?: string): void {
    if (typeof window === "undefined") return;
    if (token) {
      this.accessToken = token;
    }
    // Set authentication flag for UI state management
    localStorage.setItem(this.AUTHENTICATED_KEY, "true");
  }

  /**
   * Save refresh token in memory for token refresh requests.
   */
  saveRefreshToken(token?: string): void {
    if (typeof window === "undefined") return;
    if (token) {
      this.refreshTokenValue = token;
    }
  }

  /**
   * Save token expiry timestamp (needed for proactive refresh logic)
   */
  saveTokenExpiry(expiry: number): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(this.TOKEN_EXPIRY_KEY, expiry.toString());
  }

  /**
   * Get access token from memory for Authorization header.
   * Returns null if token was not saved (e.g., after page refresh).
   * In that case, HttpOnly cookies provide fallback auth on the backend.
   */
  getAccessToken(): string | null {
    if (typeof window === "undefined") return null;
    return this.accessToken;
  }

  /**
   * Get refresh token from memory for token refresh requests.
   */
  getRefreshToken(): string | null {
    if (typeof window === "undefined") return null;
    return this.refreshTokenValue;
  }

  /**
   * Get token expiry timestamp (for proactive refresh logic)
   */
  getTokenExpiry(): number | null {
    if (typeof window === "undefined") return null;
    const expiry = localStorage.getItem(this.TOKEN_EXPIRY_KEY);
    return expiry ? parseInt(expiry) : null;
  }

  /**
   * Save refresh token expiry timestamp (needed for proactive refresh logic)
   */
  saveRefreshTokenExpiry(expiry: number): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(this.REFRESH_TOKEN_EXPIRY_KEY, expiry.toString());
  }

  /**
   * Get refresh token expiry timestamp
   */
  getRefreshTokenExpiry(): number | null {
    if (typeof window === "undefined") return null;
    const expiry = localStorage.getItem(this.REFRESH_TOKEN_EXPIRY_KEY);
    return expiry ? parseInt(expiry) : null;
  }

  /**
   * Get authentication state (for UI state management)
   */
  isAuthenticated(): boolean {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(this.AUTHENTICATED_KEY) === "true";
  }

  /**
   * Clear all authentication state (memory + localStorage).
   * HttpOnly cookies are cleared by the backend /logout endpoint.
   */
  clearAll(): void {
    if (typeof window === "undefined") return;
    this.accessToken = null;
    this.refreshTokenValue = null;
    localStorage.removeItem(this.TOKEN_EXPIRY_KEY);
    localStorage.removeItem(this.REFRESH_TOKEN_EXPIRY_KEY);
    localStorage.removeItem(this.AUTHENTICATED_KEY);
  }

  /**
   * Get all storage keys (for debugging)
   */
  getAllStorageKeys(): string[] {
    if (typeof window === "undefined") return [];
    return Object.keys(localStorage);
  }
}
