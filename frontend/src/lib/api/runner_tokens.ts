/**
 * Runner Tokens API
 *
 * Long-lived bearer tokens used by server-mode runners to authenticate
 * against the backend when they register and heartbeat.
 */

import type {
  CreateRunnerTokenRequest,
  CreateRunnerTokenResponse,
  RunnerToken,
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
 * Create a new runner token. The plain token is only returned on creation
 * and must be shown to the user once.
 */
export async function createRunnerToken(
  data: CreateRunnerTokenRequest
): Promise<CreateRunnerTokenResponse> {
  const response = await fetch(`/api/v1/runners/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  return handleResponse<CreateRunnerTokenResponse>(
    response,
    "Failed to create runner token"
  );
}

/** List the user's runner tokens (hashes never leak). */
export async function listRunnerTokens(): Promise<RunnerToken[]> {
  const response = await fetch(`/api/v1/runners/tokens`, {
    credentials: "include",
  });
  return handleResponse<RunnerToken[]>(
    response,
    "Failed to list runner tokens"
  );
}

/** Revoke a runner token. */
export async function revokeRunnerToken(tokenId: string): Promise<void> {
  const response = await fetch(`/api/v1/runners/tokens/${tokenId}`, {
    method: "DELETE",
    credentials: "include",
  });
  await handleResponse<void>(response, "Failed to revoke runner token");
}
