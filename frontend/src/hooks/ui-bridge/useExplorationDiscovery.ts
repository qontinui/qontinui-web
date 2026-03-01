"use client";

/**
 * Exploration Discovery Hook
 *
 * Manages exploration session state, including database-persisted sessions,
 * config persistence, progress tracking, and results management.
 */

import { useState, useCallback, useRef, useEffect } from "react";

import {
  DEFAULT_EXPLORATION_CONFIG,
  type ExplorationProgress,
  type ExplorationResults,
  type ExplorationSession,
  type ExplorationSessionResponse,
  type PlaywrightJobStatus,
  type PlaywrightRawResults,
  type UIBridgeExplorationConfig,
  type UIBridgeJobStatus,
  type UIBridgeRawResults,
} from "./types";
import {
  loadPersistedConfig,
  persistConfig,
  toExplorationSession,
} from "./utils";
import { createLogger } from "@/lib/logger";
const logger = createLogger("UseExplorationDiscovery");

export interface UseExplorationDiscoveryReturn {
  /** Current exploration configuration */
  config: UIBridgeExplorationConfig;
  /** Update configuration with partial values */
  updateConfig: (updates: Partial<UIBridgeExplorationConfig>) => void;
  /** Current exploration progress */
  progress: ExplorationProgress;
  /** Set progress state */
  setProgress: React.Dispatch<React.SetStateAction<ExplorationProgress>>;
  /** Exploration results */
  results: ExplorationResults;
  /** Set results state */
  setResults: React.Dispatch<React.SetStateAction<ExplorationResults>>;
  /** Playwright job status */
  playwrightJob: PlaywrightJobStatus;
  /** Set Playwright job status */
  setPlaywrightJob: React.Dispatch<React.SetStateAction<PlaywrightJobStatus>>;
  /** Playwright raw results */
  playwrightResults: PlaywrightRawResults | null;
  /** Set Playwright raw results */
  setPlaywrightResults: React.Dispatch<
    React.SetStateAction<PlaywrightRawResults | null>
  >;
  /** UI Bridge job status */
  uiBridgeJob: UIBridgeJobStatus;
  /** Set UI Bridge job status */
  setUIBridgeJob: React.Dispatch<React.SetStateAction<UIBridgeJobStatus>>;
  /** UI Bridge raw results */
  uiBridgeResults: UIBridgeRawResults | null;
  /** Set UI Bridge raw results */
  setUIBridgeResults: React.Dispatch<
    React.SetStateAction<UIBridgeRawResults | null>
  >;
  /** Current database-persisted exploration session */
  currentSession: ExplorationSession | null;
  /** Ref to current session for use in async callbacks */
  currentSessionRef: React.MutableRefObject<ExplorationSession | null>;
  /** Abort ref for cancellation */
  abortRef: React.MutableRefObject<boolean>;
  /** Visited states ref for deduplication */
  visitedStatesRef: React.MutableRefObject<Set<string>>;
  /** Create a new exploration session in the database */
  createExplorationSession: (
    projectId: string,
    authToken: string,
    apiUrl: string
  ) => Promise<ExplorationSession | null>;
  /** Append render logs to the current session */
  appendRendersToSession: (
    projectId: string,
    sessionId: string,
    authToken: string,
    apiUrl: string,
    renderLogs: unknown[],
    elementsDiscovered?: number,
    elementsExplored?: number
  ) => Promise<boolean>;
  /** Update session status in the database */
  updateSessionStatus: (
    projectId: string,
    sessionId: string,
    authToken: string,
    apiUrl: string,
    status: "running" | "completed" | "failed" | "cancelled",
    errorMessage?: string
  ) => Promise<boolean>;
  /** Whether the exploration is currently running */
  isRunning: boolean;
}

/**
 * Hook for managing exploration discovery state.
 *
 * Handles config persistence (localStorage), progress tracking,
 * exploration results, and database session management.
 */
export function useExplorationDiscovery(): UseExplorationDiscoveryReturn {
  const [config, setConfig] = useState<UIBridgeExplorationConfig>(
    DEFAULT_EXPLORATION_CONFIG
  );
  const [isConfigLoaded, setIsConfigLoaded] = useState(false);
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
  const [playwrightResults, setPlaywrightResults] =
    useState<PlaywrightRawResults | null>(null);

  // UI Bridge exploration results
  const [uiBridgeJob, setUIBridgeJob] = useState<UIBridgeJobStatus>({
    job_id: "",
    status: "idle",
    connection_url: "",
    target_type: "web",
  });
  const [uiBridgeResults, setUIBridgeResults] =
    useState<UIBridgeRawResults | null>(null);

  // Database-persisted exploration session
  const [currentSession, setCurrentSession] =
    useState<ExplorationSession | null>(null);
  const currentSessionRef = useRef<ExplorationSession | null>(null);

  const abortRef = useRef(false);
  const visitedStatesRef = useRef(new Set<string>());

  // Load persisted config on mount
  useEffect(() => {
    const persisted = loadPersistedConfig();
    setConfig(persisted);
    setIsConfigLoaded(true);
  }, []);

  // Persist config when it changes (after initial load)
  useEffect(() => {
    if (isConfigLoaded) {
      persistConfig(config);
    }
  }, [config, isConfigLoaded]);

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
   * Create an exploration session in the database
   */
  const createExplorationSession = useCallback(
    async (
      projectId: string,
      authToken: string,
      apiUrl: string
    ): Promise<ExplorationSession | null> => {
      try {
        const response = await fetch(
          `${apiUrl}/api/v1/projects/${projectId}/exploration-sessions`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${authToken}`,
            },
            body: JSON.stringify({
              name: `Exploration ${new Date().toLocaleString()}`,
              target_type: config.targetType,
              target_url:
                config.targetType !== "extension" ? config.targetUrl : null,
              exploration_config: {
                maxDepth: config.maxDepth,
                maxElementsPerPage: config.maxElementsPerPage,
                maxTotalElements: config.maxTotalElements,
                actionDelayMs: config.actionDelayMs,
                blockedKeywords: config.blockedKeywords,
                safeKeywords: config.safeKeywords,
                blockedSelectors: config.blockedSelectors,
              },
            }),
          }
        );

        if (!response.ok) {
          logger.error(
            "[useExplorationDiscovery] Failed to create exploration session:",
            response.statusText
          );
          return null;
        }

        const data = (await response.json()) as ExplorationSessionResponse;
        const session = toExplorationSession(data);
        setCurrentSession(session);
        currentSessionRef.current = session;
        return session;
      } catch (error) {
        logger.error(
          "[useExplorationDiscovery] Failed to create exploration session:",
          error
        );
        return null;
      }
    },
    [config]
  );

  /**
   * Append render logs to the current session
   */
  const appendRendersToSession = useCallback(
    async (
      projectId: string,
      sessionId: string,
      authToken: string,
      apiUrl: string,
      renderLogs: unknown[],
      elementsDiscovered?: number,
      elementsExplored?: number
    ): Promise<boolean> => {
      if (renderLogs.length === 0) return true;

      try {
        const response = await fetch(
          `${apiUrl}/api/v1/projects/${projectId}/exploration-sessions/${sessionId}/renders`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${authToken}`,
            },
            body: JSON.stringify({
              render_logs: renderLogs,
              elements_discovered: elementsDiscovered,
              elements_explored: elementsExplored,
            }),
          }
        );

        if (!response.ok) {
          logger.error(
            "[useExplorationDiscovery] Failed to append renders:",
            response.statusText
          );
          return false;
        }

        const data = (await response.json()) as ExplorationSessionResponse;
        const session = toExplorationSession(data);
        setCurrentSession(session);
        currentSessionRef.current = session;
        return true;
      } catch (error) {
        logger.error(
          "[useExplorationDiscovery] Failed to append renders:",
          error
        );
        return false;
      }
    },
    []
  );

  /**
   * Update exploration session status
   */
  const updateSessionStatus = useCallback(
    async (
      projectId: string,
      sessionId: string,
      authToken: string,
      apiUrl: string,
      status: "running" | "completed" | "failed" | "cancelled",
      errorMessage?: string
    ): Promise<boolean> => {
      try {
        const response = await fetch(
          `${apiUrl}/api/v1/projects/${projectId}/exploration-sessions/${sessionId}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${authToken}`,
            },
            body: JSON.stringify({
              status,
              error_message: errorMessage,
            }),
          }
        );

        if (!response.ok) {
          logger.error(
            "[useExplorationDiscovery] Failed to update session status:",
            response.statusText
          );
          return false;
        }

        const data = (await response.json()) as ExplorationSessionResponse;
        const session = toExplorationSession(data);
        setCurrentSession(session);
        currentSessionRef.current = session;
        return true;
      } catch (error) {
        logger.error(
          "[useExplorationDiscovery] Failed to update session status:",
          error
        );
        return false;
      }
    },
    []
  );

  return {
    config,
    updateConfig,
    progress,
    setProgress,
    results,
    setResults,
    playwrightJob,
    setPlaywrightJob,
    playwrightResults,
    setPlaywrightResults,
    uiBridgeJob,
    setUIBridgeJob,
    uiBridgeResults,
    setUIBridgeResults,
    currentSession,
    currentSessionRef,
    abortRef,
    visitedStatesRef,
    createExplorationSession,
    appendRendersToSession,
    updateSessionStatus,
    isRunning: progress.status === "running",
  };
}
