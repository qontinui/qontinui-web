/**
 * Scheduled Workflow Runs API
 *
 * Cron-style recurring dispatch records. Each record binds a workflow to a
 * cron expression and a dispatch target (auto or a specific runner).
 */

import type {
  CreateScheduledRunRequest,
  DispatchResponse,
  ScheduledWorkflowRun,
  UpdateScheduledRunRequest,
} from "@/types/server-runner";

async function handleResponse<T>(
  response: Response,
  fallback: string
): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message =
      (body as { detail?: string }).detail ||
      (body as { message?: string }).message ||
      fallback;
    throw new Error(message);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json();
}

/**
 * List scheduled runs. Pass a workflow_id to scope the list to that
 * workflow, or omit to list all scheduled runs owned by the user.
 */
export async function listScheduledRuns(
  workflowId?: string
): Promise<ScheduledWorkflowRun[]> {
  const params = new URLSearchParams();
  if (workflowId) params.append("workflow_id", workflowId);
  const qs = params.toString();
  const url = `/api/v1/scheduled-runs${qs ? `?${qs}` : ""}`;
  const response = await fetch(url, { credentials: "include" });
  return handleResponse<ScheduledWorkflowRun[]>(
    response,
    "Failed to list scheduled runs"
  );
}

export async function getScheduledRun(
  id: string
): Promise<ScheduledWorkflowRun> {
  const response = await fetch(`/api/v1/scheduled-runs/${id}`, {
    credentials: "include",
  });
  return handleResponse<ScheduledWorkflowRun>(
    response,
    "Failed to load scheduled run"
  );
}

export async function createScheduledRun(
  data: CreateScheduledRunRequest
): Promise<ScheduledWorkflowRun> {
  const response = await fetch(`/api/v1/scheduled-runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  return handleResponse<ScheduledWorkflowRun>(
    response,
    "Failed to create scheduled run"
  );
}

export async function updateScheduledRun(
  id: string,
  data: UpdateScheduledRunRequest
): Promise<ScheduledWorkflowRun> {
  const response = await fetch(`/api/v1/scheduled-runs/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  return handleResponse<ScheduledWorkflowRun>(
    response,
    "Failed to update scheduled run"
  );
}

export async function deleteScheduledRun(id: string): Promise<void> {
  const response = await fetch(`/api/v1/scheduled-runs/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  await handleResponse<void>(response, "Failed to delete scheduled run");
}

/**
 * Fire a scheduled run immediately, outside of its normal cron cadence.
 * Returns the same dispatch payload as POST /workflows/{id}/dispatch.
 */
export async function runScheduledRunNow(
  id: string
): Promise<DispatchResponse> {
  const response = await fetch(`/api/v1/scheduled-runs/${id}/run-now`, {
    method: "POST",
    credentials: "include",
  });
  return handleResponse<DispatchResponse>(
    response,
    "Failed to run scheduled run now"
  );
}
