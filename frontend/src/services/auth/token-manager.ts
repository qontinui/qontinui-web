import { TokenResponse } from '@/types/auth-types';
import { TokenStorage } from './token-storage';
import { TokenValidator } from './token-validator';

/**
 * TokenManager - Single Responsibility: Coordinate token operations
 * Orchestrates token storage, validation, and provides a simple API
 * This is a facade that delegates to specialized services
 */
export class TokenManager {
  private storage: TokenStorage;
  private validator: TokenValidator;

  constructor(storage: TokenStorage, validator: TokenValidator) {
    this.storage = storage;
    this.validator = validator;

    console.log('[TokenManager] Initializing TokenManager', {
      timestamp: new Date().toISOString(),
      stackTrace: new Error().stack?.split('\n').slice(1, 6).join('\n'),
    });
    this.logCurrentState();
  }

  /**
   * Store new tokens
   */
  setTokens(tokens: TokenResponse): void {
    const expiry = this.validator.extractExpiry(tokens.access_token);

    console.log('[TokenManager] Setting new tokens:', {
      timestamp: new Date().toISOString(),
      hasAccessToken: !!tokens.access_token,
      hasRefreshToken: !!tokens.refresh_token,
      accessTokenPreview: tokens.access_token ? tokens.access_token.substring(0, 20) + '...' : 'none',
      expiry: expiry ? new Date(expiry).toISOString() : 'unknown',
      stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n'),
    });

    this.storage.saveAccessToken(tokens.access_token);
    this.storage.saveRefreshToken(tokens.refresh_token);
    if (expiry) {
      this.storage.saveTokenExpiry(expiry);
    }
  }

  /**
   * Clear all tokens
   */
  clearTokens(): void {
    const hadAccessToken = !!this.storage.getAccessToken();
    const hadRefreshToken = !!this.storage.getRefreshToken();
    const clearEvent = {
      timestamp: new Date().toISOString(),
      hadAccessToken,
      hadRefreshToken,
      stackTrace: new Error().stack,
    };

    console.error('[TokenManager] ⚠️ CLEARING ALL TOKENS ⚠️', clearEvent);

    // Store clear event in localStorage for debugging across page refreshes
    if (typeof window !== 'undefined') {
      try {
        const recentClears = JSON.parse(localStorage.getItem('debug_token_clears') || '[]');
        recentClears.push(clearEvent);
        // Keep only last 10 clear events
        if (recentClears.length > 10) recentClears.shift();
        localStorage.setItem('debug_token_clears', JSON.stringify(recentClears));
      } catch (e) {
        console.error('[TokenManager] Failed to store clear event:', e);
      }
    }

    this.storage.clearAll();
  }

  /**
   * Get current access token
   */
  getAccessToken(): string | null {
    const token = this.storage.getAccessToken();
    if (!token) {
      console.log('[TokenManager] getAccessToken called but no token available');
    }
    return token;
  }

  /**
   * Get current refresh token
   */
  getRefreshToken(): string | null {
    const token = this.storage.getRefreshToken();
    if (!token) {
      console.log('[TokenManager] getRefreshToken called but no token available');
    }
    return token;
  }

  /**
   * Get token expiry timestamp
   */
  getTokenExpiry(): number | null {
    return this.storage.getTokenExpiry();
  }

  /**
   * Check if we have a valid session
   */
  hasValidToken(): boolean {
    const accessToken = this.storage.getAccessToken();
    const refreshToken = this.storage.getRefreshToken();
    const expiry = this.storage.getTokenExpiry();

    const hasAccessToken = !!accessToken;
    const hasRefreshToken = !!refreshToken;

    const isValid = this.validator.hasValidSession(hasAccessToken, hasRefreshToken, expiry);
    this.validator.logValidation(hasAccessToken, hasRefreshToken, expiry);

    return isValid;
  }

  /**
   * Check if access token is expired
   */
  isAccessTokenExpired(): boolean {
    const expiry = this.storage.getTokenExpiry();
    if (!expiry) return true;
    return this.validator.isTokenExpired(expiry);
  }

  /**
   * Check if access token will expire soon
   */
  isAccessTokenExpiringSoon(thresholdMs: number = 60000): boolean {
    const expiry = this.storage.getTokenExpiry();
    if (!expiry) return false;
    return this.validator.isTokenExpiringSoon(expiry, thresholdMs);
  }

  /**
   * Get time until access token expires
   */
  getTimeUntilExpiry(): number {
    const expiry = this.storage.getTokenExpiry();
    if (!expiry) return 0;
    return this.validator.getTimeUntilExpiry(expiry);
  }

  /**
   * Log current token state for debugging
   */
  private logCurrentState(): void {
    const accessToken = this.storage.getAccessToken();
    const refreshToken = this.storage.getRefreshToken();
    const expiry = this.storage.getTokenExpiry();

    console.log('[TokenManager] Loaded tokens from storage:', {
      hasAccessToken: !!accessToken,
      hasRefreshToken: !!refreshToken,
      accessTokenPreview: accessToken ? accessToken.substring(0, 20) + '...' : 'none',
      refreshTokenPreview: refreshToken ? refreshToken.substring(0, 20) + '...' : 'none',
      expiry: expiry ? new Date(expiry).toISOString() : 'none',
      expiryRaw: expiry,
      storageKeys: this.storage.getAllStorageKeys(),
    });

    // Display recent token clear events for debugging
    if (typeof window !== 'undefined') {
      try {
        const recentClears = JSON.parse(localStorage.getItem('debug_token_clears') || '[]');
        if (recentClears.length > 0) {
          console.warn('[TokenManager] 📜 Recent token clear history:', recentClears);
          console.warn(`[TokenManager] Found ${recentClears.length} recent token clear event(s). Last clear:`, recentClears[recentClears.length - 1]);
        }
      } catch (e) {
        // Ignore parsing errors
      }
    }
  }
}
