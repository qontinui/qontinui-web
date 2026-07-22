import { TokenManager } from "./auth/token-manager";
import {
  TokenRefreshService,
  type RefreshOutcome,
} from "./auth/token-refresh-service";
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
  // Device pair-code mint — the code's tenant is burned server-side from
  // the operator's coord identity, which honors this override (membership-
  // gated coord-side). Forwarding it lets a multi-tenant operator pair a
  // device to the tenant they've switched to, not just their home tenant.
  "/api/v1/devices/pair-codes",
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

/**
 * Consecutive 401/403s on a request replayed with a FRESHLY refreshed bearer
 * before the session is declared dead.
 *
 * The replay returns straight to the caller, bypassing the auth-rejection
 * block, so without a bound a token the backend keeps rejecting leaves every
 * caller getting a bare 401 forever with no teardown and no recovery. Two lets
 * a single racing/late-propagating token through while still terminating.
 */
const MAX_POST_REFRESH_UNAUTHORIZED = 2;

export class HttpClient {
  private tokenManager: TokenManager;
  private retryStrategy: RetryStrategy;
  private refreshService: TokenRefreshService;
  private onSessionExpired?: () => void;
  // Set once an auth rejection (401/403 with no usable token) has been
  // surfaced as a session-expiry, so concurrent polling loops that all
  // 401/403 within the same tick fire the redirect exactly once instead
  // of a storm of session-expired events.
  private sessionExpiryHandled = false;
  // Consecutive 401/403s seen on a replay performed with a freshly refreshed
  // bearer. Reset by any replay that is not an auth rejection.
  private postRefreshUnauthorizedCount = 0;

  constructor(
    tokenManager: TokenManager,
    retryStrategy?: RetryStrategy,
    refreshService?: TokenRefreshService
  ) {
    this.tokenManager = tokenManager;
    this.retryStrategy = retryStrategy || new RetryStrategy();
    // Injected by the ServiceFactory so the reactive (401) and proactive
    // (pre-expiry timer) refresh paths share ONE single-flight mutex and one
    // set of tokens. The fallback keeps standalone construction working; it
    // behaves identically, just without cross-path de-duplication.
    this.refreshService =
      refreshService || new TokenRefreshService(tokenManager);
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
    /**
     * Skip the "is the locally-held token unusable" clause. Set only by the
     * post-refresh-replay backstop, where the bearer IS locally fresh (we just
     * minted it) yet the backend keeps rejecting it — so the usual predicate
     * would never fire and the caller would 401 forever.
     */
    tokenKnownRejected = false,
  ): void {
    if (skipAuth) return;
    if (status !== 401 && status !== 403) return;
    if (this.sessionExpiryHandled) return;
    if (!this.hadSession()) return;

    const tokenUnusable =
      !this.tokenManager.getAccessToken() ||
      this.tokenManager.isAccessTokenExpired();
    if (!tokenUnusable && !tokenKnownRejected) return;

    this.sessionExpiryHandled = true;
    console.warn(
      `[HttpClient] ${status} with an expired/absent (or server-rejected) access ` +
        "token — treating as session expiry and halting (redirecting to re-auth) " +
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
    // service rejecting the call). Refreshing on those hammers the Cognito
    // token endpoint, and a rejected refresh escalates to a global
    // `session-expired` — falsely tearing the whole session down. (This was
    // the `strategy/mentions/unread` teardown.) So surface a valid-token 401
    // instead of refreshing.
    if (response.status === 401 && !skipAuth && attempt === 1) {
      // An anonymous visitor (no session evidence) gets the 401 returned
      // plainly — entering the refresh branch would print the misleading
      // "attempting token refresh…" warn and spend a refresh attempt on a
      // session that never existed.
      if (!this.hadSession()) {
        return response;
      }
      // "Past `exp`" is checked explicitly on top of the two TokenManager
      // predicates because neither covers it: `isAccessTokenExpired()` carries
      // TokenValidator's 5-minute clock-skew grace (so it stays false for five
      // minutes AFTER `exp`), and `isAccessTokenExpiringSoon()` requires time
      // REMAINING (`> 0`). Without this clause a 401 landing in that five-minute
      // gap was classified "still-valid token" and never refreshed — the exact
      // window in which the backend has already started rejecting the bearer.
      const expiry = this.tokenManager.getAccessTokenExpiry();
      const tokenStale =
        this.tokenManager.isAccessTokenExpired() ||
        this.tokenManager.isAccessTokenExpiringSoon() ||
        (expiry !== null && expiry <= Date.now());
      if (!tokenStale) {
        console.warn(
          "[HttpClient] 401 with a still-valid access token — treating as a feature/upstream error, not session expiry; not refreshing"
        );
        return response;
      }
      console.warn(
        "[HttpClient] Received 401 with a stale access token, attempting token refresh..."
      );
      const outcome = await this.attemptRefresh();

      if (outcome === "refreshed") {
        log.debug("Token refresh successful, retrying request");
        return this.replayAfterRefresh(url, options, skipAuth, timeoutMs);
      }

      if (outcome === "transient") {
        // The token endpoint could not be reached (offline / 5xx / 429). The
        // session is NOT known to be dead and the refresh service deliberately
        // kept the tokens, so surface the 401 to the caller and let a later
        // attempt recover instead of tearing a live session down on a blip.
        console.warn(
          "[HttpClient] token refresh failed transiently — surfacing the 401 " +
            "and leaving the session intact for a later attempt"
        );
        return response;
      }

      // "expired" (the Cognito refresh grant was authoritatively rejected, or
      // there was no refresh token to spend) or "not-authenticated" (no refresh
      // was even attempted, and nothing was cleared). Either way a stale-token
      // 401 that can't refresh is a dead session: halt and route to re-auth
      // once instead of letting the dashboard's polling loops retry-storm this
      // endpoint on every tick. (No-op when `attemptRefresh` already marked the
      // expiry handled — which it does NOT do for "not-authenticated", so that
      // path still fires the teardown exactly once here.)
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

  /**
   * Attempt a silent token refresh for a 401'd request.
   *
   * Delegates to the shared `TokenRefreshService`, which owns both the
   * single-flight mutex (so a burst of concurrent 401s from the dashboard's
   * polling loops spends the Cognito refresh token exactly once) and the
   * teardown when the refresh grant is authoritatively rejected.
   *
   * Returns the service's outcome, plus `"not-authenticated"` for the case
   * where no refresh was attempted at all.
   */
  private async attemptRefresh(): Promise<
    RefreshOutcome | "not-authenticated"
  > {
    if (!this.tokenManager.isAuthenticated()) {
      log.debug("Not authenticated - skipping token refresh");
      // Deliberately does NOT set `sessionExpiryHandled`: nothing was cleared
      // and no `session-expired` was dispatched on this path, so the caller
      // MUST be allowed to fall through to `maybeHandleAuthRejection()` and
      // fire the teardown once. Marking it handled here dead-ended the client
      // into "401ing forever, no teardown, no recovery" for the life of the
      // page — the flag is never reset.
      return "not-authenticated";
    }

    const outcome = await this.refreshService.refreshWithOutcome();
    if (outcome === "expired") {
      // The refresh service already cleared local tokens and dispatched
      // `session-expired` — the same event `onSessionExpired` would fan out —
      // so re-invoking the handler here would only double-fire it. Just mark
      // the expiry handled so a concurrent/subsequent poll that also 401/403s
      // doesn't re-enter the session-expired path via
      // `maybeHandleAuthRejection`.
      this.sessionExpiryHandled = true;
    }
    // "transient" is deliberately NOT marked handled: the session is still
    // alive, so a genuine expiry later on must still be able to announce itself.
    return outcome;
  }

  /**
   * Replay a request with the freshly refreshed bearer, bounding the case where
   * the backend rejects the new token too.
   *
   * The replay's response goes straight back to the caller (it must — a 200 is
   * the whole point), which means it bypasses the auth-rejection block. Without
   * this counter a token the backend keeps rejecting produces a bare 401 on
   * every call forever, with no teardown and no route back to re-auth.
   */
  private async replayAfterRefresh(
    url: string,
    options: RequestInit,
    skipAuth: boolean,
    timeoutMs: number
  ): Promise<Response> {
    const replay = await this.executeSingleRequest(
      url,
      options,
      skipAuth,
      timeoutMs
    );

    if (replay.status !== 401 && replay.status !== 403) {
      this.postRefreshUnauthorizedCount = 0;
      return replay;
    }

    this.postRefreshUnauthorizedCount++;
    if (this.postRefreshUnauthorizedCount >= MAX_POST_REFRESH_UNAUTHORIZED) {
      console.warn(
        `[HttpClient] ${this.postRefreshUnauthorizedCount} consecutive ${replay.status}s on a ` +
          "freshly refreshed bearer — treating as session expiry rather than " +
          "leaving the caller to 401 forever."
      );
      this.maybeHandleAuthRejection(replay.status, skipAuth, true);
    }
    return replay;
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
