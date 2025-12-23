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

  // State setters with auto-persist
  const setActiveTab = useCallback(
    (tab: string) => {
      store.setActiveTab(tab);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setSearchQuery = useCallback(
    (query: string) => {
      store.setSearchQuery(query);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setFiltersOpen = useCallback(
    (open: boolean) => {
      store.setFiltersOpen(open);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setFilters = useCallback(
    (filters: Partial<DependenciesPageState["filters"]>) => {
      store.setFilters(filters);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setGraphViewport = useCallback(
    (viewport: Partial<DependenciesPageState["graphViewport"]>) => {
      store.setGraphViewport(viewport);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setSelectedWorkflowId = useCallback(
    (id: string | null) => {
      store.setSelectedWorkflowId(id);
      debouncedPersist();
    },
    [store, debouncedPersist]
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
