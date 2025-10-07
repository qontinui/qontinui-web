import { TokenResponse } from '@/types/auth-types';
import { TokenManager } from './token-manager';

/**
 * TokenRefreshService - Single Responsibility: Handle token refresh logic
 * Manages refresh token requests and prevents duplicate refresh attempts
 */
export class TokenRefreshService {
  private tokenManager: TokenManager;
  private apiUrl: string;
  private refreshPromise: Promise<boolean> | null = null;

  constructor(tokenManager: TokenManager, apiUrl: string) {
    this.tokenManager = tokenManager;
    this.apiUrl = apiUrl;
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
      console.log('[TokenRefreshService] Attempting to refresh token at:', `${this.apiUrl}/api/v1/auth/refresh`);

      const response = await fetch(`${this.apiUrl}/api/v1/auth/refresh`, {
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
        console.error('[TokenRefreshService] ❌ Token refresh FAILED - will clear tokens:', {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error('[TokenRefreshService] ❌ Token refresh error (network/exception) - will clear tokens:', {
        error,
        timestamp: new Date().toISOString(),
      });
    }

    console.error('[TokenRefreshService] ⚠️ Token refresh failed - CLEARING TOKENS NOW');
    this.tokenManager.clearTokens();
    return false;
  }

  /**
   * Check if refresh is currently in progress
   */
  isRefreshing(): boolean {
    return this.refreshPromise !== null;
  }
}
