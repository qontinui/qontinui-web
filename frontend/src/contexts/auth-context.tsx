'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { authService } from '@/services/service-factory';
import { User } from '@/types/auth-types';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string, rememberMe?: boolean) => Promise<User>;
  register: (email: string, username: string, password: string, fullName?: string) => Promise<void>;
  logout: () => void;
  updateUser: (data: Partial<User>) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();

    // Listen for session expiry (only in browser)
    if (typeof window !== 'undefined') {
      const handleSessionExpired = () => {
        console.log('[AuthContext] Session expired event received:', {
          timestamp: new Date().toISOString(),
          currentUser: user?.username || 'none',
        });

        setUser(null);
        console.log('[AuthContext] Redirecting to home page due to session expiry');
        window.location.href = '/';
      };

      console.log('[AuthContext] Registering session-expired event listener');
      window.addEventListener('session-expired', handleSessionExpired);
      return () => {
        console.log('[AuthContext] Removing session-expired event listener');
        window.removeEventListener('session-expired', handleSessionExpired);
      };
    }
  }, []);

  const checkAuth = async () => {
    console.log('[AuthContext] Checking authentication...');
    try {
      const isAuth = authService.isAuthenticated();
      console.log('[AuthContext] Is authenticated:', isAuth);

      if (isAuth) {
        console.log('[AuthContext] Fetching current user...');
        const currentUser = await authService.getCurrentUser();
        console.log('[AuthContext] Current user:', currentUser);
        setUser(currentUser);
      } else {
        console.log('[AuthContext] No valid auth token found');
      }
    } catch (error) {
      console.error('[AuthContext] Auth check failed:', error);
      authService.logout();
    } finally {
      console.log('[AuthContext] Setting loading to false');
      setLoading(false);
    }
  };

  const login = async (username: string, password: string, rememberMe?: boolean) => {
    try {
      const loggedInUser = await authService.login({
        username,
        password,
        remember_me: rememberMe
      });
      setUser(loggedInUser);
      return loggedInUser;
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  };

  const register = async (email: string, username: string, password: string, fullName?: string) => {
    try {
      const newUser = await authService.register({
        email,
        username,
        password,
        full_name: fullName,
      });
      // After registration, log the user in
      await login(username, password);
    } catch (error) {
      console.error('Registration failed:', error);
      throw error;
    }
  };

  const logout = () => {
    authService.logout();
    setUser(null);
    if (typeof window !== 'undefined') {
      window.location.href = '/';
    }
  };

  const updateUser = async (data: Partial<User>) => {
    try {
      // This would need to be implemented in the auth service
      // For now, just update the local state
      setUser(currentUser => currentUser ? { ...currentUser, ...data } : null);
    } catch (error) {
      console.error('User update failed:', error);
      throw error;
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
