/**
 * useClickCapture Hook
 *
 * Manages click capture sessions for template generation.
 * Communicates with the runner to start/stop video+input recording.
 */

"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { runnerClient } from "@/lib/runner-client";
import { useRunnerAvailability } from "@/hooks/useRunnerMonitors";

export interface ClickCaptureState {
  isActive: boolean;
  sessionId: string | null;
  startTime: number | null;
  applicationName: string | null;
  duration: number;
  clickCount: number;
  error: string | null;
}

export interface UseClickCaptureResult {
  state: ClickCaptureState;
  isRunnerConnected: boolean;
  start: (applicationName?: string) => Promise<boolean>;
  stop: () => Promise<{ candidatesCount: number } | null>;
  refresh: () => Promise<void>;
}

export function useClickCapture(): UseClickCaptureResult {
  const [state, setState] = useState<ClickCaptureState>({
    isActive: false,
    sessionId: null,
    startTime: null,
    applicationName: null,
    duration: 0,
    clickCount: 0,
    error: null,
  });

  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const statusPollingRef = useRef<NodeJS.Timeout | null>(null);
  const { data: isAvailable } = useRunnerAvailability({
    refetchInterval: 5000,
  });

  // Update duration every second when active
  useEffect(() => {
    if (state.isActive && state.startTime) {
      durationIntervalRef.current = setInterval(() => {
        setState((prev) => ({
          ...prev,
          duration: Math.floor((Date.now() - (prev.startTime || 0)) / 1000),
        }));
      }, 1000);
    } else {
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = null;
      }
    }

    return () => {
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
    };
  }, [state.isActive, state.startTime]);

  // Poll for click count updates during recording
  useEffect(() => {
    if (state.isActive) {
      statusPollingRef.current = setInterval(async () => {
        try {
          const response = await runnerClient.getClickCaptureStatus();
          if (response.success && response.click_count !== undefined) {
            setState((prev) => ({
              ...prev,
              clickCount: response.click_count || 0,
            }));
          }
        } catch (_error) {
          // Silently ignore polling errors
        }
      }, 2000); // Poll every 2 seconds
    } else {
      if (statusPollingRef.current) {
        clearInterval(statusPollingRef.current);
        statusPollingRef.current = null;
      }
    }

    return () => {
      if (statusPollingRef.current) {
        clearInterval(statusPollingRef.current);
      }
    };
  }, [state.isActive]);

  // Fetch initial status on mount
  const refresh = useCallback(async () => {
    try {
      const response = await runnerClient.getClickCaptureStatus();
      if (response.success && response.is_active) {
        setState({
          isActive: true,
          sessionId: response.session_id || null,
          startTime: response.start_time || null,
          applicationName: response.application_name || null,
          duration: response.start_time
            ? Math.floor((Date.now() - response.start_time * 1000) / 1000)
            : 0,
          clickCount: response.click_count || 0,
          error: null,
        });
      } else {
        setState({
          isActive: false,
          sessionId: null,
          startTime: null,
          applicationName: null,
          duration: 0,
          clickCount: 0,
          error: null,
        });
      }
    } catch (error) {
      console.error("[useClickCapture] Error fetching status:", error);
    }
  }, []);

  useEffect(() => {
    if (isAvailable) {
      refresh();
    }
  }, [isAvailable, refresh]);

  // Start capture session
  const start = useCallback(
    async (applicationName?: string): Promise<boolean> => {
      setState((prev) => ({ ...prev, error: null }));

      const sessionId = `capture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      try {
        const response = await runnerClient.startClickCapture(
          sessionId,
          applicationName
        );

        if (response.success) {
          setState({
            isActive: true,
            sessionId: response.session_id || sessionId,
            startTime: Date.now(),
            applicationName: applicationName || null,
            duration: 0,
            clickCount: 0,
            error: null,
          });
          return true;
        } else {
          setState((prev) => ({
            ...prev,
            error: response.error || "Failed to start capture",
          }));
          return false;
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Failed to start capture";
        setState((prev) => ({ ...prev, error: errorMessage }));
        return false;
      }
    },
    []
  );

  // Stop capture session
  const stop = useCallback(async (): Promise<{
    candidatesCount: number;
  } | null> => {
    setState((prev) => ({ ...prev, error: null }));

    try {
      const response = await runnerClient.stopClickCapture();

      setState({
        isActive: false,
        sessionId: null,
        startTime: null,
        applicationName: null,
        duration: 0,
        clickCount: 0,
        error: response.error || null,
      });

      if (response.success) {
        return { candidatesCount: response.candidates_count || 0 };
      }
      return null;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to stop capture";
      setState((prev) => ({
        ...prev,
        isActive: false,
        error: errorMessage,
      }));
      return null;
    }
  }, []);

  return {
    state,
    isRunnerConnected: isAvailable ?? false,
    start,
    stop,
    refresh,
  };
}
