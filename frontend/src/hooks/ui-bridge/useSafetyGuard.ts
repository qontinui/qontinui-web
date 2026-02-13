"use client";

/**
 * Safety Guard Hook
 *
 * Manages browser tab discovery and selection for safe exploration.
 * Handles communication with the Chrome extension for tab listing,
 * selection, and clearing.
 */

import { useState, useCallback } from "react";

import type { BrowserTab, UIBridgeExplorationConfig } from "./types";
import { isCloudEnvironment, sendRunnerCommand } from "./utils";
import { createLogger } from "@/lib/logger";
const logger = createLogger("UseSafetyGuard");

export interface UseSafetyGuardReturn {
  /** Available browser tabs from Chrome extension */
  browserTabs: BrowserTab[];
  /** Whether browser tabs are currently loading */
  browserTabsLoading: boolean;
  /** Error message from fetching browser tabs */
  browserTabsError: string | null;
  /** Fetch available browser tabs from the Chrome extension via runner */
  fetchBrowserTabs: (runnerUrl: string | null) => Promise<BrowserTab[]>;
  /** Select a specific browser tab for exploration */
  selectBrowserTab: (
    runnerUrl: string | null,
    tabId: number | null
  ) => Promise<{ success: boolean; error?: string }>;
}

/**
 * Hook for browser tab safety guard logic.
 *
 * Provides browser tab discovery and selection for the Chrome extension
 * exploration mode, ensuring the correct tab is targeted.
 */
export function useSafetyGuard(
  config: UIBridgeExplorationConfig,
  setConfig: (updates: Partial<UIBridgeExplorationConfig>) => void
): UseSafetyGuardReturn {
  const [browserTabs, setBrowserTabs] = useState<BrowserTab[]>([]);
  const [browserTabsLoading, setBrowserTabsLoading] = useState(false);
  const [browserTabsError, setBrowserTabsError] = useState<string | null>(null);

  /**
   * Fetch available browser tabs from the Chrome extension via runner
   */
  const fetchBrowserTabs = useCallback(
    async (runnerUrl: string | null) => {
      logger.info(
        "[useSafetyGuard] fetchBrowserTabs called with:",
        runnerUrl,
        "isCloud:",
        isCloudEnvironment()
      );
      setBrowserTabsLoading(true);
      setBrowserTabsError(null);

      try {
        const result = await sendRunnerCommand(runnerUrl, "listTabs", {}, 10);

        if (!result.success) {
          throw new Error(result.error || "Failed to fetch browser tabs");
        }

        const data = result.data as {
          tabs?: BrowserTab[];
          selectedTabId?: number | null;
        };
        const tabs: BrowserTab[] = data?.tabs || [];
        logger.info(
          "[useSafetyGuard] Got",
          tabs.length,
          "browser tabs"
        );
        setBrowserTabs(tabs);

        // If a tab was previously selected, verify it still exists
        if (config.selectedBrowserTabId !== null) {
          const tabExists = tabs.some(
            (t) => t.id === config.selectedBrowserTabId
          );
          if (!tabExists) {
            // Tab no longer exists, clear selection
            setConfig({ selectedBrowserTabId: null });
          }
        }

        return tabs;
      } catch (error) {
        let message = "Failed to fetch browser tabs";
        if (error instanceof Error) {
          if (error.message.includes("timed out")) {
            message =
              "Request timed out. Make sure the Qontinui extension is installed and the runner is connected.";
          } else if (error.message.includes("Unknown action")) {
            message =
              "Extension needs to be reloaded. Go to chrome://extensions and click the refresh icon on Qontinui DevTools.";
          } else {
            message = error.message;
          }
        }
        setBrowserTabsError(message);
        setBrowserTabs([]);
        return [];
      } finally {
        setBrowserTabsLoading(false);
      }
    },
    [config.selectedBrowserTabId, setConfig]
  );

  /**
   * Select a browser tab for exploration
   */
  const selectBrowserTab = useCallback(
    async (runnerUrl: string | null, tabId: number | null) => {
      logger.info("[useSafetyGuard] selectBrowserTab called:", {
        runnerUrl,
        tabId,
        isCloud: isCloudEnvironment(),
      });
      try {
        if (tabId === null) {
          // Clear selection - use active tab
          const result = await sendRunnerCommand(
            runnerUrl,
            "clearSelectedTab",
            {},
            10
          );
          if (!result.success) {
            throw new Error(result.error || "Failed to clear tab selection");
          }
          setConfig({ selectedBrowserTabId: null });
          return { success: true };
        }

        // Select specific tab
        const result = await sendRunnerCommand(
          runnerUrl,
          "selectTab",
          { tabId },
          10
        );
        if (!result.success) {
          throw new Error(result.error || "Failed to select tab");
        }

        logger.info(
          "[useSafetyGuard] Setting selectedBrowserTabId to:",
          tabId
        );
        setConfig({ selectedBrowserTabId: tabId });
        return { success: true, ...(result.data as Record<string, unknown>) };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to select tab";
        logger.error("selectBrowserTab error:", message);
        return { success: false, error: message };
      }
    },
    [setConfig]
  );

  return {
    browserTabs,
    browserTabsLoading,
    browserTabsError,
    fetchBrowserTabs,
    selectBrowserTab,
  };
}
