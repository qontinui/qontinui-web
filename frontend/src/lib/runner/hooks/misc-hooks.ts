"use client";

import {
  useRunnerQuery,
  useRunnerMutation,
  HEALTH_POLL_INTERVAL,
  DEFAULT_POLL_INTERVAL,
} from "../api-client";
import { useRunnerTarget } from "@/contexts/active-runner-context";
import type { RunnerHealth } from "../types/task-run";
import type { TestResult, ExecutionSpan } from "../types/testing";
import type { GlobalLogSourceSettings, LogSource } from "../types/log-sources";
import type { Hook } from "../types/hooks-config";
import type { ErrorMonitorEntry } from "../types/error-monitor";
import type { McpServerConfig } from "../types/settings";

export function useRunnerHealth() {
  return useRunnerQuery<RunnerHealth>(useRunnerTarget(), "/health", {
    pollInterval: HEALTH_POLL_INTERVAL,
  });
}

export function useExtensionStatus() {
  return useRunnerQuery<{
    connected: boolean;
    tab_id?: number;
    tab_url?: string;
    tab_title?: string;
    last_pong_ago_sec?: number;
    connection_age_sec?: number;
    reconnect_count?: number;
  }>(useRunnerTarget(), "/extension/status", {
    pollInterval: 5000,
  });
}

export function useExtensionCommand() {
  return useRunnerMutation<
    { action: string; params?: Record<string, unknown> },
    unknown
  >(useRunnerTarget(), "/extension/command");
}

export function useLogSources() {
  return useRunnerQuery<LogSource[]>(useRunnerTarget(), "/log-sources");
}

export function useGlobalLogSourceSettings() {
  return useRunnerQuery<GlobalLogSourceSettings>(
    useRunnerTarget(),
    "/log-sources/settings"
  );
}

export function useHooks() {
  return useRunnerQuery<Hook[]>(useRunnerTarget(), "/hooks");
}

export function useErrorMonitorEntries() {
  return useRunnerQuery<ErrorMonitorEntry[]>(
    useRunnerTarget(),
    "/error-monitor/errors",
    {
      pollInterval: DEFAULT_POLL_INTERVAL,
    }
  );
}

export function useMcpServers() {
  return useRunnerQuery<McpServerConfig[]>(useRunnerTarget(), "/mcp-servers");
}

export function useTestResults() {
  return useRunnerQuery<TestResult[]>(useRunnerTarget(), "/test-results");
}

export function useTestHistory() {
  return useRunnerQuery<TestResult[]>(useRunnerTarget(), "/tests/history");
}

export function useExecutionSpans() {
  return useRunnerQuery<ExecutionSpan[]>(useRunnerTarget(), "/execution-spans");
}
