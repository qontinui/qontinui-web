import { TokenResponse, LoginRequest, RegisterRequest, User } from '@/types/auth-types';
import { TokenManager } from './token-manager';
import { TokenRefreshService } from './token-refresh-service';
import { ApiConfig } from '../api-config';

/**
 * Map backend error codes to user-friendly messages
 */
function getFriendlyErrorMessage(errorCode: string): string {
  const errorMessages: Record<string, string> = {
    'REGISTER_USER_ALREADY_EXISTS': 'This email is already registered. Please use a different email or try logging in.',
    'LOGIN_BAD_CREDENTIALS': 'Invalid username or password. Please try again.',
    'LOGIN_USER_NOT_VERIFIED': 'Please verify your email address before logging in.',
    'VALIDATION_ERROR': 'Please check your input and try again.',
  };

  return errorMessages[errorCode] || errorCode;
}

/**
 * AuthService - Single Responsibility: Handle authentication operations
 * Manages login, logout, registration, and user information
 * Delegates token management and refresh to specialized services
 */
export class AuthService {
  public tokenManager: TokenManager;
  private refreshService: TokenRefreshService;

  constructor(tokenManager: TokenManager, refreshService: TokenRefreshService) {
    this.tokenManager = tokenManager;
    this.refreshService = refreshService;
  }

  /**
   * Login user with credentials
   */
  async login(credentials: LoginRequest): Promise<User> {
    const formData = new URLSearchParams();
    formData.append('username', credentials.username);
    formData.append('password', credentials.password);

    console.log('[AuthService] Attempting login to:', ApiConfig.AUTH_LOGIN);
    console.log('[AuthService] Remember me:', credentials.remember_me);

    // Add remember_me as query parameter
    const url = new URL(ApiConfig.AUTH_LOGIN);
    if (credentials.remember_me) {
      url.searchParams.append('remember_me', 'true');
    }

    const response = await fetch(url.toString(), {
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
      const errorMessage = error.message || error.detail || 'Login failed';
      throw new Error(getFriendlyErrorMessage(errorMessage));
    }

    const tokens: TokenResponse = await response.json();
    this.tokenManager.setTokens(tokens);

    return this.getCurrentUser();
  }

  /**
   * Register new user
   */
  async register(data: RegisterRequest): Promise<User> {
    const response = await fetch(ApiConfig.AUTH_REGISTER, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json();
      const errorMessage = error.message || error.detail || 'Registration failed';
      throw new Error(getFriendlyErrorMessage(errorMessage));
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
        await fetch(ApiConfig.AUTH_LOGOUT, {
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
    console.log('[AuthService] Getting current user from:', ApiConfig.USERS_ME);
    console.log('[AuthService] Access token:', accessToken?.substring(0, 20) + '...');

    const response = await fetch(ApiConfig.USERS_ME, {
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
