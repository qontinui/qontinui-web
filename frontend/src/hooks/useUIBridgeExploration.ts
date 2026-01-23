"use client";

/**
 * UI Bridge Exploration Hook
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
 */

import { useState, useCallback, useRef } from "react";

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Target type for UI Bridge exploration
 */
export type TargetType = "web" | "desktop" | "mobile";

/**
 * Configuration for UI Bridge exploration
 */
export interface UIBridgeExplorationConfig {
  /** Target type: web, desktop (Tauri), or mobile (React Native) */
  targetType: TargetType;
  /** Target URL to explore (required - the application to automate) */
  targetUrl: string;
  /** Maximum depth of navigation (0 = current page only) */
  maxDepth: number;
  /** Maximum elements to click per page */
  maxElementsPerPage: number;
  /** Maximum total elements to click */
  maxTotalElements: number;
  /** Delay between actions in milliseconds */
  actionDelayMs: number;
  /** Keywords in element text/label that should be blocked */
  blockedKeywords: string[];
  /** Keywords that are safe even if they might seem dangerous */
  safeKeywords: string[];
  /** CSS selectors to skip */
  blockedSelectors: string[];
  /** Element types to interact with */
  allowedTypes: string[];
  /** Whether to capture render log after each action */
  captureRenderLogs: boolean;
  /** Whether to track and avoid revisiting same states */
  trackVisitedStates: boolean;
}

/**
 * Default exploration configuration
 */
export const DEFAULT_EXPLORATION_CONFIG: UIBridgeExplorationConfig = {
  targetType: "web",
  targetUrl: "",
  maxDepth: 2,
  maxElementsPerPage: 20,
  maxTotalElements: 100,
  actionDelayMs: 500,
  blockedKeywords: [
    "delete",
    "remove",
    "logout",
    "sign out",
    "cancel subscription",
    "deactivate",
    "close account",
    "unsubscribe",
  ],
  safeKeywords: [],
  blockedSelectors: [
    "[data-no-explore]",
    "[data-dangerous]",
  ],
  allowedTypes: ["button", "link", "tab", "menuitem"],
  captureRenderLogs: true,
  trackVisitedStates: true,
};

/**
 * Discovered element during exploration
 */
export interface ExploredElement {
  id: string;
  type: string;
  label?: string;
  tagName: string;
  actions: string[];
  url: string;
  depth: number;
  clicked: boolean;
  skipped: boolean;
  skipReason?: string;
  resultUrl?: string;
  timestamp: number;
}

/**
 * Render log entry captured during exploration
 */
export interface ExplorationRenderLog {
  id: string;
  url: string;
  timestamp: number;
  trigger: string;
  elementId?: string;
  snapshot: {
    root: unknown;
  };
}

/**
 * Exploration progress state
 */
export interface ExplorationProgress {
  status: "idle" | "running" | "paused" | "completed" | "failed";
  currentDepth: number;
  elementsDiscovered: number;
  elementsClicked: number;
  elementsSkipped: number;
  pagesVisited: number;
  renderLogsCollected: number;
  currentElement?: string;
  currentUrl: string;
  startTime?: number;
  endTime?: number;
  error?: string;
}

/**
 * Exploration results
 */
export interface ExplorationResults {
  elements: ExploredElement[];
  renderLogs: ExplorationRenderLog[];
  visitedUrls: string[];
  progress: ExplorationProgress;
}


/**
 * Hook for UI Bridge exploration
 */
export function useUIBridgeExploration() {
  const [config, setConfig] = useState<UIBridgeExplorationConfig>(
    DEFAULT_EXPLORATION_CONFIG
  );
  const [progress, setProgress] = useState<ExplorationProgress>({
    status: "idle",
    currentDepth: 0,
    elementsDiscovered: 0,
    elementsClicked: 0,
    elementsSkipped: 0,
    pagesVisited: 0,
    renderLogsCollected: 0,
    currentUrl: "",
  });
  const [results, setResults] = useState<ExplorationResults>({
    elements: [],
    renderLogs: [],
    visitedUrls: [],
    progress: progress,
  });

  const abortRef = useRef(false);
  const visitedStatesRef = useRef(new Set<string>());

  /**
   * Update configuration
   */
  const updateConfig = useCallback(
    (updates: Partial<UIBridgeExplorationConfig>) => {
      setConfig((prev) => ({ ...prev, ...updates }));
    },
    []
  );

  /**
   * Start exploration using the qontinui-runner's Playwright collection
   * @param runnerUrl - The runner URL to use for exploration (e.g., "http://localhost:9876")
   */
  const startExploration = useCallback(async (runnerUrl: string) => {
    if (!config.targetUrl) {
      throw new Error("Target URL is required");
    }

    if (!runnerUrl) {
      throw new Error("Runner URL is required");
    }

    abortRef.current = false;

    const initialProgress: ExplorationProgress = {
      status: "running",
      currentDepth: 0,
      elementsDiscovered: 0,
      elementsClicked: 0,
      elementsSkipped: 0,
      pagesVisited: 0,
      renderLogsCollected: 0,
      currentUrl: config.targetUrl,
      startTime: Date.now(),
    };

    setProgress(initialProgress);

    try {
      // Start Playwright collection via runner API
      const startResponse = await fetch(
        `${runnerUrl}/api/playwright/collection/start`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: config.targetUrl,
            max_depth: config.maxDepth,
            max_elements_per_page: config.maxElementsPerPage,
            max_risk_level: "safe",
            dry_run: false,
            verify_extractions: true,
            additional_blocked_keywords: config.blockedKeywords,
            additional_safe_keywords: config.safeKeywords,
            blocked_selectors: config.blockedSelectors,
          }),
        }
      );

      if (!startResponse.ok) {
        const error = await startResponse.json().catch(() => ({}));
        throw new Error(error.error || error.detail || "Failed to start exploration");
      }

      const startData = await startResponse.json();

      if (!startData.success) {
        throw new Error(startData.error || "Failed to start exploration");
      }

      const jobId = startData.data?.job_id;

      // Poll for status
      const pollStatus = async (): Promise<ExplorationResults | null> => {
        if (abortRef.current) {
          // Cancel the job
          await fetch(`${runnerUrl}/api/playwright/collection/stop`, {
            method: "POST",
          }).catch(() => {});
          return null;
        }

        const statusResponse = await fetch(
          `${runnerUrl}/api/playwright/collection/status${jobId ? `?job_id=${jobId}` : ""}`
        );

        if (!statusResponse.ok) {
          throw new Error("Failed to get exploration status");
        }

        const statusData = await statusResponse.json();
        const status = statusData.data;

        if (!status) {
          throw new Error("Invalid status response");
        }

        // Update progress
        setProgress((prev) => ({
          ...prev,
          currentUrl: status.url || config.targetUrl,
          currentElement: status.progress_message,
        }));

        if (status.status === "completed" || status.status === "failed") {
          // Get final results
          const resultsResponse = await fetch(
            `${runnerUrl}/api/playwright/collection/results${jobId ? `?job_id=${jobId}` : ""}`
          );

          if (!resultsResponse.ok) {
            throw new Error("Failed to get exploration results");
          }

          const resultsData = await resultsResponse.json();
          const results = resultsData.data;

          if (!results) {
            throw new Error("Invalid results response");
          }

          // Convert Playwright clickables to explored elements
          const clickables = results.clickables || [];
          const skippedDangerous = results.skipped_dangerous || [];
          const pagesVisited = results.pages_visited || [config.targetUrl];
          const metrics = results.metrics || {};

          const exploredElements: ExploredElement[] = [
            ...clickables.map((c: Record<string, unknown>, idx: number) => ({
              id: (c.element_id as string) || `element_${idx}`,
              type: inferElementType(c.tag_name as string, c.selector as string),
              label: (c.text as string) || (c.aria_label as string) || undefined,
              tagName: (c.tag_name as string) || "unknown",
              actions: ["click"],
              url: config.targetUrl,
              depth: 0,
              clicked: c.was_clicked as boolean || false,
              skipped: false,
              timestamp: Date.now(),
            })),
            ...skippedDangerous.map((s: Record<string, unknown>, idx: number) => ({
              id: `skipped_${idx}`,
              type: "dangerous",
              label: (s.text as string) || undefined,
              tagName: "unknown",
              actions: [],
              url: (s.url as string) || config.targetUrl,
              depth: 0,
              clicked: false,
              skipped: true,
              skipReason: `${s.risk}: ${s.reason}`,
              timestamp: Date.now(),
            })),
          ];

          // Create render logs from the exploration results
          // Each page visited becomes a render log with the elements found on that page
          const renderLogs: ExplorationRenderLog[] = pagesVisited.map(
            (pageUrl: string, idx: number) => {
              // Get elements found on this page
              const pageElements = clickables.filter(
                (c: Record<string, unknown>) => !c.url || c.url === pageUrl
              );

              // Build a minimal DOM snapshot from the elements
              const snapshot = {
                root: {
                  tag: "body",
                  children: pageElements.map((c: Record<string, unknown>) => ({
                    tag: c.tag_name || "div",
                    attributes: {
                      "data-testid": c.element_id || undefined,
                      "aria-label": c.aria_label || undefined,
                      class: c.selector ? extractClassFromSelector(c.selector as string) : undefined,
                    },
                    text: c.text || undefined,
                  })),
                },
              };

              return {
                id: `render_${idx}_${Date.now()}`,
                url: pageUrl,
                timestamp: Date.now() + idx,
                trigger: idx === 0 ? "initial_load" : "navigation",
                snapshot,
              };
            }
          );

          // Add render logs for each clicked element (state change)
          clickables.forEach((c: Record<string, unknown>, idx: number) => {
            if (c.was_clicked) {
              renderLogs.push({
                id: `render_click_${idx}_${Date.now()}`,
                url: config.targetUrl,
                timestamp: Date.now() + pagesVisited.length + idx,
                trigger: "click",
                elementId: (c.element_id as string) || `element_${idx}`,
                snapshot: {
                  root: {
                    tag: "body",
                    children: clickables
                      .filter((_: unknown, i: number) => i <= idx)
                      .map((el: Record<string, unknown>) => ({
                        tag: el.tag_name || "div",
                        attributes: {
                          "data-testid": el.element_id || undefined,
                        },
                        text: el.text || undefined,
                      })),
                  },
                },
              });
            }
          });

          const finalResults: ExplorationResults = {
            elements: exploredElements,
            renderLogs,
            visitedUrls: pagesVisited,
            progress: {
              status: status.status === "completed" ? "completed" : "failed",
              currentDepth: 0,
              elementsDiscovered: metrics.total_found || exploredElements.length,
              elementsClicked: metrics.clicked || exploredElements.filter((e) => e.clicked).length,
              elementsSkipped: metrics.skipped_dangerous || exploredElements.filter((e) => e.skipped).length,
              pagesVisited: metrics.pages_visited || pagesVisited.length,
              renderLogsCollected: renderLogs.length,
              currentUrl: config.targetUrl,
              startTime: initialProgress.startTime,
              endTime: Date.now(),
              error: status.error || results.error,
            },
          };

          setProgress(finalResults.progress);
          setResults(finalResults);
          return finalResults;
        }

        // Continue polling
        await sleep(1000);
        return pollStatus();
      };

      return await pollStatus();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Exploration failed";

      setProgress((prev) => ({
        ...prev,
        status: "failed",
        error: errorMessage,
        endTime: Date.now(),
      }));

      throw error;
    }
  }, [config]);

  /**
   * Infer element type from tag name and selector
   */
  function inferElementType(tagName: string, selector: string): string {
    const tag = tagName?.toLowerCase() || "";
    const sel = selector?.toLowerCase() || "";

    if (tag === "button" || sel.includes("button")) return "button";
    if (tag === "a" || sel.includes("link")) return "link";
    if (tag === "input") return "input";
    if (sel.includes("tab")) return "tab";
    if (sel.includes("menu")) return "menuitem";
    return "element";
  }

  /**
   * Extract class name from CSS selector
   */
  function extractClassFromSelector(selector: string): string | undefined {
    const match = selector.match(/\.([a-zA-Z0-9_-]+)/);
    return match ? match[1] : undefined;
  }

  /**
   * Stop exploration
   * @param runnerUrl - The runner URL to send stop request to (e.g., "http://localhost:9876")
   */
  const stopExploration = useCallback(async (runnerUrl?: string) => {
    abortRef.current = true;

    // Try to stop both Playwright and UI Bridge exploration
    if (runnerUrl) {
      try {
        await Promise.all([
          fetch(`${runnerUrl}/api/playwright/collection/stop`, { method: "POST" }).catch(() => {}),
          fetch(`${runnerUrl}/ui-bridge/explore/stop`, { method: "POST" }).catch(() => {}),
        ]);
      } catch {
        // Ignore errors when stopping
      }
    }

    setProgress((prev) => ({
      ...prev,
      status: "paused",
    }));
  }, []);

  /**
   * Reset exploration
   */
  const resetExploration = useCallback(() => {
    abortRef.current = false;
    visitedStatesRef.current.clear();
    setProgress({
      status: "idle",
      currentDepth: 0,
      elementsDiscovered: 0,
      elementsClicked: 0,
      elementsSkipped: 0,
      pagesVisited: 0,
      renderLogsCollected: 0,
      currentUrl: window.location.href,
    });
    setResults({
      elements: [],
      renderLogs: [],
      visitedUrls: [],
      progress: {
        status: "idle",
        currentDepth: 0,
        elementsDiscovered: 0,
        elementsClicked: 0,
        elementsSkipped: 0,
        pagesVisited: 0,
        renderLogsCollected: 0,
        currentUrl: window.location.href,
      },
    });
  }, []);

  /**
   * Start UI Bridge exploration via runner API
   * The runner uses the qontinui library's UIBridgeExplorer for proper target type handling
   * @param runnerUrl - The runner URL to use for exploration (e.g., "http://localhost:9876")
   */
  const startUIBridgeExploration = useCallback(async (runnerUrl: string) => {
    if (!config.targetUrl) {
      throw new Error("Target URL is required");
    }

    if (!runnerUrl) {
      throw new Error("Runner URL is required");
    }

    abortRef.current = false;

    const initialProgress: ExplorationProgress = {
      status: "running",
      currentDepth: 0,
      elementsDiscovered: 0,
      elementsClicked: 0,
      elementsSkipped: 0,
      pagesVisited: 0,
      renderLogsCollected: 0,
      currentUrl: config.targetUrl,
      startTime: Date.now(),
    };

    setProgress(initialProgress);

    try {
      // Start the exploration job via runner's UI Bridge explore endpoint
      const startResponse = await fetch(
        `${runnerUrl}/ui-bridge/explore`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            target_type: config.targetType,
            connection_url: config.targetUrl,
            max_depth: config.maxDepth,
            max_elements_per_page: config.maxElementsPerPage,
            max_total_elements: config.maxTotalElements,
            action_delay_ms: config.actionDelayMs,
            blocked_keywords: config.blockedKeywords,
            safe_keywords: config.safeKeywords,
            blocked_selectors: config.blockedSelectors,
            capture_screenshots: false,
            run_state_discovery: true,
          }),
        }
      );

      if (!startResponse.ok) {
        const error = await startResponse.json().catch(() => ({}));
        throw new Error(error.detail || error.error || "Failed to start UI Bridge exploration");
      }

      const startData = await startResponse.json();
      const responseData = startData.data || startData;

      if (!responseData.success && !responseData.job_id) {
        throw new Error(responseData.error || "Failed to start exploration");
      }

      const jobId = responseData.job_id;

      // Poll for status
      const pollStatus = async (): Promise<ExplorationResults | null> => {
        if (abortRef.current) {
          // Stop the exploration
          await fetch(`${runnerUrl}/ui-bridge/explore/stop`, {
            method: "POST",
          }).catch(() => {});
          return null;
        }

        const statusResponse = await fetch(
          `${runnerUrl}/ui-bridge/explore/status${jobId ? `?job_id=${jobId}` : ""}`
        );

        if (!statusResponse.ok) {
          throw new Error("Failed to get exploration status");
        }

        const statusData = await statusResponse.json();
        const status = statusData.data || statusData;

        // Update progress with current status
        setProgress((prev) => ({
          ...prev,
          elementsDiscovered: status.elements_discovered || prev.elementsDiscovered,
          elementsClicked: status.elements_explored || prev.elementsClicked,
          currentElement: status.current_element || status.progress_message,
          currentUrl: status.connection_url || config.targetUrl,
        }));

        if (status.status === "completed" || status.status === "failed") {
          // Get final results
          const resultsResponse = await fetch(
            `${runnerUrl}/ui-bridge/explore/results${jobId ? `?job_id=${jobId}` : ""}`
          );

          if (!resultsResponse.ok) {
            throw new Error("Failed to get exploration results");
          }

          const resultsData = await resultsResponse.json();
          const results = resultsData.data?.data || resultsData.data || resultsData;

          if (!results && status.status === "completed") {
            throw new Error("Invalid results response");
          }

          // Convert backend response to our result format
          const steps = results?.steps || [];
          const renderLogs = results?.render_logs || [];
          const stateDiscovery = results?.state_discovery;

          const exploredElements: ExploredElement[] = steps.map(
            (step: { element_id: string; action: string; success: boolean; state_changed?: boolean; depth?: number; timestamp: string }, idx: number) => ({
              id: step.element_id || `element_${idx}`,
              type: "element",
              label: step.element_id,
              tagName: "unknown",
              actions: [step.action],
              url: config.targetUrl,
              depth: step.depth || 0,
              clicked: step.success,
              skipped: !step.success,
              timestamp: new Date(step.timestamp).getTime(),
            })
          );

          const explorationRenderLogs: ExplorationRenderLog[] = renderLogs.map(
            (log: { id: string; url: string; timestamp: string; elements_count?: number }, idx: number) => ({
              id: log.id || `render_${idx}`,
              url: log.url || config.targetUrl,
              timestamp: new Date(log.timestamp).getTime(),
              trigger: idx === 0 ? "initial_load" : "action",
              snapshot: { root: {} }, // Simplified for now
            })
          );

          const finalResults: ExplorationResults = {
            elements: exploredElements,
            renderLogs: explorationRenderLogs,
            visitedUrls: [config.targetUrl],
            progress: {
              status: status.status === "completed" ? "completed" : "failed",
              currentDepth: 0,
              elementsDiscovered: results?.elements_discovered || exploredElements.length,
              elementsClicked: results?.elements_explored || exploredElements.filter((e) => e.clicked).length,
              elementsSkipped: exploredElements.filter((e) => e.skipped).length,
              pagesVisited: 1,
              renderLogsCollected: explorationRenderLogs.length,
              currentUrl: config.targetUrl,
              startTime: initialProgress.startTime,
              endTime: Date.now(),
              error: status.error,
            },
          };

          // Attach state discovery results if available
          if (stateDiscovery) {
            (finalResults as ExplorationResults & { stateDiscovery?: unknown }).stateDiscovery = stateDiscovery;
          }

          setProgress(finalResults.progress);
          setResults(finalResults);
          return finalResults;
        }

        // Continue polling
        await sleep(1000);
        return pollStatus();
      };

      return await pollStatus();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "UI Bridge exploration failed";

      setProgress((prev) => ({
        ...prev,
        status: "failed",
        error: errorMessage,
        endTime: Date.now(),
      }));

      throw error;
    }
  }, [config]);

  /**
   * Convert render logs to format expected by state discovery
   */
  const getRenderLogsForDiscovery = useCallback(() => {
    return results.renderLogs.map((log) => ({
      id: log.id,
      type: "dom_snapshot",
      page_url: log.url,
      snapshot: log.snapshot,
      timestamp: log.timestamp,
      trigger: log.trigger,
    }));
  }, [results.renderLogs]);

  return {
    config,
    updateConfig,
    progress,
    results,
    startExploration,
    startUIBridgeExploration,
    stopExploration,
    resetExploration,
    getRenderLogsForDiscovery,
    isRunning: progress.status === "running",
  };
}
