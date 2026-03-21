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
    startRecording,
    stopRecording,
    getRecordingStatus,
    captureNow,
    startPolling,
    stopPolling,
    resetSession,
    getSnapshotsAsRenderLogs,
    // Computed values
    isRecording: session.isRecording,
    snapshotCount: session.snapshots.length,
    duration: session.startTime ? Date.now() - session.startTime : 0,
  };
}
