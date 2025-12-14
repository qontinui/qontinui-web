/**
 * useSettings Hook
 *
 * Hook for project settings operations.
 */

import { useAutomationStore } from "@/stores/automation";

export function useSettings() {
  // State
  const settings = useAutomationStore((s) => s.settings);

  // Actions
  const setSettings = useAutomationStore((s) => s.setSettings);
  const updateSettings = useAutomationStore((s) => s.updateSettings);

  return {
    settings,
    setSettings,
    updateSettings,
  };
}
