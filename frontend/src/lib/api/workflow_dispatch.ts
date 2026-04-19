/**
 * Workflow Dispatch API
 *
 * Dispatch a workflow to a server-mode runner for execution.
 * Returns the execution_id so the caller can follow along in the
 * execution/run detail view.
 */

import type { DispatchRequest, DispatchResponse } from "@/types/server-runner";

/** Thrown when the dispatch backend returns a known error status. */
export class DispatchError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "DispatchError";
  }
}

/**
 * POST a workflow to the dispatch endpoint.
 *
 * Error status semantics:
 *   - 404: workflow or runner not found / not owned
 *   - 409: target runner is not server_mode
 *   - 502: runner unreachable
 *   - 503: no healthy runner available (target=auto)
 *   - 504: runner timed out accepting the dispatch
 */
export async function dispatchWorkflow(
  workflowId: string,
  data: DispatchRequest
): Promise<DispatchResponse> {
  const response = await fetch(`/api/v1/workflows/${workflowId}/dispatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message =
      (body as { detail?: string }).detail ||
      (body as { message?: string }).message ||
      "Failed to dispatch workflow";
    throw new DispatchError(message, response.status);
  }

  return response.json();
}
