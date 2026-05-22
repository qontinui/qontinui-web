import {
  TokenResponse,
  LoginRequest,
  RegisterRequest,
  User,
} from "@/types/auth-types";
import { TokenManager } from "./token-manager";
import { TokenRefreshService } from "./token-refresh-service";
import { ApiConfig } from "../api-config";
import { createLogger } from "@/lib/logger";

const log = createLogger("AuthService");

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

    log.debug("Attempting login");

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

    // Store tokens in memory (for Authorization header) and expiry in localStorage.
    // Backend also sets HttpOnly cookies as fallback.
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

      log.debug("Logout successful");
    } catch (error) {
      log.error("Logout request failed:", error);
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
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Include Authorization header if we have an in-memory access token
    const accessToken = this.tokenManager.getAccessToken();
    if (accessToken) {
      headers["Authorization"] = `Bearer ${accessToken}`;
    }

    const response = await fetch(ApiConfig.USERS_ME, {
      method: "GET",
      headers,
      credentials: "include",
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error("getCurrentUser failed:", response.status);
      throw new Error(
        `Failed to get user info: ${response.status} - ${errorText}`
      );
    }

    return response.json();
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
   * Persist the authentication flag without setting tokens.
   *
   * Used by the auth context's cookie-based session restore: when a fresh
   * load has valid HttpOnly cookies but no `is_authenticated` flag,
   * getCurrentUser() succeeds via the cookies and we persist the flag so
   * subsequent loads take the fast path. This intentionally sets only the
   * UI auth flag — actual tokens remain in HttpOnly cookies.
   */
  setAuthenticated(): void {
    this.tokenManager.setAuthenticated();
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
