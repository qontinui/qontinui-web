/**
 * TokenStorage - HttpOnly Cookie Migration Complete
 *
 * SECURITY: Tokens are now stored in HttpOnly cookies (XSS protection)
 * - access_token: HttpOnly cookie, path="/", 15min lifetime
 * - refresh_token: HttpOnly cookie, path="/api/v1/auth", 30-90 day lifetime
 *
 * This class no longer stores actual token values in localStorage (security vulnerability).
 * We only store:
 * - Token expiry timestamps (for proactive refresh logic)
 * - Authentication state flag (for UI state management)
 *
 * The browser automatically sends HttpOnly cookies with every request.
 * Backend reads tokens from cookies first, then falls back to Authorization header.
 */
export class TokenStorage {
  private readonly TOKEN_EXPIRY_KEY = 'token_expiry';
  private readonly REFRESH_TOKEN_EXPIRY_KEY = 'refresh_token_expiry';
  private readonly AUTHENTICATED_KEY = 'is_authenticated';

  // REMOVED: access_token and refresh_token keys (now in HttpOnly cookies)

  /**
   * Save access token - NO-OP (tokens are in HttpOnly cookies)
   * Kept for API compatibility during migration
   */
  saveAccessToken(token: string): void {
    if (typeof window === 'undefined') return;
    // DO NOT store actual token in localStorage (XSS vulnerability)
    // Backend sets access_token as HttpOnly cookie automatically
    console.log('[TokenStorage] ✅ Access token in HttpOnly cookie (not localStorage)');

    // Set authentication flag for UI state management
    localStorage.setItem(this.AUTHENTICATED_KEY, 'true');
  }

  /**
   * Save refresh token - NO-OP (tokens are in HttpOnly cookies)
   * Kept for API compatibility during migration
   */
  saveRefreshToken(token: string): void {
    if (typeof window === 'undefined') return;
    // DO NOT store actual token in localStorage (XSS vulnerability)
    // Backend sets refresh_token as HttpOnly cookie automatically
    console.log('[TokenStorage] ✅ Refresh token in HttpOnly cookie (not localStorage)');
  }

  /**
   * Save token expiry timestamp (needed for proactive refresh logic)
   */
  saveTokenExpiry(expiry: number): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(this.TOKEN_EXPIRY_KEY, expiry.toString());
    console.log('[TokenStorage] Token expiry saved:', new Date(expiry).toISOString());
  }

  /**
   * Get access token - Returns null (tokens are in HttpOnly cookies)
   * Browser automatically sends access_token cookie with credentials: 'include'
   */
  getAccessToken(): string | null {
    if (typeof window === 'undefined') return null;
    // Tokens are in HttpOnly cookies, not accessible to JavaScript (security)
    // Browser automatically sends cookies with fetch(..., { credentials: 'include' })
    return null;
  }

  /**
   * Get refresh token - Returns null (tokens are in HttpOnly cookies)
   * Browser automatically sends refresh_token cookie with credentials: 'include'
   */
  getRefreshToken(): string | null {
    if (typeof window === 'undefined') return null;
    // Tokens are in HttpOnly cookies, not accessible to JavaScript (security)
    // Browser automatically sends cookies with fetch(..., { credentials: 'include' })
    return null;
  }

  /**
   * Get token expiry timestamp (for proactive refresh logic)
   */
  getTokenExpiry(): number | null {
    if (typeof window === 'undefined') return null;
    const expiry = localStorage.getItem(this.TOKEN_EXPIRY_KEY);
    return expiry ? parseInt(expiry) : null;
  }

  /**
   * Save refresh token expiry timestamp (needed for proactive refresh logic)
   */
  saveRefreshTokenExpiry(expiry: number): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(this.REFRESH_TOKEN_EXPIRY_KEY, expiry.toString());
    console.log('[TokenStorage] Refresh token expiry saved:', new Date(expiry).toISOString());
  }

  /**
   * Get refresh token expiry timestamp
   */
  getRefreshTokenExpiry(): number | null {
    if (typeof window === 'undefined') return null;
    const expiry = localStorage.getItem(this.REFRESH_TOKEN_EXPIRY_KEY);
    return expiry ? parseInt(expiry) : null;
  }

  /**
   * Get authentication state (for UI state management)
   */
  isAuthenticated(): boolean {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(this.AUTHENTICATED_KEY) === 'true';
  }

  /**
   * Clear all authentication state
   * Note: This only clears localStorage flags. HttpOnly cookies are cleared by backend.
   */
  clearAll(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(this.TOKEN_EXPIRY_KEY);
    localStorage.removeItem(this.REFRESH_TOKEN_EXPIRY_KEY);
    localStorage.removeItem(this.AUTHENTICATED_KEY);
    console.error('[TokenStorage] Authentication state cleared from localStorage');
    console.error('[TokenStorage] HttpOnly cookies cleared by backend /logout endpoint');
  }

  /**
   * Get all storage keys (for debugging)
   */
  getAllStorageKeys(): string[] {
    if (typeof window === 'undefined') return [];
    return Object.keys(localStorage);
  }
}
