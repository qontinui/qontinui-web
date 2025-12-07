"use client";

import React, { createContext, useContext, useState, ReactNode } from "react";
import type { PermissionLevel } from "./types";
import { hasPermission } from "@/lib/permissions";

// ============================================================================
// Context Types
// ============================================================================

interface PermissionsContextValue {
  projectAccess: PermissionLevel | null;
  setProjectAccess: (level: PermissionLevel | null) => void;
  canView: boolean;
  canComment: boolean;
  canEdit: boolean;
  canAdmin: boolean;
  hasPermission: (required: PermissionLevel) => boolean;
}

const PermissionsContext = createContext<PermissionsContextValue | undefined>(
  undefined
);

// ============================================================================
// Provider Props
// ============================================================================

interface PermissionsProviderProps {
  children: ReactNode;
  initialAccess?: PermissionLevel | null;
}

// ============================================================================
// Provider Component
// ============================================================================

export function PermissionsProvider({
  children,
  initialAccess = null,
}: PermissionsProviderProps) {
  const [projectAccess, setProjectAccess] = useState<PermissionLevel | null>(
    initialAccess
  );

  // ============================================================================
  // Permission Helpers
  // ============================================================================

  const canView = hasPermission("view", projectAccess || "none");
  const canComment = hasPermission("comment", projectAccess || "none");
  const canEdit = hasPermission("edit", projectAccess || "none");
  const canAdmin = hasPermission("admin", projectAccess || "none");

  /**
   * Check if user has a specific permission level
   */
  const checkPermission = (required: PermissionLevel): boolean => {
    return hasPermission(required, projectAccess || "none");
  };

  // ============================================================================
  // Context Value
  // ============================================================================

  const value: PermissionsContextValue = {
    projectAccess,
    setProjectAccess,
    canView,
    canComment,
    canEdit,
    canAdmin,
    hasPermission: checkPermission,
  };

  return (
    <PermissionsContext.Provider value={value}>
      {children}
    </PermissionsContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function usePermissions() {
  const context = useContext(PermissionsContext);
  if (context === undefined) {
    throw new Error("usePermissions must be used within a PermissionsProvider");
  }
  return context;
}
