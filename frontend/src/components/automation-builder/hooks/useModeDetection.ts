/**
 * useModeDetection Hook
 *
 * Handles automatic mode detection and switching logic based on selected items.
 */

import { useCallback } from "react";
import type { BuilderMode, LibraryItem } from "../types";
import { getSuggestedMode, isItemCompatibleWithMode } from "../types";
import { toast } from "sonner";

interface UseModeDetectionOptions {
  /** Current mode */
  currentMode: BuilderMode;
  /** Whether automatic mode switching is enabled */
  autoSwitch?: boolean;
  /** Callback to change mode */
  onModeChange: (mode: BuilderMode) => void;
}

export function useModeDetection({
  currentMode,
  autoSwitch = true,
  onModeChange,
}: UseModeDetectionOptions) {
  /**
   * Detect the appropriate mode for an item
   */
  const detectMode = useCallback((item: LibraryItem): BuilderMode => {
    return getSuggestedMode(item);
  }, []);

  /**
   * Handle item selection with automatic mode switching
   */
  const handleItemSelection = useCallback(
    (item: LibraryItem): boolean => {
      const suggestedMode = detectMode(item);
      const isCompatible = isItemCompatibleWithMode(item, currentMode);

      if (isCompatible) {
        // Item is compatible with current mode - no switch needed
        return true;
      }

      if (autoSwitch) {
        // Auto-switch to suggested mode
        onModeChange(suggestedMode);

        toast.info(`Switched to ${suggestedMode} mode`, {
          description: `${item.type === "workflow" ? "Graph workflows" : "Sequential processes"} are best edited in ${suggestedMode} mode.`,
          duration: 2000,
        });

        return true;
      } else {
        // Show warning but don't switch
        const modeLabel =
          suggestedMode === "sequential" ? "Sequential" : "Graph";
        const itemType = item.type === "workflow" ? "workflow" : "process";

        toast.warning(`${itemType} requires ${modeLabel} mode`, {
          description: `Switch to ${modeLabel} mode to edit this ${itemType}.`,
          action: {
            label: `Switch to ${modeLabel}`,
            onClick: () => onModeChange(suggestedMode),
          },
          duration: 5000,
        });

        return false;
      }
    },
    [currentMode, autoSwitch, detectMode, onModeChange]
  );

  /**
   * Check if mode switch is needed for an item
   */
  const needsModeSwitch = useCallback(
    (item: LibraryItem): boolean => {
      return !isItemCompatibleWithMode(item, currentMode);
    },
    [currentMode]
  );

  return {
    detectMode,
    handleItemSelection,
    needsModeSwitch,
  };
}
