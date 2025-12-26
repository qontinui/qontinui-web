/**
 * Dependencies Bridge Hook
 *
 * Provides a bridge between the old useState-based approach and the new
 * Zustand store, making migration easier. This hook provides the same
 * interface as the original component's state.
 */

import { useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useAutomation } from "@/contexts/automation-context";
import { useDependenciesStore } from "../dependencies-store";
import type { DependenciesPageState } from "../types";

/**
 * Bridge hook for Dependencies page.
 * Provides the same interface as the original useState-based approach
 * but backed by persistent Zustand store.
 */
export function useDependenciesBridge() {
  const { user } = useAuth();
  const { projectName } = useAutomation();
  const store = useDependenciesStore();

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

  // State setters with auto-persist
  const setActiveTab = useCallback(
    (tab: string) => {
      storeRef.current.setActiveTab(tab);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const setSearchQuery = useCallback(
    (query: string) => {
      storeRef.current.setSearchQuery(query);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const setFiltersOpen = useCallback(
    (open: boolean) => {
      storeRef.current.setFiltersOpen(open);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const setFilters = useCallback(
    (filters: Partial<DependenciesPageState["filters"]>) => {
      storeRef.current.setFilters(filters);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const setGraphViewport = useCallback(
    (viewport: Partial<DependenciesPageState["graphViewport"]>) => {
      storeRef.current.setGraphViewport(viewport);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const setSelectedWorkflowId = useCallback(
    (id: string | null) => {
      storeRef.current.setSelectedWorkflowId(id);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  return {
    // Hydration status
    isHydrated: store.isHydrated,
    isHydrating: store.isHydrating,

    // State values (read-only)
    activeTab: store.activeTab,
    searchQuery: store.searchQuery,
    filtersOpen: store.filtersOpen,
    filters: store.filters,
    graphViewport: store.graphViewport,
    selectedWorkflowId: store.selectedWorkflowId,

    // Actions (same interface as useState setters)
    setActiveTab,
    setSearchQuery,
    setFiltersOpen,
    setFilters,
    setGraphViewport,
    setSelectedWorkflowId,
  };
}
