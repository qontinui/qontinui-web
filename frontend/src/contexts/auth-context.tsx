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
  logout: () => void;
  updateUser: (data: Partial<User>) => Promise<void>;
  getAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Development auto-login credentials
const DEV_AUTO_LOGIN = {
  username: "josh",
  password: "admin123",
};

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
   * Automatically logs in with dev credentials when not authenticated in dev mode
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

    // Auto-login in development
    console.log(
      "[AuthContext] Dev mode: Not authenticated, attempting auto-login..."
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
      .catch((err) => {
        console.error("[AuthContext] Dev mode auto-login failed:", err);
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

  const logout = () => {
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
      // Get the current access token from the token manager
      const token = authService.tokenManager.getAccessToken();

      if (!token) {
        return null;
      }

      // Check if token is expired or expiring soon
      const expiry = authService.tokenManager.getTokenExpiry();
      if (expiry) {
        const now = Date.now();
        const timeUntilExpiry = expiry - now;

        // If token expires in less than 1 minute, refresh it
        if (timeUntilExpiry < 60000) {
          console.log("[AuthContext] Token expiring soon, refreshing...");
          await authService.refreshAccessToken();
          return authService.tokenManager.getAccessToken();
        }
      }

      return token;
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
