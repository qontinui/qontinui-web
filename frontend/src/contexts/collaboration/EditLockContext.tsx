"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import type { Lock, ResourceType } from "./types";
import { lockService } from "@/services/service-factory";

// ============================================================================
// Context Types
// ============================================================================

interface EditLockContextValue {
  currentLock: Lock | null;
  acquireEditLock: (
    resourceType: ResourceType,
    resourceId: string
  ) => Promise<void>;
  releaseEditLock: () => Promise<void>;
  hasLock: (resourceType: ResourceType, resourceId: string) => boolean;
}

const EditLockContext = createContext<EditLockContextValue | undefined>(
  undefined
);

// ============================================================================
// Provider Props
// ============================================================================

interface EditLockProviderProps {
  children: ReactNode;
  projectId: string;
}

// ============================================================================
// Provider Component
// ============================================================================

export function EditLockProvider({
  children,
  projectId,
}: EditLockProviderProps) {
  const [currentLock, setCurrentLock] = useState<Lock | null>(null);

  // ============================================================================
  // Methods
  // ============================================================================

  const acquireEditLock = async (
    resourceType: ResourceType,
    resourceId: string
  ) => {
    try {
      const lock = await lockService.acquireLock(
        projectId,
        resourceType,
        resourceId,
        true // auto-refresh
      );
      setCurrentLock(lock);
    } catch (error) {
      console.error("[EditLock] Failed to acquire lock:", error);
      throw error;
    }
  };

  const releaseEditLock = async () => {
    if (!currentLock) return;

    try {
      await lockService.releaseLock(currentLock.id);
      setCurrentLock(null);
    } catch (error) {
      console.error("[EditLock] Failed to release lock:", error);
      throw error;
    }
  };

  const hasLock = (resourceType: ResourceType, resourceId: string): boolean => {
    return (
      currentLock !== null &&
      currentLock.resource_type === resourceType &&
      currentLock.resource_id === resourceId
    );
  };

  // ============================================================================
  // Cleanup
  // ============================================================================

  useEffect(() => {
    return () => {
      // Release lock on unmount
      if (currentLock) {
        lockService.releaseLock(currentLock.id).catch((error) => {
          console.error("[EditLock] Failed to release lock on unmount:", error);
        });
      }
    };
  }, [currentLock]);

  // ============================================================================
  // Context Value
  // ============================================================================

  const value: EditLockContextValue = {
    currentLock,
    acquireEditLock,
    releaseEditLock,
    hasLock,
  };

  return (
    <EditLockContext.Provider value={value}>
      {children}
    </EditLockContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useEditLock() {
  const context = useContext(EditLockContext);
  if (context === undefined) {
    throw new Error("useEditLock must be used within an EditLockProvider");
  }
  return context;
}
