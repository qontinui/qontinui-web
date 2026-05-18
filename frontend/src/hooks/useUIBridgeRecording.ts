"use client";

/**
 * UI Bridge Recording Hook
 *
 * Enables manual recording mode for UI Bridge element capture.
 * The user turns on recording, navigates through the application manually,
 * and then turns off recording. During recording, DOM snapshots are captured
 * on user interactions (clicks, inputs, navigation).
 *
 * The captured snapshots can then be used for state discovery.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { createLogger } from "@/lib/logger";

const log = createLogger("useUIBridgeRecording");

/**
 * Element captured in a snapshot
 */
export interface RecordedElement {
  id: string;
  tagName: string;
  textContent: string | null;
  attributes: {
    class: string | null;
    type: string | null;
    role: string | null;
    ariaLabel: string | null;
    href: string | null;
    name: string | null;
    placeholder: string | null;
  };
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  isVisible: boolean;
  isEnabled: boolean;
  value: string | null;
}

/**
 * A captured DOM snapshot
 */
export interface RecordingSnapshot {
  id: string;
  timestamp: string;
  url: string;
  title: string;
  trigger: "initial" | "click" | "input" | "navigation" | "mutation" | "manual";
  triggerElement: {
    id: string | null;
    tagName: string | null;
    textContent: string | null;
  } | null;
  elements: RecordedElement[];
  elementCount: number;
}

/**
 * Recording session state
 */
export interface RecordingSession {
  isRecording: boolean;
  tabId: number | null;
  tabUrl: string | null;
  tabTitle: string | null;
  startTime: number | null;
  snapshots: RecordingSnapshot[];
  error: string | null;
}

/**
 * Recording options
 */
export interface RecordingOptions {
  /** Whether to capture DOM mutations (can be noisy) */
  captureMutations?: boolean;
}

/**
 * Result from the embedded SDK recording pipeline
 */
export interface RecordingPipelineResult {
  sessionId: string;
  duration: number;
  exportData: Record<string, unknown>;
  variables: Array<{
    fingerprint: string;
    elementId: string;
    inputType: string;
    enteredValue: string;
    label: string;
    suggestedParamName: string;
  }>;
  interactionCount: number;
  captureCount: number;
}

/**
 * State machine discovery result from the pipeline API
 */
export interface PipelineDiscoveryResult {
  sessionId: string;
  stateCount: number;
  transitionCount: number;
  globalStateCount: number;
  modalStateCount: number;
  states: Array<{
    id: string;
    name: string;
    elementCount: number;
    isBlocking: boolean;
    isGlobal: boolean;
    positionZone: string | null;
    confidence: number;
  }>;
  transitions: Array<{
    id: string;
    name: string;
    fromStates: string[];
    activateStates: string[];
    exitStates: string[];
    confidence: number;
    observationCount: number;
    isBidirectional: boolean;
  }>;
  playbookContent?: string;
}

/**
 * Raw snake_case shape of the runner-produced RecordingPipelineResult
 * payload (mirrors the Phase 4 schema at
 * qontinui_schemas.commands.recording_pipeline.ProcessRecordingResult.result).
 */
interface PipelineRunResultPayload {
  session_id: string;
  state_count: number;
  transition_count: number;
  global_state_count?: number;
  modal_state_count?: number;
  states: Array<{
    id: string;
    name: string;
    element_ids?: string[];
    element_count?: number;
    blocking?: boolean;
    metadata?: {
      is_global?: boolean;
      position_zone?: string | null;
      confidence?: number;
    };
  }>;
  transitions: Array<{
    id: string;
    name: string;
    from_states: string[];
    activate_states: string[];
    exit_states: string[];
    metadata?: {
      confidence?: number;
      observation_count?: number;
      is_bidirectional?: boolean;
    };
  }>;
  playbook_content?: string;
}

function mapPipelineRunResult(
  payload: PipelineRunResultPayload
): PipelineDiscoveryResult {
  return {
    sessionId: payload.session_id,
    stateCount: payload.state_count,
    transitionCount: payload.transition_count,
    globalStateCount: payload.global_state_count ?? 0,
    modalStateCount: payload.modal_state_count ?? 0,
    states: payload.states.map((s) => ({
      id: s.id,
      name: s.name,
      elementCount: s.element_count ?? s.element_ids?.length ?? 0,
      isBlocking: Boolean(s.blocking),
      isGlobal: Boolean(s.metadata?.is_global),
      positionZone: s.metadata?.position_zone ?? null,
      confidence: s.metadata?.confidence ?? 0,
    })),
    transitions: payload.transitions.map((t) => ({
      id: t.id,
      name: t.name,
      fromStates: t.from_states,
      activateStates: t.activate_states,
      exitStates: t.exit_states,
      confidence: t.metadata?.confidence ?? 0,
      observationCount: t.metadata?.observation_count ?? 0,
      isBidirectional: Boolean(t.metadata?.is_bidirectional),
    })),
    playbookContent: payload.playbook_content,
  };
}

const INITIAL_SESSION: RecordingSession = {
  isRecording: false,
  tabId: null,
  tabUrl: null,
  tabTitle: null,
  startTime: null,
  snapshots: [],
  error: null,
};

/**
 * Hook for UI Bridge recording
 */
export function useUIBridgeRecording() {
  const [session, setSession] = useState<RecordingSession>(INITIAL_SESSION);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Start recording on a specific tab
   */
  const startRecording = useCallback(
    async (
      runnerUrl: string,
      tabId: number | null,
      options: RecordingOptions = {}
    ) => {
      setIsStarting(true);
      setSession((prev) => ({ ...prev, error: null }));

      try {
        const response = await fetch(`${runnerUrl}/extension/command`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "startRecording",
            params: {
              tabId,
              captureMutations: options.captureMutations ?? true,
            },
            timeout_secs: 15,
          }),
        });

        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error.error || "Failed to start recording");
        }

        const result = await response.json();
        if (!result.success) {
          throw new Error(result.error || "Failed to start recording");
        }

        const data = result.data;
        log.debug("Recording started:", data);

        setSession({
          isRecording: true,
          tabId: data.tabId,
          tabUrl: data.initialSnapshot?.url || null,
          tabTitle: data.initialSnapshot?.title || null,
          startTime: Date.now(),
          snapshots: data.initialSnapshot ? [data.initialSnapshot] : [],
          error: null,
        });

        return { success: true, tabId: data.tabId };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to start recording";
        setSession((prev) => ({ ...prev, error: message }));
        return { success: false, error: message };
      } finally {
        setIsStarting(false);
      }
    },
    []
  );

  /**
   * Stop recording and get all captured snapshots
   */
  const stopRecording = useCallback(async (runnerUrl: string) => {
    setIsStopping(true);

    try {
      const response = await fetch(`${runnerUrl}/extension/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "stopRecording",
          params: {},
          timeout_secs: 15,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Failed to stop recording");
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || "Failed to stop recording");
      }

      const data = result.data;
      log.debug("Recording stopped:", data.snapshotCount, "snapshots");

      // Update session with final snapshots
      setSession((prev) => ({
        ...prev,
        isRecording: false,
        snapshots: data.snapshots || prev.snapshots,
      }));

      return {
        success: true,
        snapshotCount: data.snapshotCount,
        snapshots: data.snapshots,
        duration: data.duration,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to stop recording";
      setSession((prev) => ({ ...prev, error: message, isRecording: false }));
      return { success: false, error: message };
    } finally {
      setIsStopping(false);
    }
  }, []);

  /**
   * Get current recording status
   */
  const getRecordingStatus = useCallback(async (runnerUrl: string) => {
    try {
      const response = await fetch(`${runnerUrl}/extension/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "getRecordingStatus",
          params: {},
          timeout_secs: 10,
        }),
      });

      if (!response.ok) {
        return null;
      }

      const result = await response.json();
      if (!result.success) {
        return null;
      }

      return result.data;
    } catch {
      return null;
    }
  }, []);

  /**
   * Manually trigger a capture
   */
  const captureNow = useCallback(async (runnerUrl: string) => {
    try {
      const response = await fetch(`${runnerUrl}/extension/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "captureNow",
          params: {},
          timeout_secs: 10,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to capture");
      }

      const result = await response.json();
      return result.data;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to capture";
      return { success: false, error: message };
    }
  }, []);

  /**
   * Poll for snapshot updates during recording
   */
  const pollSnapshots = useCallback(
    async (runnerUrl: string) => {
      if (!session.isRecording) return;

      try {
        const response = await fetch(`${runnerUrl}/extension/command`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "getRecordingSnapshots",
            params: {},
            timeout_secs: 10,
          }),
        });

        if (response.ok) {
          const result = await response.json();
          if (result.success && result.data?.snapshots) {
            setSession((prev) => ({
              ...prev,
              snapshots: result.data.snapshots,
            }));
          }
        }
      } catch {
        // Ignore polling errors
      }
    },
    [session.isRecording]
  );

  /**
   * Start polling for updates while recording
   */
  const startPolling = useCallback(
    (runnerUrl: string, intervalMs: number = 2000) => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }

      pollingRef.current = setInterval(() => {
        pollSnapshots(runnerUrl);
      }, intervalMs);
    },
    [pollSnapshots]
  );

  /**
   * Stop polling
   */
  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  /**
   * Reset session (clear all data)
   */
  const resetSession = useCallback(() => {
    stopPolling();
    setSession(INITIAL_SESSION);
  }, [stopPolling]);

  /**
   * Convert snapshots to render logs format for state discovery
   */
  const getSnapshotsAsRenderLogs = useCallback(() => {
    return session.snapshots.map((snapshot) => ({
      id: snapshot.id,
      type: "dom_snapshot",
      page_url: snapshot.url,
      snapshot: {
        root: {
          elements: snapshot.elements,
          url: snapshot.url,
          title: snapshot.title,
        },
      },
      timestamp: new Date(snapshot.timestamp).getTime(),
      trigger: snapshot.trigger,
    }));
  }, [session.snapshots]);

  // =========================================================================
  // UI Bridge Embedded SDK Recording (WebSocket-based)
  // =========================================================================

  const [pipelineResult, setPipelineResult] =
    useState<PipelineDiscoveryResult | null>(null);
  const [sdkRecordingResult, setSdkRecordingResult] =
    useState<RecordingPipelineResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  /**
   * Start recording via the embedded UI Bridge SDK (WebSocket).
   * Use this when connected to a UI Bridge-enabled app.
   */
  const startSdkRecording = useCallback(
    async (wsUrl: string, config?: Record<string, unknown>) => {
      setIsStarting(true);
      setSession((prev) => ({ ...prev, error: null }));

      try {
        const ws = new WebSocket(wsUrl);
        await new Promise<void>((resolve, reject) => {
          ws.onopen = () => resolve();
          ws.onerror = () => reject(new Error("WebSocket connection failed"));
          setTimeout(() => reject(new Error("Connection timeout")), 5000);
        });

        // Send recording:start
        const requestId = `req-${Date.now()}`;
        const response = await new Promise<Record<string, unknown>>(
          (resolve, reject) => {
            ws.onmessage = (event) => {
              const msg = JSON.parse(event.data);
              if (msg.requestId === requestId && msg.type === "response") {
                resolve(msg.payload);
              }
            };
            ws.send(
              JSON.stringify({
                id: requestId,
                type: "recording:start",
                timestamp: Date.now(),
                config,
              })
            );
            setTimeout(
              () => reject(new Error("Start recording timeout")),
              10000
            );
          }
        );

        if (!(response as { success?: boolean }).success) {
          throw new Error("Failed to start SDK recording");
        }

        ws.close();

        setSession({
          isRecording: true,
          tabId: null,
          tabUrl: null,
          tabTitle: null,
          startTime: Date.now(),
          snapshots: [],
          error: null,
        });

        log.debug("SDK recording started");
        return { success: true };
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to start SDK recording";
        setSession((prev) => ({ ...prev, error: message }));
        return { success: false, error: message };
      } finally {
        setIsStarting(false);
      }
    },
    []
  );

  /**
   * Stop recording via the embedded UI Bridge SDK (WebSocket).
   * Returns the CooccurrenceExport data for pipeline processing.
   */
  const stopSdkRecording = useCallback(async (wsUrl: string) => {
    setIsStopping(true);

    try {
      const ws = new WebSocket(wsUrl);
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error("WebSocket connection failed"));
        setTimeout(() => reject(new Error("Connection timeout")), 5000);
      });

      const requestId = `req-${Date.now()}`;
      const response = await new Promise<Record<string, unknown>>(
        (resolve, reject) => {
          ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.requestId === requestId && msg.type === "response") {
              resolve(msg.payload);
            }
          };
          ws.send(
            JSON.stringify({
              id: requestId,
              type: "recording:stop",
              timestamp: Date.now(),
            })
          );
          setTimeout(() => reject(new Error("Stop recording timeout")), 30000);
        }
      );

      ws.close();

      const result = (response as { data?: RecordingPipelineResult }).data;
      if (!result) throw new Error("No recording data returned");

      setSdkRecordingResult(result);

      setSession((prev) => ({
        ...prev,
        isRecording: false,
      }));

      log.debug(
        "SDK recording stopped:",
        result.interactionCount,
        "interactions,",
        result.captureCount,
        "captures"
      );

      return { success: true, result };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to stop SDK recording";
      setSession((prev) => ({ ...prev, error: message, isRecording: false }));
      return { success: false, error: message };
    } finally {
      setIsStopping(false);
    }
  }, []);

  /**
   * Process the SDK recording result through the pipeline API.
   * Discovers states, transitions, and optionally generates a playbook.
   *
   * As of Phase 4 of plan 2026-05-17-web-runner-ws-bridge-plan-b.md,
   * the pipeline endpoints are async: POST returns 202 + {run_id};
   * the actual compute runs on the user's connected runner over the WS
   * bridge. This hook polls GET /runs/{run_id} until the run reaches
   * a terminal status ("completed", "failed", "timed_out"), then
   * resolves the result into the legacy PipelineDiscoveryResult shape
   * for unchanged downstream consumers.
   */
  const processRecording = useCallback(
    async (
      apiBaseUrl: string,
      options?: {
        generatePlaybook?: boolean;
        appName?: string;
        appUrl?: string;
      }
    ) => {
      if (!sdkRecordingResult) {
        return { success: false, error: "No recording result to process" };
      }

      setIsProcessing(true);

      try {
        const endpoint = options?.generatePlaybook
          ? "/api/v1/recording-pipeline/process-with-playbook"
          : "/api/v1/recording-pipeline/process";

        const body: Record<string, unknown> = {
          export_data: sdkRecordingResult.exportData,
        };

        if (options?.generatePlaybook) {
          body.variables = sdkRecordingResult.variables;
          body.app_name = options.appName;
          body.app_url = options.appUrl;
        }

        const dispatchResponse = await fetch(`${apiBaseUrl}${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!dispatchResponse.ok) {
          const error = await dispatchResponse.json().catch(() => ({}));
          throw new Error(
            (error as { detail?: string | { message?: string } }).detail &&
              typeof (
                error as { detail?: string | { message?: string } }
              ).detail === "object"
              ? (error.detail as { message?: string }).message ||
                "Pipeline dispatch failed"
              : ((error as { detail?: string }).detail as string) ||
                "Pipeline dispatch failed"
          );
        }

        const accepted = (await dispatchResponse.json()) as {
          run_id: string;
          status: string;
        };

        // Poll the run status until terminal.
        const POLL_INTERVAL_MS = 2000;
        const POLL_TIMEOUT_MS = 30 * 60 * 1000; // matches runner-side TTL
        const startedAt = Date.now();
        let terminal: {
          run_id: string;
          status: string;
          result?: PipelineRunResultPayload | null;
          error?: { error: string; message: string; traceback?: string } | null;
        } | null = null;

        while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
          const statusResp = await fetch(
            `${apiBaseUrl}/api/v1/recording-pipeline/runs/${accepted.run_id}`,
            { method: "GET" }
          );
          if (!statusResp.ok) {
            throw new Error(
              `Failed to poll run ${accepted.run_id}: HTTP ${statusResp.status}`
            );
          }
          const status = (await statusResp.json()) as {
            run_id: string;
            status: string;
            result?: PipelineRunResultPayload | null;
            error?: { error: string; message: string; traceback?: string } | null;
          };
          if (
            status.status === "completed" ||
            status.status === "failed" ||
            status.status === "timed_out"
          ) {
            terminal = status;
            break;
          }
          await new Promise((resolve) =>
            setTimeout(resolve, POLL_INTERVAL_MS)
          );
        }

        if (terminal === null) {
          throw new Error(
            `Pipeline run ${accepted.run_id} did not reach a terminal state within the poll window.`
          );
        }

        if (terminal.status !== "completed" || !terminal.result) {
          const msg =
            terminal.error?.message ||
            `Pipeline run finished with status=${terminal.status}.`;
          throw new Error(msg);
        }

        // Map the snake_case runner payload to the camelCase
        // PipelineDiscoveryResult shape used by downstream consumers.
        const result = mapPipelineRunResult(terminal.result);
        setPipelineResult(result);

        log.debug(
          "Pipeline processed:",
          result.stateCount,
          "states,",
          result.transitionCount,
          "transitions"
        );

        return { success: true, result };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Pipeline processing failed";
        return { success: false, error: message };
      } finally {
        setIsProcessing(false);
      }
    },
    [sdkRecordingResult]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  return {
    session,
    isStarting,
    isStopping,
    isProcessing,
    // Extension-based recording (legacy)
    startRecording,
    stopRecording,
    getRecordingStatus,
    captureNow,
    startPolling,
    stopPolling,
    resetSession,
    getSnapshotsAsRenderLogs,
    // SDK-based recording (embedded UI Bridge)
    startSdkRecording,
    stopSdkRecording,
    processRecording,
    sdkRecordingResult,
    pipelineResult,
    // Computed values
    isRecording: session.isRecording,
    snapshotCount: session.snapshots.length,
    duration: session.startTime ? Date.now() - session.startTime : 0,
  };
}
