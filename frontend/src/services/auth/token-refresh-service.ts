import { TokenResponse } from '@/types/auth-types';
import { TokenManager } from './token-manager';
import { ApiConfig } from '../api-config';

/**
 * TokenRefreshService - Single Responsibility: Handle token refresh logic
 * Manages refresh token requests and prevents duplicate refresh attempts
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
   */
  private async performRefresh(): Promise<boolean> {
    const refreshToken = this.tokenManager.getRefreshToken();

    if (!refreshToken) {
      console.warn('[TokenRefreshService] No refresh token available - cannot refresh');
      return false;
    }

    try {
      console.log('[TokenRefreshService] Attempting to refresh token at:', ApiConfig.AUTH_REFRESH);

      const response = await fetch(ApiConfig.AUTH_REFRESH, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ refresh_token: refreshToken }),
      });

      console.log('[TokenRefreshService] Token refresh response status:', response.status);

      if (response.ok) {
        const tokens: TokenResponse = await response.json();
        console.log('[TokenRefreshService] ✅ Token refresh successful, setting new tokens');
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
