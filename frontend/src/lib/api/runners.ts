/**
 * Devices API — wraps the unified `/api/v1/devices` endpoint surface.
 *
 * Backed by the canonical `Device` entity (single source of truth, see
 * `qontinui-schemas/rust/src/device.rs`). Replaces the legacy
 * `runner_connections` and split `ServerRunner`/`RunnerConnection` shapes.
 * The TS surface still typed against the existing `Runner` type alias from
 * `@qontinui/shared-types@0.3.0`; Phase 7 publishes the renamed `Device`
 * type and consumers retype in that PR.
 */

import type { Runner } from "@qontinui/shared-types";
import type {
  RunnerSessionFilters,
  RunnerSessionsResponse,
  DispatchPayload,
  DispatchResult,
} from "@/types/runner";

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
 * List runners owned by the current user. Optionally filter by derived
 * status (comma-separated list, e.g. `"healthy,degraded"`).
 */
export async function listRunners(status?: string): Promise<Runner[]> {
  const url = status
    ? `/api/v1/devices?status=${encodeURIComponent(status)}`
    : `/api/v1/devices`;
  const response = await fetch(url, { credentials: "include" });
  return handleResponse<Runner[]>(response, "Failed to list runners");
}

/** Get details for a single runner by UUID. */
export async function getRunner(runnerId: string): Promise<Runner> {
  const response = await fetch(`/api/v1/devices/${runnerId}`, {
    credentials: "include",
  });
  return handleResponse<Runner>(response, "Failed to load runner");
}

/** Deregister a runner. Closes its WebSocket and removes it from the fleet. */
export async function deleteRunner(runnerId: string): Promise<void> {
  const response = await fetch(`/api/v1/devices/${runnerId}`, {
    method: "DELETE",
    credentials: "include",
  });
  await handleResponse<void>(response, "Failed to deregister runner");
}

/**
 * Dispatch a workflow to a specific runner. The runner must be
 * WebSocket-connected — returns 503 otherwise.
 */
export async function dispatchToRunner(
  runnerId: string,
  body: DispatchPayload
): Promise<DispatchResult> {
  const response = await fetch(`/api/v1/devices/${runnerId}/dispatch`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return handleResponse<DispatchResult>(
    response,
    "Failed to dispatch workflow"
  );
}

/**
 * Fetch the runner-session audit log (history of past WS sessions).
 * This replaces the old `/api/v1/devices/connections` endpoint.
 */
export async function listRunnerSessions(
  filters: RunnerSessionFilters = {}
): Promise<RunnerSessionsResponse> {
  const params = new URLSearchParams();
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  if (filters.offset !== undefined)
    params.set("offset", String(filters.offset));
  if (filters.search) params.set("search", filters.search);
  if (filters.start_date) params.set("start_date", filters.start_date);
  if (filters.end_date) params.set("end_date", filters.end_date);
  if (filters.runner_id) params.set("runner_id", filters.runner_id);

  const url = `/api/v1/devices/sessions${
    params.toString() ? `?${params.toString()}` : ""
  }`;
  const response = await fetch(url, { credentials: "include" });
  return handleResponse<RunnerSessionsResponse>(
    response,
    "Failed to load runner sessions"
  );
}
