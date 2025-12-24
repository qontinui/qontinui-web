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
  const hasHydrated = useRef(false);
  const persistTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Hydrate on mount
  useEffect(() => {
    if (user?.id && projectName && !hasHydrated.current) {
      hasHydrated.current = true;
      store.hydrate(projectName, user.id);
    }
  }, [user?.id, projectName, store]);

  // Persist on unmount
  useEffect(() => {
    return () => {
      if (persistTimeoutRef.current) {
        clearTimeout(persistTimeoutRef.current);
      }
      store.persist().finally(() => {
        store.cleanup();
      });
    };
  }, [store]);

  // Debounced persist
  const debouncedPersist = useCallback(() => {
    if (persistTimeoutRef.current) {
      clearTimeout(persistTimeoutRef.current);
    }
    persistTimeoutRef.current = setTimeout(() => {
      store.persist();
    }, 500);
  }, [store]);

  // Listen for beforeunload
  useEffect(() => {
    const handleBeforeUnload = () => {
      store.persist();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [store]);

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
      await store.addScreenshot(screenshot);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const removeScreenshot = useCallback(
    (id: string) => {
      store.removeScreenshot(id);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const updateScreenshotName = useCallback(
    (id: string, name: string) => {
      store.updateScreenshotName(id, name);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const clearAllScreenshots = useCallback(() => {
    store.clearAllScreenshots();
    debouncedPersist();
  }, [store, debouncedPersist]);

  const selectScreenshot = useCallback(
    (id: string) => {
      store.selectScreenshot(id);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const deselectScreenshot = useCallback(
    (id: string) => {
      store.deselectScreenshot(id);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const clearSelection = useCallback(() => {
    store.clearSelection();
    debouncedPersist();
  }, [store, debouncedPersist]);

  const selectAll = useCallback(() => {
    store.selectAll();
    debouncedPersist();
  }, [store, debouncedPersist]);

  const setViewMode = useCallback(
    (mode: "grid" | "list") => {
      store.setViewMode(mode);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setSortBy = useCallback(
    (sortBy: "name" | "uploadedAt") => {
      store.setSortBy(sortBy);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setSortDirection = useCallback(
    (direction: "asc" | "desc") => {
      store.setSortDirection(direction);
      debouncedPersist();
    },
    [store, debouncedPersist]
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
