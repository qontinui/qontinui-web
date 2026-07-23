import { createLogger } from "@/lib/logger";
import { decodeJwtClaims } from "./jwt-claims";

const log = createLogger("TokenValidator");

/**
 * TokenValidator - Single Responsibility: Validate JWT tokens
 * Handles token decoding, expiration checks, and validation logic
 */
export interface TokenPayload {
  exp?: number;
  iat?: number;
  sub?: string;
  [key: string]: unknown;
}

export class TokenValidator {
  // Clock skew tolerance: allow 5 minutes of difference between server and client
  private readonly CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

  /**
   * Decode JWT token and extract payload.
   *
   * Delegates to the shared `decodeJwtClaims` helper so this is NOT a second
   * (base64url-blind) decoder: `atob` throws on the `-` / `_` a JWT payload can
   * legitimately contain, and a throw here surfaced as "no expiry" — which the
   * proactive refresh scheduler read as "renew now", spinning the Cognito token
   * endpoint every 10 seconds. See `jwt-claims.ts`.
   */
  decodeToken(token: string): TokenPayload | null {
    const payload = decodeJwtClaims(token);
    if (!payload) {
      log.error("Failed to decode token (malformed or non-JWT)");
      return null;
    }
    return payload as TokenPayload;
  }

  /**
   * Extract expiry timestamp from JWT token (in milliseconds)
   */
  extractExpiry(token: string): number | null {
    const payload = this.decodeToken(token);
    // `exp` must be a finite number of seconds; anything else (absent, a
    // string, NaN) yields no usable expiry rather than a NaN timestamp that
    // silently poisons every downstream comparison.
    if (typeof payload?.exp !== "number" || !Number.isFinite(payload.exp)) {
      return null;
    }
    return payload.exp * 1000; // Convert to milliseconds
  }

  /**
   * Check if token is expired (with clock skew tolerance)
   */
  isTokenExpired(expiryTime: number): boolean {
    const now = Date.now();
    const isExpired = now >= expiryTime + this.CLOCK_SKEW_TOLERANCE_MS;

    if (now >= expiryTime && !isExpired) {
      log.debug("Token within clock skew tolerance");
    }

    return isExpired;
  }

  /**
   * Check if token will expire soon (within specified milliseconds)
   * Default: 30 seconds BEFORE expiry (proactive refresh to prevent 401 errors)
   */
  isTokenExpiringSoon(
    expiryTime: number,
    thresholdMs: number = 30000
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
}
