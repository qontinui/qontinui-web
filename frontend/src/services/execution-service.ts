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

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/**
 * Helper to make API requests with authentication
 */
async function fetchWithAuth<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = localStorage.getItem("access_token");

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    },
  });

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
  const token = localStorage.getItem("access_token");

  const formData = new FormData();
  formData.append("metadata", JSON.stringify(metadata));
  formData.append("image", imageFile);

  const response = await fetch(
    `${API_BASE}/api/v1/execution/runs/${runId}/screenshots`,
    {
      method: "POST",
      headers: {
        ...(token && { Authorization: `Bearer ${token}` }),
      },
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
  // Actions
  reportActions,
  listActions,
  // Screenshots
  uploadScreenshot,
  // Issues
  reportIssues,
  listRunIssues,
  listIssues,
  getIssue,
  updateIssue,
  // Analytics
  getTrends: getExecutionTrends,
  getReliability: getActionReliability,
};

export default executionService;
