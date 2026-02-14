"use client";

import { runnerFetch } from "./api-client";
import type {
  RunnerHealth,
  TaskRun,
  TaskRunOutput,
  Finding,
  SendMessageResponse,
  SessionState,
} from "./types/task-run";
import type {
  Check,
  CheckGroup,
  SavedApiRequest,
  PlaywrightScript,
  SavedPrompt,
  Macro,
  Scriptlet,
} from "./types/library";
import type {
  AwasDiscoverResponse,
  AwasCheckSupportResponse,
  AwasActionInfo,
  AwasExecuteResponse,
  ExplorationStrategy,
  ExplorationReport,
  ContextItem,
} from "./types/exploration";
import type {
  GeneralSettings,
  AiSettings,
  AgenticSettings,
  DebugSettings,
  PlaywrightSettings,
  SelfHealingSettings,
  MobileSettings,
  StorageInfo,
  DeviceInfo,
  BackupSummary,
  McpServer,
  McpServerStatus,
  AiConnectionTestResult,
} from "./types/settings";
import type {
  Hook,
  CreateHookRequest,
  UpdateHookRequest,
  TestHookResponse,
} from "./types/hooks-config";
import type {
  LogSource,
  GlobalLogSourceSettings,
  LogSourceAiSelectionMode,
} from "./types/log-sources";
import type { ExecutePlanRequest, ShellCommand } from "./types/execution";
import type {
  GenerateWorkflowRequest,
  GenerateWorkflowResponse,
  GenerateWorkflowAsyncResponse,
  CreateContextFromFileRequest,
} from "./types/workflow";
import type {
  ParsedCurlResponse,
  ApiRequestTestResult,
  GenerateChecksResponse,
} from "./types/api-responses";

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

  // Generate workflow from natural language (AI generation - long timeout)
  // Multi-agent pipeline: builder + up to 3 verification/fixer loops, each calling AI with 90s timeout
  generateWorkflow: (request: GenerateWorkflowRequest) =>
    runnerFetch<GenerateWorkflowResponse>("/unified-workflows/generate", {
      method: "POST",
      body: JSON.stringify(request),
      timeoutMs: 600000,
    }),

  // Async workflow generation (meta-workflow based - returns immediately with task run ID)
  generateWorkflowAsync: (request: GenerateWorkflowRequest) =>
    runnerFetch<GenerateWorkflowAsyncResponse>(
      "/unified-workflows/generate-async",
      {
        method: "POST",
        body: JSON.stringify(request),
        timeoutMs: 30000, // Quick response - just starts the task
      }
    ),

  // Get result data from a completed task run
  getTaskRunResultData: (id: string) =>
    runnerFetch<Record<string, unknown>>(`/task-runs/${id}/result-data`, {
      method: "GET",
    }),

  // Get workflow state for a task run (used to track meta-workflow progress)
  getTaskRunWorkflowState: (id: string) =>
    runnerFetch<Record<string, unknown>>(`/task-runs/${id}/workflow-state`, {
      method: "GET",
    }),

  // Create context from file path
  createContextFromFile: (
    scope: string,
    request: CreateContextFromFileRequest
  ) =>
    runnerFetch<ContextItem>(`/contexts/${scope}/from-file`, {
      method: "POST",
      body: JSON.stringify(request),
    }),


  // Run workflow
  runUnifiedWorkflow: (id: string) =>
    runnerFetch<void>(`/unified-workflows/${id}/run`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

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

  // App Mode
  getAppMode: () =>
    runnerFetch<{ mode: string }>("/settings/app-mode"),
  setAppMode: (mode: string) =>
    runnerFetch<void>("/settings/app-mode", {
      method: "PUT",
      body: JSON.stringify({ mode }),
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

  // Pause/Resume task run
  pauseTaskRun: (id: string | number) =>
    runnerFetch<void>(`/task-runs/${id}/pause`, { method: "POST" }),
  resumeTaskRun: (id: string | number) =>
    runnerFetch<void>(`/task-runs/${id}/resume`, { method: "POST" }),

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
