/**
 * Server-Mode Runners API
 *
 * Manage the fleet of long-running server-mode runners registered to
 * the current user. Runners register themselves using a runner token.
 */

import type { ServerRunner } from "@/types/server-runner";

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

/** List all server-mode runners owned by the current user. */
export async function listRunners(): Promise<ServerRunner[]> {
  const response = await fetch(`/api/v1/runners`, {
    credentials: "include",
  });
  return handleResponse<ServerRunner[]>(response, "Failed to list runners");
}

/** Get details for a single runner. */
export async function getRunner(runnerId: string): Promise<ServerRunner> {
  const response = await fetch(`/api/v1/runners/${runnerId}`, {
    credentials: "include",
  });
  return handleResponse<ServerRunner>(response, "Failed to load runner");
}

/** Deregister a runner. The runner will need to re-register to come back. */
export async function deregisterRunner(runnerId: string): Promise<void> {
  const response = await fetch(`/api/v1/runners/${runnerId}`, {
    method: "DELETE",
    credentials: "include",
  });
  await handleResponse<void>(response, "Failed to deregister runner");
}
