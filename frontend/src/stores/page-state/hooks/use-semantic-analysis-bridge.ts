/**
 * Semantic Analysis Bridge Hook
 *
 * Provides a bridge between the old useState-based approach and the new
 * Zustand store, making migration easier. This hook provides the same
 * interface as the original component's state.
 */

import { useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useAutomation } from "@/contexts/automation-context";
import { useSemanticAnalysisStore } from "../semantic-analysis-store";

/**
 * Bridge hook for Semantic Analysis page.
 * Provides the same interface as the original useState-based approach
 * but backed by persistent Zustand store.
 */
export function useSemanticAnalysisBridge() {
  const { user } = useAuth();
  const { projectName } = useAutomation();
  const store = useSemanticAnalysisStore();
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
      store.persist();
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

  // State setters that mirror the original component's setState functions
  const setSelectedScreenshotId = useCallback(
    (id: string | null) => {
      store.setSelectedScreenshotId(id);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setSelectedElementIds = useCallback(
    (ids: string[]) => {
      store.setSelectedElementIds(ids);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const toggleElementId = useCallback(
    (id: string) => {
      store.toggleElementId(id);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setAnalysisResults = useCallback(
    (results: Record<string, unknown>) => {
      store.setAnalysisResults(results);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setShowOverlay = useCallback(
    (show: boolean) => {
      store.setShowOverlay(show);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setHighlightMode = useCallback(
    (mode: "all" | "selected" | "none") => {
      store.setHighlightMode(mode);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  return {
    // Hydration status
    isHydrated: store.isHydrated,
    isHydrating: store.isHydrating,

    // State values
    selectedScreenshotId: store.selectedScreenshotId,
    selectedElementIds: store.selectedElementIds,
    analysisResults: store.analysisResults,
    showOverlay: store.showOverlay,
    highlightMode: store.highlightMode,

    // Actions
    setSelectedScreenshotId,
    setSelectedElementIds,
    toggleElementId,
    setAnalysisResults,
    setShowOverlay,
    setHighlightMode,
  };
}
