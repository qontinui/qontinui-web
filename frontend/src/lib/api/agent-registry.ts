/**
 * Agent-registry API — wraps the `/api/v1/agent-registry` endpoint surface.
 *
 * Backs two pages:
 *
 * - `/settings/agents` — the current user's effective agent list (coord
 *   registry defaults overlaid with the user's own prefs) and the per-agent
 *   enable/disposition preference write. The write reaches coord's SELF door,
 *   so it works for every tenant member, not only admins.
 * - `/admin/coord/agent-registry` — the ADMIN surface for the tenant DEFAULT
 *   (`default_enabled` / `policy_required`), i.e. what a member with no
 *   recorded preference gets.
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

/**
 * Error codes forwarded through the backend from coord.
 *
 * The first two are 422 VALIDATION codes: the write was understood and
 * refused on its content, and the settings page answers them with an inline
 * disposition picker.
 *
 * `operator_not_provisioned_in_web` is a 403 and is a different kind of thing
 * — a coord operator whose verified email matches no `auth.users` row. Nothing
 * about the request is wrong and no permission is missing; the two accounts
 * are simply not linked. Rendering it beside a plain authorization denial
 * would send the reader to an admin who cannot help.
 *
 * A plain authorization 403 has no code of its own on purpose: coord's body
 * for it is not a stable contract, so the page keys on `status === 403` with
 * no recognised code rather than pattern-matching prose that may change.
 */
export type AgentPrefErrorCode =
  | "disposition_required"
  | "invalid_disposition"
  | "operator_not_provisioned_in_web";

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
  if (text.includes("operator_not_provisioned_in_web")) {
    return "operator_not_provisioned_in_web";
  }
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

/** The current user's effective agent list.
 *
 *  Throws rather than returning `[]` when the response carries no `agents`
 *  array. `?? []` here was the same laundering the backend removed from
 *  `_effective_rows` (`payload.get("agents") or []`): the page renders an
 *  empty list as "No agents are registered for your tenant yet.", so a
 *  response that never carried a registry becomes a confident claim that the
 *  tenant has none. The backend's `response_model` makes `agents` a list on
 *  every 2xx it produces, which is exactly why anything else reaching here is
 *  a broken response — a proxy error page, a rewritten body — and not a
 *  tenant with no agents. An empty ARRAY is still a legitimate answer and
 *  passes through untouched. */
export async function listAgentRegistry(): Promise<AgentRegistryEntry[]> {
  const response = await httpClient.fetch(AGENT_REGISTRY_API);
  const body = await handleResponse<{ agents: AgentRegistryEntry[] }>(
    response,
    "Failed to load agent registry"
  );
  if (!Array.isArray(body?.agents)) {
    throw new AgentPrefError(
      "The agent registry response carried no agent list; refusing to show " +
        "an empty registry.",
      null,
      response.status
    );
  }
  return body.agents;
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

// ── The tenant-default admin surface ────────────────────────────────────────
//
// Backs `/admin/coord/agent-registry`. These read and write the REGISTRY row
// (`default_enabled` — what a member with no recorded preference gets), never
// a member's own pref. Both proxies are admin-gated in the web tier, so a
// non-admin gets `not_coord_tenant_admin` here rather than an opaque coord
// body.

/** One raw registry row plus how many members have overridden it. */
export interface AdminAgentRegistryRow {
  agent_name: string;
  purpose: string;
  trigger_condition: string;
  spawn_path: string;
  model: string | null;
  effort: string | null;
  default_enabled: boolean;
  policy_required: boolean;
  allowed_dispositions: string[];
  fanout_bound: number | null;
  /** Members with a recorded pref — exactly those a default change misses. */
  pref_count: number;
  /** Of those, the ones whose recorded `enabled` contradicts the default. */
  pref_differs_from_default_count: number;
}

/**
 * Body for the tenant-default write.
 *
 * `default_enabled` is REQUIRED, mirroring coord: it is the lever itself, and
 * defaulting it would let a typo silently flip a tenant's autonomy. Editing
 * `policy_required` alone therefore still means sending the agent's current
 * `default_enabled` back. Everything else coord stores is preserving, and this
 * body deliberately names none of it — an earlier full-row shape is what once
 * reset a seeded row's `purpose` and its `fanout_bound`.
 */
export interface AgentRegistryDefaultsUpdate {
  default_enabled: boolean;
  policy_required?: boolean;
}

/** ADMIN: the tenant's raw registry rows with their override counts.
 *
 *  Throws rather than returning `[]` on a response carrying no `agents`
 *  array, for the same reason `listAgentRegistry` does — and this one shipped
 *  with the `?? []` that function had already had removed. An admin reading
 *  an empty registry concludes the tenant has no agents to configure; a
 *  response that never carried a list is not that fact. An empty ARRAY still
 *  passes through untouched. */
export async function listAdminAgentRegistry(): Promise<AdminAgentRegistryRow[]> {
  const response = await httpClient.fetch(`${AGENT_REGISTRY_API}/admin/registry`);
  const body = await handleResponse<{ agents: AdminAgentRegistryRow[] }>(
    response,
    "Failed to load the agent registry"
  );
  if (!Array.isArray(body?.agents)) {
    throw new AgentPrefError(
      "The agent registry response carried no agent list; refusing to show " +
        "an empty registry.",
      null,
      response.status
    );
  }
  return body.agents;
}

/** ADMIN: set one agent's tenant default. */
export async function putAgentRegistryDefaults(
  agentName: string,
  update: AgentRegistryDefaultsUpdate
): Promise<void> {
  const response = await httpClient.fetch(
    `${AGENT_REGISTRY_API}/admin/registry/${encodeURIComponent(agentName)}`,
    { method: "PUT", body: JSON.stringify(update) }
  );
  await handleResponse<unknown>(response, "Failed to save the tenant default");
}
