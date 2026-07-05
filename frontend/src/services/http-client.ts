import { TokenManager } from "./auth/token-manager";
import { ApiConfig } from "./api-config";
import { csrfService } from "./csrf-service";
import { RetryStrategy } from "./retry-strategy";
import { createLogger } from "@/lib/logger";

const log = createLogger("HttpClient");

/**
 * The dashboard tenant-switcher selection, persisted by `tenant-context.tsx`.
 * Read here directly (not via React context — `HttpClient` is a plain class)
 * to attach the `X-Qontinui-Active-Tenant` header to coord-proxy calls so the
 * operator's coord context re-scopes to the chosen tenant. The key MUST match
 * `tenant-context.tsx`'s `STORAGE_KEY`.
 */
const ACTIVE_TENANT_STORAGE_KEY = "qontinui.active_tenant_id";

/**
 * URL prefixes whose backend handlers proxy to coord with the operator's
 * active-tenant override honored. The header is attached only to these calls so
 * we never leak the tenant selection onto unrelated requests. (`/constraints/`
 * is deliberately excluded — it proxies to the local runner, not coord, and is
 * not tenant-scoped.)
 *
 * NOTE: the agent-sessions panel mounts under `/api/v1/admin/agent-sessions`
 * (the router's `/admin` prefix), not `/api/v1/agent-sessions`.
 */
const ACTIVE_TENANT_URL_PREFIXES = [
  "/api/v1/operations/",
  "/api/v1/admin-dev/",
  "/api/v1/admin/agent-sessions",
  // Helper-task portal proxy — coord-scoped; honoring the override lets a
  // caller who is a coord member of another tenant point the portal at it.
  "/api/v1/helper-tasks",
];

function readActiveTenantId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(ACTIVE_TENANT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function isActiveTenantScopedUrl(url: string): boolean {
  return ACTIVE_TENANT_URL_PREFIXES.some((prefix) => url.includes(prefix));
}

export interface HttpOptions extends RequestInit {
  skipAuth?: boolean;
  maxRetries?: number;
  /**
   * Per-request client-side timeout in milliseconds. Defaults to
   * `DEFAULT_REQUEST_TIMEOUT_MS` (60s) — covers typical reads + backend cold
   * starts. Long-running proxied operations (e.g. the audit wizard's
   * /pr-merge/onboarding/audit, whose backend timeout was bumped to 90s in
   * PR #569 to cover coord's 60s STARTER_PROFILE_WAIT) must pass a value
   * larger than the backend's own timeout, or the client AbortController will
   * fire first and surface the misleading "backend may be starting up"
   * message instead of the real backend error.
   */
  timeoutMs?: number;
}

/**
 * Default client-side fetch timeout. Sized to cover an Elastic Beanstalk
 * cold-start (~10-15s) plus normal request latency, but small enough that a
 * truly stuck request fails fast. Per-request `timeoutMs` overrides this.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

export class HttpClient {
  private tokenManager: TokenManager;
  private retryStrategy: RetryStrategy;
  private refreshPromise: Promise<boolean> | null = null;
  private onSessionExpired?: () => void;
  // Set once an auth rejection (401/403 with no usable token) has been
  // surfaced as a session-expiry, so concurrent polling loops that all
  // 401/403 within the same tick fire the redirect exactly once instead
  // of a storm of session-expired events.
  private sessionExpiryHandled = false;

  constructor(tokenManager: TokenManager, retryStrategy?: RetryStrategy) {
    this.tokenManager = tokenManager;
    this.retryStrategy = retryStrategy || new RetryStrategy();
  }

  setSessionExpiredHandler(handler: () => void): void {
    this.onSessionExpired = handler;
  }

  /**
   * Whether there is evidence a session was ever established. The single
   * source of truth for "anonymous visitor vs expired session": a 401/403
   * is only session expiry if there was a session to expire.
   *
   * Three clauses, any one suffices:
   * - an access token is present (it may be expired — checked separately),
   * - a refresh token is present (it survives access-token expiry),
   * - the `is_authenticated` localStorage marker is set.
   *
   * The marker is load-bearing, not redundant with the token getters: both
   * the access AND refresh tokens live in tab-scoped `sessionStorage`, so
   * they are wiped on browser/tab close while the `is_authenticated` marker
   * (localStorage) survives a restart. Keying on tokens alone would
   * misclassify a genuinely-expired session as anonymous after a browser
   * restart on the cookie/non-remote path. The marker is the canonical
   * "a session existed" signal the rest of the auth stack already keys on.
   */
  private hadSession(): boolean {
    return (
      !!this.tokenManager.getAccessToken() ||
      !!this.tokenManager.getRefreshToken() ||
      this.tokenManager.isAuthenticated()
    );
  }

  /**
   * Decide whether a 401/403 represents a dead session (expired/absent
   * bearer) rather than a feature/permission denial on a still-valid token.
   *
   * The dashboard runs several independent polling loops (device-status,
   * CI-status, gates, merge-queue, co-pilot activity, …) that each swallow a
   * non-ok response and keep their `setInterval` running. When the Cognito
   * bearer expires, every one of those loops would otherwise 401/403 on every
   * tick forever — the retry-storm that floods Sentry with hundreds of
   * 401/403 events per session. Treating an auth-failed poll as session
   * expiry once routes the user to `/login`, which unmounts the dashboard and
   * stops ALL the loops centrally.
   *
   * Guard rails:
   * - Only fires when the locally-held access token is expired or missing, so
   *   a feature/permission 403 (or a 401 from a flaky proxied downstream)
   *   while the token is still valid is NOT mistaken for session expiry —
   *   that path is returned to the caller untouched, preserving the existing
   *   `strategy/mentions/unread` carve-out behavior.
   * - `skipAuth` requests are exempt (public endpoints).
   * - Never fires for anonymous visitors — no access/refresh token AND no
   *   `is_authenticated` marker = no session to expire. A 401/403 on a public
   *   page (e.g. `/login`, `/auth/callback`) is returned to the caller plainly.
   * - Fires at most once per HttpClient instance (`sessionExpiryHandled`).
   */
  private maybeHandleAuthRejection(
    status: number,
    skipAuth: boolean,
  ): void {
    if (skipAuth) return;
    if (status !== 401 && status !== 403) return;
    if (this.sessionExpiryHandled) return;
    if (!this.hadSession()) return;

    const tokenUnusable =
      !this.tokenManager.getAccessToken() ||
      this.tokenManager.isAccessTokenExpired();
    if (!tokenUnusable) return;

    this.sessionExpiryHandled = true;
    console.warn(
      `[HttpClient] ${status} with an expired/absent access token — ` +
        "treating as session expiry and halting (redirecting to re-auth) " +
        "rather than letting polling loops retry-storm.",
    );
    this.tokenManager.clearTokens();
    if (this.onSessionExpired) {
      this.onSessionExpired();
    }
  }

  async fetch(url: string, options: HttpOptions = {}): Promise<Response> {
    const {
      skipAuth = false,
      maxRetries = 3,
      timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
      ...fetchOptions
    } = options;

    // Override retry strategy max retries if specified
    if (maxRetries !== 3) {
      this.retryStrategy = new RetryStrategy({ maxRetries });
    }

    return this.executeRequestWithRetry(url, fetchOptions, skipAuth, timeoutMs);
  }

  private async executeRequestWithRetry(
    url: string,
    options: RequestInit,
    skipAuth: boolean,
    timeoutMs: number,
    attempt: number = 1
  ): Promise<Response> {
    // Execute single request
    const response = await this.executeSingleRequest(url, options, skipAuth, timeoutMs);

    // Handle 401 Unauthorized with token refresh.
    //
    // Only refresh when our access token is actually stale (expired or about
    // to expire). A 401 while the token is still valid is NOT session expiry —
    // it's a feature/permission/upstream failure (e.g. a proxied downstream
    // service rejecting the call). Refreshing on those hammers the refresh
    // endpoint, and a token-rotation race there can 401 the refresh itself,
    // which `doRefreshToken` escalates to a global `session-expired` — falsely
    // tearing the whole session down. (This was the `strategy/mentions/unread`
    // teardown.) So surface a valid-token 401 instead of refreshing.
    if (response.status === 401 && !skipAuth && attempt === 1) {
      // An anonymous visitor (no session evidence) gets the 401 returned
      // plainly — entering the refresh branch would print the misleading
      // "attempting token refresh…" warn and call refreshAccessToken() even
      // though doRefreshToken() consumes no refresh token under Cognito-only
      // auth (it early-returns on !isAuthenticated, but only AFTER the warn).
      if (!this.hadSession()) {
        return response;
      }
      const tokenStale =
        this.tokenManager.isAccessTokenExpired() ||
        this.tokenManager.isAccessTokenExpiringSoon();
      if (!tokenStale) {
        console.warn(
          "[HttpClient] 401 with a still-valid access token — treating as a feature/upstream error, not session expiry; not refreshing"
        );
        return response;
      }
      console.warn(
        "[HttpClient] Received 401 with a stale access token, attempting token refresh..."
      );
      const refreshed = await this.refreshAccessToken();
      if (refreshed) {
        log.debug("Token refresh successful, retrying request");
        return this.executeSingleRequest(url, options, skipAuth, timeoutMs);
      }
      // Token refresh failed. Under Cognito-only auth there is no silent
      // re-mint, so a stale-token 401 that can't refresh is a dead session:
      // halt and route to re-auth once instead of letting the dashboard's
      // polling loops retry-storm this endpoint on every tick.
      this.maybeHandleAuthRejection(response.status, skipAuth);
      return response;
    }

    // A 403 (or a 401 on a non-first attempt) with an expired/absent bearer
    // is the same dead-session case the polling dashboards hit once the
    // Cognito token lapses — the upstream proxy rejects the expired token
    // with 403. Halt + re-auth once rather than 401/403-storming forever.
    if (response.status === 401 || response.status === 403) {
      this.maybeHandleAuthRejection(response.status, skipAuth);
    }

    // Use RetryStrategy for rate limiting and server errors
    if (response.status === 429 || response.status >= 500) {
      return this.retryStrategy.executeWithRetry(
        () => this.executeSingleRequest(url, options, skipAuth, timeoutMs),
        attempt
      );
    }

    return response;
  }

  private async executeSingleRequest(
    url: string,
    options: RequestInit,
    skipAuth: boolean,
    timeoutMs: number
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };

    if (!skipAuth) {
      const accessToken = this.tokenManager.getAccessToken();
      log.debug("executeSingleRequest:", {
        url,
        method: options.method || "GET",
        hasAccessToken: !!accessToken,
      });
      if (accessToken) {
        headers["Authorization"] = `Bearer ${accessToken}`;
      }
    }

    // Forward the dashboard tenant-switcher selection on coord-proxy calls so
    // the operator's coord context re-scopes to the chosen tenant (validated
    // coord-side against their memberships). Scoped to the tenant-aware proxy
    // prefixes (operations / admin-dev / admin agent-sessions / constraints)
    // so the header never leaks onto unrelated requests.
    if (!skipAuth && isActiveTenantScopedUrl(url)) {
      const activeTenant = readActiveTenantId();
      if (activeTenant) {
        headers["X-Qontinui-Active-Tenant"] = activeTenant;
      }
    }

    // Add CSRF token for state-changing requests
    const csrfToken = csrfService.getToken();
    if (
      csrfToken &&
      ["POST", "PUT", "DELETE", "PATCH"].includes(options.method || "GET")
    ) {
      headers["X-CSRF-Token"] = csrfToken;
    }

    const controller = new AbortController();
    // Client-side timeout to handle backend cold starts (can take 10-15
    // seconds) while still failing fast on truly stuck requests. Long-running
    // proxied operations override this via `timeoutMs` so the client clock
    // outlasts the backend's own timeout (otherwise the AbortController fires
    // first and surfaces the misleading "backend may be starting up" text in
    // place of the real backend error body).
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        credentials: "include",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      log.debug("Response:", {
        url,
        status: response.status,
        ok: response.ok,
      });

      return response;
    } catch (error: unknown) {
      clearTimeout(timeoutId);

      if ((error as Error).name === "AbortError") {
        throw new Error(
          "Request timeout - backend may be starting up. Please try again."
        );
      }

      if (typeof navigator !== "undefined" && !navigator.onLine) {
        throw new Error("No internet connection. Please check your network.");
      }

      throw error;
    }
  }

  private async refreshAccessToken(): Promise<boolean> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.doRefreshToken();
    const result = await this.refreshPromise;
    this.refreshPromise = null;
    return result;
  }

  private async doRefreshToken(): Promise<boolean> {
    const isAuthenticated = this.tokenManager.isAuthenticated();
    if (!isAuthenticated) {
      log.debug("Not authenticated - skipping token refresh");
      return false;
    }

    // Authentication is Cognito-only: there is no backend password-refresh
    // endpoint to silently mint a new access token. A stale access token means
    // the session has truly expired, so clear local state and trigger the
    // session-expired handler, which routes the user back to the Cognito hosted
    // UI via /login. Always returns false — there is no refreshed token.
    log.debug("No backend refresh under Cognito-only auth - session expired");
    this.tokenManager.clearTokens();
    // Mark handled so a concurrent/subsequent poll that also 401/403s does
    // not re-fire the session-expired path via `maybeHandleAuthRejection`.
    this.sessionExpiryHandled = true;
    if (this.onSessionExpired) {
      this.onSessionExpired();
    }
    return false;
  }

  /**
   * Helper method for GET requests
   */
  async get<T>(url: string, options?: HttpOptions): Promise<T> {
    const fullUrl = url.startsWith("http")
      ? url
      : `${ApiConfig.getBaseUrl()}${url}`;
    const response = await this.fetch(fullUrl, { ...options, method: "GET" });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`GET ${url} failed: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  /**
   * Helper method for POST requests
   */
  async post<T>(
    url: string,
    body?: unknown,
    options?: HttpOptions
  ): Promise<T> {
    const fullUrl = url.startsWith("http")
      ? url
      : `${ApiConfig.getBaseUrl()}${url}`;
    const response = await this.fetch(fullUrl, {
      ...options,
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`POST ${url} failed: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  /**
   * Helper method for PUT requests
   */
  async put<T>(url: string, body?: unknown, options?: HttpOptions): Promise<T> {
    const fullUrl = url.startsWith("http")
      ? url
      : `${ApiConfig.getBaseUrl()}${url}`;
    const response = await this.fetch(fullUrl, {
      ...options,
      method: "PUT",
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`PUT ${url} failed: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  /**
   * Helper method for PATCH requests
   */
  async patch<T>(
    url: string,
    body?: unknown,
    options?: HttpOptions
  ): Promise<T> {
    const fullUrl = url.startsWith("http")
      ? url
      : `${ApiConfig.getBaseUrl()}${url}`;
    const response = await this.fetch(fullUrl, {
      ...options,
      method: "PATCH",
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`PATCH ${url} failed: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  /**
   * Helper method for DELETE requests
   */
  async delete<T>(url: string, options?: HttpOptions): Promise<T> {
    const fullUrl = url.startsWith("http")
      ? url
      : `${ApiConfig.getBaseUrl()}${url}`;
    const response = await this.fetch(fullUrl, {
      ...options,
      method: "DELETE",
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(
        `DELETE ${url} failed: ${response.status} - ${errorText}`
      );
    }

    // DELETE may return 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json();
  }

  /**
   * Get the auth token (for use in manual fetch calls)
   */
  getAuthToken(): string | null {
    return this.tokenManager.getAccessToken();
  }

  /**
   * Get a token for authenticating browser WebSocket connections (passed as
   * the `?token=` query param — the backend's `get_current_user_from_ws`
   * verifies the SAME bearer the HTTP `Authorization` header carries).
   *
   * Source order matters because prod has two session shapes:
   * 1. Cognito hosted-UI sessions (the only prod login flow) keep the bearer
   *    in the token-storage layer and NEVER set the HttpOnly `access_token`
   *    cookie — for them the cookie-reading route 401s, so the client-held
   *    bearer must be used directly.
   * 2. Legacy cookie sessions have no client-readable token, so fall back to
   *    the same-origin `/api/v1/ws-token` Next.js route, which echoes the
   *    HttpOnly cookie. (Same-origin ONLY — the route has no backend
   *    counterpart; prefixing it with API_BASE_URL 404s cross-origin.)
   */
  async getWebSocketToken(): Promise<string | null> {
    const bearer = this.tokenManager.getAccessToken();
    if (bearer && !this.tokenManager.isAccessTokenExpired()) {
      return bearer;
    }

    try {
      const response = await this.fetch("/api/v1/ws-token");
      if (!response.ok) {
        return null;
      }
      const data = (await response.json()) as { token?: string };
      return data.token ?? null;
    } catch {
      return null;
    }
  }
}
