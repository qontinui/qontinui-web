"use client";

/**
 * UI Bridge Exploration Hook (Orchestrator)
 *
 * Automates exploration of target applications using the qontinui-runner's
 * Playwright capabilities. Discovers interactive elements, clicks on them
 * systematically, and captures render logs for state discovery via
 * co-occurrence analysis.
 *
 * Features:
 * - Specify any target URL to explore (not limited to current page)
 * - Uses qontinui-runner's Playwright for cross-origin exploration
 * - Safety controls: blocked keywords, safe keywords, blocked selectors
 * - Converts Playwright results to render logs for state discovery
 *
 * This is the main orchestrator that composes:
 * - useExplorationDiscovery: Config, progress, results, session management
 * - useSafetyGuard: Browser tab discovery and selection
 * - useExplorationStrategy: Exploration execution (Playwright & UI Bridge)
 * - useRenderLogProcessing: Render log conversion for state discovery
 */

import { useExplorationDiscovery } from "./useExplorationDiscovery";
import { useSafetyGuard } from "./useSafetyGuard";
import { useExplorationStrategy } from "./useExplorationStrategy";
import { useRenderLogProcessing } from "./useRenderLogProcessing";

/**
 * Hook for UI Bridge exploration
 */
export function useUIBridgeExploration() {
  // Discovery state management (config, progress, results, sessions)
  const discovery = useExplorationDiscovery();

  // Safety guard (browser tab management)
  const safetyGuard = useSafetyGuard(discovery.config, discovery.updateConfig);

  // Exploration strategies (Playwright & UI Bridge execution)
  const strategy = useExplorationStrategy({
    config: discovery.config,
    abortRef: discovery.abortRef,
    visitedStatesRef: discovery.visitedStatesRef,
    setProgress: discovery.setProgress,
    setResults: discovery.setResults,
    setPlaywrightJob: discovery.setPlaywrightJob,
    setPlaywrightResults: discovery.setPlaywrightResults,
    setUIBridgeJob: discovery.setUIBridgeJob,
    setUIBridgeResults: discovery.setUIBridgeResults,
    createExplorationSession: discovery.createExplorationSession,
    appendRendersToSession: discovery.appendRendersToSession,
    updateSessionStatus: discovery.updateSessionStatus,
  });

  // Render log processing for state discovery
  const renderLogProcessing = useRenderLogProcessing(discovery.results);

  return {
    config: discovery.config,
    updateConfig: discovery.updateConfig,
    progress: discovery.progress,
    results: discovery.results,
    startExploration: strategy.startExploration,
    startUIBridgeExploration: strategy.startUIBridgeExploration,
    stopExploration: strategy.stopExploration,
    resetExploration: strategy.resetExploration,
    getRenderLogsForDiscovery: renderLogProcessing.getRenderLogsForDiscovery,
    isRunning: discovery.isRunning,
    // Raw Playwright results for PlaywrightResultsView compatibility
    playwrightJob: discovery.playwrightJob,
    playwrightResults: discovery.playwrightResults,
    // Raw UI Bridge results for UIBridgeResultsView
    uiBridgeJob: discovery.uiBridgeJob,
    uiBridgeResults: discovery.uiBridgeResults,
    // Browser tab management (for extension exploration)
    browserTabs: safetyGuard.browserTabs,
    browserTabsLoading: safetyGuard.browserTabsLoading,
    browserTabsError: safetyGuard.browserTabsError,
    fetchBrowserTabs: safetyGuard.fetchBrowserTabs,
    selectBrowserTab: safetyGuard.selectBrowserTab,
    // Database-persisted exploration session
    currentSession: discovery.currentSession,
  };
}
