import {
  TokenResponse,
  LoginRequest,
  RegisterRequest,
  User,
} from "@/types/auth-types";
import { TokenManager } from "./token-manager";
import { TokenRefreshService } from "./token-refresh-service";
import { ApiConfig } from "../api-config";

/**
 * Map backend error codes to user-friendly messages
 */
function getFriendlyErrorMessage(errorCode: string): string {
  const errorMessages: Record<string, string> = {
    REGISTER_USER_ALREADY_EXISTS:
      "This email is already registered. Please use a different email or try logging in.",
    LOGIN_BAD_CREDENTIALS: "Invalid username or password. Please try again.",
    LOGIN_USER_NOT_VERIFIED:
      "Please verify your email address before logging in.",
    VALIDATION_ERROR: "Please check your input and try again.",
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
   *
   * HttpOnly Cookie Security (Migration Complete):
   * - Backend sets access_token and refresh_token as HttpOnly cookies (XSS protection)
   * - Backend returns tokens in response body for expiry calculation
   * - Frontend stores ONLY expiry timestamps and auth flag (not actual tokens)
   * - Browser automatically sends cookies with credentials: 'include'
   * - Actual tokens never stored in localStorage (security best practice)
   */
  async login(credentials: LoginRequest): Promise<User> {
    const formData = new URLSearchParams();
    formData.append("username", credentials.username);
    formData.append("password", credentials.password);

    console.log("[AuthService] Attempting login to:", ApiConfig.AUTH_LOGIN);
    console.log("[AuthService] Remember me:", credentials.remember_me);

    // Add remember_me as query parameter
    let loginUrl = ApiConfig.AUTH_LOGIN;
    if (credentials.remember_me) {
      loginUrl += "?remember_me=true";
    }

    const response = await fetch(loginUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData,
      credentials: "include", // Critical: Allows cookies to be set
    });

    console.log("[AuthService] Login response status:", response.status);

    if (!response.ok) {
      // Safely parse error response - might not be JSON
      let errorMessage = "Login failed";
      try {
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const error = await response.json();
          errorMessage = error.message || error.detail || "Login failed";
        } else {
          const text = await response.text();
          // Check for common server errors
          if (response.status >= 500) {
            errorMessage =
              "Server is temporarily unavailable. Please try again later.";
          } else if (text && text.length < 200) {
            errorMessage = text;
          }
        }
      } catch {
        // If parsing fails, use status-based message
        if (response.status >= 500) {
          errorMessage =
            "Server is temporarily unavailable. Please try again later.";
        } else if (response.status === 401) {
          errorMessage = "Invalid username or password. Please try again.";
        }
      }
      throw new Error(getFriendlyErrorMessage(errorMessage));
    }

    // Safely parse success response
    let tokens: TokenResponse;
    try {
      tokens = await response.json();
    } catch {
      throw new Error("Invalid response from server. Please try again.");
    }

    // Store expiry timestamps and authentication state (not actual tokens)
    // Backend sets HttpOnly cookies automatically
    // TokenStorage.saveAccessToken() and saveRefreshToken() are now NO-OPs
    // They only set the authentication flag for UI state management
    this.tokenManager.setTokens(tokens);

    return this.getCurrentUser();
  }

  /**
   * Register new user
   */
  async register(data: RegisterRequest): Promise<User> {
    const response = await fetch(ApiConfig.AUTH_REGISTER, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
      credentials: "include",
    });

    if (!response.ok) {
      // Safely parse error response - might not be JSON
      let errorMessage = "Registration failed";
      try {
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const error = await response.json();
          errorMessage = error.message || error.detail || "Registration failed";
        } else {
          const text = await response.text();
          if (response.status >= 500) {
            errorMessage =
              "Server is temporarily unavailable. Please try again later.";
          } else if (text && text.length < 200) {
            errorMessage = text;
          }
        }
      } catch {
        if (response.status >= 500) {
          errorMessage =
            "Server is temporarily unavailable. Please try again later.";
        }
      }
      throw new Error(getFriendlyErrorMessage(errorMessage));
    }

    try {
      return await response.json();
    } catch {
      throw new Error("Invalid response from server. Please try again.");
    }
  }

  /**
   * Logout user
   *
   * HttpOnly Cookie Security (Migration Complete):
   * - Always call logout endpoint to clear HttpOnly cookies on backend
   * - Backend reads auth from cookie (not Authorization header)
   * - Clear localStorage authentication state (not actual tokens - they're in cookies)
   * - Browser automatically sends cookies for authentication
   */
  async logout(): Promise<void> {
    try {
      // Always call logout endpoint to clear HttpOnly cookies
      await fetch(ApiConfig.AUTH_LOGOUT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include", // Critical: Sends access_token cookie for authentication
      });

      console.log(
        "[AuthService] Logout successful, cookies cleared on backend"
      );
    } catch (error) {
      console.error("[AuthService] Logout request failed:", error);
      // Continue to clear local tokens even if backend request fails
    } finally {
      // Clear authentication state from localStorage
      // Note: Actual tokens are in HttpOnly cookies, cleared by backend
      this.tokenManager.clearTokens();
    }
  }

  /**
   * Get current authenticated user
   *
   * HttpOnly Cookie Security (Migration Complete):
   * - Backend reads access_token from cookie for authentication
   * - Browser automatically sends access_token cookie with credentials: 'include'
   * - No Authorization header needed (tokens are in HttpOnly cookies)
   */
  async getCurrentUser(): Promise<User> {
    console.log("[AuthService] Getting current user from:", ApiConfig.USERS_ME);
    console.log("[AuthService] Using HttpOnly cookie authentication");

    const response = await fetch(ApiConfig.USERS_ME, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include", // Critical: Sends access_token cookie for authentication
    });

    console.log(
      "[AuthService] getCurrentUser response status:",
      response.status
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[AuthService] getCurrentUser error response:", errorText);
      throw new Error(
        `Failed to get user info: ${response.status} - ${errorText}`
      );
    }

    const user = await response.json();
    console.log("[AuthService] Current user:", user);
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
