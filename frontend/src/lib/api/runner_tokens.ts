/**
 * Device Tokens API
 *
 * Long-lived bearer tokens used by paired devices (server-mode runners)
 * to authenticate against the backend when they register and heartbeat.
 *
 * Phase 6 of the unified-devices-registry plan: pair-confirm POST replaces
 * `POST /api/v1/runners/tokens`; list/revoke now live under
 * `/api/v1/devices/tokens` to match the canonical `coord.devices` surface.
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
 * Pair-confirm: create a new device token. The plain token is only
 * returned on creation and must be shown to the user once.
 *
 * Backed by Phase 5's `POST /api/v1/devices/pair-confirm` endpoint —
 * mints the device JWT and (on a fresh device) UPSERTs `coord.devices`.
 */
export async function createRunnerToken(
  data: CreateRunnerTokenRequest
): Promise<CreateRunnerTokenResponse> {
  const response = await fetch(`/api/v1/devices/pair-confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  return handleResponse<CreateRunnerTokenResponse>(
    response,
    "Failed to create device token"
  );
}

/** List the user's device tokens (hashes never leak). */
export async function listRunnerTokens(): Promise<RunnerToken[]> {
  const response = await fetch(`/api/v1/devices/tokens`, {
    credentials: "include",
  });
  return handleResponse<RunnerToken[]>(
    response,
    "Failed to list device tokens"
  );
}

/** Revoke a device token. */
export async function revokeRunnerToken(tokenId: string): Promise<void> {
  const response = await fetch(`/api/v1/devices/tokens/${tokenId}`, {
    method: "DELETE",
    credentials: "include",
  });
  await handleResponse<void>(response, "Failed to revoke device token");
}
