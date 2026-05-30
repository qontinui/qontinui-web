import { TokenManager } from "./auth/token-manager";
import { ApiConfig } from "./api-config";
import { csrfService } from "./csrf-service";
import { RetryStrategy } from "./retry-strategy";
import { createLogger } from "@/lib/logger";

const log = createLogger("HttpClient");

export interface HttpOptions extends RequestInit {
  skipAuth?: boolean;
  maxRetries?: number;
}

export class HttpClient {
  private tokenManager: TokenManager;
  private retryStrategy: RetryStrategy;
  private refreshPromise: Promise<boolean> | null = null;
  private onSessionExpired?: () => void;

  constructor(tokenManager: TokenManager, retryStrategy?: RetryStrategy) {
    this.tokenManager = tokenManager;
    this.retryStrategy = retryStrategy || new RetryStrategy();
  }

  setSessionExpiredHandler(handler: () => void): void {
    this.onSessionExpired = handler;
  }

  async fetch(url: string, options: HttpOptions = {}): Promise<Response> {
    const { skipAuth = false, maxRetries = 3, ...fetchOptions } = options;

    // Override retry strategy max retries if specified
    if (maxRetries !== 3) {
      this.retryStrategy = new RetryStrategy({ maxRetries });
    }

    return this.executeRequestWithRetry(url, fetchOptions, skipAuth);
  }

  private async executeRequestWithRetry(
    url: string,
    options: RequestInit,
    skipAuth: boolean,
    attempt: number = 1
  ): Promise<Response> {
    // Execute single request
    const response = await this.executeSingleRequest(url, options, skipAuth);

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
        return this.executeSingleRequest(url, options, skipAuth);
      }
      // Token refresh failed. Do NOT auto-logout here — `doRefreshToken`
      // already fires `session-expired` when the refresh token itself is
      // invalid; a transient refresh failure should leave the user signed in.
      console.warn(
        "[HttpClient] Token refresh failed - returning 401 response without auto-logout"
      );
      return response;
    }

    // Use RetryStrategy for rate limiting and server errors
    if (response.status === 429 || response.status >= 500) {
      return this.retryStrategy.executeWithRetry(
        () => this.executeSingleRequest(url, options, skipAuth),
        attempt
      );
    }

    return response;
  }

  private async executeSingleRequest(
    url: string,
    options: RequestInit,
    skipAuth: boolean
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

    // Add CSRF token for state-changing requests
    const csrfToken = csrfService.getToken();
    if (
      csrfToken &&
      ["POST", "PUT", "DELETE", "PATCH"].includes(options.method || "GET")
    ) {
      headers["X-CSRF-Token"] = csrfToken;
    }

    const controller = new AbortController();
    // 60 second timeout to handle backend cold starts (can take 10-15 seconds)
    const timeoutId = setTimeout(() => controller.abort(), 60000);

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
}
