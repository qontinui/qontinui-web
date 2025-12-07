import { TokenManager } from "./auth/token-manager";
import { ApiConfig } from "./api-config";
import { csrfService } from "./csrf-service";
import { RetryStrategy } from "./retry-strategy";

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

    // Handle 401 Unauthorized with token refresh
    if (response.status === 401 && !skipAuth && attempt === 1) {
      console.warn("[HttpClient] Received 401, attempting token refresh...");
      const refreshed = await this.refreshAccessToken();
      if (refreshed) {
        console.log("[HttpClient] Token refresh successful, retrying request");
        return this.executeSingleRequest(url, options, skipAuth);
      } else {
        // DISABLED: Automatic logout on 401
        // Users should be able to stay logged in even if some API calls fail
        console.warn(
          "[HttpClient] Token refresh failed - returning 401 response without auto-logout"
        );
        return response;

        // Original auto-logout logic (disabled):
        // Only trigger session expired if we truly have no valid tokens
        // const hasRefreshToken = !!this.tokenManager.getRefreshToken();
        // if (!hasRefreshToken && this.onSessionExpired) {
        //   console.error('[HttpClient] No refresh token available - session truly expired');
        //   this.onSessionExpired();
        // } else {
        //   console.warn('[HttpClient] Token refresh failed but still have refresh token - may be temporary issue');
        // }
        // return response;
      }
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
      console.log("[HttpClient] executeSingleRequest:", {
        url,
        method: options.method || "GET",
        skipAuth,
        hasAccessToken: !!accessToken,
        accessTokenLength: accessToken?.length || 0,
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

      // Debug logging for response
      console.log("[HttpClient] Response:", {
        url,
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
      });

      return response;
    } catch (error: any) {
      clearTimeout(timeoutId);

      if (error.name === "AbortError") {
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
    const refreshToken = this.tokenManager.getRefreshToken();
    if (!refreshToken) return false;

    try {
      console.log("[HttpClient] Refreshing token at:", ApiConfig.AUTH_REFRESH);

      const response = await fetch(ApiConfig.AUTH_REFRESH, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ refresh_token: refreshToken }),
      });

      if (response.ok) {
        const tokens = await response.json();
        console.log("[HttpClient] Token refresh successful");
        this.tokenManager.setTokens(tokens);
        return true;
      } else {
        console.error(
          "[HttpClient] Token refresh failed with status:",
          response.status
        );

        // If refresh token is invalid (401/403), session has truly expired
        if (response.status === 401 || response.status === 403) {
          console.error(
            "[HttpClient] Refresh token is invalid - triggering session expiry"
          );
          this.tokenManager.clearTokens();

          // Trigger session expired handler (which dispatches the event)
          if (this.onSessionExpired) {
            this.onSessionExpired();
          }
        } else {
          // For other errors, keep tokens and allow retry
          console.warn(
            "[HttpClient] Refresh failed but keeping tokens - may be temporary server issue"
          );
        }
      }
    } catch (error) {
      console.error("[HttpClient] Failed to refresh token:", error);
      // Network errors - keep tokens for retry
      console.warn(
        "[HttpClient] Network error during refresh - keeping tokens for retry"
      );
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
