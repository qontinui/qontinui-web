"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// =============================================================================
// Configuration
// =============================================================================

const RUNNER_API_BASE = "http://localhost:9876";
const DEFAULT_POLL_INTERVAL = 5000;
const HEALTH_POLL_INTERVAL = 10000;

// =============================================================================
// Types
// =============================================================================

export interface RunnerHealth {
  status: string;
  version?: string;
  uptime_seconds?: number;
}

export interface TaskRun {
  id: string;
  task_name: string;
  prompt?: string;
  task_type?: string;
  status: string;
  sessions_count?: number;
  max_sessions?: number;
  auto_continue?: boolean;
  output_log?: string;
  workflow_name?: string;
  workflow_type?: string;
  depth?: number;
  created_at: string;
  updated_at?: string;
  completed_at?: string;
  summary?: string;
  ai_summary?: string;
  iteration_count?: number;
  phase?: string;
  /** Duration in seconds (computed from created_at/completed_at) */
  duration_seconds?: number;
}

export interface TaskRunOutput {
  id: number;
  output_log: string;
}

export interface TaskRunKnowledge {
  findings: Finding[];
  observations: string[];
  hypotheses: string[];
}

export interface Finding {
  id: number;
  task_run_id: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  file_path?: string;
  line_number?: number;
  status: string;
  created_at: string;
}

export interface VerificationResult {
  id: number;
  task_run_id: string;
  criterion: string;
  passed: boolean;
  confidence: number;
  observation: string;
  verified_at: string;
}

export interface PlaywrightResult {
  id: number;
  task_run_id: string;
  test_name: string;
  status: string;
  duration_ms: number;
  error_message?: string;
  screenshot_path?: string;
  console_output?: string;
}

export interface TaskRunEvent {
  id: number;
  task_run_id: string;
  event_type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface Screenshot {
  id: number;
  task_run_id: string;
  filename: string;
  path: string;
  timestamp: string;
  description?: string;
}

export interface TaskRunScreenshot {
  id: number;
  task_run_id: string;
  timestamp: string;
  path: string;
  url?: string;
  data?: string;
  description?: string;
  phase?: string;
  step?: string;
}

export interface SessionState {
  state: string;
  can_send: boolean;
  can_interrupt: boolean;
}

export interface SendMessageResponse {
  success: boolean;
  queued: boolean;
  state: string;
}

export interface FindingsSummary {
  total: number;
  by_severity: Record<string, number>;
  by_category: Record<string, number>;
  by_status: Record<string, number>;
  recent: Finding[];
}

export interface Checkpoint {
  id: number;
  task_run_id: string;
  name: string;
  phase: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface McpCall {
  id: number;
  task_run_id: string;
  tool_name: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  status: string;
  duration_ms?: number;
  timestamp: string;
}

export interface TestResult {
  id: number;
  test_name: string;
  status: string;
  duration_ms: number;
  timestamp: string;
  specs?: TestSpec[];
}

export interface TestSpec {
  name: string;
  status: string;
  duration_ms: number;
  error?: string;
}

export interface ExecutionSpan {
  id: number;
  task_run_id: number;
  name: string;
  phase: string;
  start_time: string;
  end_time?: string;
  duration_ms?: number;
  status: string;
}

export type { UnifiedWorkflow } from "@/types/unified-workflow";
import type { UnifiedWorkflow } from "@/types/unified-workflow";

export interface LibraryItem {
  id: string;
  name: string;
  type: string;
  description?: string;
  updated_at?: string;
  created_at?: string;
}

export interface SavedApiRequest {
  id: string;
  name: string;
  description?: string;
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  body_content_type?: string;
  category?: string;
  tags?: string[];
  timeout_ms?: number;
  follow_redirects?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface PlaywrightScript {
  id: string;
  name: string;
  description?: string;
  script_content: string;
  target_url?: string;
  ai_instructions?: string;
  category?: string;
  tags?: string[];
  timeout_seconds?: number;
  display_mode?: string;
  browser?: string;
  created_at?: string;
  updated_at?: string;
}

export interface SavedPrompt {
  id: string;
  name: string;
  description?: string;
  content: string;
  category?: string;
  tags?: string[];
  max_sessions?: number | null;
  provider?: string;
  model?: string;
  requires_orchestrator?: boolean;
  orchestrator_goal?: string;
  orchestrator_max_iterations?: number;
  created_at?: string;
  updated_at?: string;
}

export interface ContextAutoInclude {
  taskMentions?: string[];
  actionTypes?: string[];
  errorPatterns?: string[];
  filePatterns?: string[];
}

export interface ContextItem {
  id: string;
  name: string;
  content: string;
  category?: string;
  tags?: string[];
  scope?: string;
  enabled?: boolean;
  autoInclude?: ContextAutoInclude;
  createdAt?: string;
  modifiedAt?: string;
}

export interface McpServerConfig {
  id: string;
  name: string;
  description?: string;
  transport: "stdio" | "http";
  enabled: boolean;
  auto_start: boolean;
  cached_tools?: string;
  created_at: string;
  updated_at: string;
}

export interface Check {
  id: string;
  name: string;
  description?: string;
  check_type: string;
  tool?: string;
  command?: string;
  working_directory?: string;
  config_path?: string;
  auto_fix?: boolean;
  fail_on_warning?: boolean;
  is_critical?: boolean;
  timeout_seconds?: number;
  enabled?: boolean;
  tags?: string[];
  created_at?: string;
  updated_at?: string;
}

export interface CheckGroup {
  id: string;
  name: string;
  description?: string;
  stop_on_failure?: boolean;
  run_in_parallel?: boolean;
  check_ids?: string[];
  created_at?: string;
  updated_at?: string;
}

export interface Macro {
  id: string;
  name: string;
  description?: string;
  steps: MacroStep[];
  category?: string;
  tags?: string[];
  run_count?: number;
  created_at?: string;
  modified_at?: string;
}

export interface MacroStep {
  id: string;
  action_type: string;
  name?: string;
  target_image_ids?: string[];
  target_image_names?: string[];
  text_input?: string;
  hotkey?: string;
  target_state_ids?: string[];
  target_state_names?: string[];
  pause_after_ms?: number;
  monitor_index?: number;
  timeout_seconds?: number;
}

export interface Scriptlet {
  id: string;
  name: string;
  content: string;
  category?: string;
  tags?: string[];
  source_log_ids?: string[];
  created_at?: string;
  modified_at?: string;
}

export interface AwasDiscoverResponse {
  success: boolean;
  manifest?: unknown;
  error?: string;
}

export interface AwasCheckSupportResponse {
  supported: boolean;
  version?: string;
  manifest_url?: string;
  error?: string;
}

export interface AwasActionInfo {
  id: string;
  name: string;
  description?: string;
  method?: string;
  endpoint?: string;
  intent?: string;
  parameters?: unknown;
}

export interface AwasExecuteResponse {
  success: boolean;
  result?: unknown;
  error?: string;
}

export interface ExplorationStrategy {
  id: string;
  name: string;
  description: string;
}

export interface ExplorationReport {
  id: string;
  status: string;
  strategy?: string;
  config_path?: string;
  started_at?: string;
  completed_at?: string;
  duration_seconds?: number;
  states_visited?: number;
  transitions_tested?: number;
  failures?: number;
  coverage_pct?: number;
  details?: unknown;
}

export interface ShellCommand {
  id: string;
  name: string;
  command: string;
  working_directory?: string;
  timeout_seconds?: number;
  description?: string;
  category?: string;
  tags?: string[];
  fail_on_error?: boolean;
  enabled?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface LogSource {
  id: number;
  name: string;
  path: string;
  enabled: boolean;
  log_type: string;
}

// Global Log Source types (matching Rust backend GlobalLogSource*)
export type LogSourceCategory =
  | "frontend"
  | "backend"
  | "api"
  | "mobile"
  | "database"
  | "build"
  | "testing"
  | "runner"
  | "general";

export type LogSourceAiSelectionMode = "dynamic" | "static" | "disabled";

export interface GlobalLogSource {
  id: string;
  name: string;
  description: string;
  category: LogSourceCategory;
  type: string; // "file" or "directory"
  path: string;
  pattern?: string;
  tail_lines: number;
  enabled: boolean;
  color?: string;
  keywords: string[];
  format: string;
  parser: string;
  timestamp_pattern?: string;
  timezone: string;
  error_patterns: string[];
  warning_patterns: string[];
  ignore_patterns: string[];
  poll_interval_ms: number;
}

export interface GlobalLogSourceProfile {
  id: string;
  name: string;
  description?: string;
  source_ids: string[];
  created_at?: string;
  updated_at?: string;
}

export interface GlobalLogSourceSettings {
  sources: GlobalLogSource[];
  profiles: GlobalLogSourceProfile[];
  default_profile_id?: string;
  ai_selection_mode: LogSourceAiSelectionMode;
  include_all_when_no_profile: boolean;
}

export type HookTrigger =
  | "pre_execution"
  | "post_execution"
  | "on_error"
  | "on_verification_fail"
  | "on_complete"
  | "pre_iteration"
  | "post_iteration";

export type HookActionType = "command" | "webhook" | "log" | "notification";

export interface HookCondition {
  variable: string;
  operator: string;
  value: unknown;
}

export interface Hook {
  id: string;
  name: string;
  description?: string;
  trigger: HookTrigger;
  action_type: HookActionType;
  action_config: Record<string, unknown>;
  enabled: boolean;
  execution_order: number;
  continue_on_failure: boolean;
  conditions: HookCondition[];
  task_run_id?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateHookRequest {
  name: string;
  description?: string;
  trigger: HookTrigger;
  action_type: HookActionType;
  action_config: Record<string, unknown>;
  enabled?: boolean;
  execution_order?: number;
  continue_on_failure?: boolean;
  conditions?: HookCondition[];
}

export interface UpdateHookRequest {
  name?: string;
  description?: string | null;
  trigger?: HookTrigger;
  action_type?: HookActionType;
  action_config?: Record<string, unknown>;
  enabled?: boolean;
  execution_order?: number;
  continue_on_failure?: boolean;
  conditions?: HookCondition[];
}

export interface TestHookResponse {
  success: boolean;
  output?: string;
  error?: string;
  duration_ms: number;
}

export interface PlanPhaseInput {
  name: string;
  prompt: string;
}

export interface ExecutePlanRequest {
  plan_name: string;
  plan_overview: string;
  phases: PlanPhaseInput[];
  next_steps_sweep: boolean;
  max_next_steps_iterations: number;
  timeout_seconds?: number | null;
}

export interface ErrorMonitorEntry {
  id: number;
  log_source_id: number | null;
  log_source_name: string;
  task_run_id: string | null;
  workflow_step_id: string | null;
  log_timestamp: string | null;
  captured_at: string;
  severity: string;
  error_type: string | null;
  error_code: string | null;
  message: string;
  stack_trace: string | null;
  context_lines: string | null;
  raw_entry: string | null;
  location: { file?: string; line?: number; column?: number } | null;
  signature_hash: string;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  status: string;
  finding_id: number | null;
  resolved_by_task_run_id: string | null;
  resolution_notes: string | null;
  acknowledged_at: string | null;
  resolved_at: string | null;
}

// =============================================================================
// Settings Types
// =============================================================================

export interface GeneralSettings {
  auto_load_last_config: boolean;
  include_summary_step_by_default: boolean;
  preflight_check_enabled: boolean;
  session_auto_fix_on_failure: boolean;
}

export interface AiSettings {
  provider: "claude_cli" | "claude_api" | "gemini_cli" | "gemini_api";
  claude_cli: {
    execution_mode: string;
    custom_path: string | null;
    timeout_seconds: number;
    config_dir: string | null;
  };
  claude_api: {
    model: string;
    max_tokens: number;
  };
  gemini_cli: {
    execution_mode: string;
    custom_path: string | null;
    timeout_seconds: number;
    auth_method: "oauth" | "api_key";
    model: string;
  };
  gemini_api: {
    model: string;
    max_output_tokens: number;
    temperature: number;
  };
  auto_refine_video_after_iterations: number;
  interactive_sessions_enabled: boolean;
}

export interface AgenticSettings {
  compression: {
    enabled: boolean;
    threshold_tokens: number;
    target_tokens: number;
    keep_recent_items: number;
    summarize_batch_size: number;
  };
  retry: {
    enabled: boolean;
    max_retries: number;
    base_delay_ms: number;
    max_delay_ms: number;
    exponential_base: number;
    jitter: boolean;
    feedback_injection: boolean;
  };
  routing: {
    enabled: boolean;
    simple_model: string;
    medium_model: string;
    complex_model: string;
    file_threshold_simple: number;
    file_threshold_medium: number;
  };
}

export interface DebugSettings {
  enable_image_debug: boolean;
  top_matches_count: number;
}

export interface PlaywrightSettings {
  test_username: string | null;
  test_password: string | null;
  base_url: string | null;
  skip_web_server: boolean;
}

export interface SelfHealingSettings {
  action_caching_enabled: boolean;
  cache_ttl_seconds: number;
  visual_validation_enabled: boolean;
  llm_mode: "disabled" | "local_ollama" | "remote_api";
  ollama_model: string;
  api_provider: "open_ai" | "anthropic";
}

export interface MobileSettings {
  adb_path: string | null;
  default_device_id: string | null;
  app_package: string | null;
  logcat_lines: number;
  filter_react_native: boolean;
  output_dir: string | null;
}

export interface StorageInfo {
  screenshot_path: string;
  video_path: string;
  screenshot_usage_mb: number;
  screenshot_max_mb: number;
  screenshot_file_count: number;
  video_usage_mb: number;
  video_max_mb: number;
  video_file_count: number;
}

export interface DeviceInfo {
  device_id: string;
  device_name: string;
  platform: string;
}

export interface BackupSummary {
  flows: number;
  flow_executions: number;
  checkpoints: number;
  learning_outcomes: number;
  learning_patterns: number;
  settings: number;
  prompts: number;
  unified_workflows: number;
  verification_tests: number;
  task_hooks: number;
  scheduled_tasks: number;
  saved_api_requests: number;
  configs: number;
}

export interface McpServer {
  id: string;
  name: string;
  description: string | null;
  transport: "stdio" | "http";
  command: string | null;
  args: string[];
  cwd: string | null;
  url: string | null;
  headers: Record<string, string>;
  timeout_seconds: number;
  enabled: boolean;
  auto_start: boolean;
}

export interface McpServerStatus {
  server_id: string;
  connected: boolean;
  error: string | null;
  tools: McpTool[];
}

export interface McpTool {
  name: string;
  description: string | null;
}

export interface AiConnectionTestResult {
  success: boolean;
  message: string;
  provider: string;
}

// =============================================================================
// Fetch Wrapper
// =============================================================================

class RunnerApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "RunnerApiError";
  }
}

async function runnerFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${RUNNER_API_BASE}${path}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      signal: options?.signal ?? controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new RunnerApiError(
      response.status,
      `Runner API error: ${response.status} ${response.statusText}`
    );
  }

  const text = await response.text();
  if (!text) return undefined as T;
  const json = JSON.parse(text);
  // Unwrap ApiResponse envelope ({ success, data }) used by some endpoints
  if (json && typeof json === "object" && "success" in json && "data" in json) {
    return json.data as T;
  }
  return json as T;
}

// =============================================================================
// Generic Hook
// =============================================================================

interface UseRunnerQueryOptions<T = unknown> {
  enabled?: boolean;
  pollInterval?: number;
  /** Transform the raw API response before storing (e.g. unwrap nested fields) */
  transform?: (raw: unknown) => T;
}

interface UseRunnerQueryResult<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  isOffline: boolean;
  refetch: () => Promise<void>;
}

function useRunnerQuery<T>(
  path: string | null,
  options?: UseRunnerQueryOptions<T>
): UseRunnerQueryResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const enabled = options?.enabled !== false;
  const pollInterval = options?.pollInterval;
  const transform = options?.transform;

  const fetchData = useCallback(async () => {
    if (!path || !enabled) return;
    try {
      const raw = await runnerFetch<unknown>(path);
      const result = transform ? transform(raw) : (raw as T);
      setData(result);
      setError(null);
      setIsOffline(false);
    } catch (err) {
      if (err instanceof TypeError && err.message.includes("fetch")) {
        setIsOffline(true);
        setError("Runner not connected");
      } else if (err instanceof RunnerApiError) {
        setError(err.message);
        setIsOffline(false);
      } else {
        setIsOffline(true);
        setError("Runner not connected");
      }
    } finally {
      setIsLoading(false);
    }
  }, [path, enabled]);

  useEffect(() => {
    if (!enabled || !path) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    fetchData();

    const startPolling = () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (pollInterval) {
        intervalRef.current = setInterval(fetchData, pollInterval);
      }
    };

    const stopPolling = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    startPolling();

    // Pause polling when tab is hidden to prevent request accumulation
    const handleVisibility = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        fetchData(); // Refresh immediately on return
        startPolling();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchData, pollInterval, enabled, path]);

  return { data, isLoading, error, isOffline, refetch: fetchData };
}

// =============================================================================
// Mutation Hook
// =============================================================================

interface UseRunnerMutationResult<TInput, TOutput> {
  mutate: (input: TInput) => Promise<TOutput>;
  isLoading: boolean;
  error: string | null;
}

function useRunnerMutation<TInput, TOutput>(
  path: string,
  method: string = "POST"
): UseRunnerMutationResult<TInput, TOutput> {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutate = useCallback(
    async (input: TInput): Promise<TOutput> => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await runnerFetch<TOutput>(path, {
          method,
          body: JSON.stringify(input),
        });
        return result;
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Runner mutation failed";
        setError(msg);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [path, method]
  );

  return { mutate, isLoading, error };
}

// =============================================================================
// Exported Hooks
// =============================================================================

export function useRunnerHealth() {
  return useRunnerQuery<RunnerHealth>("/health", {
    pollInterval: HEALTH_POLL_INTERVAL,
  });
}

export function useTaskRuns(params?: { limit?: number; status?: string }) {
  const query = new URLSearchParams();
  if (params?.limit) query.set("limit", String(params.limit));
  if (params?.status) query.set("status", params.status);
  const qs = query.toString();
  return useRunnerQuery<TaskRun[]>(`/task-runs${qs ? `?${qs}` : ""}`);
}

export function useRunningTaskRuns() {
  return useRunnerQuery<TaskRun[]>("/task-runs/running", {
    pollInterval: DEFAULT_POLL_INTERVAL,
  });
}

export function useTaskRun(id: string | number | null) {
  return useRunnerQuery<TaskRun>(id != null ? `/task-runs/${id}` : null, {
    enabled: id != null,
    pollInterval: DEFAULT_POLL_INTERVAL,
  });
}

export function useTaskRunOutput(id: string | number | null) {
  return useRunnerQuery<TaskRunOutput>(
    id != null ? `/task-runs/${id}/output` : null,
    { enabled: id != null }
  );
}

export function useTaskRunKnowledge(id: string | number | null) {
  return useRunnerQuery<TaskRunKnowledge>(
    id != null ? `/task-runs/${id}/knowledge` : null,
    {
      enabled: id != null,
      transform: (raw) => {
        const obj = raw as Record<string, unknown>;
        // API returns { knowledge: [...], summary: {...} } - map to TaskRunKnowledge shape
        if (
          obj &&
          typeof obj === "object" &&
          "knowledge" in obj &&
          Array.isArray(obj.knowledge)
        ) {
          const items = obj.knowledge as Array<Record<string, unknown>>;
          return {
            findings: items.filter(
              (k) => k.category === "finding"
            ) as unknown as Finding[],
            observations: items
              .filter((k) => k.category === "observation")
              .map((k) => String(k.content || k.title || "")),
            hypotheses: items
              .filter((k) => k.category === "hypothesis")
              .map((k) => String(k.content || k.title || "")),
          };
        }
        // Already in correct shape
        if (obj && "findings" in obj) return obj as unknown as TaskRunKnowledge;
        return { findings: [], observations: [], hypotheses: [] };
      },
    }
  );
}

export function useTaskRunVerification(id: string | number | null) {
  return useRunnerQuery<VerificationResult[]>(
    id != null ? `/task-runs/${id}/verification-results` : null,
    {
      enabled: id != null,
      transform: (raw) => {
        const obj = raw as Record<string, unknown>;
        if (
          obj &&
          typeof obj === "object" &&
          "results" in obj &&
          Array.isArray(obj.results)
        )
          return obj.results as VerificationResult[];
        if (Array.isArray(raw)) return raw as VerificationResult[];
        return [];
      },
    }
  );
}

export function useTaskRunPlaywright(id: string | number | null) {
  return useRunnerQuery<PlaywrightResult[]>(
    id != null ? `/task-runs/${id}/playwright-results` : null,
    { enabled: id != null }
  );
}

export function useTaskRunEvents(id: string | number | null) {
  return useRunnerQuery<TaskRunEvent[]>(
    id != null ? `/task-runs/${id}/events` : null,
    {
      enabled: id != null,
      transform: (raw) => {
        const obj = raw as Record<string, unknown>;
        if (
          obj &&
          typeof obj === "object" &&
          "events" in obj &&
          Array.isArray(obj.events)
        )
          return obj.events as TaskRunEvent[];
        if (Array.isArray(raw)) return raw as TaskRunEvent[];
        return [];
      },
    }
  );
}

export function useTaskRunScreenshots(id: string | number | null) {
  return useRunnerQuery<Screenshot[]>(
    id != null ? `/task-runs/${id}/screenshots` : null,
    { enabled: id != null, pollInterval: 3000 }
  );
}

export function useTaskRunScreenshotsDetailed(id: string | number | null) {
  return useRunnerQuery<TaskRunScreenshot[]>(
    id != null ? `/task-runs/${id}/screenshots` : null,
    { enabled: id != null, pollInterval: 3000 }
  );
}

export function useSessionState(id: string | number | null) {
  return useRunnerQuery<SessionState>(
    id != null ? `/task-runs/${id}/session-state` : null,
    { enabled: id != null, pollInterval: 3000 }
  );
}

export function useFindingsSummary() {
  return useRunnerQuery<FindingsSummary>("/findings/summary");
}

export function useTaskRunCheckpoints(id: string | number | null) {
  return useRunnerQuery<Checkpoint[]>(
    id != null ? `/task-runs/${id}/checkpoints` : null,
    { enabled: id != null }
  );
}

export function useTaskRunMcpCalls(id: string | number | null) {
  return useRunnerQuery<McpCall[]>(
    id != null ? `/task-runs/${id}/mcp-calls` : null,
    {
      enabled: id != null,
      transform: (raw) => {
        const obj = raw as Record<string, unknown>;
        if (
          obj &&
          typeof obj === "object" &&
          "calls" in obj &&
          Array.isArray(obj.calls)
        )
          return obj.calls as McpCall[];
        if (Array.isArray(raw)) return raw as McpCall[];
        return [];
      },
    }
  );
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

// Builder data hooks
export function useUnifiedWorkflows() {
  return useRunnerQuery<UnifiedWorkflow[]>("/unified-workflows");
}

export function useUnifiedWorkflow(id: string | null) {
  return useRunnerQuery<UnifiedWorkflow>(
    id ? `/unified-workflows/${id}` : null,
    { enabled: !!id }
  );
}

export function useLibraryItems() {
  return useRunnerQuery<LibraryItem[]>("/library/items");
}

export function usePlaywrightScripts() {
  return useRunnerQuery<LibraryItem[]>("/playwright-scripts");
}

export function useSavedApiRequests() {
  return useRunnerQuery<LibraryItem[]>("/saved-api-requests");
}

export function useChecks() {
  return useRunnerQuery<Check[]>("/checks");
}

export function useContexts() {
  return useRunnerQuery<LibraryItem[]>("/contexts");
}

export function useContextsDetailed() {
  return useRunnerQuery<ContextItem[]>("/contexts");
}

export function useScripts() {
  return useRunnerQuery<LibraryItem[]>("/scripts");
}

export function useShellCommands() {
  return useRunnerQuery<ShellCommand[]>("/shell-commands");
}

export function usePlaywrightScriptsDetailed() {
  return useRunnerQuery<PlaywrightScript[]>("/playwright/scripts");
}

export function useSavedApiRequestsDetailed() {
  return useRunnerQuery<SavedApiRequest[]>("/saved-api-requests");
}

export function usePromptsDetailed() {
  return useRunnerQuery<SavedPrompt[]>("/prompts");
}

export function useCheckGroups() {
  return useRunnerQuery<CheckGroup[]>("/check-groups");
}

export function useCheck(id: string | null) {
  return useRunnerQuery<Check>(id ? `/checks/${id}` : null, { enabled: !!id });
}

export function useCheckGroup(id: string | null) {
  return useRunnerQuery<CheckGroup>(id ? `/check-groups/${id}` : null, {
    enabled: !!id,
  });
}

export function useShellCommand(id: string | null) {
  return useRunnerQuery<ShellCommand>(id ? `/shell-commands/${id}` : null, {
    enabled: !!id,
  });
}

export function useMacros() {
  return useRunnerQuery<LibraryItem[]>("/macros");
}

export function useTests() {
  return useRunnerQuery<LibraryItem[]>("/tests");
}

export function usePrompts() {
  return useRunnerQuery<LibraryItem[]>("/prompts");
}

export function useScriptlets() {
  return useRunnerQuery<LibraryItem[]>("/scriptlets");
}

export function useMacrosDetailed() {
  return useRunnerQuery<Macro[]>("/macros");
}

export function useMacro(id: string | null) {
  return useRunnerQuery<Macro>(id ? `/macros/${id}` : null, { enabled: !!id });
}

export function useScriptletsDetailed() {
  return useRunnerQuery<Scriptlet[]>("/scriptlets");
}

export function useScriptletDetailed(id: string | null) {
  return useRunnerQuery<Scriptlet>(id ? `/scriptlets/${id}` : null, {
    enabled: !!id,
  });
}

export function useCheckGroupChecks(groupId: string | null) {
  return useRunnerQuery<Check[]>(
    groupId ? `/check-groups/${groupId}/checks` : null,
    {
      enabled: !!groupId,
    }
  );
}

export function useExplorationHistory(limit?: number) {
  const qs = limit ? `?limit=${limit}` : "";
  return useRunnerQuery<ExplorationReport[]>(`/state-explorer/history${qs}`);
}

export function useExplorationStrategies() {
  return useRunnerQuery<ExplorationStrategy[]>("/state-explorer/strategies");
}

export function useMcpServers() {
  return useRunnerQuery<McpServerConfig[]>("/mcp-servers");
}

// Configure hooks
export function useLogSources() {
  return useRunnerQuery<LogSource[]>("/log-sources");
}

// Global log source settings (full configuration)
export function useGlobalLogSourceSettings() {
  return useRunnerQuery<GlobalLogSourceSettings>("/log-sources/settings");
}

export function useHooks() {
  return useRunnerQuery<Hook[]>("/hooks");
}

// Error monitor
export function useErrorMonitorEntries() {
  return useRunnerQuery<ErrorMonitorEntry[]>("/error-monitor/errors", {
    pollInterval: DEFAULT_POLL_INTERVAL,
  });
}

// =============================================================================
// Settings Hooks
// =============================================================================

export function useAiSettings() {
  return useRunnerQuery<AiSettings>("/settings/ai");
}

export function useAgenticSettings() {
  return useRunnerQuery<AgenticSettings>("/settings/agentic");
}

export function useGeneralSettings() {
  return useRunnerQuery<GeneralSettings>("/settings/general");
}

export function useDebugSettings() {
  return useRunnerQuery<DebugSettings>("/settings/debug");
}

export function usePlaywrightSettings() {
  return useRunnerQuery<PlaywrightSettings>("/settings/playwright");
}

export function useSelfHealingSettings() {
  return useRunnerQuery<SelfHealingSettings>("/settings/self-healing");
}

export function useMobileSettings() {
  return useRunnerQuery<MobileSettings>("/settings/mobile");
}

export function useStorageInfo() {
  return useRunnerQuery<StorageInfo>("/settings/storage");
}

export function useDeviceInfo() {
  return useRunnerQuery<DeviceInfo>("/settings/device-info");
}

export function useBackupSummary() {
  return useRunnerQuery<BackupSummary>("/settings/backup/summary");
}

export function useSettingsMcpServers() {
  return useRunnerQuery<McpServer[]>("/settings/mcp/servers");
}

// =============================================================================
// State Machine Builder Hooks
// =============================================================================

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

export function useExplorationStatus(jobId: string | null) {
  return useRunnerQuery<{
    status: "running" | "complete" | "error" | "stopped";
    phase?: string;
    elements_discovered?: number;
    pages_visited?: number;
    current_url?: string;
    error?: string;
    progress_pct?: number;
  }>(jobId ? `/ui-bridge/explore/status?job_id=${jobId}` : null, {
    pollInterval: 1000,
    enabled: jobId != null,
  });
}

export function useExplorationResults(jobId: string | null, enabled: boolean) {
  return useRunnerQuery<{
    state_discovery_result?: unknown;
    elements_discovered?: number;
    pages_visited?: number;
    duration_seconds?: number;
  }>(jobId ? `/ui-bridge/explore/results?job_id=${jobId}` : null, {
    enabled,
  });
}

export function useStartExploration() {
  return useRunnerMutation<
    {
      target_type?: "web";
      connection_url: string;
      max_depth?: number;
      max_elements_per_page?: number;
      max_total_elements?: number;
      action_delay_ms?: number;
      blocked_keywords?: string[];
      safe_keywords?: string[];
      blocked_selectors?: string[];
      capture_screenshots?: boolean;
      run_state_discovery?: boolean;
    },
    { job_id: string }
  >("/ui-bridge/explore");
}

export function useStopExploration() {
  return useRunnerMutation<Record<string, never>, void>(
    "/ui-bridge/explore/stop"
  );
}

export function useDiscoverStatesFromRenders() {
  return useRunnerMutation<{ render_logs: unknown[] }, unknown>(
    "/ui-bridge/discover-states"
  );
}

export function useExtensionCommand() {
  return useRunnerMutation<
    { action: string; params?: Record<string, unknown> },
    unknown
  >("/extension/command");
}

// Executor status
export function useExecutorStatus() {
  return useRunnerQuery<Record<string, unknown>>("/executor/status", {
    pollInterval: DEFAULT_POLL_INTERVAL,
  });
}

// Workflow queue
export function useWorkflowQueue() {
  return useRunnerQuery<Record<string, unknown>[]>("/workflow-queue");
}

// Mutations
export function useRunWorkflow() {
  return useRunnerMutation<
    { workflow_id: string; monitor?: string },
    { task_run_id: string }
  >("/unified-workflows/run");
}

export function useStopTaskRun() {
  return useRunnerMutation<{ task_run_id: string }, void>("/task-runs/stop");
}

// =============================================================================
// API response types
// =============================================================================

export interface ParsedCurlResponse {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string;
  content_type?: string;
}

export interface ApiRequestTestResult {
  success: boolean;
  status_code: number;
  status_text: string;
  response_headers?: Record<string, string>;
  response_time_ms: number;
  response_body_type?: string;
  response_body?: string;
  response_size_bytes?: number;
  error?: string;
}

export interface GenerateChecksResponse {
  success: boolean;
  suggested_checks?: {
    check?: Partial<Check>;
    name?: string;
    command?: string;
    reason?: string;
  }[];
  error?: string;
}

// =============================================================================
// Direct API calls (non-hook)
// =============================================================================

export const runnerApi = {
  getHealth: () => runnerFetch<RunnerHealth>("/health"),
  getTaskRuns: (params?: {
    limit?: number;
    status?: string;
    workflow_type?: string;
  }) => {
    const query = new URLSearchParams();
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.status) query.set("status", params.status);
    if (params?.workflow_type) query.set("workflow_type", params.workflow_type);
    const qs = query.toString();
    return runnerFetch<TaskRun[]>(`/task-runs${qs ? `?${qs}` : ""}`);
  },
  getTaskRun: (id: string | number) => runnerFetch<TaskRun>(`/task-runs/${id}`),
  deleteTaskRun: (id: string | number) =>
    runnerFetch<void>(`/task-runs/${id}`, { method: "DELETE" }),
  getTaskRunOutput: (id: string | number) =>
    runnerFetch<TaskRunOutput>(`/task-runs/${id}/output`),
  stopTaskRun: (id: string | number) =>
    runnerFetch<void>(`/task-runs/${id}/stop`, { method: "POST" }),
  executePlan: (plan: ExecutePlanRequest) =>
    runnerFetch<{ success: boolean; execution_id: string; message: string }>(
      "/execute-plan",
      { method: "POST", body: JSON.stringify(plan) }
    ),
  runWorkflow: (workflowId: string, monitor?: string) =>
    runnerFetch<{ task_run_id: string }>(
      `/unified-workflows/${workflowId}/run`,
      {
        method: "POST",
        body: JSON.stringify({ monitor }),
      }
    ),
  saveUnifiedWorkflow: (workflow: Partial<UnifiedWorkflow>) =>
    runnerFetch<UnifiedWorkflow>("/unified-workflows", {
      method: "POST",
      body: JSON.stringify(workflow),
    }),
  updateUnifiedWorkflow: (id: string, workflow: Partial<UnifiedWorkflow>) =>
    runnerFetch<UnifiedWorkflow>(`/unified-workflows/${id}`, {
      method: "PUT",
      body: JSON.stringify(workflow),
    }),
  getUnifiedWorkflow: (id: string) =>
    runnerFetch<UnifiedWorkflow>(`/unified-workflows/${id}`),
  deleteUnifiedWorkflow: (id: string) =>
    runnerFetch<void>(`/unified-workflows/${id}`, { method: "DELETE" }),
  saveLogSource: (source: Partial<LogSource>) =>
    runnerFetch<LogSource>("/log-sources", {
      method: "POST",
      body: JSON.stringify(source),
    }),
  deleteLogSource: (id: number) =>
    runnerFetch<void>(`/log-sources/${id}`, { method: "DELETE" }),
  // Global log source settings (full configuration)
  getGlobalLogSourceSettings: () =>
    runnerFetch<GlobalLogSourceSettings>("/log-sources/settings"),
  saveGlobalLogSourceSettings: (settings: GlobalLogSourceSettings) =>
    runnerFetch<void>("/log-sources/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),
  setLogSourceAiMode: (mode: LogSourceAiSelectionMode) =>
    runnerFetch<void>("/log-sources/ai-mode", {
      method: "PUT",
      body: JSON.stringify({ mode }),
    }),
  setDefaultLogSourceProfile: (profileId: string | null) =>
    runnerFetch<void>("/log-sources/default-profile", {
      method: "PUT",
      body: JSON.stringify({ profile_id: profileId }),
    }),
  migrateLogSources: () =>
    runnerFetch<{ migrated: number }>("/log-sources/migrate", {
      method: "POST",
    }),
  createHook: (hook: CreateHookRequest) =>
    runnerFetch<Hook>("/hooks", {
      method: "POST",
      body: JSON.stringify(hook),
    }),
  updateHook: (id: string, updates: UpdateHookRequest) =>
    runnerFetch<Hook>(`/hooks/${id}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    }),
  deleteHook: (id: string) =>
    runnerFetch<void>(`/hooks/${id}`, { method: "DELETE" }),
  setHookEnabled: (id: string, enabled: boolean) =>
    runnerFetch<void>(`/hooks/${id}/enabled`, {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    }),
  reorderHooks: (hookIds: string[]) =>
    runnerFetch<void>("/hooks/reorder", {
      method: "PUT",
      body: JSON.stringify({ hook_ids: hookIds }),
    }),
  testHook: (
    id: string,
    context?: {
      task_run_id?: string;
      task_name?: string;
      iteration?: number;
      status?: string;
      error?: string;
    }
  ) =>
    runnerFetch<TestHookResponse>(`/hooks/${id}/test`, {
      method: "POST",
      body: JSON.stringify(context ?? null),
    }),
  // Error monitor actions
  acknowledgeError: (id: number) =>
    runnerFetch<void>(`/error-monitor/errors/${id}/acknowledge`, {
      method: "POST",
    }),
  resolveError: (id: number, notes?: string, resolvedByTaskRunId?: string) =>
    runnerFetch<void>(`/error-monitor/errors/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify({
        resolution_notes: notes ?? null,
        resolved_by_task_run_id: resolvedByTaskRunId ?? null,
      }),
    }),
  getErrorSummary: (taskRunId?: string) =>
    runnerFetch<{
      critical: number;
      error: number;
      warning: number;
      info: number;
      debug: number;
      total: number;
      unresolved: number;
    }>(`/error-monitor/summary${taskRunId ? `?task_run_id=${taskRunId}` : ""}`),
  generateFixWorkflow: (taskRunId?: string, maxIterations?: number) =>
    runnerFetch<unknown>("/error-monitor/fix-workflow", {
      method: "POST",
      body: JSON.stringify({
        task_run_id: taskRunId ?? null,
        max_iterations: maxIterations ?? null,
      }),
    }),

  // Checks CRUD
  getChecks: () => runnerFetch<Check[]>("/checks"),
  getCheck: (id: string) => runnerFetch<Check>(`/checks/${id}`),
  createCheck: (check: Partial<Check>) =>
    runnerFetch<Check>("/checks", {
      method: "POST",
      body: JSON.stringify(check),
    }),
  updateCheck: (id: string, check: Partial<Check>) =>
    runnerFetch<Check>(`/checks/${id}`, {
      method: "PUT",
      body: JSON.stringify(check),
    }),
  deleteCheck: (id: string) =>
    runnerFetch<void>(`/checks/${id}`, { method: "DELETE" }),

  // Check Groups CRUD
  getCheckGroups: () => runnerFetch<CheckGroup[]>("/check-groups"),
  getCheckGroup: (id: string) => runnerFetch<CheckGroup>(`/check-groups/${id}`),
  createCheckGroup: (group: Partial<CheckGroup>) =>
    runnerFetch<CheckGroup>("/check-groups", {
      method: "POST",
      body: JSON.stringify(group),
    }),
  updateCheckGroup: (id: string, group: Partial<CheckGroup>) =>
    runnerFetch<CheckGroup>(`/check-groups/${id}`, {
      method: "PUT",
      body: JSON.stringify(group),
    }),
  deleteCheckGroup: (id: string) =>
    runnerFetch<void>(`/check-groups/${id}`, { method: "DELETE" }),

  // Shell Commands CRUD
  getShellCommands: () => runnerFetch<ShellCommand[]>("/shell-commands"),
  getShellCommand: (id: string) =>
    runnerFetch<ShellCommand>(`/shell-commands/${id}`),
  createShellCommand: (cmd: Partial<ShellCommand>) =>
    runnerFetch<ShellCommand>("/shell-commands", {
      method: "POST",
      body: JSON.stringify(cmd),
    }),
  updateShellCommand: (id: string, cmd: Partial<ShellCommand>) =>
    runnerFetch<ShellCommand>(`/shell-commands/${id}`, {
      method: "PUT",
      body: JSON.stringify(cmd),
    }),
  deleteShellCommand: (id: string) =>
    runnerFetch<void>(`/shell-commands/${id}`, { method: "DELETE" }),

  // Saved API Requests CRUD
  getSavedApiRequests: () =>
    runnerFetch<SavedApiRequest[]>("/saved-api-requests/detailed"),
  createSavedApiRequest: (req: Partial<SavedApiRequest>) =>
    runnerFetch<SavedApiRequest>("/saved-api-requests", {
      method: "POST",
      body: JSON.stringify(req),
    }),
  updateSavedApiRequest: (id: string, req: Partial<SavedApiRequest>) =>
    runnerFetch<SavedApiRequest>(`/saved-api-requests/${id}`, {
      method: "PUT",
      body: JSON.stringify(req),
    }),
  deleteSavedApiRequest: (id: string) =>
    runnerFetch<void>(`/saved-api-requests/${id}`, { method: "DELETE" }),
  duplicateSavedApiRequest: (id: string) =>
    runnerFetch<SavedApiRequest>(`/saved-api-requests/${id}/duplicate`, {
      method: "POST",
    }),

  // Playwright Scripts CRUD
  getPlaywrightScripts: () =>
    runnerFetch<PlaywrightScript[]>("/playwright/scripts"),
  createPlaywrightScript: (script: Partial<PlaywrightScript>) =>
    runnerFetch<PlaywrightScript>("/playwright/scripts", {
      method: "POST",
      body: JSON.stringify(script),
    }),
  updatePlaywrightScript: (id: string, script: Partial<PlaywrightScript>) =>
    runnerFetch<PlaywrightScript>(`/playwright/scripts/${id}`, {
      method: "PUT",
      body: JSON.stringify(script),
    }),
  deletePlaywrightScript: (id: string) =>
    runnerFetch<void>(`/playwright/scripts/${id}`, { method: "DELETE" }),
  runPlaywrightScript: (id: string) =>
    runnerFetch<{ task_run_id: string }>(`/playwright/scripts/${id}/run`, {
      method: "POST",
    }),
  duplicatePlaywrightScript: (id: string, newName?: string) =>
    runnerFetch<PlaywrightScript>(`/playwright/scripts/${id}/duplicate`, {
      method: "POST",
      body: JSON.stringify({ new_name: newName }),
    }),

  // Prompts CRUD
  getPrompts: () => runnerFetch<SavedPrompt[]>("/prompts/detailed"),
  createPrompt: (prompt: Partial<SavedPrompt>) =>
    runnerFetch<SavedPrompt>("/prompts", {
      method: "POST",
      body: JSON.stringify(prompt),
    }),
  updatePrompt: (id: string, prompt: Partial<SavedPrompt>) =>
    runnerFetch<SavedPrompt>(`/prompts/${id}`, {
      method: "PUT",
      body: JSON.stringify(prompt),
    }),
  deletePrompt: (id: string) =>
    runnerFetch<void>(`/prompts/${id}`, { method: "DELETE" }),
  duplicatePrompt: (id: string) =>
    runnerFetch<SavedPrompt>(`/prompts/${id}/duplicate`, { method: "POST" }),

  // Contexts CRUD
  getContexts: () => runnerFetch<ContextItem[]>("/contexts"),
  createContext: (scope: string, ctx: Partial<ContextItem>) =>
    runnerFetch<ContextItem>(`/contexts/${scope}`, {
      method: "POST",
      body: JSON.stringify(ctx),
    }),
  updateContext: (scope: string, id: string, ctx: Partial<ContextItem>) =>
    runnerFetch<ContextItem>(`/contexts/${scope}/${id}`, {
      method: "PUT",
      body: JSON.stringify(ctx),
    }),
  deleteContext: (scope: string, id: string) =>
    runnerFetch<void>(`/contexts/${scope}/${id}`, { method: "DELETE" }),
  duplicateContext: (scope: string, id: string) =>
    runnerFetch<ContextItem>(`/contexts/${scope}/${id}/duplicate`, {
      method: "POST",
    }),

  // Workflow import/export
  exportWorkflow: (id: string) =>
    runnerFetch<unknown>(`/unified-workflows/${id}/export`),
  importWorkflow: (workflow: unknown, conflictStrategy?: string) =>
    runnerFetch<unknown>("/unified-workflows/import", {
      method: "POST",
      body: JSON.stringify({
        workflow,
        conflict_strategy: conflictStrategy ?? "generate",
      }),
    }),

  // Run workflow
  runUnifiedWorkflow: (id: string) =>
    runnerFetch<void>(`/unified-workflows/${id}/run`, { method: "POST" }),

  // Continue a task run with additional sessions
  continueTaskRun: (
    id: string | number,
    options: { additional_sessions: number }
  ) =>
    runnerFetch<void>(`/task-runs/${id}/continue`, {
      method: "POST",
      body: JSON.stringify(options),
    }),

  // Generate AI summary for a task run
  generateTaskRunSummary: (id: string | number) =>
    runnerFetch<void>(`/task-runs/${id}/generate-summary`, { method: "POST" }),

  // Stop execution
  stopExecution: () => runnerFetch<void>("/stop-execution", { method: "POST" }),

  // AI Generation
  aiGenerateTest: (userPrompt: string, testType?: string) =>
    runnerFetch<{
      success: boolean;
      data: Record<string, unknown>;
      message?: string;
    }>("/ai/generate-test", {
      method: "POST",
      body: JSON.stringify({
        user_prompt: userPrompt,
        test_type: testType ?? "playwright_cdp",
      }),
    }),

  aiGenerateShellCommand: (
    userPrompt: string,
    targetOs?: string,
    category?: string
  ) =>
    runnerFetch<{
      success: boolean;
      data: Record<string, unknown>;
      message?: string;
    }>("/ai/generate-shell-command", {
      method: "POST",
      body: JSON.stringify({
        user_prompt: userPrompt,
        target_os: targetOs ?? "windows",
        category,
      }),
    }),

  aiGenerateApiRequest: (userPrompt: string, baseUrl?: string) =>
    runnerFetch<{
      success: boolean;
      data: Record<string, unknown>;
      message?: string;
    }>("/ai/generate-api-request", {
      method: "POST",
      body: JSON.stringify({ user_prompt: userPrompt, base_url: baseUrl }),
    }),

  aiGenerateContext: (userPrompt: string) =>
    runnerFetch<{
      success: boolean;
      data: Record<string, unknown>;
      message?: string;
    }>("/ai/generate-context", {
      method: "POST",
      body: JSON.stringify({ user_prompt: userPrompt }),
    }),

  aiGeneratePrompt: (userPrompt: string, mode?: string) =>
    runnerFetch<{
      success: boolean;
      data: Record<string, unknown>;
      message?: string;
    }>("/ai/generate-prompt", {
      method: "POST",
      body: JSON.stringify({
        user_prompt: userPrompt,
        mode: mode ?? "generate",
      }),
    }),

  aiGenerateMacro: (userPrompt: string, category?: string) =>
    runnerFetch<{
      success: boolean;
      data: Record<string, unknown>;
      message?: string;
    }>("/ai/generate-macro", {
      method: "POST",
      body: JSON.stringify({ user_prompt: userPrompt, category }),
    }),

  aiGenerateScriptlet: (userPrompt: string, language?: string) =>
    runnerFetch<{
      success: boolean;
      data: Record<string, unknown>;
      message?: string;
    }>("/ai/generate-scriptlet", {
      method: "POST",
      body: JSON.stringify({
        user_prompt: userPrompt,
        language: language ?? "python",
      }),
    }),

  aiSuggestCheckGroups: (
    userPrompt: string,
    existingChecks: Array<Record<string, unknown>>
  ) =>
    runnerFetch<{
      success: boolean;
      data: Record<string, unknown>;
      message?: string;
    }>("/ai/suggest-check-groups", {
      method: "POST",
      body: JSON.stringify({
        user_prompt: userPrompt,
        existing_checks: existingChecks,
      }),
    }),

  aiSuggestExplorationStrategy: (userGoal: string, configPath?: string) =>
    runnerFetch<{
      success: boolean;
      data: Record<string, unknown>;
      message?: string;
    }>("/ai/suggest-exploration-strategy", {
      method: "POST",
      body: JSON.stringify({ user_goal: userGoal, config_path: configPath }),
    }),

  // Workspace scanning for checks
  scanWorkspace: (baseDirectory: string, maxDepth?: number) =>
    runnerFetch<Record<string, unknown>>("/checks/scan-workspace", {
      method: "POST",
      body: JSON.stringify({
        base_directory: baseDirectory,
        max_depth: maxDepth ?? 2,
      }),
    }),

  generateChecks: (
    workspaceScan: Record<string, unknown>,
    userPreferences?: Record<string, unknown>
  ) =>
    runnerFetch<GenerateChecksResponse>("/checks/generate", {
      method: "POST",
      body: JSON.stringify({
        workspace_scan: workspaceScan,
        user_preferences: userPreferences,
      }),
    }),

  // cURL import
  importCurl: (curlCommand: string) =>
    runnerFetch<ParsedCurlResponse>("/api-request/import-curl", {
      method: "POST",
      body: JSON.stringify({ curl_command: curlCommand }),
    }),

  importCurlToLibrary: (
    curlCommand: string,
    name?: string,
    category?: string
  ) =>
    runnerFetch<SavedApiRequest>("/api-request/import-to-library", {
      method: "POST",
      body: JSON.stringify({ curl_command: curlCommand, name, category }),
    }),

  // Test API request
  testApiRequest: (
    method: string,
    url: string,
    headers?: Record<string, string>,
    body?: string,
    contentType?: string,
    timeoutMs?: number,
    followRedirects?: boolean
  ) =>
    runnerFetch<ApiRequestTestResult>("/api-request/test", {
      method: "POST",
      body: JSON.stringify({
        method,
        url,
        headers: headers ?? {},
        body: body ?? null,
        content_type: contentType,
        timeout_ms: timeoutMs ?? 30000,
        follow_redirects: followRedirects ?? true,
      }),
    }),

  // Run shell command
  runShellCommand: (id: string) =>
    runnerFetch<Record<string, unknown>>(`/shell-commands/${id}/run`, {
      method: "POST",
    }),

  // Run check
  runCheck: (id: string) =>
    runnerFetch<Record<string, unknown>>(`/checks/${id}/run`, {
      method: "POST",
    }),

  // Duplicate check
  duplicateCheck: (id: string) =>
    runnerFetch<Check>(`/checks/${id}/duplicate`, { method: "POST" }),

  // Duplicate shell command
  duplicateShellCommand: (id: string) =>
    runnerFetch<ShellCommand>(`/shell-commands/${id}/duplicate`, {
      method: "POST",
    }),

  // Playwright import/export
  importPlaywrightScript: (data: Record<string, unknown>) =>
    runnerFetch<PlaywrightScript>("/playwright/scripts/import", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  exportPlaywrightScript: (id: string) =>
    runnerFetch<Record<string, unknown>>(`/playwright/scripts/${id}/export`, {
      method: "GET",
    }),

  // Macros CRUD
  getMacros: (category?: string) => {
    const qs = category ? `?category=${encodeURIComponent(category)}` : "";
    return runnerFetch<Macro[]>(`/macros${qs}`);
  },
  getMacro: (id: string) => runnerFetch<Macro>(`/macros/${id}`),
  createMacro: (macro: Partial<Macro>) =>
    runnerFetch<Macro>("/macros", {
      method: "POST",
      body: JSON.stringify(macro),
    }),
  updateMacro: (id: string, macro: Partial<Macro>) =>
    runnerFetch<Macro>(`/macros/${id}`, {
      method: "PUT",
      body: JSON.stringify(macro),
    }),
  deleteMacro: (id: string) =>
    runnerFetch<void>(`/macros/${id}`, { method: "DELETE" }),
  runMacro: (id: string) =>
    runnerFetch<Record<string, unknown>>(`/macros/${id}/run`, {
      method: "POST",
    }),
  searchMacros: (query: string) =>
    runnerFetch<Macro[]>(`/macros/search?q=${encodeURIComponent(query)}`),
  getMacroCategories: () => runnerFetch<string[]>("/macros/categories"),

  // Scriptlets CRUD
  getScriptlets: () => runnerFetch<Scriptlet[]>("/scriptlets"),
  getScriptlet: (id: string) => runnerFetch<Scriptlet>(`/scriptlets/${id}`),
  createScriptlet: (scriptlet: Partial<Scriptlet>) =>
    runnerFetch<Scriptlet>("/scriptlets", {
      method: "POST",
      body: JSON.stringify(scriptlet),
    }),
  updateScriptlet: (id: string, scriptlet: Partial<Scriptlet>) =>
    runnerFetch<Scriptlet>(`/scriptlets/${id}`, {
      method: "PUT",
      body: JSON.stringify(scriptlet),
    }),
  deleteScriptlet: (id: string) =>
    runnerFetch<void>(`/scriptlets/${id}`, { method: "DELETE" }),
  searchScriptlets: (query: string) =>
    runnerFetch<Scriptlet[]>(
      `/scriptlets/search?q=${encodeURIComponent(query)}`
    ),

  // AWAS
  awasDiscover: (url: string, timeoutSeconds?: number) =>
    runnerFetch<AwasDiscoverResponse>("/awas/discover", {
      method: "POST",
      body: JSON.stringify({ url, timeout_seconds: timeoutSeconds ?? 10 }),
    }),
  awasCheckSupport: (url: string, timeoutSeconds?: number) =>
    runnerFetch<AwasCheckSupportResponse>("/awas/check-support", {
      method: "POST",
      body: JSON.stringify({ url, timeout_seconds: timeoutSeconds ?? 10 }),
    }),
  awasListActions: () =>
    runnerFetch<{ actions: AwasActionInfo[]; url: string }>("/awas/actions"),
  awasExecute: (
    url: string,
    actionId: string,
    params?: Record<string, unknown>,
    timeoutSeconds?: number
  ) =>
    runnerFetch<AwasExecuteResponse>("/awas/execute", {
      method: "POST",
      body: JSON.stringify({
        url,
        action_id: actionId,
        params,
        timeout_seconds: timeoutSeconds ?? 30,
      }),
    }),
  awasExtractElements: (html: string, baseUrl?: string) =>
    runnerFetch<{ success: boolean; elements?: unknown; error?: string }>(
      "/awas/extract-elements",
      {
        method: "POST",
        body: JSON.stringify({ html, base_url: baseUrl }),
      }
    ),

  // State Explorer
  startExploration: (config: {
    config_path: string;
    strategy?: string;
    max_states?: number;
    max_duration_seconds?: number;
    target_state_ids?: string[];
    target_transition_ids?: string[];
    monitor_index?: number;
    capture_screenshots?: boolean;
    stop_on_first_failure?: boolean;
  }) =>
    runnerFetch<{ run_id: string }>("/state-explorer/start", {
      method: "POST",
      body: JSON.stringify(config),
    }),
  getExplorationStrategies: () =>
    runnerFetch<ExplorationStrategy[]>("/state-explorer/strategies"),
  previewExploration: (config: {
    config_path: string;
    strategy?: string;
    max_states?: number;
    target_state_ids?: string[];
    target_transition_ids?: string[];
  }) =>
    runnerFetch<unknown>("/state-explorer/preview", {
      method: "POST",
      body: JSON.stringify(config),
    }),
  getExplorationHistory: (limit?: number) => {
    const qs = limit ? `?limit=${limit}` : "";
    return runnerFetch<ExplorationReport[]>(`/state-explorer/history${qs}`);
  },
  getExplorationReport: (runId: string) =>
    runnerFetch<ExplorationReport>(`/state-explorer/${runId}`),

  // Check Group Members
  getChecksInGroup: (groupId: string) =>
    runnerFetch<Check[]>(`/check-groups/${groupId}/checks`),
  setChecksInGroup: (groupId: string, checkIds: string[]) =>
    runnerFetch<void>(`/check-groups/${groupId}/checks`, {
      method: "PUT",
      body: JSON.stringify({ check_ids: checkIds }),
    }),
  runCheckGroup: (groupId: string) =>
    runnerFetch<Record<string, unknown>>(`/check-groups/${groupId}/run`, {
      method: "POST",
    }),

  // ============================================================================
  // Settings API
  // ============================================================================

  // General Settings
  getGeneralSettings: () => runnerFetch<GeneralSettings>("/settings/general"),
  saveGeneralSettings: (settings: GeneralSettings) =>
    runnerFetch<void>("/settings/general", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),

  // AI Settings
  getAiSettings: () => runnerFetch<AiSettings>("/settings/ai"),
  saveAiSettings: (settings: AiSettings) =>
    runnerFetch<void>("/settings/ai", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),
  testAiConnection: () =>
    runnerFetch<AiConnectionTestResult>("/settings/ai/test-connection", {
      method: "POST",
    }),
  saveAiApiKey: (provider: string, apiKey: string) =>
    runnerFetch<void>("/settings/ai/api-key", {
      method: "POST",
      body: JSON.stringify({ provider, api_key: apiKey }),
    }),
  deleteAiApiKey: (provider: string) =>
    runnerFetch<void>(`/settings/ai/api-key/${provider}`, {
      method: "DELETE",
    }),
  hasAiApiKey: (provider: string) =>
    runnerFetch<{ has_key: boolean }>(`/settings/ai/has-key/${provider}`),

  // Agentic Settings
  getAgenticSettings: () => runnerFetch<AgenticSettings>("/settings/agentic"),
  saveAgenticSettings: (settings: AgenticSettings) =>
    runnerFetch<void>("/settings/agentic", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),

  // Debug Settings
  getDebugSettings: () => runnerFetch<DebugSettings>("/settings/debug"),
  saveDebugSettings: (settings: DebugSettings) =>
    runnerFetch<void>("/settings/debug", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),

  // Playwright Settings
  getPlaywrightSettings: () =>
    runnerFetch<PlaywrightSettings>("/settings/playwright"),
  savePlaywrightSettings: (settings: Partial<PlaywrightSettings>) =>
    runnerFetch<void>("/settings/playwright", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),
  hasPlaywrightPassword: () =>
    runnerFetch<{ has_password: boolean }>("/settings/playwright/has-password"),
  deletePlaywrightPassword: () =>
    runnerFetch<void>("/settings/playwright/password", {
      method: "DELETE",
    }),

  // Self-Healing Settings
  getSelfHealingSettings: () =>
    runnerFetch<SelfHealingSettings>("/settings/self-healing"),
  saveSelfHealingSettings: (settings: SelfHealingSettings) =>
    runnerFetch<void>("/settings/self-healing", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),
  saveSelfHealingApiKey: (provider: string, apiKey: string) =>
    runnerFetch<void>("/settings/self-healing/api-key", {
      method: "POST",
      body: JSON.stringify({ provider, api_key: apiKey }),
    }),
  deleteSelfHealingApiKey: (provider: string) =>
    runnerFetch<void>(`/settings/self-healing/api-key/${provider}`, {
      method: "DELETE",
    }),
  hasSelfHealingApiKey: (provider: string) =>
    runnerFetch<{ has_key: boolean }>(
      `/settings/self-healing/has-key/${provider}`
    ),

  // Mobile Settings
  getMobileSettings: () => runnerFetch<MobileSettings>("/settings/mobile"),
  saveMobileSettings: (settings: MobileSettings) =>
    runnerFetch<void>("/settings/mobile", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),

  // Storage Info
  getStorageInfo: () => runnerFetch<StorageInfo>("/settings/storage"),
  cleanupStorage: (storageType: string, olderThanDays: number) =>
    runnerFetch<void>("/settings/storage/cleanup", {
      method: "POST",
      body: JSON.stringify({
        storage_type: storageType,
        older_than_days: olderThanDays,
      }),
    }),
  clearAllStorage: () =>
    runnerFetch<void>("/settings/storage/clear-all", { method: "POST" }),

  // Device Info
  getDeviceInfo: () => runnerFetch<DeviceInfo>("/settings/device-info"),

  // Backup
  getBackupSummary: () =>
    runnerFetch<BackupSummary>("/settings/backup/summary"),
  exportBackup: (options?: Record<string, boolean>) =>
    runnerFetch<Record<string, unknown>>("/settings/backup/export", {
      method: "POST",
      body: JSON.stringify(options ?? {}),
    }),
  importBackup: (
    data: Record<string, unknown>,
    options?: {
      conflict_resolution?: string;
      categories?: Record<string, boolean>;
    }
  ) =>
    runnerFetch<{
      imported: number;
      skipped: number;
      errors: number;
      details: Record<
        string,
        { imported: number; skipped: number; errors: number }
      >;
    }>("/settings/backup/import", {
      method: "POST",
      body: JSON.stringify({ data, ...options }),
    }),

  // MCP Servers (Settings)
  getSettingsMcpServers: () =>
    runnerFetch<McpServer[]>("/settings/mcp/servers"),
  createMcpServer: (server: Omit<McpServer, "id">) =>
    runnerFetch<McpServer>("/settings/mcp/servers", {
      method: "POST",
      body: JSON.stringify(server),
    }),
  updateMcpServer: (id: string, server: Partial<McpServer>) =>
    runnerFetch<McpServer>(`/settings/mcp/servers/${id}`, {
      method: "PUT",
      body: JSON.stringify(server),
    }),
  deleteMcpServer: (id: string) =>
    runnerFetch<void>(`/settings/mcp/servers/${id}`, { method: "DELETE" }),
  connectMcpServer: (id: string) =>
    runnerFetch<void>(`/settings/mcp/servers/${id}/connect`, {
      method: "POST",
    }),
  disconnectMcpServer: (id: string) =>
    runnerFetch<void>(`/settings/mcp/servers/${id}/disconnect`, {
      method: "POST",
    }),
  getMcpServerStatus: (id: string) =>
    runnerFetch<McpServerStatus>(`/settings/mcp/servers/${id}/status`),
  getMcpServersStatus: () =>
    runnerFetch<McpServerStatus[]>("/settings/mcp/servers/status"),

  // Interaction Recording
  startInteractionRecording: (fps?: number, outputDir?: string) =>
    runnerFetch<{ session_id: string; status: string }>(
      "/interaction-recording/start",
      {
        method: "POST",
        body: JSON.stringify({ fps: fps ?? 30, output_dir: outputDir }),
      }
    ),

  stopInteractionRecording: () =>
    runnerFetch<{
      status: string;
      duration: number;
      events_count: number;
    }>("/interaction-recording/stop", {
      method: "POST",
    }),

  getInteractionRecordingStatus: () =>
    runnerFetch<{
      is_recording: boolean;
      session_id: string | null;
      duration: number;
      events_count: number;
      fps: number;
    }>("/interaction-recording/status"),

  // Findings
  getTaskFindings: (taskRunId: string | number) =>
    runnerFetch<Finding[]>(`/findings/task/${taskRunId}`),

  updateFindingStatus: (
    findingId: string,
    status: string,
    resolution?: string
  ) =>
    runnerFetch<void>(`/findings/${findingId}/status`, {
      method: "PUT",
      body: JSON.stringify({ status, resolution }),
    }),

  resolveFinding: (findingId: string, resolution: string) =>
    runnerFetch<void>(`/findings/${findingId}/resolve`, {
      method: "POST",
      body: JSON.stringify({ resolution }),
    }),

  provideFindingResponse: (findingId: string, response: string) =>
    runnerFetch<void>(`/findings/${findingId}/user-response`, {
      method: "POST",
      body: JSON.stringify({ response }),
    }),

  clearAllFindings: (taskRunId: string | number) =>
    runnerFetch<void>(`/findings/task/${taskRunId}/clear-all`, {
      method: "POST",
    }),

  // Task run messaging and session state
  sendTaskRunMessage: (id: string | number, message: string) =>
    runnerFetch<SendMessageResponse>(`/task-runs/${id}/message`, {
      method: "POST",
      body: JSON.stringify({ message }),
    }),

  getSessionState: (id: string | number) =>
    runnerFetch<SessionState>(`/task-runs/${id}/session-state`),

  toggleAutoContinue: (id: string | number, enabled: boolean) =>
    runnerFetch<void>(`/task-runs/${id}/auto-continue`, {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    }),

  // Execute Action
  executeAction: (params: {
    action_type: string;
    image_id?: string;
    text_input?: string;
    hotkey?: string;
    monitor_index?: number;
    timeout_seconds?: number;
  }) =>
    runnerFetch<{
      success: boolean;
      action_type: string;
      image_id: string;
      error: string | null;
    }>("/execute-action", {
      method: "POST",
      body: JSON.stringify(params),
    }),
};
