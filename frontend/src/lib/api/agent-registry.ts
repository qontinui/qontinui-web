/**
 * Agent-registry API — wraps the `/api/v1/agent-registry` endpoint surface.
 *
 * Backs the `/settings/agents` page: the current user's effective agent
 * list (coord registry defaults overlaid with the user's own prefs) and
 * the per-agent enable/disposition preference write.
 *
 * Response shapes are typed locally against the backend's
 * `app/api/v1/endpoints/agent_registry.py` Pydantic models (matching the
 * `fleet.ts` precedent — local interfaces keep the page decoupled from the
 * generated api-client snapshot regen).
 */

import { httpClient } from "@/services/service-factory";
import { ApiConfig } from "@/services/api-config";

const AGENT_REGISTRY_API = `${ApiConfig.API_BASE_URL}/api/v1/agent-registry`;

/** What happens when a spawn of a disabled policy-required agent is requested. */
export type AgentDisposition = "block" | "degrade" | "warn_proceed";

/** Whether the effective enabled/disposition comes from the registry default
 *  or the user's own recorded preference. */
export type AgentPrefSource = "default" | "user_pref";

/** One agent in the caller's effective registry view. */
export interface AgentRegistryEntry {
  agent_name: string;
  purpose: string;
  spawn_path: string;
  model: string | null;
  effort: string | null;
  policy_required: boolean;
  fanout_bound: number | string | null;
  enabled: boolean;
  disposition: AgentDisposition | string;
  source: AgentPrefSource | string;
}

/** Body for the pref write. `user_id` is server-derived — never sent. */
export interface AgentPrefUpdate {
  enabled: boolean;
  disposition?: AgentDisposition;
}

/** Coord validation error codes forwarded through the backend's 422. */
export type AgentPrefErrorCode = "disposition_required" | "invalid_disposition";

/** Typed error carrying coord's 422 validation code (when recognizable),
 *  so the settings page can render the forced disposition choice inline
 *  instead of a toast. */
export class AgentPrefError extends Error {
  readonly code: AgentPrefErrorCode | null;
  readonly status: number;

  constructor(
    message: string,
    code: AgentPrefErrorCode | null,
    status: number
  ) {
    super(message);
    this.name = "AgentPrefError";
    this.code = code;
    this.status = status;
  }
}

/** Extract a known coord error code from an arbitrary error payload. The
 *  backend forwards coord's 422 body as structured `detail`, but the exact
 *  envelope (`{error}` vs `{code}` vs nested) is coord's — scan defensively. */
function extractErrorCode(body: unknown): AgentPrefErrorCode | null {
  const text = JSON.stringify(body ?? "");
  if (text.includes("disposition_required")) return "disposition_required";
  if (text.includes("invalid_disposition")) return "invalid_disposition";
  return null;
}

function extractMessage(body: unknown, fallback: string): string {
  if (typeof body === "object" && body !== null && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (
      typeof detail === "object" &&
      detail !== null &&
      "message" in detail &&
      typeof (detail as { message: unknown }).message === "string"
    ) {
      return (detail as { message: string }).message;
    }
  }
  return fallback;
}

async function handleResponse<T>(
  response: Response,
  fallback: string
): Promise<T> {
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => ({}));
    throw new AgentPrefError(
      extractMessage(body, fallback),
      extractErrorCode(body),
      response.status
    );
  }
  return response.json() as Promise<T>;
}

/** The current user's effective agent list. */
export async function listAgentRegistry(): Promise<AgentRegistryEntry[]> {
  const response = await httpClient.fetch(AGENT_REGISTRY_API);
  const body = await handleResponse<{ agents: AgentRegistryEntry[] }>(
    response,
    "Failed to load agent registry"
  );
  return body.agents ?? [];
}

/** Upsert the caller's pref for one agent. Throws `AgentPrefError` with
 *  `code: "disposition_required"` when coord requires a disposition choice
 *  (disabling a policy-required agent without one). */
export async function putAgentPref(
  agentName: string,
  update: AgentPrefUpdate
): Promise<void> {
  const response = await httpClient.fetch(
    `${AGENT_REGISTRY_API}/prefs/${encodeURIComponent(agentName)}`,
    { method: "PUT", body: JSON.stringify(update) }
  );
  await handleResponse<unknown>(response, "Failed to save agent preference");
}
