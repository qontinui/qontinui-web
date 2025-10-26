/**
 * TokenStorage - Single Responsibility: Persist and retrieve tokens from localStorage
 * Handles all localStorage interactions for authentication tokens
 */
export class TokenStorage {
  private readonly ACCESS_TOKEN_KEY = 'access_token';
  private readonly REFRESH_TOKEN_KEY = 'refresh_token';
  private readonly TOKEN_EXPIRY_KEY = 'token_expiry';
  private readonly REFRESH_TOKEN_EXPIRY_KEY = 'refresh_token_expiry';

  saveAccessToken(token: string): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(this.ACCESS_TOKEN_KEY, token);
    console.log('[TokenStorage] Access token saved to localStorage');
  }

  saveRefreshToken(token: string): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(this.REFRESH_TOKEN_KEY, token);
    console.log('[TokenStorage] Refresh token saved to localStorage');
  }

  saveTokenExpiry(expiry: number): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(this.TOKEN_EXPIRY_KEY, expiry.toString());
    console.log('[TokenStorage] Token expiry saved:', new Date(expiry).toISOString());
  }

  getAccessToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(this.ACCESS_TOKEN_KEY);
  }

  getRefreshToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(this.REFRESH_TOKEN_KEY);
  }

  getTokenExpiry(): number | null {
    if (typeof window === 'undefined') return null;
    const expiry = localStorage.getItem(this.TOKEN_EXPIRY_KEY);
    return expiry ? parseInt(expiry) : null;
  }

  saveRefreshTokenExpiry(expiry: number): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(this.REFRESH_TOKEN_EXPIRY_KEY, expiry.toString());
    console.log('[TokenStorage] Refresh token expiry saved:', new Date(expiry).toISOString());
  }

  getRefreshTokenExpiry(): number | null {
    if (typeof window === 'undefined') return null;
    const expiry = localStorage.getItem(this.REFRESH_TOKEN_EXPIRY_KEY);
    return expiry ? parseInt(expiry) : null;
  }

  clearAll(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(this.ACCESS_TOKEN_KEY);
    localStorage.removeItem(this.REFRESH_TOKEN_KEY);
    localStorage.removeItem(this.TOKEN_EXPIRY_KEY);
    localStorage.removeItem(this.REFRESH_TOKEN_EXPIRY_KEY);
    console.error('[TokenStorage] All tokens cleared from localStorage');
  }

  getAllStorageKeys(): string[] {
    if (typeof window === 'undefined') return [];
    return Object.keys(localStorage);
  }
}
