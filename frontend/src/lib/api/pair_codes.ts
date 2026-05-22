/**
 * Pair Codes API
 *
 * Phase 2a.2 of plan
 * `D:/qontinui-root/plans/2026-05-22-mtc-iter3-remediation-web-dashboard.md`.
 *
 * Short-lived (5-minute TTL), single-use codes the operator mints from
 * the dashboard and types into the runner's Settings UI to pair a new
 * device. Distinct from long-lived runner tokens — those live in
 * `runner_tokens.ts`.
 */

export interface PairCodeMintResponse {
  code: string;
  expiresAt: string;
}

async function handleResponse<T>(
  response: Response,
  fallback: string
): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail = (body as { detail?: string | { message?: string } }).detail;
    const message =
      (typeof detail === "string" ? detail : detail?.message) ||
      (body as { message?: string }).message ||
      fallback;
    throw new Error(message);
  }
  return response.json();
}

/**
 * Mint a fresh single-use pair code (5-minute TTL).
 *
 * Backend: `POST /api/v1/devices/pair-codes`. The tenant is resolved
 * server-side from the auth cookie; no body is required. The code uses
 * the 32-char unambiguous alphabet (no `0`, `O`, `1`, `I`) so an
 * operator can read it off the screen and type it into the runner
 * without confusing similar-looking characters.
 */
export async function mintPairCode(): Promise<PairCodeMintResponse> {
  const response = await fetch(`/api/v1/devices/pair-codes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({}),
  });
  const raw = await handleResponse<{ code: string; expires_at: string }>(
    response,
    "Failed to mint pair code"
  );
  return {
    code: raw.code,
    expiresAt: raw.expires_at,
  };
}
