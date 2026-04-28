/**
 * Workflow Dispatch API
 *
 * Dispatches a workflow to a specific runner. Backed by the unified
 * `POST /api/v1/runners/{runner_id}/dispatch` endpoint (Phase 2 of the
 * unified-runner architecture). Returns the execution_id so the caller
 * can follow along in the run detail view.
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
 * POST a workflow to a runner via the unified dispatch endpoint.
 *
 * @param runnerId UUID of the target runner. Pass an explicit ID; the
 *   backend no longer supports `target=auto` at the dispatch endpoint —
 *   callers should pick a healthy runner client-side and dispatch to its
 *   ID directly.
 *
 * Error status semantics:
 *   - 404: workflow or runner not found / not owned
 *   - 503: runner is not WebSocket-connected (cannot accept dispatch)
 *   - 502: runner reachable but failed to ACK
 *   - 504: runner timed out accepting the dispatch
 */
export async function dispatchWorkflow(
  runnerId: string,
  data: DispatchRequest
): Promise<DispatchResponse> {
  const response = await fetch(`/api/v1/runners/${runnerId}/dispatch`, {
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
