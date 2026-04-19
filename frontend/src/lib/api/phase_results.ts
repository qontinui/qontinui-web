/**
 * Phase Results API
 *
 * Phase results are written by server-mode runners as each workflow phase
 * finishes. Each record captures the full step_results[] and metadata for
 * one pass of one phase (setup, verification, agentic, completion).
 */

import type { PhaseResult } from "@/types/server-runner";

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
  return response.json();
}

/**
 * List all phase results for an execution, ordered by created_at ASC.
 */
export async function listPhaseResults(
  executionId: string
): Promise<PhaseResult[]> {
  const params = new URLSearchParams({ execution_id: executionId });
  const response = await fetch(`/api/v1/phase-results?${params.toString()}`, {
    credentials: "include",
  });
  return handleResponse<PhaseResult[]>(
    response,
    "Failed to list phase results"
  );
}

/** Get a single phase result by id. */
export async function getPhaseResult(id: string): Promise<PhaseResult> {
  const response = await fetch(`/api/v1/phase-results/${id}`, {
    credentials: "include",
  });
  return handleResponse<PhaseResult>(response, "Failed to load phase result");
}
