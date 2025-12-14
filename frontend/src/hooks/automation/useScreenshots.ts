/**
 * useScreenshots Hook
 *
 * Hook for screenshot operations including backend sync.
 */

import { useAutomationStore } from "@/stores/automation";

export function useScreenshots() {
  // State
  const screenshots = useAutomationStore((s) => s.screenshots);

  // Actions
  const setScreenshots = useAutomationStore((s) => s.setScreenshots);
  const addScreenshot = useAutomationStore((s) => s.addScreenshot);
  const updateScreenshot = useAutomationStore((s) => s.updateScreenshot);
  const deleteScreenshot = useAutomationStore((s) => s.deleteScreenshot);
  const syncScreenshotsFromBackend = useAutomationStore(
    (s) => s.syncScreenshotsFromBackend
  );

  return {
    screenshots,
    setScreenshots,
    addScreenshot,
    updateScreenshot,
    deleteScreenshot,
    syncScreenshotsFromBackend,
  };
}
