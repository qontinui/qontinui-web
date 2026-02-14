"use client";

/**
 * Exploration Strategy Hook
 *
 * Manages the actual exploration execution strategies:
 * - Playwright-based exploration (web crawling with click collection)
 * - UI Bridge exploration (SDK-based with render log capture)
 *
 * Handles starting, polling, stopping, and resetting explorations.
 */

import { useCallback } from "react";

import type {
  UIBridgeExplorationConfig,
  ExplorationProgress,
  ExplorationResults,
  ExplorationRenderLog,
  ExploredElement,
  PlaywrightRawResults,
  UIBridgeRawResults,
  PlaywrightJobStatus,
  UIBridgeJobStatus,
  ExplorationSession,
} from "./types";
import { sleep, inferElementType, extractClassFromSelector } from "./utils";
import { createLogger } from "@/lib/logger";
const logger = createLogger("UseExplorationStrategy");

export interface UseExplorationStrategyDeps {
  config: UIBridgeExplorationConfig;
  abortRef: React.MutableRefObject<boolean>;
  visitedStatesRef: React.MutableRefObject<Set<string>>;
  setProgress: React.Dispatch<React.SetStateAction<ExplorationProgress>>;
  setResults: React.Dispatch<React.SetStateAction<ExplorationResults>>;
  setPlaywrightJob: React.Dispatch<React.SetStateAction<PlaywrightJobStatus>>;
  setPlaywrightResults: React.Dispatch<
    React.SetStateAction<PlaywrightRawResults | null>
  >;
  setUIBridgeJob: React.Dispatch<React.SetStateAction<UIBridgeJobStatus>>;
  setUIBridgeResults: React.Dispatch<
    React.SetStateAction<UIBridgeRawResults | null>
  >;
  createExplorationSession: (
    projectId: string,
    authToken: string,
    apiUrl: string
  ) => Promise<ExplorationSession | null>;
  appendRendersToSession: (
    projectId: string,
    sessionId: string,
    authToken: string,
    apiUrl: string,
    renderLogs: unknown[],
    elementsDiscovered?: number,
    elementsExplored?: number
  ) => Promise<boolean>;
  updateSessionStatus: (
    projectId: string,
    sessionId: string,
    authToken: string,
    apiUrl: string,
    status: "running" | "completed" | "failed" | "cancelled",
    errorMessage?: string
  ) => Promise<boolean>;
}

export interface UseExplorationStrategyReturn {
  /** Start Playwright-based exploration */
  startExploration: (runnerUrl: string) => Promise<ExplorationResults | null>;
  /** Start UI Bridge exploration via runner API */
  startUIBridgeExploration: (
    runnerUrl: string,
    options?: {
      projectId?: string;
      authToken?: string;
      apiUrl?: string;
    }
  ) => Promise<ExplorationResults | null>;
  /** Stop the current exploration */
  stopExploration: (runnerUrl?: string) => Promise<void>;
  /** Reset exploration state */
  resetExploration: () => void;
}

/**
 * Hook for exploration strategy execution.
 *
 * Provides methods to start, poll, stop, and reset exploration runs
 * using either the Playwright or UI Bridge approach.
 */
export function useExplorationStrategy(
  deps: UseExplorationStrategyDeps
): UseExplorationStrategyReturn {
  const {
    config,
    abortRef,
    visitedStatesRef,
    setProgress,
    setResults,
    setPlaywrightJob,
    setPlaywrightResults,
    setUIBridgeJob,
    setUIBridgeResults,
    createExplorationSession,
    appendRendersToSession,
    updateSessionStatus,
  } = deps;

  /**
   * Start exploration using the qontinui-runner's Playwright collection
   */
  const startExploration = useCallback(
    async (runnerUrl: string) => {
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
          throw new Error(
            error.error || error.detail || "Failed to start exploration"
          );
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
            setPlaywrightJob((prev) => ({
              ...prev,
              status: "failed",
              error: "Cancelled",
            }));
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
          setPlaywrightJob((prev) => ({
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
                type: inferElementType(
                  c.tag_name as string,
                  c.selector as string
                ),
                label:
                  (c.text as string) || (c.aria_label as string) || undefined,
                tagName: (c.tag_name as string) || "unknown",
                actions: ["click"],
                url: config.targetUrl,
                depth: 0,
                clicked: (c.was_clicked as boolean) || false,
                skipped: false,
                timestamp: Date.now(),
              })),
              ...skippedDangerous.map(
                (s: Record<string, unknown>, idx: number) => ({
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
                })
              ),
            ];

            // Create render logs from the exploration results
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
                    children: pageElements.map(
                      (c: Record<string, unknown>) => ({
                        tag: c.tag_name || "div",
                        attributes: {
                          "data-testid": c.element_id || undefined,
                          "aria-label": c.aria_label || undefined,
                          class: c.selector
                            ? extractClassFromSelector(c.selector as string)
                            : undefined,
                        },
                        text: c.text || undefined,
                      })
                    ),
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
                elementsDiscovered:
                  metrics.total_found || exploredElements.length,
                elementsClicked:
                  metrics.clicked ||
                  exploredElements.filter((e) => e.clicked).length,
                elementsSkipped:
                  metrics.skipped_dangerous ||
                  exploredElements.filter((e) => e.skipped).length,
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
        const errorMessage =
          error instanceof Error ? error.message : "Exploration failed";

        setProgress((prev) => ({
          ...prev,
          status: "failed",
          error: errorMessage,
          endTime: Date.now(),
        }));

        throw error;
      }
    },
    [
      config,
      abortRef,
      visitedStatesRef,
      setResults,
      setProgress,
      setPlaywrightJob,
      setPlaywrightResults,
    ]
  );

  /**
   * Start UI Bridge exploration via runner API
   */
  const startUIBridgeExploration = useCallback(
    async (
      runnerUrl: string,
      options?: {
        projectId?: string;
        authToken?: string;
        apiUrl?: string;
      }
    ) => {
      // For extension mode, targetUrl is not required - we use the browser tab
      if (config.targetType !== "extension" && !config.targetUrl) {
        throw new Error("Target URL is required");
      }

      if (!runnerUrl) {
        throw new Error("Runner URL is required");
      }

      // For extension mode, use the runner URL as the connection URL
      const connectionUrl =
        config.targetType === "extension" ? runnerUrl : config.targetUrl;

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
          currentUrl: connectionUrl,
        },
      });
      // Reset UI Bridge state
      setUIBridgeJob({
        job_id: "",
        status: "pending",
        connection_url: connectionUrl,
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
        currentUrl: connectionUrl,
        startTime: Date.now(),
      };

      setProgress(initialProgress);

      // Create exploration session in database if persistence is enabled
      let session: ExplorationSession | null = null;
      const enablePersistence =
        options?.projectId && options?.authToken && options?.apiUrl;
      if (enablePersistence) {
        session = await createExplorationSession(
          options.projectId!,
          options.authToken!,
          options.apiUrl!
        );
        if (session) {
          logger.info(
            "[useExplorationStrategy] Created exploration session:",
            session.id
          );
        }
      }

      // Track render logs for periodic persistence
      let lastPersistedRenderCount = 0;
      const persistRendersBatch = async (
        renderLogs: unknown[],
        elementsDiscovered: number,
        elementsExplored: number
      ) => {
        if (!enablePersistence || !session) return;

        // Only persist new renders
        const newRenders = renderLogs.slice(lastPersistedRenderCount);
        if (newRenders.length === 0) return;

        const success = await appendRendersToSession(
          options.projectId!,
          session.id,
          options.authToken!,
          options.apiUrl!,
          newRenders,
          elementsDiscovered,
          elementsExplored
        );

        if (success) {
          lastPersistedRenderCount = renderLogs.length;
          logger.info(
            `[useExplorationStrategy] Persisted ${newRenders.length} renders (total: ${renderLogs.length})`
          );
        }
      };

      try {
        // Start the exploration job via runner's UI Bridge explore endpoint
        let startResponse: Response;
        try {
          // Build the request body
          const requestBody: Record<string, unknown> = {
            target_type: config.targetType,
            connection_url: connectionUrl,
            max_depth: config.maxDepth,
            max_elements_per_page: config.maxElementsPerPage,
            max_total_elements: config.maxTotalElements,
            action_delay_ms: config.actionDelayMs,
            blocked_keywords: config.blockedKeywords,
            safe_keywords: config.safeKeywords,
            blocked_selectors: config.blockedSelectors,
            capture_screenshots: false,
            run_state_discovery: true,
          };

          // For extension mode, include the selected browser tab ID if specified
          if (
            config.targetType === "extension" &&
            config.selectedBrowserTabId !== null
          ) {
            requestBody.browser_tab_id = config.selectedBrowserTabId;
          }

          startResponse = await fetch(`${runnerUrl}/ui-bridge/explore`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(requestBody),
          });
        } catch (_fetchError) {
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

          if (
            errorDetail.toLowerCase().includes("connection refused") ||
            errorDetail.toLowerCase().includes("could not connect")
          ) {
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

          if (
            errorDetail.toLowerCase().includes("ui bridge") ||
            errorDetail.toLowerCase().includes("sdk not found") ||
            errorDetail.toLowerCase().includes("404")
          ) {
            throw new Error(
              `UI Bridge SDK not found at ${config.targetUrl}. ` +
                `The target application must have the UI Bridge SDK installed and configured. ` +
                `For web apps, install @qontinui/ui-bridge and add the provider to your app.`
            );
          }

          if (
            errorDetail.toLowerCase().includes("no app connected") ||
            errorDetail.toLowerCase().includes("websocket") ||
            errorDetail.toLowerCase().includes("no desktop") ||
            errorDetail.toLowerCase().includes("no mobile")
          ) {
            if (config.targetType === "extension") {
              throw new Error(
                `Chrome extension not connected to the runner. ` +
                  `Make sure the Qontinui DevTools extension is installed and enabled in Chrome.`
              );
            }
            throw new Error(
              `No ${config.targetType} application connected to the runner. ` +
                `Start your ${config.targetType === "desktop" ? "Tauri" : "React Native"} app ` +
                `and ensure it connects to the runner via WebSocket.`
            );
          }

          if (
            errorDetail.toLowerCase().includes("extension not connected") ||
            errorDetail.toLowerCase().includes("chrome extension")
          ) {
            throw new Error(
              `Chrome extension not connected to the runner. ` +
                `Make sure the Qontinui DevTools extension is installed and enabled in Chrome, ` +
                `and that you have a browser tab open.`
            );
          }

          if (errorDetail.toLowerCase().includes("timeout")) {
            throw new Error(
              `Connection to ${config.targetUrl} timed out. ` +
                `The target application may be unresponsive or the network connection is slow.`
            );
          }

          throw new Error(
            error.detail ||
              error.error ||
              "Failed to start UI Bridge exploration"
          );
        }

        const startData = await startResponse.json();
        const responseData = startData.data || startData;

        if (!responseData.success && !responseData.job_id) {
          throw new Error(responseData.error || "Failed to start exploration");
        }

        const jobId = responseData.job_id;

        // Update UI Bridge job with ID
        setUIBridgeJob((prev) => ({
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
            setUIBridgeJob((prev) => ({
              ...prev,
              status: "failed",
              error: "Cancelled",
            }));
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
            elementsDiscovered:
              status.elements_discovered || prev.elementsDiscovered,
            elementsClicked: status.elements_explored || prev.elementsClicked,
            currentElement: status.current_element || status.progress_message,
            currentUrl: status.connection_url || config.targetUrl,
          }));

          // Update UI Bridge job status
          setUIBridgeJob((prev) => ({
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
            const results =
              resultsData.data?.data || resultsData.data || resultsData;

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
              render_log_count:
                results?.render_log_count || results?.render_logs?.length || 0,
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
              (
                step: {
                  element_id: string;
                  action: string;
                  success: boolean;
                  state_changed?: boolean;
                  depth?: number;
                  timestamp: string;
                },
                idx: number
              ) => ({
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

            const explorationRenderLogs: ExplorationRenderLog[] =
              renderLogs.map(
                (
                  log: {
                    id: string;
                    type?: string;
                    url: string;
                    timestamp: string;
                    elements_count?: number;
                    snapshot?: Record<string, unknown>;
                  },
                  idx: number
                ) => ({
                  id: log.id || `render_${idx}`,
                  url: log.url || config.targetUrl,
                  timestamp: new Date(log.timestamp).getTime(),
                  trigger: idx === 0 ? "initial_load" : "action",
                  snapshot: log.snapshot || { root: {} },
                })
              );

            const finalResults: ExplorationResults = {
              elements: exploredElements,
              renderLogs: explorationRenderLogs,
              visitedUrls: [config.targetUrl],
              progress: {
                status: status.status === "completed" ? "completed" : "failed",
                currentDepth: 0,
                elementsDiscovered:
                  results?.elements_discovered || exploredElements.length,
                elementsClicked:
                  results?.elements_explored ||
                  exploredElements.filter((e) => e.clicked).length,
                elementsSkipped: exploredElements.filter((e) => e.skipped)
                  .length,
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
              (
                finalResults as ExplorationResults & {
                  stateDiscovery?: unknown;
                }
              ).stateDiscovery = stateDiscovery;
            }

            // Persist final render logs to database
            if (enablePersistence && session) {
              await persistRendersBatch(
                renderLogs,
                results?.elements_discovered || exploredElements.length,
                results?.elements_explored ||
                  exploredElements.filter((e) => e.clicked).length
              );
              await updateSessionStatus(
                options.projectId!,
                session.id,
                options.authToken!,
                options.apiUrl!,
                status.status === "completed" ? "completed" : "failed",
                status.error
              );
              logger.info(
                `[useExplorationStrategy] Session ${session.id} marked as ${status.status}`
              );
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
        let errorMessage =
          error instanceof Error
            ? error.message
            : "UI Bridge exploration failed";

        // If it's a generic error, provide more context based on target type
        if (
          errorMessage === "UI Bridge exploration failed" ||
          errorMessage === "Failed to fetch"
        ) {
          if (config.targetType === "web") {
            errorMessage = `Could not connect to ${config.targetUrl}. Make sure the web application is running.`;
          } else if (config.targetType === "desktop") {
            errorMessage = `Could not connect to desktop application. Make sure the Tauri app is running and connected to the runner.`;
          } else if (config.targetType === "mobile") {
            errorMessage = `Could not connect to mobile application. Make sure the React Native app is running and connected to the runner.`;
          } else if (config.targetType === "extension") {
            errorMessage = `Could not connect via browser extension. Make sure the Qontinui DevTools extension is installed in Chrome and connected to the runner.`;
          }
        }

        setProgress((prev) => ({
          ...prev,
          status: "failed",
          error: errorMessage,
          endTime: Date.now(),
        }));

        // Update UI Bridge job status with error
        setUIBridgeJob((prev) => ({
          ...prev,
          status: "failed",
          error: errorMessage,
        }));

        // Update session status on error
        if (enablePersistence && session) {
          await updateSessionStatus(
            options.projectId!,
            session.id,
            options.authToken!,
            options.apiUrl!,
            "failed",
            errorMessage
          );
        }

        throw error;
      }
    },
    [
      config,
      abortRef,
      visitedStatesRef,
      setResults,
      setProgress,
      setUIBridgeJob,
      setUIBridgeResults,
      createExplorationSession,
      appendRendersToSession,
      updateSessionStatus,
    ]
  );

  /**
   * Stop exploration
   */
  const stopExploration = useCallback(
    async (runnerUrl?: string) => {
      abortRef.current = true;

      // Try to stop both Playwright and UI Bridge exploration
      if (runnerUrl) {
        try {
          await Promise.all([
            fetch(`${runnerUrl}/playwright-collection/stop`, {
              method: "POST",
            }).catch(() => {}),
            fetch(`${runnerUrl}/ui-bridge/explore/stop`, {
              method: "POST",
            }).catch(() => {}),
          ]);
        } catch {
          // Ignore errors when stopping
        }
      }

      setProgress((prev) => ({
        ...prev,
        status: "paused",
      }));
    },
    [abortRef, setProgress]
  );

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
  }, [abortRef, visitedStatesRef, setProgress, setResults]);

  return {
    startExploration,
    startUIBridgeExploration,
    stopExploration,
    resetExploration,
  };
}
