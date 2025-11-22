import { TokenResponse } from '@/types/auth-types';
import { TokenManager } from './token-manager';
import { ApiConfig } from '../api-config';

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
    console.log('[TokenRefreshService] refreshAccessToken called:', {
      timestamp: new Date().toISOString(),
      stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n'),
    });

    // Prevent multiple simultaneous refresh attempts
    if (this.refreshPromise) {
      console.log('[TokenRefreshService] Refresh already in progress, waiting...');
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
      console.log('[TokenRefreshService] Attempting to refresh token at:', ApiConfig.AUTH_REFRESH);
      console.log('[TokenRefreshService] Using HttpOnly cookie authentication');

      const response = await fetch(ApiConfig.AUTH_REFRESH, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Critical: Sends refresh_token cookie for authentication
      });

      console.log('[TokenRefreshService] Token refresh response status:', response.status);

      if (response.ok) {
        const tokens: TokenResponse = await response.json();
        console.log('[TokenRefreshService] ✅ Token refresh successful');

        // Store expiry timestamps and authentication state (not actual tokens)
        // Backend sets new HttpOnly cookies automatically
        // TokenStorage.saveAccessToken() and saveRefreshToken() are now NO-OPs
        this.tokenManager.setTokens(tokens);
        return true;
      } else {
        const errorText = await response.text();
        console.error('[TokenRefreshService] ❌ Token refresh FAILED:', {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
          timestamp: new Date().toISOString(),
          url: ApiConfig.AUTH_REFRESH,
        });

        // If refresh token is invalid (401/403), clear tokens and trigger session expiry
        // This means the session has truly expired and user needs to log in again
        if (response.status === 401 || response.status === 403) {
          console.error('[TokenRefreshService] ⚠️ Refresh token is invalid (401/403) - session expired');
          this.tokenManager.clearTokens();

          // Dispatch session-expired event to trigger redirect to landing page
          if (typeof window !== 'undefined') {
            console.log('[TokenRefreshService] Dispatching session-expired event');
            window.dispatchEvent(new CustomEvent('session-expired'));
          }
        } else {
          // For other errors (server issues, network), keep tokens and allow retry
          console.warn('[TokenRefreshService] ⚠️ Refresh failed but keeping tokens - may be temporary server issue');
        }

        return false;
      }
    } catch (error) {
      console.error('[TokenRefreshService] ❌ Token refresh error (network/exception):', {
        error,
        errorMessage: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
        url: ApiConfig.AUTH_REFRESH,
      });

      // DON'T clear tokens on network errors - keep tokens for retry
      console.warn('[TokenRefreshService] ⚠️ Network error during refresh - keeping tokens for retry');
      return false;
    }

    // This line should never be reached now
    return false;
  }

  /**
   * Check if refresh is currently in progress
   */
  isRefreshing(): boolean {
    return this.refreshPromise !== null;
  }
}
