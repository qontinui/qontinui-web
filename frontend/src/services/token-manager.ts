import { TokenResponse } from '@/types/auth-types';

export class TokenManager {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiry: number | null = null;

  constructor() {
    console.log('[TokenManager] Initializing TokenManager');
    if (typeof window !== 'undefined') {
      this.loadTokensFromStorage();
    } else {
      console.log('[TokenManager] Skipping token load - window not available (SSR)');
    }
  }

  private loadTokensFromStorage(): void {
    this.accessToken = localStorage.getItem('access_token');
    this.refreshToken = localStorage.getItem('refresh_token');
    const expiryStr = localStorage.getItem('token_expiry');
    this.tokenExpiry = expiryStr ? parseInt(expiryStr) : null;

    console.log('[TokenManager] Loaded tokens from localStorage:', {
      hasAccessToken: !!this.accessToken,
      hasRefreshToken: !!this.refreshToken,
      accessTokenPreview: this.accessToken ? this.accessToken.substring(0, 20) + '...' : 'none',
      expiry: this.tokenExpiry ? new Date(this.tokenExpiry).toISOString() : 'none',
    });
  }

  private decodeTokenExpiry(token: string): number | null {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.exp ? payload.exp * 1000 : null; // Convert to milliseconds
    } catch (error) {
      console.error('[TokenManager] Failed to decode token expiry:', error);
      return null;
    }
  }

  setTokens(tokens: TokenResponse): void {
    const expiry = this.decodeTokenExpiry(tokens.access_token);

    console.log('[TokenManager] Setting new tokens:', {
      timestamp: new Date().toISOString(),
      hasAccessToken: !!tokens.access_token,
      hasRefreshToken: !!tokens.refresh_token,
      accessTokenPreview: tokens.access_token ? tokens.access_token.substring(0, 20) + '...' : 'none',
      expiry: expiry ? new Date(expiry).toISOString() : 'unknown',
      stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n'), // Show caller
    });

    this.accessToken = tokens.access_token;
    this.refreshToken = tokens.refresh_token;
    this.tokenExpiry = expiry;

    if (typeof window !== 'undefined') {
      localStorage.setItem('access_token', tokens.access_token);
      localStorage.setItem('refresh_token', tokens.refresh_token);
      if (expiry) {
        localStorage.setItem('token_expiry', expiry.toString());
      }
      console.log('[TokenManager] Tokens saved to localStorage');
    } else {
      console.warn('[TokenManager] Cannot save tokens - window not available');
    }
  }

  clearTokens(): void {
    console.warn('[TokenManager] CLEARING ALL TOKENS:', {
      timestamp: new Date().toISOString(),
      hadAccessToken: !!this.accessToken,
      hadRefreshToken: !!this.refreshToken,
      stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n'), // Show caller
    });

    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = null;

    if (typeof window !== 'undefined') {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('token_expiry');
      console.log('[TokenManager] Tokens removed from localStorage');
    }
  }

  getAccessToken(): string | null {
    const token = this.accessToken;
    if (!token) {
      console.log('[TokenManager] getAccessToken called but no token available');
    }
    return token;
  }

  getRefreshToken(): string | null {
    const token = this.refreshToken;
    if (!token) {
      console.log('[TokenManager] getRefreshToken called but no token available');
    }
    return token;
  }

  hasValidToken(): boolean {
    const hasToken = !!this.accessToken;
    const now = Date.now();
    const isExpired = this.tokenExpiry ? now >= this.tokenExpiry : false;
    const isValid = hasToken && !isExpired;

    console.log('[TokenManager] hasValidToken check:', {
      hasToken,
      isExpired,
      isValid,
      expiry: this.tokenExpiry ? new Date(this.tokenExpiry).toISOString() : 'none',
      now: new Date(now).toISOString(),
    });

    return isValid;
  }
}
