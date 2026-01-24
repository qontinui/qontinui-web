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
 * Raw Playwright job status (for compatibility with PlaywrightResultsView)
 */
export interface PlaywrightJobStatus {
  job_id: string;
  status: "idle" | "pending" | "running" | "completed" | "failed";
  url: string;
  progress_message?: string;
  progress_percent?: number;
  error?: string;
}

/**
 * Raw Playwright results (for compatibility with PlaywrightResultsView)
 */
export interface PlaywrightRawResults {
  clickables: Array<{
    element_id: string;
    selector: string;
    tag_name: string;
    text?: string | null;
    aria_label?: string | null;
    bounding_box: { x: number; y: number; width: number; height: number };
    risk_level?: string;
    risk_reason?: string;
    was_clicked: boolean;
    verified?: boolean;
    verification_confidence?: number;
    screenshot?: string;
    error?: string | null;
  }>;
  skipped_dangerous: Array<{
    selector: string;
    text?: string;
    risk: string;
    reason: string;
    url: string;
  }>;
  metrics: {
    total_found: number;
    clicked: number;
    skipped_dangerous: number;
    pages_visited: number;
    errors: number;
    verified?: number;
    unverified?: number;
  };
  pages_visited: string[];
  errors: string[];
}

/**
 * UI Bridge job status
 */
export interface UIBridgeJobStatus {
  job_id: string;
  status: "idle" | "pending" | "running" | "completed" | "failed";
  connection_url: string;
  target_type: string;
  progress_message?: string;
  progress_percent?: number;
  elements_discovered?: number;
  elements_explored?: number;
  current_element?: string;
  error?: string;
}

/**
 * Discovered state from co-occurrence analysis
 */
export interface UIBridgeDiscoveredState {
  id: string;
  name: string;
  state_image_ids: string[];
  screenshot_ids: string[];
  confidence: number;
}

/**
 * Discovered element from UI Bridge exploration
 */
export interface UIBridgeDiscoveredElement {
  id: string;
  name: string;
  type: string;
  render_ids: string[];
  tag_name?: string;
  text_content?: string;
  component_name?: string;
}

/**
 * State discovery results from co-occurrence analysis
 */
export interface UIBridgeStateDiscovery {
  states: UIBridgeDiscoveredState[];
  elements: UIBridgeDiscoveredElement[];
  element_to_renders: Record<string, string[]>;
  render_count: number;
  unique_element_count: number;
}

/**
 * Render log from UI Bridge exploration
 */
export interface UIBridgeRenderLog {
  id: string;
  timestamp: string;
  url: string;
  elements_count: number;
}

/**
 * Exploration step from UI Bridge
 */
export interface UIBridgeExplorationStep {
  step_id: string;
  timestamp: string;
  element_id: string;
  action: string;
  success: boolean;
  state_changed?: boolean;
  depth: number;
}

/**
 * Raw UI Bridge exploration results
 */
export interface UIBridgeRawResults {
  exploration_id: string;
  elements_discovered: number;
  elements_explored: number;
  steps: UIBridgeExplorationStep[];
  render_logs: UIBridgeRenderLog[];
  render_log_count: number;
  state_discovery?: UIBridgeStateDiscovery;
  errors: string[];
  start_time?: string;
  end_time?: string;
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

  // Raw Playwright results for compatibility with PlaywrightResultsView
  const [playwrightJob, setPlaywrightJob] = useState<PlaywrightJobStatus>({
    job_id: "",
    status: "idle",
    url: "",
  });
  const [playwrightResults, setPlaywrightResults] = useState<PlaywrightRawResults | null>(null);

  // UI Bridge exploration results
  const [uiBridgeJob, setUIBridgeJob] = useState<UIBridgeJobStatus>({
    job_id: "",
    status: "idle",
    connection_url: "",
    target_type: "web",
  });
  const [uiBridgeResults, setUIBridgeResults] = useState<UIBridgeRawResults | null>(null);

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

    // Reset state before starting new exploration
    abortRef.current = false;
    visitedStatesRef.current.clear();
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
        currentUrl: config.targetUrl,
      },
    });
    // Reset raw Playwright results
    setPlaywrightJob({
      job_id: "",
      status: "pending",
      url: config.targetUrl,
    });
    setPlaywrightResults(null);

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
        `${runnerUrl}/playwright-collection/start`,
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

      // Update Playwright job with the new job ID
      setPlaywrightJob({
        job_id: jobId || "",
        status: "running",
        url: config.targetUrl,
      });

      // Poll for status
      const pollStatus = async (): Promise<ExplorationResults | null> => {
        if (abortRef.current) {
          // Cancel the job
          await fetch(`${runnerUrl}/playwright-collection/stop`, {
            method: "POST",
          }).catch(() => {});
          setPlaywrightJob(prev => ({ ...prev, status: "failed", error: "Cancelled" }));
          return null;
        }

        const statusResponse = await fetch(
          `${runnerUrl}/playwright-collection/status${jobId ? `?job_id=${jobId}` : ""}`
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

        // Update Playwright job status
        setPlaywrightJob(prev => ({
          ...prev,
          status: status.status,
          progress_message: status.progress_message,
          progress_percent: status.progress_percent,
          error: status.error,
        }));

        if (status.status === "completed" || status.status === "failed") {
          // Get final results
          const resultsResponse = await fetch(
            `${runnerUrl}/playwright-collection/results${jobId ? `?job_id=${jobId}` : ""}`
          );

          if (!resultsResponse.ok) {
            throw new Error("Failed to get exploration results");
          }

          const resultsData = await resultsResponse.json();
          const results = resultsData.data;

          if (!results) {
            throw new Error("Invalid results response");
          }

          // Store raw Playwright results for PlaywrightResultsView compatibility
          const rawResults: PlaywrightRawResults = {
            clickables: results.clickables || [],
            skipped_dangerous: results.skipped_dangerous || [],
            metrics: results.metrics || {
              total_found: 0,
              clicked: 0,
              skipped_dangerous: 0,
              pages_visited: 0,
              errors: 0,
            },
            pages_visited: results.pages_visited || [config.targetUrl],
            errors: results.errors || [],
          };
          setPlaywrightResults(rawResults);

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
          fetch(`${runnerUrl}/playwright-collection/stop`, { method: "POST" }).catch(() => {}),
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

    // Reset state before starting new exploration
    abortRef.current = false;
    visitedStatesRef.current.clear();
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
        currentUrl: config.targetUrl,
      },
    });
    // Reset UI Bridge state
    setUIBridgeJob({
      job_id: "",
      status: "pending",
      connection_url: config.targetUrl,
      target_type: config.targetType,
    });
    setUIBridgeResults(null);

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
      let startResponse: Response;
      try {
        startResponse = await fetch(
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
      } catch (fetchError) {
        // Network error - runner not available
        throw new Error(
          `Could not connect to the qontinui-runner at ${runnerUrl}. ` +
          `Make sure the runner application is running. ` +
          `You can start it with: cd qontinui-runner && npm run tauri dev`
        );
      }

      if (!startResponse.ok) {
        const error = await startResponse.json().catch(() => ({}));

        // Provide specific error messages based on the error type
        const errorDetail = error.detail || error.error || "";

        if (startResponse.status === 404) {
          throw new Error(
            `UI Bridge exploration endpoint not found at ${runnerUrl}. ` +
            `Make sure you're using a compatible version of qontinui-runner.`
          );
        }

        if (errorDetail.toLowerCase().includes("connection refused") ||
            errorDetail.toLowerCase().includes("could not connect")) {
          if (config.targetType === "web") {
            throw new Error(
              `Could not connect to ${config.targetUrl}. ` +
              `Make sure the web application is running and accessible.`
            );
          } else {
            throw new Error(
              `Could not connect to the target application. ` +
              `Make sure your ${config.targetType} app is running and connected to the runner.`
            );
          }
        }

        if (errorDetail.toLowerCase().includes("ui bridge") ||
            errorDetail.toLowerCase().includes("sdk not found") ||
            errorDetail.toLowerCase().includes("404")) {
          throw new Error(
            `UI Bridge SDK not found at ${config.targetUrl}. ` +
            `The target application must have the UI Bridge SDK installed and configured. ` +
            `For web apps, install @qontinui/ui-bridge and add the provider to your app.`
          );
        }

        if (errorDetail.toLowerCase().includes("no app connected") ||
            errorDetail.toLowerCase().includes("websocket") ||
            errorDetail.toLowerCase().includes("no desktop") ||
            errorDetail.toLowerCase().includes("no mobile")) {
          throw new Error(
            `No ${config.targetType} application connected to the runner. ` +
            `Start your ${config.targetType === "desktop" ? "Tauri" : "React Native"} app ` +
            `and ensure it connects to the runner via WebSocket.`
          );
        }

        if (errorDetail.toLowerCase().includes("timeout")) {
          throw new Error(
            `Connection to ${config.targetUrl} timed out. ` +
            `The target application may be unresponsive or the network connection is slow.`
          );
        }

        throw new Error(error.detail || error.error || "Failed to start UI Bridge exploration");
      }

      const startData = await startResponse.json();
      const responseData = startData.data || startData;

      if (!responseData.success && !responseData.job_id) {
        throw new Error(responseData.error || "Failed to start exploration");
      }

      const jobId = responseData.job_id;

      // Update UI Bridge job with ID
      setUIBridgeJob(prev => ({
        ...prev,
        job_id: jobId || "",
        status: "running",
      }));

      // Poll for status
      const pollStatus = async (): Promise<ExplorationResults | null> => {
        if (abortRef.current) {
          // Stop the exploration
          await fetch(`${runnerUrl}/ui-bridge/explore/stop`, {
            method: "POST",
          }).catch(() => {});
          setUIBridgeJob(prev => ({ ...prev, status: "failed", error: "Cancelled" }));
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

        // Update UI Bridge job status
        setUIBridgeJob(prev => ({
          ...prev,
          status: status.status,
          progress_message: status.progress_message,
          progress_percent: status.progress_percent,
          elements_discovered: status.elements_discovered,
          elements_explored: status.elements_explored,
          current_element: status.current_element,
          error: status.error,
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

          // Store raw UI Bridge results
          const rawUIBridgeResults: UIBridgeRawResults = {
            exploration_id: results?.exploration_id || jobId || "",
            elements_discovered: results?.elements_discovered || 0,
            elements_explored: results?.elements_explored || 0,
            steps: results?.steps || [],
            render_logs: results?.render_logs || [],
            render_log_count: results?.render_log_count || results?.render_logs?.length || 0,
            state_discovery: results?.state_discovery,
            errors: results?.errors || [],
            start_time: results?.start_time,
            end_time: results?.end_time,
          };
          setUIBridgeResults(rawUIBridgeResults);

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
      let errorMessage = error instanceof Error ? error.message : "UI Bridge exploration failed";

      // If it's a generic error, provide more context based on target type
      if (errorMessage === "UI Bridge exploration failed" || errorMessage === "Failed to fetch") {
        if (config.targetType === "web") {
          errorMessage = `Could not connect to ${config.targetUrl}. Make sure the web application is running.`;
        } else if (config.targetType === "desktop") {
          errorMessage = `Could not connect to desktop application. Make sure the Tauri app is running and connected to the runner.`;
        } else if (config.targetType === "mobile") {
          errorMessage = `Could not connect to mobile application. Make sure the React Native app is running and connected to the runner.`;
        }
      }

      setProgress((prev) => ({
        ...prev,
        status: "failed",
        error: errorMessage,
        endTime: Date.now(),
      }));

      // Update UI Bridge job status with error
      setUIBridgeJob(prev => ({
        ...prev,
        status: "failed",
        error: errorMessage,
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
    // Raw Playwright results for PlaywrightResultsView compatibility
    playwrightJob,
    playwrightResults,
    // Raw UI Bridge results for UIBridgeResultsView
    uiBridgeJob,
    uiBridgeResults,
  };
}
