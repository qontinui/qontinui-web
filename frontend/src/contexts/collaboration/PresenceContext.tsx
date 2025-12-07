"use client";

import React, { createContext, useContext, useState, ReactNode } from "react";
import type { UserPresence } from "./types";

// ============================================================================
// Context Types
// ============================================================================

interface PresenceContextValue {
  activeUsers: UserPresence[];
  setActiveUsers: (users: UserPresence[]) => void;
  addUser: (user: UserPresence) => void;
  removeUser: (userId: string) => void;
  updateUser: (userId: string, updates: Partial<UserPresence>) => void;
}

const PresenceContext = createContext<PresenceContextValue | undefined>(
  undefined
);

// ============================================================================
// Provider Props
// ============================================================================

interface PresenceProviderProps {
  children: ReactNode;
}

// ============================================================================
// Provider Component
// ============================================================================

export function PresenceProvider({ children }: PresenceProviderProps) {
  const [activeUsers, setActiveUsers] = useState<UserPresence[]>([]);

  // ============================================================================
  // Methods
  // ============================================================================

  const addUser = (user: UserPresence) => {
    setActiveUsers((prev) => {
      // Check if user already exists
      const exists = prev.some((u) => u.user_id === user.user_id);
      if (exists) {
        return prev.map((u) => (u.user_id === user.user_id ? user : u));
      }
      return [...prev, user];
    });
  };

  const removeUser = (userId: string) => {
    setActiveUsers((prev) => prev.filter((u) => u.user_id !== userId));
  };

  const updateUser = (userId: string, updates: Partial<UserPresence>) => {
    setActiveUsers((prev) =>
      prev.map((u) => (u.user_id === userId ? { ...u, ...updates } : u))
    );
  };

  // ============================================================================
  // Context Value
  // ============================================================================

  const value: PresenceContextValue = {
    activeUsers,
    setActiveUsers,
    addUser,
    removeUser,
    updateUser,
  };

  return (
    <PresenceContext.Provider value={value}>
      {children}
    </PresenceContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function usePresence() {
  const context = useContext(PresenceContext);
  if (context === undefined) {
    throw new Error("usePresence must be used within a PresenceProvider");
  }
  return context;
}
