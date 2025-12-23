/**
 * Variables Bridge Hook
 *
 * Provides a bridge between the old useState-based approach and the new
 * Zustand store, making migration easier. This hook provides the same
 * interface as the original component's state.
 */

import { useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useAutomation } from "@/contexts/automation-context";
import { useVariablesStore } from "../variables-store";

/**
 * Bridge hook for Variables page.
 * Provides the same interface as the original useState-based approach
 * but backed by persistent Zustand store.
 */
export function useVariablesBridge() {
  const { user } = useAuth();
  const { projectName } = useAutomation();
  const store = useVariablesStore();
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

  // State setters that persist after each change
  const setSearchQuery = useCallback(
    (query: string) => {
      store.setSearchQuery(query);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setSelectedVariables = useCallback(
    (ids: string[]) => {
      store.setSelectedVariableIds(ids);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setSortField = useCallback(
    (field: "name" | "type" | "value" | "createdAt") => {
      store.setSortField(field);
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

  const setFilterType = useCallback(
    (type: string | null) => {
      store.setFilterType(type);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  return {
    // Hydration status
    isHydrated: store.isHydrated,
    isHydrating: store.isHydrating,

    // State values (read-only)
    searchQuery: store.searchQuery,
    selectedVariableIds: store.selectedVariableIds,
    sortField: store.sortField,
    sortDirection: store.sortDirection,
    filterType: store.filterType,

    // Actions (same interface as useState setters)
    setSearchQuery,
    setSelectedVariables,
    setSortField,
    setSortDirection,
    setFilterType,
  };
}
