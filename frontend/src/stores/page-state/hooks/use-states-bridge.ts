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
      storeRef.current.persist();
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
  const setViewport = useCallback(
    (viewport: { x: number; y: number; zoom: number }) => {
      storeRef.current.setViewport(viewport);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const setSelectedStateIds = useCallback(
    (ids: string[]) => {
      storeRef.current.setSelectedStateIds(ids);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const toggleStateId = useCallback(
    (id: string) => {
      storeRef.current.toggleStateId(id);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const setSelectedTransitionIds = useCallback(
    (ids: string[]) => {
      storeRef.current.setSelectedTransitionIds(ids);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const toggleTransitionId = useCallback(
    (id: string) => {
      storeRef.current.toggleTransitionId(id);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const setEditingStateId = useCallback(
    (id: string | null) => {
      storeRef.current.setEditingStateId(id);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const setShowGrid = useCallback(
    (show: boolean) => {
      storeRef.current.setShowGrid(show);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const setSnapToGrid = useCallback(
    (snap: boolean) => {
      storeRef.current.setSnapToGrid(snap);
      debouncedPersist();
    },
    [debouncedPersist]
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
