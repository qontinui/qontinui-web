/**
 * States Bridge Hook
 *
 * Provides a bridge between the old useState-based approach and the new
 * Zustand store, making migration easier. This hook provides the same
 * interface as the original component's state.
 */

import { useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useAutomation } from "@/contexts/automation-context";
import { useStatesStore } from "../states-store";

/**
 * Bridge hook for States page.
 * Provides the same interface as the original useState-based approach
 * but backed by persistent Zustand store.
 */
export function useStatesBridge() {
  const { user } = useAuth();
  const { projectName } = useAutomation();
  const store = useStatesStore();
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
  const setViewport = useCallback(
    (viewport: { x: number; y: number; zoom: number }) => {
      store.setViewport(viewport);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setSelectedStateIds = useCallback(
    (ids: string[]) => {
      store.setSelectedStateIds(ids);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const toggleStateId = useCallback(
    (id: string) => {
      store.toggleStateId(id);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setSelectedTransitionIds = useCallback(
    (ids: string[]) => {
      store.setSelectedTransitionIds(ids);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const toggleTransitionId = useCallback(
    (id: string) => {
      store.toggleTransitionId(id);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setEditingStateId = useCallback(
    (id: string | null) => {
      store.setEditingStateId(id);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setShowGrid = useCallback(
    (show: boolean) => {
      store.setShowGrid(show);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setSnapToGrid = useCallback(
    (snap: boolean) => {
      store.setSnapToGrid(snap);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  return {
    // Hydration status
    isHydrated: store.isHydrated,
    isHydrating: store.isHydrating,

    // State values
    viewport: store.viewport,
    selectedStateIds: store.selectedStateIds,
    selectedTransitionIds: store.selectedTransitionIds,
    editingStateId: store.editingStateId,
    showGrid: store.showGrid,
    snapToGrid: store.snapToGrid,

    // Actions
    setViewport,
    setSelectedStateIds,
    toggleStateId,
    setSelectedTransitionIds,
    toggleTransitionId,
    setEditingStateId,
    setShowGrid,
    setSnapToGrid,
  };
}
