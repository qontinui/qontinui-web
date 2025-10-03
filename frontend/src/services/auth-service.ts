import { TokenResponse, LoginRequest, RegisterRequest, User } from '@/types/auth-types';
import { TokenManager } from './token-manager';
import { ApiConfig } from './api-config';

export class AuthService {
  public tokenManager: TokenManager;
  private apiUrl: string;

  constructor(tokenManager: TokenManager, apiUrl: string) {
    this.tokenManager = tokenManager;
    this.apiUrl = apiUrl;
  }

  async login(credentials: LoginRequest): Promise<User> {
    const formData = new URLSearchParams();
    formData.append('username', credentials.username);
    formData.append('password', credentials.password);

    console.log('[AuthService] Attempting login to:', `${this.apiUrl}/api/v1/auth/login`);

    const response = await fetch(`${this.apiUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData,
      credentials: 'include',
    });

    console.log('[AuthService] Login response status:', response.status);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Login failed');
    }

    const tokens: TokenResponse = await response.json();
    this.tokenManager.setTokens(tokens);

    return this.getCurrentUser();
  }

  async register(data: RegisterRequest): Promise<User> {
    const response = await fetch(`${this.apiUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Registration failed');
    }

    return response.json();
  }

  async logout(): Promise<void> {
    try {
      const accessToken = this.tokenManager.getAccessToken();
      if (accessToken) {
        await fetch(`${this.apiUrl}/api/v1/auth/logout`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          credentials: 'include',
        });
      }
    } catch (error) {
      console.error('Logout request failed:', error);
    } finally {
      this.tokenManager.clearTokens();
    }
  }

  async getCurrentUser(): Promise<User> {
    const accessToken = this.tokenManager.getAccessToken();
    console.log('[AuthService] Getting current user from:', `${this.apiUrl}/api/v1/users/me`);
    console.log('[AuthService] Access token:', accessToken?.substring(0, 20) + '...');

    const response = await fetch(`${this.apiUrl}/api/v1/users/me`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    });

    console.log('[AuthService] getCurrentUser response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[AuthService] getCurrentUser error response:', errorText);
      throw new Error(`Failed to get user info: ${response.status} - ${errorText}`);
    }

    const user = await response.json();
    console.log('[AuthService] Current user:', user);
    return user;
  }

  async refreshAccessToken(): Promise<boolean> {
    console.log('[AuthService] refreshAccessToken called:', {
      timestamp: new Date().toISOString(),
      stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n'),
    });

    const refreshToken = this.tokenManager.getRefreshToken();
    if (!refreshToken) {
      console.warn('[AuthService] No refresh token available - cannot refresh');
      return false;
    }

    try {
      console.log('[AuthService] Attempting to refresh token at:', `${this.apiUrl}/api/v1/auth/refresh`);

      const response = await fetch(`${this.apiUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ refresh_token: refreshToken }),
      });

      console.log('[AuthService] Token refresh response status:', response.status);

      if (response.ok) {
        const tokens: TokenResponse = await response.json();
        console.log('[AuthService] Token refresh successful, setting new tokens');
        this.tokenManager.setTokens(tokens);
        return true;
      } else {
        const errorText = await response.text();
        console.error('[AuthService] Token refresh failed:', {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        });
      }
    } catch (error) {
      console.error('[AuthService] Token refresh error (network/exception):', error);
    }

    console.warn('[AuthService] Token refresh failed - clearing tokens');
    this.tokenManager.clearTokens();
    return false;
  }

  isAuthenticated(): boolean {
    return this.tokenManager.hasValidToken();
  }
}
