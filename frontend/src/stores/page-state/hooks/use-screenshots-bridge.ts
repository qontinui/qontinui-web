/**
 * Screenshots Bridge Hook
 *
 * Provides a bridge between the old useState-based approach and the new
 * Zustand store, making migration easier. This hook provides the same
 * interface as the original component's state.
 */

import { useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useAutomation } from "@/contexts/automation-context";
import { useScreenshotsStore } from "../screenshots-store";
import type { Region } from "@/types/pattern-optimization";

// Re-export types for convenience
export interface Screenshot {
  id: string;
  name: string;
  url: string;
  region?: Region;
}

/**
 * Bridge hook for Screenshots page.
 * Provides the same interface as the original useState-based approach
 * but backed by persistent Zustand store.
 */
export function useScreenshotsBridge() {
  const { user } = useAuth();
  const { projectName } = useAutomation();
  const store = useScreenshotsStore();

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

  // Convert store screenshots to component Screenshot format
  const uploadedScreenshots: Screenshot[] = store.uploadedScreenshots.map(
    (s) => ({
      id: s.id,
      name: s.name,
      url: s.url || "",
      region: s.region,
    })
  );

  // Actions that mirror the original component's setState functions
  const addScreenshot = useCallback(
    async (screenshot: { id: string; name: string; file: File }) => {
      await storeRef.current.addScreenshot(screenshot);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const removeScreenshot = useCallback(
    (id: string) => {
      storeRef.current.removeScreenshot(id);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const updateScreenshotName = useCallback(
    (id: string, name: string) => {
      storeRef.current.updateScreenshotName(id, name);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const clearAllScreenshots = useCallback(() => {
    storeRef.current.clearAllScreenshots();
    debouncedPersist();
  }, [debouncedPersist]);

  const selectScreenshot = useCallback(
    (id: string) => {
      storeRef.current.selectScreenshot(id);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const deselectScreenshot = useCallback(
    (id: string) => {
      storeRef.current.deselectScreenshot(id);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const clearSelection = useCallback(() => {
    storeRef.current.clearSelection();
    debouncedPersist();
  }, [debouncedPersist]);

  const selectAll = useCallback(() => {
    storeRef.current.selectAll();
    debouncedPersist();
  }, [debouncedPersist]);

  const setViewMode = useCallback(
    (mode: "grid" | "list") => {
      storeRef.current.setViewMode(mode);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const setSortBy = useCallback(
    (sortBy: "name" | "uploadedAt") => {
      storeRef.current.setSortBy(sortBy);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const setSortDirection = useCallback(
    (direction: "asc" | "desc") => {
      storeRef.current.setSortDirection(direction);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  return {
    // Hydration status
    isHydrated: store.isHydrated,
    isHydrating: store.isHydrating,

    // State values (read-only)
    uploadedScreenshots,
    selectedScreenshotIds: store.selectedScreenshotIds,
    viewMode: store.viewMode,
    sortBy: store.sortBy,
    sortDirection: store.sortDirection,

    // Actions (same interface as useState setters)
    addScreenshot,
    removeScreenshot,
    updateScreenshotName,
    clearAllScreenshots,
    selectScreenshot,
    deselectScreenshot,
    clearSelection,
    selectAll,
    setViewMode,
    setSortBy,
    setSortDirection,
  };
}
