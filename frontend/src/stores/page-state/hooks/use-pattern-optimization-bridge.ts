/**
 * Pattern Optimization Bridge Hook
 *
 * Provides a bridge between the old useState-based approach and the new
 * Zustand store, making migration easier. This hook provides the same
 * interface as the original component's state.
 */

import { useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useAutomation } from "@/contexts/automation-context";
import { usePatternOptimizationStore } from "../pattern-optimization-store";

/**
 * Bridge hook for Pattern Optimization page.
 * Provides the same interface as the original useState-based approach
 * but backed by persistent Zustand store.
 */
export function usePatternOptimizationBridge() {
  const { user } = useAuth();
  const { projectName } = useAutomation();
  const store = usePatternOptimizationStore();

  // Keep stable ref to store to avoid infinite loops
  const storeRef = useRef(store);
  storeRef.current = store;

  const hasHydrated = useRef(false);
  const persistTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Hydrate on mount
  useEffect(() => {
    if (user?.id && projectName && !hasHydrated.current) {
      hasHydrated.current = true;
      storeRef.current.hydrate(projectName, user.id);
    }
  }, [user?.id, projectName]);

  // Persist on unmount
  useEffect(() => {
    return () => {
      if (persistTimeoutRef.current) {
        clearTimeout(persistTimeoutRef.current);
      }
      storeRef.current.persist().finally(() => {
        storeRef.current.cleanup();
      });
    };
  }, []);

  // Debounced persist
  const debouncedPersist = useCallback(() => {
    if (persistTimeoutRef.current) {
      clearTimeout(persistTimeoutRef.current);
    }
    persistTimeoutRef.current = setTimeout(() => {
      storeRef.current.persist();
    }, 500);
  }, []);

  // Listen for beforeunload
  useEffect(() => {
    const handleBeforeUnload = () => {
      storeRef.current.persist();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  // State setters that mirror the original component's setState functions
  const setSelectedScreenshotId = useCallback(
    (id: string | null) => {
      storeRef.current.setSelectedScreenshotId(id);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const setConfig = useCallback(
    (
      config:
        | typeof store.config
        | ((prev: typeof store.config) => typeof store.config)
    ) => {
      if (typeof config === "function") {
        const newConfig = config(storeRef.current.config);
        storeRef.current.setConfig(newConfig);
      } else {
        storeRef.current.setConfig(config);
      }
      debouncedPersist();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [debouncedPersist]
  );

  const setEditMode = useCallback(
    (mode: "none" | "add" | "remove") => {
      storeRef.current.setEditMode(mode);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const setEditedPattern = useCallback(
    async (pattern: string | null) => {
      if (pattern) {
        // Convert data URL to Blob
        const response = await fetch(pattern);
        const blob = await response.blob();
        await storeRef.current.setEditedPattern(blob);
      } else {
        await storeRef.current.setEditedPattern(null);
      }
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const setStepIndex = useCallback(
    (index: number) => {
      storeRef.current.setStepIndex(index);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const setShowStateImageDialog = useCallback(
    (show: boolean) => {
      storeRef.current.setShowStateImageDialog(show);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const setStateImageName = useCallback(
    (name: string) => {
      storeRef.current.setStateImageName(name);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const setSelectedStateId = useCallback(
    (id: string) => {
      storeRef.current.setSelectedStateId(id);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const setNewStateName = useCallback(
    (name: string) => {
      storeRef.current.setNewStateName(name);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const setFixedLocation = useCallback(
    (fixed: boolean) => {
      storeRef.current.setFixedLocation(fixed);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  return {
    // Hydration status
    isHydrated: store.isHydrated,
    isHydrating: store.isHydrating,

    // State values (read-only)
    selectedScreenshotId: store.selectedScreenshotId,
    config: store.config,
    editMode: store.editMode,
    editedPattern: store.editedPatternUrl || null,
    stepIndex: store.stepIndex,
    showStateImageDialog: store.showStateImageDialog,
    stateImageName: store.stateImageName,
    selectedStateId: store.selectedStateId,
    newStateName: store.newStateName,
    fixedLocation: store.fixedLocation,

    // Actions (same interface as useState setters)
    setSelectedScreenshotId,
    setConfig,
    setEditMode,
    setEditedPattern,
    setStepIndex,
    setShowStateImageDialog,
    setStateImageName,
    setSelectedStateId,
    setNewStateName,
    setFixedLocation,
  };
}
