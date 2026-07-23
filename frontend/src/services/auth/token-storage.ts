/**
 * TokenStorage - Bearer tokens (sessionStorage-backed) + HttpOnly cookies
 *
 * The backend sets HttpOnly cookies for XSS protection AND returns the tokens
 * in the response body. We keep the tokens both in memory and mirrored to
 * sessionStorage so the HttpClient can always attach an `Authorization: Bearer`
 * header — the primary, transport-independent auth path. The HttpOnly cookie
 * is a redundant bonus the backend's CookieOrBearerScheme also accepts.
 *
 * Why the Bearer header is primary (not the cookie): cookie delivery is
 * fragile across host/origin boundaries — `127.0.0.1` vs `localhost` are
 * distinct cookie hosts, and `SameSite=lax` drops cookies on cross-origin /
 * cross-port fetches. A Bearer header has none of those constraints, so
 * relying on it makes auth work the same regardless of how the dev server is
 * addressed or whether the backend is same-origin or cross-origin.
 *
 * sessionStorage (tab-scoped, cleared on tab close, wiped by clearAll on
 * logout) is the reload-survival store in EVERY mode. Persisting and
 * restoring unconditionally means a page reload never loses the in-memory
 * tokens, so the reactive refresh always has a body token and a 401 never
 * cascades into a spurious session teardown. (Previously this was gated to
 * remote-backend mode, which left local dev dependent on the fragile cookie
 * path after a reload.)
 */
import { ApiConfig } from "../api-config";
// The single base64url-aware JWT payload decoder for the auth stack. The
// signature is NOT verified — only the backend can verify; this exists so the
// client can read its own `sub` / `jti` etc. without a backend round-trip.
// (The SDK's per-user tab scoping via `registrationMetadata` is the primary
// consumer; the relay re-verifies the same token server-side at the auth gate,
// so a client that lies about its claims here is caught there.)
import { decodeJwtClaims } from "./jwt-claims";

/**
 * Parse a stored millisecond timestamp, rejecting anything non-numeric.
 *
 * `parseInt` on a corrupted/hand-edited localStorage value returns NaN, and a
 * NaN expiry poisons every downstream comparison: `expiry > Date.now()` is
 * false, `isTokenExpired` is false, `getTimeUntilExpiry` is NaN — the session
 * lands in a state that is simultaneously "not expired" and "no time left".
 * Treating it as absent routes it down the existing no-expiry paths instead.
 */
function parseStoredTimestamp(raw: string | null): number | null {
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export class TokenStorage {
  private readonly TOKEN_EXPIRY_KEY = "token_expiry";
  private readonly REFRESH_TOKEN_EXPIRY_KEY = "refresh_token_expiry";
  private readonly AUTHENTICATED_KEY = "is_authenticated";
  private readonly SESSION_ACCESS_TOKEN_KEY = "auth_bearer_access_token";
  private readonly SESSION_REFRESH_TOKEN_KEY = "auth_bearer_refresh_token";

  /**
   * Client-readable, non-secret auth marker cookie. In remote-backend mode the
   * real `access_token`/`refresh_token` HttpOnly cookies never land on the
   * dashboard origin (they're scoped to the cross-origin backend host), so the
   * Next.js `middleware.ts` cookie gate would bounce every protected route to
   * `/login` even though the Bearer token in sessionStorage is valid. This
   * marker (value carries NO token — just "the client believes it is signed
   * in") lets the middleware pass; it's a soft gate, not a security boundary
   * (the page-level `useAuth()` flow still validates / refreshes / signs out).
   * Session-scoped (no Max-Age) to align with the tab-scoped sessionStorage
   * Bearer token. Kept in sync with middleware.ts AUTH_MARKER_COOKIE.
   */
  private readonly AUTH_MARKER_COOKIE = "qontinui_auth";

  // Bearer tokens: kept in memory (primary auth via the Authorization header)
  // and mirrored to sessionStorage so a reload can restore them. The HttpOnly
  // cookies are a redundant backend-side fallback.
  private accessToken: string | null = null;
  private refreshTokenValue: string | null = null;

  constructor() {
    // Restore Bearer tokens from sessionStorage on construction so a page
    // reload never loses the in-memory tokens. Without this, a reload leaves
    // requests dependent on the HttpOnly cookie, which is dropped across
    // host/origin boundaries (e.g. 127.0.0.1 vs localhost) — the next 401
    // then triggers a cookie-only refresh that also fails and tears down the
    // session. Unconditional in every mode (not just remote-backend).
    if (typeof window !== "undefined") {
      this.accessToken = sessionStorage.getItem(this.SESSION_ACCESS_TOKEN_KEY);
      this.refreshTokenValue = sessionStorage.getItem(
        this.SESSION_REFRESH_TOKEN_KEY
      );
    }
  }

  /**
   * Save access token in memory and mirror it to sessionStorage (so it
   * survives a page reload), and set the authentication flag in localStorage
   * for UI state. The Authorization header built from this token is the
   * primary auth path in every mode.
   */
  saveAccessToken(token?: string): void {
    if (typeof window === "undefined") return;
    if (token) {
      this.accessToken = token;
      sessionStorage.setItem(this.SESSION_ACCESS_TOKEN_KEY, token);
      // Always set the marker cookie so Next.js middleware knows the user is
      // authenticated, regardless of whether we're in local or remote mode.
      // Without this, the middleware sees no auth cookie and bounces to /login.
      this.setAuthMarkerCookie();
    }
    // Set authentication flag for UI state management
    localStorage.setItem(this.AUTHENTICATED_KEY, "true");
  }

  /**
   * Set the client-readable auth-marker cookie on the current origin so the
   * Next.js middleware soft-gate passes (it carries NO token). Set in every
   * mode. Session-scoped; `Secure` only over https so it still works on
   * http://localhost / http://127.0.0.1 during dev.
   */
  private setAuthMarkerCookie(): void {
    if (typeof document === "undefined") return;
    const secure =
      typeof location !== "undefined" && location.protocol === "https:"
        ? "; Secure"
        : "";
    document.cookie = `${this.AUTH_MARKER_COOKIE}=1; Path=/; SameSite=Lax${secure}`;
  }

  /** Remove the auth-marker cookie (logout / clear). */
  private clearAuthMarkerCookie(): void {
    if (typeof document === "undefined") return;
    document.cookie = `${this.AUTH_MARKER_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  }

  /**
   * Set the authentication flag in localStorage without touching tokens.
   *
   * Used by cookie-based session restore: when valid HttpOnly cookies
   * establish a session on a fresh load (no in-memory tokens), we persist
   * this flag so subsequent loads take the fast path. Mirrors the flag write
   * in saveAccessToken() but does not require an access token.
   */
  setAuthenticated(): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(this.AUTHENTICATED_KEY, "true");
  }

  /**
   * Save refresh token in memory and mirror it to sessionStorage so token
   * refresh remains possible after a page reload (the reactive refresh sends
   * it in the request body — see token-refresh-service). Mirrored in every
   * mode so reload never falls back to the fragile cookie-only refresh path.
   */
  saveRefreshToken(token?: string): void {
    if (typeof window === "undefined") return;
    if (token) {
      this.refreshTokenValue = token;
      sessionStorage.setItem(this.SESSION_REFRESH_TOKEN_KEY, token);
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
   * Drop the persisted bearer expiry.
   *
   * Called when a freshly-stored bearer yields NO usable expiry at all: leaving
   * the PREVIOUS token's timestamp behind would have the staleness predicates
   * answering for a token that is no longer held.
   */
  clearTokenExpiry(): void {
    if (typeof window === "undefined") return;
    localStorage.removeItem(this.TOKEN_EXPIRY_KEY);
  }

  /**
   * Get access token for the Authorization header. Restored from
   * sessionStorage on construction, so it survives a page reload; null only
   * when genuinely signed out.
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
   * Get the user id from the current access token's `sub` claim.
   * Returns null when no access token is present OR when the token is
   * malformed. Used by callers that need a stable user identifier
   * client-side without making a backend round-trip (e.g. the UI Bridge
   * SDK's per-user tab scoping — `registrationMetadata.userId`).
   */
  getUserId(): string | null {
    const claims = decodeJwtClaims(this.getAccessToken());
    if (claims && typeof claims.sub === "string" && claims.sub.length > 0) {
      return claims.sub;
    }
    return null;
  }

  /**
   * Get a session id from the current access token's `jti` claim. The
   * JWT issuer (`fastapi-users`) mints a fresh `jti` for every token,
   * so this rotates on every refresh — adequate for per-request audit
   * correlation and for the UI Bridge SDK's per-session scoping
   * (`registrationMetadata.sessionId`).
   */
  getSessionId(): string | null {
    const claims = decodeJwtClaims(this.getAccessToken());
    if (claims && typeof claims.jti === "string" && claims.jti.length > 0) {
      return claims.jti;
    }
    return null;
  }

  /**
   * Get token expiry timestamp (for proactive refresh logic)
   */
  getTokenExpiry(): number | null {
    if (typeof window === "undefined") return null;
    return parseStoredTimestamp(localStorage.getItem(this.TOKEN_EXPIRY_KEY));
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
    return parseStoredTimestamp(
      localStorage.getItem(this.REFRESH_TOKEN_EXPIRY_KEY)
    );
  }

  /**
   * Get authentication state (for UI state management)
   */
  isAuthenticated(): boolean {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(this.AUTHENTICATED_KEY) === "true";
  }

  /**
   * Synchronously detect-and-clear a STALE session at boot.
   *
   * The "logged-out tab thinks it has a session" bug: Bearer tokens live in
   * sessionStorage (cleared when the tab/browser closes), but the auth markers
   * persist in localStorage (`is_authenticated`, `refresh_token_expiry`) plus
   * the `qontinui_auth` marker cookie. A reopened browser therefore has the
   * markers but no usable token, and post-Cognito-teardown there is no local
   * refresh path to re-mint one — so the tab renders as "authenticated" (the
   * middleware soft-gate sees the cookie) until something tears it down.
   *
   * STALE := a marker is present AND there is no usable access token.
   *   - marker present  = `isAuthenticated()` (the `is_authenticated` flag) OR
   *                       a persisted `refresh_token_expiry` value.
   *   - usable token     = `getAccessToken()` is a non-empty string AND, if a
   *                       token-expiry timestamp exists, it is still in the
   *                       future (> Date.now()).
   *
   * When stale, clears EVERYTHING (clearAll + explicit marker-cookie clear) and
   * returns true. Otherwise returns false. SSR-safe and never throws.
   *
   * SCOPE: remote-backend mode only. In same-origin / local-dev mode the session
   * is backed by the HttpOnly refresh cookie, so "marker present + no sessionStorage
   * Bearer" is a NORMAL, recoverable state (the next request re-mints the token via
   * the cookie). Purging there would wrongly tear down valid cookie-based sessions —
   * e.g. the Spec CI crawler, which authenticates via the refresh cookie + seeded
   * markers and deliberately carries no Bearer. Only cross-origin (remote) mode makes
   * a missing Bearer unambiguously stale: the backend's auth cookies never land on the
   * dashboard origin, so there is no cookie-refresh path and the sessionStorage Bearer
   * is the sole session anchor.
   */
  purgeStaleSession(): boolean {
    if (typeof window === "undefined") return false;
    if (!ApiConfig.IS_REMOTE_BACKEND) return false;
    try {
      const markerPresent =
        this.isAuthenticated() ||
        localStorage.getItem(this.REFRESH_TOKEN_EXPIRY_KEY) !== null;

      if (!markerPresent) return false;

      const token = this.getAccessToken();
      const expiry = this.getTokenExpiry();
      const usableToken =
        typeof token === "string" &&
        token.length > 0 &&
        (expiry === null || expiry > Date.now());

      if (usableToken) return false;

      // Marker present but no usable token -> stale. Clear all auth state and
      // the marker cookie so the tab boots as cleanly logged-out.
      this.clearAll();
      this.clearAuthMarkerCookie();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clear all authentication state (memory + localStorage + sessionStorage).
   * HttpOnly cookies are cleared by the backend /logout endpoint.
   */
  clearAll(): void {
    if (typeof window === "undefined") return;
    this.accessToken = null;
    this.refreshTokenValue = null;
    localStorage.removeItem(this.TOKEN_EXPIRY_KEY);
    localStorage.removeItem(this.REFRESH_TOKEN_EXPIRY_KEY);
    localStorage.removeItem(this.AUTHENTICATED_KEY);
    sessionStorage.removeItem(this.SESSION_ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(this.SESSION_REFRESH_TOKEN_KEY);
    this.clearAuthMarkerCookie();
  }

  /**
   * Get all storage keys (for debugging)
   */
  getAllStorageKeys(): string[] {
    if (typeof window === "undefined") return [];
    return Object.keys(localStorage);
  }
}
