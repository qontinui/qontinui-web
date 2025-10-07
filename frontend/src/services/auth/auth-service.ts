import { TokenResponse, LoginRequest, RegisterRequest, User } from '@/types/auth-types';
import { TokenManager } from './token-manager';
import { TokenRefreshService } from './token-refresh-service';

/**
 * AuthService - Single Responsibility: Handle authentication operations
 * Manages login, logout, registration, and user information
 * Delegates token management and refresh to specialized services
 */
export class AuthService {
  public tokenManager: TokenManager;
  private refreshService: TokenRefreshService;
  private apiUrl: string;

  constructor(tokenManager: TokenManager, refreshService: TokenRefreshService, apiUrl: string) {
    this.tokenManager = tokenManager;
    this.refreshService = refreshService;
    this.apiUrl = apiUrl;
  }

  /**
   * Login user with credentials
   */
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

  /**
   * Register new user
   */
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

  /**
   * Logout user
   */
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
      console.error('[AuthService] Logout request failed:', error);
    } finally {
      this.tokenManager.clearTokens();
    }
  }

  /**
   * Get current authenticated user
   */
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

  /**
   * Refresh access token
   */
  async refreshAccessToken(): Promise<boolean> {
    return this.refreshService.refreshAccessToken();
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return this.tokenManager.hasValidToken();
  }

  /**
   * Check if access token is expired
   */
  isAccessTokenExpired(): boolean {
    return this.tokenManager.isAccessTokenExpired();
  }

  /**
   * Check if access token will expire soon
   */
  isAccessTokenExpiringSoon(thresholdMs?: number): boolean {
    return this.tokenManager.isAccessTokenExpiringSoon(thresholdMs);
  }
}
