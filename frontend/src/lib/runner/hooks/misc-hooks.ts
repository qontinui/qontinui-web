"use client";

import {
  useRunnerQuery,
  useRunnerMutation,
  HEALTH_POLL_INTERVAL,
  DEFAULT_POLL_INTERVAL,
} from "../api-client";
import type { RunnerHealth } from "../types/task-run";
import type { TestResult, ExecutionSpan } from "../types/testing";
import type { LogSource } from "../types/log-sources";
import type { GlobalLogSourceSettings } from "../types/log-sources";
import type { Hook } from "../types/hooks-config";
import type { ErrorMonitorEntry } from "../types/error-monitor";
import type { McpServerConfig } from "../types/settings";

export function useRunnerHealth() {
  return useRunnerQuery<RunnerHealth>("/health", {
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
  }>("/extension/status", {
    pollInterval: 5000,
  });
}

export function useExtensionCommand() {
  return useRunnerMutation<
    { action: string; params?: Record<string, unknown> },
    unknown
  >("/extension/command");
}

export function useLogSources() {
  return useRunnerQuery<LogSource[]>("/log-sources");
}

export function useGlobalLogSourceSettings() {
  return useRunnerQuery<GlobalLogSourceSettings>("/log-sources/settings");
}

export function useHooks() {
  return useRunnerQuery<Hook[]>("/hooks");
}

export function useErrorMonitorEntries() {
  return useRunnerQuery<ErrorMonitorEntry[]>("/error-monitor/errors", {
    pollInterval: DEFAULT_POLL_INTERVAL,
  });
}

export function useMcpServers() {
  return useRunnerQuery<McpServerConfig[]>("/mcp-servers");
}

export function useTestResults() {
  return useRunnerQuery<TestResult[]>("/test-results");
}

export function useTestHistory() {
  return useRunnerQuery<TestResult[]>("/tests/history");
}

export function useExecutionSpans() {
  return useRunnerQuery<ExecutionSpan[]>("/execution-spans");
}
