"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
  useRef,
} from "react";
import { createLogger } from "@/lib/logger";
import { authService } from "@/services/service-factory";
import { User } from "@/types/auth-types";
import { pageStateDB } from "@/stores/page-state";
import { clearExtractionConfig } from "@/hooks/use-extraction-config";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (
    username: string,
    password: string,
    rememberMe?: boolean
  ) => Promise<User>;
  register: (
    email: string,
    username: string,
    password: string,
    fullName?: string
  ) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (data: Partial<User>) => Promise<void>;
  getAccessToken: () => Promise<string | null>;
}

const logger = createLogger("AuthContext");

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Development auto-login credentials (from environment variables)
// Set NEXT_PUBLIC_DEV_EMAIL and NEXT_PUBLIC_DEV_PASSWORD in .env.local for dev auto-login
const DEV_AUTO_LOGIN = {
  username: process.env.NEXT_PUBLIC_DEV_EMAIL || "",
  password: process.env.NEXT_PUBLIC_DEV_PASSWORD || "",
};

/**
 * Check if dev auto-login should be skipped.
 * Skip when:
 * - Running Playwright tests (detected via navigator.webdriver or URL param)
 * - Explicitly disabled via NEXT_PUBLIC_DISABLE_DEV_AUTO_LOGIN
 */
function shouldSkipDevAutoLogin(): boolean {
  if (typeof window === "undefined") return true;

  // Skip if explicitly disabled
  if (process.env.NEXT_PUBLIC_DISABLE_DEV_AUTO_LOGIN === "true") {
    return true;
  }

  // Skip if running in Playwright/automated browser (webdriver flag)
  if (navigator.webdriver) {
    logger.debug(
      "Dev auto-login skipped: Running in automated browser (Playwright/Selenium)"
    );
    return true;
  }

  // Skip if URL has skip_auto_login param (useful for testing login flow)
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has("skip_auto_login")) {
    logger.debug("Dev auto-login skipped: skip_auto_login URL param present");
    return true;
  }

  return false;
}

// Cross-tab auth event types
type AuthBroadcastMessage =
  | { type: "LOGIN"; user: User }
  | { type: "LOGOUT" }
  | { type: "USER_UPDATE"; user: User }
  | { type: "TOKEN_REFRESH" };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const hasAttemptedDevLogin = useRef(false);

  useEffect(() => {
    checkAuth();

    // Initialize BroadcastChannel for cross-tab synchronization
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      const channel = new BroadcastChannel("auth_channel");
      channelRef.current = channel;

      // Listen for auth events from other tabs
      channel.onmessage = (event: MessageEvent<AuthBroadcastMessage>) => {
        logger.debug("Received broadcast message:", event.data);

        switch (event.data.type) {
          case "LOGIN":
            // Another tab logged in - update local state
            logger.debug("Syncing login from another tab");
            setUser(event.data.user);
            break;

          case "LOGOUT":
            // Another tab logged out - clear local state
            logger.debug("Syncing logout from another tab");
            authService.logout(); // Clear tokens
            setUser(null);
            if (window.location.pathname !== "/") {
              window.location.href = "/";
            }
            break;

          case "USER_UPDATE":
            // Another tab updated user - sync changes
            logger.debug("Syncing user update from another tab");
            setUser(event.data.user);
            break;

          case "TOKEN_REFRESH":
            // Another tab refreshed token - reload user data
            logger.debug("Token refreshed in another tab, reloading user");
            checkAuth();
            break;
        }
      };

      logger.debug("BroadcastChannel initialized for cross-tab sync");
    }

    // Listen for session expiry (only in browser)
    if (typeof window !== "undefined") {
      const handleSessionExpired = () => {
        logger.info("Session expired event received:", {
          timestamp: new Date().toISOString(),
          currentUser: user?.username || "none",
        });

        setUser(null);
        logger.info("Redirecting to /login due to session expiry");
        window.location.href = "/login";
      };

      logger.debug("Registering session-expired event listener");
      window.addEventListener("session-expired", handleSessionExpired);

      return () => {
        logger.debug("Cleaning up event listeners");
        window.removeEventListener("session-expired", handleSessionExpired);

        // Close BroadcastChannel
        if (channelRef.current) {
          channelRef.current.close();
          channelRef.current = null;
        }
      };
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkAuth = async () => {
    logger.debug("Checking authentication...");
    try {
      const isAuth = authService.isAuthenticated();
      logger.debug("Is authenticated:", isAuth);

      if (isAuth) {
        // Check if access token is expired - if so, try to refresh it first
        if (authService.isAccessTokenExpired()) {
          logger.debug("Access token is expired, attempting refresh...");
          const refreshSuccess = await authService.refreshAccessToken();

          if (!refreshSuccess) {
            logger.info("Token refresh failed, user needs to re-login");
            authService.logout();
            return;
          }

          logger.debug("Token refresh successful");
        }

        logger.debug("Fetching current user...");
        const currentUser = await authService.getCurrentUser();
        logger.debug("Current user:", currentUser);
        setUser(currentUser);
      } else {
        logger.debug("No valid auth token found");
      }
    } catch (error) {
      logger.error("Auth check failed:", error);
      authService.logout();
    } finally {
      logger.debug("Setting loading to false");
      setLoading(false);
    }
  };

  /**
   * Development mode auto-login
   * Automatically logs in with dev credentials when not authenticated in dev mode.
   * Skipped for Playwright tests (navigator.webdriver) to allow testing the login flow.
   */
  useEffect(() => {
    // Only run in development mode
    if (process.env.NODE_ENV !== "development") {
      return;
    }

    // Only attempt once to avoid infinite loops
    if (hasAttemptedDevLogin.current) {
      return;
    }

    // Wait for auth check to complete
    if (loading) {
      return;
    }

    // If already authenticated, redirect away from landing page
    if (user) {
      logger.debug("Dev mode: Already authenticated, skipping auto-login");
      if (window.location.pathname === "/") {
        const dest = user.is_superuser ? "/admin" : "/build/workflows";
        window.location.href = dest;
      }
      return;
    }

    // Skip for Playwright tests or when explicitly disabled
    if (shouldSkipDevAutoLogin()) {
      hasAttemptedDevLogin.current = true;
      return;
    }

    // Check if dev credentials are configured via environment variables
    if (!DEV_AUTO_LOGIN.username || !DEV_AUTO_LOGIN.password) {
      logger.debug(
        "Dev mode: No auto-login credentials configured (set NEXT_PUBLIC_DEV_EMAIL and NEXT_PUBLIC_DEV_PASSWORD in .env.local)"
      );
      return;
    }

    // Auto-login in development
    logger.info(
      "Dev mode: Not authenticated, attempting auto-login with",
      DEV_AUTO_LOGIN.username
    );
    hasAttemptedDevLogin.current = true;

    authService
      .login({
        username: DEV_AUTO_LOGIN.username,
        password: DEV_AUTO_LOGIN.password,
      })
      .then((loggedInUser) => {
        logger.info("Dev mode auto-login successful");
        setUser(loggedInUser);
        // Redirect to dashboard after dev auto-login
        if (window.location.pathname === "/") {
          const dest = loggedInUser.is_superuser
            ? "/admin"
            : "/build/workflows";
          window.location.href = dest;
        }
      })
      .catch((err: unknown) => {
        // Properly extract error message for logging
        const errorMessage =
          err instanceof Error
            ? err.message
            : typeof err === "object" && err !== null
              ? JSON.stringify(err)
              : String(err);
        logger.error("Dev mode auto-login failed:", errorMessage);
      });
  }, [loading, user]);

  const login = async (
    username: string,
    password: string,
    rememberMe?: boolean
  ) => {
    try {
      const loggedInUser = await authService.login({
        username,
        password,
        remember_me: rememberMe,
      });
      setUser(loggedInUser);

      // Broadcast login event to other tabs
      if (channelRef.current) {
        channelRef.current.postMessage({
          type: "LOGIN",
          user: loggedInUser,
        } as AuthBroadcastMessage);
        logger.debug("Broadcasted LOGIN event to other tabs");
      }

      return loggedInUser;
    } catch (error) {
      logger.error("Login failed:", error);
      throw error;
    }
  };

  const register = async (
    email: string,
    username: string,
    password: string,
    fullName?: string
  ) => {
    try {
      await authService.register({
        email,
        username,
        password,
        full_name: fullName,
      });
      // After registration, log the user in
      await login(username, password);
    } catch (error) {
      logger.error("Registration failed:", error);
      throw error;
    }
  };

  const logout = async () => {
    // Clear page state from IndexedDB before logout
    if (user?.id) {
      try {
        logger.debug("Clearing page state for user:", user.id);
        await pageStateDB.clearUserData(user.id);
        logger.debug("Page state cleared successfully");
      } catch (error) {
        logger.error("Failed to clear page state:", error);
        // Continue with logout even if page state cleanup fails
      }
    }

    // Clear extraction config from localStorage
    clearExtractionConfig();
    logger.debug("Extraction config cleared");

    authService.logout();
    setUser(null);

    // Broadcast logout event to other tabs
    if (channelRef.current) {
      channelRef.current.postMessage({
        type: "LOGOUT",
      } as AuthBroadcastMessage);
      logger.debug("Broadcasted LOGOUT event to other tabs");
    }

    if (typeof window !== "undefined") {
      window.location.href = "/";
    }
  };

  const updateUser = async (data: Partial<User>) => {
    try {
      // This would need to be implemented in the auth service
      // For now, just update the local state
      const updatedUser = user ? { ...user, ...data } : null;
      setUser(updatedUser);

      // Broadcast user update event to other tabs
      if (channelRef.current && updatedUser) {
        channelRef.current.postMessage({
          type: "USER_UPDATE",
          user: updatedUser,
        } as AuthBroadcastMessage);
        logger.debug("Broadcasted USER_UPDATE event to other tabs");
      }
    } catch (error) {
      logger.error("User update failed:", error);
      throw error;
    }
  };

  const getAccessToken = async (): Promise<string | null> => {
    try {
      // Check if user is authenticated
      if (!authService.isAuthenticated()) {
        logger.debug("Not authenticated, cannot get runner token");
        return null;
      }

      // Fetch a short-lived runner token from the backend
      // This is needed because tokens are stored in HttpOnly cookies (XSS protection)
      // and cannot be accessed by JavaScript. The runner-token endpoint generates
      // a 5-minute token specifically for runner API calls.
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const response = await fetch(`${apiUrl}/api/v1/auth/runner-token`, {
        method: "POST",
        credentials: "include", // Include HttpOnly cookies for authentication
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        logger.error("Failed to get runner token:", response.status);
        return null;
      }

      const data = await response.json();
      logger.debug("Got runner token, expires in", data.expires_in, "seconds");
      return data.token;
    } catch (error) {
      logger.error("Failed to get access token:", error);
      return null;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        register,
        logout,
        updateUser,
        getAccessToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
