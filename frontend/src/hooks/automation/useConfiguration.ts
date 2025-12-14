/**
 * useConfiguration Hook
 *
 * Hook for configuration load/save/export operations.
 */

import { useCallback } from "react";
import {
  useAutomationStore,
  hydrateStore,
  resetStore,
} from "@/stores/automation";

export function useConfiguration() {
  // Actions from store
  const getConfiguration = useAutomationStore((s) => s.getConfiguration);
  const loadConfiguration = useAutomationStore((s) => s.loadConfiguration);
  const clearAllData = useAutomationStore((s) => s.clearAllData);

  /**
   * Load project data from IndexedDB
   */
  const loadProject = useCallback(async (projectName: string) => {
    await hydrateStore(projectName);
  }, []);

  /**
   * Reset to initial state
   */
  const resetProject = useCallback(() => {
    resetStore();
  }, []);

  return {
    getConfiguration,
    loadConfiguration,
    clearAllData,
    loadProject,
    resetProject,
  };
}
