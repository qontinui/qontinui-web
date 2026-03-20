import { TokenResponse } from "@/types/auth-types";
import { TokenManager } from "./token-manager";
import { ApiConfig } from "../api-config";
import { createLogger } from "@/lib/logger";

const log = createLogger("TokenRefresh");

/**
 * TokenRefreshService - Single Responsibility: Handle token refresh logic
 * Manages refresh token requests and prevents duplicate refresh attempts
 *
 * Token Refresh Strategy (Aligned with Backend):
 * - Backend sliding window middleware handles proactive token refresh (5min threshold)
 * - Frontend only refreshes reactively on 401 responses or explicit calls
 * - This prevents race conditions where both frontend and backend try to refresh simultaneously
 * - refreshAccessToken() should only be called:
 *   1. In response to 401 errors (reactive refresh)
 *   2. By explicit user actions (e.g., logout, manual refresh)
 * - Do NOT call proactively based on token expiry time
 */
export class TokenRefreshService {
  private tokenManager: TokenManager;
  private refreshPromise: Promise<boolean> | null = null;

  constructor(tokenManager: TokenManager) {
    this.tokenManager = tokenManager;
  }

  /**
   * Refresh access token using refresh token
   * Prevents multiple simultaneous refresh attempts
   *
   * Token Refresh Strategy (Aligned with Backend):
   * - This method should ONLY be called reactively (on 401 errors) or explicitly by user actions
   * - Do NOT call proactively based on token expiry time
   * - Backend sliding window middleware handles proactive refresh (5min threshold)
   * - Calling this proactively creates race conditions with backend middleware
   *
   * HttpOnly Cookie Security (Migration Complete):
   * - Backend reads refresh_token from cookie for authentication
   * - Browser automatically sends refresh_token cookie with credentials: 'include'
   * - No request body needed (tokens are in HttpOnly cookies)
   * - Backend sets new access_token and refresh_token as HttpOnly cookies
   * - Frontend stores ONLY expiry timestamps (not actual tokens)
   */
  async refreshAccessToken(): Promise<boolean> {
    // Prevent multiple simultaneous refresh attempts
    if (this.refreshPromise) {
      log.debug("Refresh already in progress, waiting...");
      return this.refreshPromise;
    }

    this.refreshPromise = this.performRefresh();
    const result = await this.refreshPromise;
    this.refreshPromise = null;
    return result;
  }

  /**
   * Perform the actual refresh operation
   *
   * HttpOnly Cookie Security (Migration Complete):
   * - Backend reads refresh_token from cookie for authentication
   * - Browser automatically sends refresh_token cookie with credentials: 'include'
   * - Frontend stores ONLY expiry timestamps from response (not actual tokens)
   * - Actual tokens never sent in request body or Authorization header
   */
  private async performRefresh(): Promise<boolean> {
    try {
      log.debug("Attempting token refresh");

      // Send refresh token in request body (in-memory) and also via cookie (fallback).
      // Backend checks cookie first, then falls back to request body.
      const refreshToken = this.tokenManager.getRefreshToken();
      const body = refreshToken
        ? JSON.stringify({ refresh_token: refreshToken })
        : undefined;

      const response = await fetch(ApiConfig.AUTH_REFRESH, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body,
      });

      if (response.ok) {
        const tokens: TokenResponse = await response.json();
        log.debug("Token refresh successful");

        // Store tokens in memory (for Authorization header) and expiry in localStorage
        this.tokenManager.setTokens(tokens);
        return true;
      } else {
        const errorText = await response.text();
        log.error("Token refresh failed:", response.status, errorText);

        // If refresh token is invalid (401/403), clear tokens and trigger session expiry
        // This means the session has truly expired and user needs to log in again
        if (response.status === 401 || response.status === 403) {
          log.warn("Refresh token invalid (401/403) - session expired");
          this.tokenManager.clearTokens();

          // Dispatch session-expired event to trigger redirect to landing page
          if (typeof window !== "undefined") {
            log.debug("Dispatching session-expired event");
            window.dispatchEvent(new CustomEvent("session-expired"));
          }
        } else {
          // For other errors (server issues, network), keep tokens and allow retry
          log.warn(
            "Refresh failed but keeping tokens - may be temporary server issue"
          );
        }

        return false;
      }
    } catch (error) {
      log.error(
        "Token refresh error:",
        error instanceof Error ? error.message : String(error)
      );
      log.warn("Network error during refresh - keeping tokens for retry");
      return false;
    }
  }

  /**
   * Check if refresh is currently in progress
   */
  isRefreshing(): boolean {
    return this.refreshPromise !== null;
  }
}
