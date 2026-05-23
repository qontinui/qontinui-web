/**
 * Execution Service
 *
 * Client for the unified execution API.
 * Replaces the fragmented testing-service.ts.
 */

import type {
  ExecutionRunCreate,
  ExecutionRunResponse,
  ExecutionRunDetail,
  ExecutionRunListResponse,
  ExecutionRunComplete,
  ExecutionRunCompleteResponse,
  ActionExecutionBatch,
  ActionExecutionBatchResponse,
  ActionExecutionListResponse,
  ExecutionIssueBatch,
  ExecutionIssueBatchResponse,
  ExecutionIssueListResponse,
  ExecutionIssueDetail,
  ExecutionIssueUpdate,
  ExecutionTrendResponse,
  ActionReliabilityStats,
  RunType,
  RunStatus,
  IssueStatus,
  IssueSeverity,
} from "@/types/generated/execution";

import { httpClient } from "@/services/service-factory";
import { ApiConfig } from "@/services/api-config";

const API_BASE = ApiConfig.API_BASE_URL;

/**
 * Helper to make API requests via the shared HttpClient.
 *
 * HttpClient injects Authorization: Bearer when a token is in memory
 * (required for cross-origin staging-mode where HttpOnly cookies don't
 * deliver) and sends credentials: "include" so the cookie path keeps
 * working in local-mode. Single auth code path for both.
 */
async function fetchWithAuth<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await httpClient.fetch(`${API_BASE}${endpoint}`, options);

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ detail: "Unknown error" }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

// =============================================================================
// Execution Runs
// =============================================================================

/**
 * Create a new execution run
 */
export async function createExecutionRun(
  data: ExecutionRunCreate
): Promise<ExecutionRunResponse> {
  return fetchWithAuth("/api/v1/execution/runs", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * List execution runs with filters
 */
export async function listExecutionRuns(params: {
  project_id?: string;
  run_type?: RunType;
  status?: RunStatus;
  workflow_name?: string;
  start_date?: string;
  end_date?: string;
  limit?: number;
  offset?: number;
}): Promise<ExecutionRunListResponse> {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) {
      searchParams.set(key, String(value));
    }
  });

  return fetchWithAuth(`/api/v1/execution/runs?${searchParams.toString()}`);
}

/**
 * Workflow summary from execution runs
 */
export interface WorkflowSummary {
  workflow_id: string | null;
  workflow_name: string;
  run_count: number;
  last_run_at: string | null;
}

/**
 * List unique workflows from execution runs
 */
export async function listWorkflows(
  projectId: string
): Promise<WorkflowSummary[]> {
  return fetchWithAuth(
    `/api/v1/execution/runs/workflows?project_id=${projectId}`
  );
}

/**
 * Get execution run details
 */
export async function getExecutionRun(
  runId: string
): Promise<ExecutionRunDetail> {
  return fetchWithAuth(`/api/v1/execution/runs/${runId}`);
}

/**
 * Complete an execution run
 */
export async function completeExecutionRun(
  runId: string,
  data: ExecutionRunComplete
): Promise<ExecutionRunCompleteResponse> {
  return fetchWithAuth(`/api/v1/execution/runs/${runId}/complete`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

/**
 * Cancel an execution run
 */
export async function cancelExecutionRun(runId: string): Promise<void> {
  return fetchWithAuth(`/api/v1/execution/runs/${runId}`, {
    method: "DELETE",
  });
}

// =============================================================================
// Action Executions
// =============================================================================

/**
 * Report batch of action executions
 */
export async function reportActions(
  runId: string,
  data: ActionExecutionBatch
): Promise<ActionExecutionBatchResponse> {
  return fetchWithAuth(`/api/v1/execution/runs/${runId}/actions`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * List actions for a run
 */
export async function listActions(
  runId: string,
  params: { limit?: number; offset?: number } = {}
): Promise<ActionExecutionListResponse> {
  const searchParams = new URLSearchParams();
  if (params.limit) searchParams.set("limit", String(params.limit));
  if (params.offset) searchParams.set("offset", String(params.offset));

  return fetchWithAuth(
    `/api/v1/execution/runs/${runId}/actions?${searchParams.toString()}`
  );
}

// =============================================================================
// Screenshots
// =============================================================================

/**
 * Upload a screenshot
 */
export async function uploadScreenshot(
  runId: string,
  metadata: {
    screenshot_id: string;
    sequence_number: number;
    screenshot_type: string;
    action_sequence_number?: number;
    state_name?: string;
    captured_at: string;
    width: number;
    height: number;
  },
  imageFile: File
): Promise<{ id: string; image_url: string; thumbnail_url?: string }> {
  const formData = new FormData();
  formData.append("metadata", JSON.stringify(metadata));
  formData.append("image", imageFile);

  const response = await fetch(
    `${API_BASE}/api/v1/execution/runs/${runId}/screenshots`,
    {
      method: "POST",
      credentials: "include", // Send HttpOnly auth cookies
      body: formData,
    }
  );

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ detail: "Unknown error" }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

// =============================================================================
// Issues
// =============================================================================

/**
 * Report batch of issues
 */
export async function reportIssues(
  runId: string,
  data: ExecutionIssueBatch
): Promise<ExecutionIssueBatchResponse> {
  return fetchWithAuth(`/api/v1/execution/runs/${runId}/issues`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * List issues for a run
 */
export async function listRunIssues(
  runId: string,
  params: { limit?: number; offset?: number } = {}
): Promise<ExecutionIssueListResponse> {
  const searchParams = new URLSearchParams();
  if (params.limit) searchParams.set("limit", String(params.limit));
  if (params.offset) searchParams.set("offset", String(params.offset));

  return fetchWithAuth(
    `/api/v1/execution/runs/${runId}/issues?${searchParams.toString()}`
  );
}

/**
 * List all issues with filters
 */
export async function listIssues(params: {
  project_id?: string;
  run_id?: string;
  status?: IssueStatus;
  severity?: IssueSeverity;
  limit?: number;
  offset?: number;
}): Promise<ExecutionIssueListResponse> {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) {
      searchParams.set(key, String(value));
    }
  });

  return fetchWithAuth(`/api/v1/execution/issues?${searchParams.toString()}`);
}

/**
 * Get issue details
 */
export async function getIssue(issueId: string): Promise<ExecutionIssueDetail> {
  return fetchWithAuth(`/api/v1/execution/issues/${issueId}`);
}

/**
 * Update an issue
 */
export async function updateIssue(
  issueId: string,
  data: ExecutionIssueUpdate
): Promise<ExecutionIssueDetail> {
  return fetchWithAuth(`/api/v1/execution/issues/${issueId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

// =============================================================================
// Screenshots (list)
// =============================================================================

/**
 * List screenshots for a run
 */
export async function listScreenshots(
  runId: string,
  params: { limit?: number; offset?: number } = {}
): Promise<{
  screenshots: Array<{
    id: string;
    run_id: string;
    sequence_number: number;
    screenshot_type: string;
    image_url: string;
    thumbnail_url?: string;
    state_name?: string;
    captured_at: string;
    file_size_bytes: number;
  }>;
  pagination: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
}> {
  const searchParams = new URLSearchParams();
  if (params.limit) searchParams.set("limit", String(params.limit));
  if (params.offset) searchParams.set("offset", String(params.offset));

  return fetchWithAuth(
    `/api/v1/execution/runs/${runId}/screenshots?${searchParams.toString()}`
  );
}

// =============================================================================
// Execution Tree
// =============================================================================

/**
 * Tree event response type
 */
export interface TreeEventResponse {
  id: string;
  run_id: string;
  event_type: string;
  node_id: string;
  node_type: string;
  node_name: string;
  parent_node_id: string | null;
  path: Array<{ id: string; name: string; node_type: string }>;
  sequence: number;
  event_timestamp: number;
  status: string;
  error_message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/**
 * Tree event list response
 */
export interface TreeEventListResponse {
  events: TreeEventResponse[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

/**
 * Tree node type for execution tree
 */
export interface ExecutionTreeNode {
  id: string;
  node_type: string;
  name: string;
  timestamp: number;
  end_timestamp?: number | null;
  duration?: number | null;
  status: string;
  metadata: Record<string, unknown>;
  error?: string | null;
  children: ExecutionTreeNode[];
  is_expanded: boolean;
  level: number;
}

/**
 * Execution tree response
 */
export interface ExecutionTreeResponse {
  run_id: string;
  root_nodes: ExecutionTreeNode[];
  total_events: number;
  workflow_name: string | null;
  status: string;
  duration_ms: number | null;
  initial_state_ids: string[];
}

/**
 * List tree events for an execution run
 */
export async function listTreeEvents(
  runId: string,
  params?: {
    event_type?: string;
    node_type?: string;
    offset?: number;
    limit?: number;
  }
): Promise<TreeEventListResponse> {
  const searchParams = new URLSearchParams();
  if (params?.event_type) searchParams.set("event_type", params.event_type);
  if (params?.node_type) searchParams.set("node_type", params.node_type);
  if (params?.offset !== undefined)
    searchParams.set("offset", String(params.offset));
  if (params?.limit !== undefined)
    searchParams.set("limit", String(params.limit));

  const queryString = searchParams.toString();
  return fetchWithAuth(
    `/api/v1/execution/runs/${runId}/tree-events${queryString ? `?${queryString}` : ""}`
  );
}

/**
 * Get the reconstructed execution tree for a run
 */
export async function getExecutionTree(
  runId: string
): Promise<ExecutionTreeResponse> {
  return fetchWithAuth(`/api/v1/execution/runs/${runId}/tree`);
}

// =============================================================================
// Analytics
// =============================================================================

/**
 * Get execution trends
 */
export async function getExecutionTrends(params: {
  project_id: string;
  run_type?: RunType;
  start_date: string;
  end_date: string;
  granularity?: "daily" | "weekly" | "monthly";
}): Promise<ExecutionTrendResponse> {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) {
      searchParams.set(key, String(value));
    }
  });

  return fetchWithAuth(
    `/api/v1/execution/analytics/trends?${searchParams.toString()}`
  );
}

/**
 * Get action reliability statistics
 */
export async function getActionReliability(params: {
  project_id: string;
  workflow_id?: string;
  start_date?: string;
  end_date?: string;
}): Promise<{ stats: ActionReliabilityStats[] }> {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) {
      searchParams.set(key, String(value));
    }
  });

  return fetchWithAuth(
    `/api/v1/execution/analytics/reliability?${searchParams.toString()}`
  );
}

// =============================================================================
// Export all functions
// =============================================================================

export const executionService = {
  // Runs
  createRun: createExecutionRun,
  listRuns: listExecutionRuns,
  getRun: getExecutionRun,
  completeRun: completeExecutionRun,
  cancelRun: cancelExecutionRun,
  // Workflows
  listWorkflows,
  // Actions
  reportActions,
  listActions,
  // Screenshots
  uploadScreenshot,
  listScreenshots,
  // Issues
  reportIssues,
  listRunIssues,
  listIssues,
  getIssue,
  updateIssue,
  // Tree
  listTreeEvents,
  getTree: getExecutionTree,
  // Analytics
  getTrends: getExecutionTrends,
  getReliability: getActionReliability,
};

// =============================================================================
// Unified Execution API (Alternative interface)
// =============================================================================

/**
 * Unified execution API with method-style interface.
 * This provides an alternative API surface that matches the unified execution API spec.
 */
export const executionApi = {
  // Runs
  createRun: (data: ExecutionRunCreate) => createExecutionRun(data),

  getRun: (runId: string) => getExecutionRun(runId),

  listRuns: (params: Parameters<typeof listExecutionRuns>[0]) =>
    listExecutionRuns(params),

  completeRun: (runId: string, data: ExecutionRunComplete) =>
    completeExecutionRun(runId, data),

  cancelRun: (runId: string) => cancelExecutionRun(runId),

  // Actions
  listActions: (runId: string, params?: Parameters<typeof listActions>[1]) =>
    listActions(runId, params),

  reportActions: (runId: string, data: ActionExecutionBatch) =>
    reportActions(runId, data),

  // Screenshots
  listScreenshots: (
    runId: string,
    params?: Parameters<typeof listScreenshots>[1]
  ) => listScreenshots(runId, params),

  uploadScreenshot: (
    runId: string,
    metadata: Parameters<typeof uploadScreenshot>[1],
    imageFile: File
  ) => uploadScreenshot(runId, metadata, imageFile),

  // Issues
  listIssues: (params?: Parameters<typeof listIssues>[0]) =>
    listIssues(params ?? {}),

  listRunIssues: (
    runId: string,
    params?: Parameters<typeof listRunIssues>[1]
  ) => listRunIssues(runId, params),

  getIssue: (issueId: string) => getIssue(issueId),

  updateIssue: (issueId: string, data: ExecutionIssueUpdate) =>
    updateIssue(issueId, data),

  reportIssues: (runId: string, data: ExecutionIssueBatch) =>
    reportIssues(runId, data),

  // Analytics
  getTrends: (params: Parameters<typeof getExecutionTrends>[0]) =>
    getExecutionTrends(params),

  getReliability: (params: Parameters<typeof getActionReliability>[0]) =>
    getActionReliability(params),

  // Tree
  getTree: (runId: string) => getExecutionTree(runId),

  listTreeEvents: (
    runId: string,
    params?: Parameters<typeof listTreeEvents>[1]
  ) => listTreeEvents(runId, params),

  // Workflows
  listWorkflows: (projectId: string) => listWorkflows(projectId),
};

export default executionService;
