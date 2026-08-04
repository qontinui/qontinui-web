/**
 * Agent-command API — wraps the `/api/v1/agent-commands` endpoint surface.
 *
 * Backs the `/settings/agent-commands` page. The runner ships its agent
 * commands (`/vet-plan`, `/implement-plan`, …) embedded in its binary and
 * resolves **account override → embedded default**. This endpoint surface owns
 * the account layer ONLY: there is no "default" row anywhere in the backend, so
 * a command that has no row here is served by the runner's embedded copy, and
 * `DELETE` removes a customization rather than deleting a default.
 *
 * Response shapes are typed locally against the backend's
 * `app/api/v1/endpoints/agent_commands.py` + `app/services/agent_command_service.py`
 * Pydantic models — the same local-interface precedent `agent-registry.ts` and
 * `fleet.ts` follow, which keeps the page decoupled from the generated
 * api-client snapshot regen.
 */

import { httpClient } from "@/services/service-factory";

const AGENT_COMMANDS_API = "/api/v1/agent-commands";

// =============================================================================
// Wire types (mirrors of the backend Pydantic models)
// =============================================================================

/** One account override. `source` is always `"user"` — the backend never
 *  returns a default row, because it does not store one. */
export interface AgentCommand {
  id: string;
  organization_id: string | null;
  created_by_user_id: string | null;
  name: string;
  body: string;
  checksum: string | null;
  is_shared: boolean;
  current_version: number;
  source: string;
  created_at: string;
  updated_at: string;
}

/** One immutable row of the append-only version chain. */
export interface AgentCommandVersion {
  id: string;
  agent_command_id: string;
  version_number: number;
  body: string;
  checksum: string | null;
  created_by_user_id: string | null;
  change_description: string | null;
  /** Set when this version was written by a revert: the version its body was
   *  copied from. `null` for an ordinary edit. */
  restored_from: number | null;
  created_at: string;
}

export interface Pagination {
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface AgentCommandListResponse {
  items: AgentCommand[];
  pagination: Pagination;
}

export interface AgentCommandVersionListResponse {
  items: AgentCommandVersion[];
  pagination: Pagination;
}

/** Body of the upsert (`POST ""`). Keyed server-side on
 *  `(organization_id, name)`; every call appends a version. */
export interface AgentCommandCreate {
  name: string;
  body: string;
  change_description?: string | null;
  is_shared?: boolean;
}

/** Body of the patch (`PATCH "/{name}"`). A `body` change appends a version;
 *  the other fields do not. */
export interface AgentCommandUpdate {
  body?: string;
  change_description?: string | null;
  is_shared?: boolean;
}

// =============================================================================
// Requests
// =============================================================================

/**
 * Every route accepts an OPTIONAL `organization_id`. Omitting it makes the
 * backend fall back to the caller's personal organization, which is the normal
 * path for a single-user account — so we only send it when one is chosen.
 */
function withOrg(path: string, organizationId?: string | null): string {
  if (!organizationId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}organization_id=${encodeURIComponent(organizationId)}`;
}

/** `GET /api/v1/agent-commands` — lists OVERRIDES only. A command absent from
 *  this list has no override and resolves to the runner's embedded default. */
export async function listAgentCommands(
  organizationId?: string | null
): Promise<AgentCommandListResponse> {
  return httpClient.get<AgentCommandListResponse>(
    withOrg(AGENT_COMMANDS_API, organizationId)
  );
}

/** `POST /api/v1/agent-commands` — create or replace an override by name. */
export async function upsertAgentCommand(
  data: AgentCommandCreate,
  organizationId?: string | null
): Promise<AgentCommand> {
  return httpClient.post<AgentCommand>(
    withOrg(AGENT_COMMANDS_API, organizationId),
    data
  );
}

/** `PATCH /api/v1/agent-commands/{name}` — update an existing override. */
export async function updateAgentCommand(
  name: string,
  data: AgentCommandUpdate,
  organizationId?: string | null
): Promise<AgentCommand> {
  return httpClient.patch<AgentCommand>(
    withOrg(
      `${AGENT_COMMANDS_API}/${encodeURIComponent(name)}`,
      organizationId
    ),
    data
  );
}

/** `GET /api/v1/agent-commands/{name}/versions` — newest version first. */
export async function listAgentCommandVersions(
  name: string,
  organizationId?: string | null
): Promise<AgentCommandVersionListResponse> {
  return httpClient.get<AgentCommandVersionListResponse>(
    withOrg(
      `${AGENT_COMMANDS_API}/${encodeURIComponent(name)}/versions`,
      organizationId
    )
  );
}

/**
 * `POST /api/v1/agent-commands/{name}/revert` — APPENDS a new head whose body
 * equals the target version's. It never rewinds the chain, so the response is
 * a NEW `current_version`, not `version_number`.
 */
export async function revertAgentCommand(
  name: string,
  versionNumber: number,
  organizationId?: string | null
): Promise<AgentCommand> {
  return httpClient.post<AgentCommand>(
    withOrg(
      `${AGENT_COMMANDS_API}/${encodeURIComponent(name)}/revert`,
      organizationId
    ),
    { version_number: versionNumber }
  );
}

/**
 * `DELETE /api/v1/agent-commands/{name}` — removes the account's override so
 * the runner's embedded default applies again (204 No Content).
 *
 * ⚠️ The version chain goes WITH it: `AgentCommandVersion.agent_command_id`
 * is `ondelete="CASCADE"` and the ORM relationship is
 * `cascade="all, delete-orphan"`, so this permanently discards every stored
 * version of the override. Callers must say so before firing.
 */
export async function deleteAgentCommandOverride(
  name: string,
  organizationId?: string | null
): Promise<void> {
  await httpClient.delete<void>(
    withOrg(`${AGENT_COMMANDS_API}/${encodeURIComponent(name)}`, organizationId)
  );
}
