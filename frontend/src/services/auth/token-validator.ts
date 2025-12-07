/**
 * TokenValidator - Single Responsibility: Validate JWT tokens
 * Handles token decoding, expiration checks, and validation logic
 */
export interface TokenPayload {
  exp?: number;
  iat?: number;
  sub?: string;
  [key: string]: any;
}

export class TokenValidator {
  // Clock skew tolerance: allow 5 minutes of difference between server and client
  private readonly CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

  /**
   * Decode JWT token and extract payload
   */
  decodeToken(token: string): TokenPayload | null {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) {
        console.error("[TokenValidator] Invalid token format");
        return null;
      }
      const payload = JSON.parse(atob(parts[1]!));
      return payload;
    } catch (error) {
      console.error("[TokenValidator] Failed to decode token:", error);
      return null;
    }
  }

  /**
   * Extract expiry timestamp from JWT token (in milliseconds)
   */
  extractExpiry(token: string): number | null {
    const payload = this.decodeToken(token);
    if (!payload?.exp) return null;
    return payload.exp * 1000; // Convert to milliseconds
  }

  /**
   * Check if token is expired (with clock skew tolerance)
   */
  isTokenExpired(expiryTime: number): boolean {
    const now = Date.now();
    const isExpired = now >= expiryTime + this.CLOCK_SKEW_TOLERANCE_MS;

    if (now >= expiryTime && !isExpired) {
      console.warn(
        "[TokenValidator] Token appears expired but within clock skew tolerance:",
        {
          now: new Date(now).toISOString(),
          expiry: new Date(expiryTime).toISOString(),
          skewToleranceMinutes: this.CLOCK_SKEW_TOLERANCE_MS / 60000,
        }
      );
    }

    return isExpired;
  }

  /**
   * Check if token will expire soon (within specified milliseconds)
   */
  isTokenExpiringSoon(
    expiryTime: number,
    thresholdMs: number = 60000
  ): boolean {
    const timeUntilExpiry = expiryTime - Date.now();
    return timeUntilExpiry < thresholdMs && timeUntilExpiry > 0;
  }

  /**
   * Get time remaining until token expires (in milliseconds)
   */
  getTimeUntilExpiry(expiryTime: number): number {
    return Math.max(0, expiryTime - Date.now());
  }

  /**
   * Validate token structure and content
   */
  isValidTokenStructure(token: string | null): boolean {
    if (!token) return false;
    const parts = token.split(".");
    return parts.length === 3;
  }

  /**
   * Check if we have a valid session (either valid access token or refresh token)
   */
  hasValidSession(
    hasAccessToken: boolean,
    hasRefreshToken: boolean,
    accessTokenExpiry: number | null
  ): boolean {
    // Valid session if we have:
    // 1. A valid (non-expired) access token, OR
    // 2. A refresh token (even if access token is expired, we can refresh it)
    const isAccessTokenValid =
      hasAccessToken &&
      accessTokenExpiry &&
      !this.isTokenExpired(accessTokenExpiry);
    return isAccessTokenValid || hasRefreshToken;
  }

  /**
   * Log validation results for debugging
   */
  logValidation(
    hasAccessToken: boolean,
    hasRefreshToken: boolean,
    expiry: number | null
  ): void {
    const isAccessTokenExpired = expiry ? this.isTokenExpired(expiry) : false;
    const isValid = this.hasValidSession(
      hasAccessToken,
      hasRefreshToken,
      expiry
    );

    console.log("[TokenValidator] Validation check:", {
      hasAccessToken,
      hasRefreshToken,
      isAccessTokenExpired,
      isValid,
      expiry: expiry ? new Date(expiry).toISOString() : "none",
      now: new Date().toISOString(),
      reasoning: isValid
        ? hasAccessToken && !isAccessTokenExpired
          ? "Valid access token"
          : "Has refresh token"
        : "No tokens available",
    });
  }
}
