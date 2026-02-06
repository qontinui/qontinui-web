"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
  useRef,
} from "react";
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
    console.log(
      "[AuthContext] Dev auto-login skipped: Running in automated browser (Playwright/Selenium)"
    );
    return true;
  }

  // Skip if URL has skip_auto_login param (useful for testing login flow)
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has("skip_auto_login")) {
    console.log(
      "[AuthContext] Dev auto-login skipped: skip_auto_login URL param present"
    );
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
        console.log("[AuthContext] Received broadcast message:", event.data);

        switch (event.data.type) {
          case "LOGIN":
            // Another tab logged in - update local state
            console.log("[AuthContext] Syncing login from another tab");
            setUser(event.data.user);
            break;

          case "LOGOUT":
            // Another tab logged out - clear local state
            console.log("[AuthContext] Syncing logout from another tab");
            authService.logout(); // Clear tokens
            setUser(null);
            if (window.location.pathname !== "/") {
              window.location.href = "/";
            }
            break;

          case "USER_UPDATE":
            // Another tab updated user - sync changes
            console.log("[AuthContext] Syncing user update from another tab");
            setUser(event.data.user);
            break;

          case "TOKEN_REFRESH":
            // Another tab refreshed token - reload user data
            console.log(
              "[AuthContext] Token refreshed in another tab, reloading user"
            );
            checkAuth();
            break;
        }
      };

      console.log(
        "[AuthContext] BroadcastChannel initialized for cross-tab sync"
      );
    }

    // Listen for session expiry (only in browser)
    if (typeof window !== "undefined") {
      const handleSessionExpired = () => {
        console.log("[AuthContext] Session expired event received:", {
          timestamp: new Date().toISOString(),
          currentUser: user?.username || "none",
        });

        setUser(null);
        console.log(
          "[AuthContext] Redirecting to home page due to session expiry"
        );
        window.location.href = "/";
      };

      console.log("[AuthContext] Registering session-expired event listener");
      window.addEventListener("session-expired", handleSessionExpired);

      return () => {
        console.log("[AuthContext] Cleaning up event listeners");
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
    console.log("[AuthContext] Checking authentication...");
    try {
      const isAuth = authService.isAuthenticated();
      console.log("[AuthContext] Is authenticated:", isAuth);

      if (isAuth) {
        // Check if access token is expired - if so, try to refresh it first
        if (authService.isAccessTokenExpired()) {
          console.log(
            "[AuthContext] Access token is expired, attempting refresh..."
          );
          const refreshSuccess = await authService.refreshAccessToken();

          if (!refreshSuccess) {
            console.log(
              "[AuthContext] Token refresh failed, user needs to re-login"
            );
            authService.logout();
            return;
          }

          console.log("[AuthContext] Token refresh successful");
        }

        console.log("[AuthContext] Fetching current user...");
        const currentUser = await authService.getCurrentUser();
        console.log("[AuthContext] Current user:", currentUser);
        setUser(currentUser);
      } else {
        console.log("[AuthContext] No valid auth token found");
      }
    } catch (error) {
      console.error("[AuthContext] Auth check failed:", error);
      authService.logout();
    } finally {
      console.log("[AuthContext] Setting loading to false");
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

    // If already authenticated, no need to auto-login
    if (user) {
      console.log(
        "[AuthContext] Dev mode: Already authenticated, skipping auto-login"
      );
      return;
    }

    // Skip for Playwright tests or when explicitly disabled
    if (shouldSkipDevAutoLogin()) {
      hasAttemptedDevLogin.current = true;
      return;
    }

    // Check if dev credentials are configured via environment variables
    if (!DEV_AUTO_LOGIN.username || !DEV_AUTO_LOGIN.password) {
      console.log(
        "[AuthContext] Dev mode: No auto-login credentials configured (set NEXT_PUBLIC_DEV_EMAIL and NEXT_PUBLIC_DEV_PASSWORD in .env.local)"
      );
      return;
    }

    // Auto-login in development
    console.log(
      "[AuthContext] Dev mode: Not authenticated, attempting auto-login with",
      DEV_AUTO_LOGIN.username
    );
    hasAttemptedDevLogin.current = true;

    authService
      .login({
        username: DEV_AUTO_LOGIN.username,
        password: DEV_AUTO_LOGIN.password,
      })
      .then((loggedInUser) => {
        console.log("[AuthContext] Dev mode auto-login successful");
        setUser(loggedInUser);
      })
      .catch((err: unknown) => {
        // Properly extract error message for logging
        const errorMessage =
          err instanceof Error
            ? err.message
            : typeof err === "object" && err !== null
              ? JSON.stringify(err)
              : String(err);
        console.error(
          "[AuthContext] Dev mode auto-login failed:",
          errorMessage
        );
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
        console.log("[AuthContext] Broadcasted LOGIN event to other tabs");
      }

      return loggedInUser;
    } catch (error) {
      console.error("Login failed:", error);
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
      console.error("Registration failed:", error);
      throw error;
    }
  };

  const logout = async () => {
    // Clear page state from IndexedDB before logout
    if (user?.id) {
      try {
        console.log("[AuthContext] Clearing page state for user:", user.id);
        await pageStateDB.clearUserData(user.id);
        console.log("[AuthContext] Page state cleared successfully");
      } catch (error) {
        console.error("[AuthContext] Failed to clear page state:", error);
        // Continue with logout even if page state cleanup fails
      }
    }

    // Clear extraction config from localStorage
    clearExtractionConfig();
    console.log("[AuthContext] Extraction config cleared");

    authService.logout();
    setUser(null);

    // Broadcast logout event to other tabs
    if (channelRef.current) {
      channelRef.current.postMessage({
        type: "LOGOUT",
      } as AuthBroadcastMessage);
      console.log("[AuthContext] Broadcasted LOGOUT event to other tabs");
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
        console.log(
          "[AuthContext] Broadcasted USER_UPDATE event to other tabs"
        );
      }
    } catch (error) {
      console.error("User update failed:", error);
      throw error;
    }
  };

  const getAccessToken = async (): Promise<string | null> => {
    try {
      // Check if user is authenticated
      if (!authService.isAuthenticated()) {
        console.log("[AuthContext] Not authenticated, cannot get runner token");
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
        console.error(
          "[AuthContext] Failed to get runner token:",
          response.status
        );
        return null;
      }

      const data = await response.json();
      console.log(
        "[AuthContext] Got runner token, expires in",
        data.expires_in,
        "seconds"
      );
      return data.token;
    } catch (error) {
      console.error("[AuthContext] Failed to get access token:", error);
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
