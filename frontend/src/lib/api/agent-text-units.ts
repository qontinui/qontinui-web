/**
 * Agent text-unit API — wraps the `/api/v1/agent-text-units` endpoint surface.
 *
 * Backs `/admin/coord/agent-commands` and `/admin/coord/agent-skills`. Both
 * routes read the SAME corpus: a unit is `(kind, name)` plus a `files` map of
 * relative path → text. `kind=command` is the degenerate single-file case
 * (`<name>.md`); `kind=skill` carries `SKILL.md` plus siblings. `kind` is a
 * widenable discriminator, not a two-value enum — `.claude/agents/*.md` is the
 * next unit with the same delivery gap.
 *
 * **Three layers resolve, and only two of them are stored here.** The runner
 * resolves `account override → fleet default → embedded default`:
 *
 * * `organization_id IS NOT NULL` — one account's override. Addressed by
 *   omitting `fleet_default` (the backend falls back to the caller's personal
 *   organization when `organization_id` is not supplied).
 * * `organization_id IS NULL` — the **fleet default**, inherited by every
 *   account that has not overridden the unit. Addressed with
 *   `fleet_default=true`. Reads are open; **writes require a superuser**,
 *   because one write there changes the whole fleet.
 * * the runner's **embedded** copy — compiled into the binary via
 *   `include_str!` and never uploaded, so it has no row anywhere in this API.
 *   A `DELETE` therefore removes a stored layer and lets the next one down
 *   apply; it never deletes a default.
 *
 * Response shapes are typed locally against the backend's
 * `app/api/v1/endpoints/agent_text_units.py` +
 * `app/services/agent_text_unit_service.py` Pydantic models — the same
 * local-interface precedent `agent-registry.ts` and `fleet.ts` follow, which
 * keeps the pages decoupled from the generated api-client snapshot regen.
 */

import { httpClient } from "@/services/service-factory";

const AGENT_TEXT_UNITS_API = "/api/v1/agent-text-units";

// =============================================================================
// Wire types (mirrors of the backend Pydantic models)
// =============================================================================

/** Relative path → text. Paths are validated at the corpus boundary. */
export type UnitFiles = Record<string, string>;

/**
 * One stored unit, from ONE layer.
 *
 * `source` says which layer this row came from: `"user"` for an account
 * override, `"fleet"` for the `organization_id IS NULL` default. It used to be
 * documented as always `"user"` — that was true only while the backend stored
 * no fleet layer at all, and it is **no longer true**: the list route returns
 * `"fleet"` rows for every unshadowed fleet default.
 */
export interface AgentTextUnit {
  id: string;
  organization_id: string | null;
  created_by_user_id: string | null;
  kind: string;
  name: string;
  files: UnitFiles;
  /** The path inside `files` holding the unit's primary text — `SKILL.md` for
   *  a skill, `<name>.md` otherwise. Server-computed; never guess it for a row
   *  you already hold. */
  entrypoint: string;
  checksum: string | null;
  is_shared: boolean;
  /** False = carried by the corpus but never offered to the harness as an
   *  invocable unit (the `_gate-registration` / `_loop-control` copy-source
   *  specs). The backend CHECK refuses `true` for an underscore-prefixed
   *  name, so the two can never disagree. */
  is_invocable: boolean;
  current_version: number;
  /** Which resolution LAYER this row was served from — `"user"` (account
   *  override) or `"fleet"` (the fleet default layer).
   *
   *  ⚠️ Unrelated to `source_path` / `source_commit` below despite the shared
   *  prefix: this names the layer, those name the config repo the text was
   *  imported from. Adjacent names, different concepts — the same warning the
   *  canonical Rust type and the backend model both carry. */
  source: string;
  /** Import provenance: the repo-relative path the text came from, e.g.
   *  `.claude/skills/coord-revive/`. `null` for text authored in the console —
   *  which includes text that WAS imported and has since been edited here,
   *  because a save clears provenance rather than let it go stale. */
  source_path: string | null;
  /** Import provenance: the full 40-char commit of the source repo, or `null`
   *  when no commit honestly describes the bytes (authored here, or imported
   *  from a dirty tree). Never an abbreviation and never a sentinel. */
  source_commit: string | null;
  created_at: string;
  updated_at: string;
}

/** One immutable row of the append-only version chain. */
export interface AgentTextUnitVersion {
  id: string;
  agent_text_unit_id: string;
  version_number: number;
  files: UnitFiles;
  checksum: string | null;
  created_by_user_id: string | null;
  change_description: string | null;
  /** Set when this version was written by a revert: the version its files were
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

export interface AgentTextUnitListResponse {
  items: AgentTextUnit[];
  pagination: Pagination;
}

export interface AgentTextUnitVersionListResponse {
  items: AgentTextUnitVersion[];
  pagination: Pagination;
}

/** Body of the upsert (`POST ""`). Keyed server-side on
 *  `(layer, kind, name)`; every call appends a version. */
export interface AgentTextUnitCreate {
  kind: string;
  name: string;
  files: UnitFiles;
  change_description?: string | null;
  is_shared?: boolean;
  is_invocable?: boolean;
  /** Import provenance, for an importing client only. The console never sends
   *  these, and that is exactly why a console save CLEARS whatever an earlier
   *  import recorded: once the text has been edited here it is no longer a copy
   *  of that path at that commit, and a stale provenance is worse than none. */
  source_path?: string | null;
  source_commit?: string | null;
}

/** Body of the patch (`PATCH "/{name}"`). A `files` change appends a version;
 *  the other fields do not. */
export interface AgentTextUnitUpdate {
  files?: UnitFiles;
  change_description?: string | null;
  is_shared?: boolean;
  is_invocable?: boolean;
}

// =============================================================================
// Layer addressing
// =============================================================================

/**
 * Which stored layer a request addresses.
 *
 * `fleetDefault: true` targets `organization_id IS NULL`. Otherwise the
 * request targets an account: `organizationId` names it explicitly, and
 * omitting it makes the backend fall back to the caller's personal
 * organization — the normal path for a single-user account, so we only send
 * the parameter when one is chosen.
 */
export interface LayerRef {
  organizationId?: string | null;
  fleetDefault?: boolean;
}

function layerParams(layer: LayerRef | undefined, params: URLSearchParams) {
  if (!layer) return;
  if (layer.fleetDefault) params.set("fleet_default", "true");
  if (layer.organizationId) params.set("organization_id", layer.organizationId);
}

function url(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

// =============================================================================
// Requests
// =============================================================================

export interface ListUnitsOptions extends LayerRef {
  /** Filter to one kind, e.g. `"command"`. Omit to list every kind. */
  kind?: string;
  /**
   * Include fleet defaults the account has not overridden — i.e. ask the
   * server for the RESOLVED view rather than the raw layer.
   *
   * The console passes `false` and fetches the two layers separately, because
   * the resolved view cannot answer "does a fleet default exist *behind* this
   * override?" — the shadowed row is exactly what it drops.
   */
  includeFleetDefaults?: boolean;
  /**
   * Drop the non-invocable units — the underscore-prefixed copy-source specs
   * (`_gate-registration`, `_loop-control`).
   *
   * **The console must leave this false, and does.** A client that PROVISIONS
   * units to disk has to pass `true`, because a `_gate-registration.md`
   * written into `.claude/commands/` becomes an invocable
   * `/_gate-registration`. A client that EDITS the corpus is the opposite
   * case: the specs are real corpus members, and hiding them would leave an
   * operator unable to see or fix the text other units paste from. It is
   * declared here so the distinction is visible at the call site rather than
   * rediscovered.
   */
  invocableOnly?: boolean;
  offset?: number;
  limit?: number;
}

/** `GET /api/v1/agent-text-units` — one layer, or the resolved view. */
export async function listAgentTextUnits(
  options: ListUnitsOptions = {}
): Promise<AgentTextUnitListResponse> {
  const params = new URLSearchParams();
  if (options.kind) params.set("kind", options.kind);
  if (options.includeFleetDefaults !== undefined) {
    params.set("include_fleet_defaults", String(options.includeFleetDefaults));
  }
  if (options.invocableOnly !== undefined) {
    params.set("invocable_only", String(options.invocableOnly));
  }
  if (options.offset !== undefined)
    params.set("offset", String(options.offset));
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  layerParams(options, params);
  return httpClient.get<AgentTextUnitListResponse>(
    url(AGENT_TEXT_UNITS_API, params)
  );
}

/** `POST /api/v1/agent-text-units` — create or replace a unit in one layer. */
export async function upsertAgentTextUnit(
  data: AgentTextUnitCreate,
  layer?: LayerRef
): Promise<AgentTextUnit> {
  const params = new URLSearchParams();
  layerParams(layer, params);
  return httpClient.post<AgentTextUnit>(
    url(AGENT_TEXT_UNITS_API, params),
    data
  );
}

/** `PATCH /api/v1/agent-text-units/{name}` — update an existing unit. */
export async function updateAgentTextUnit(
  kind: string,
  name: string,
  data: AgentTextUnitUpdate,
  layer?: LayerRef
): Promise<AgentTextUnit> {
  const params = new URLSearchParams({ kind });
  layerParams(layer, params);
  return httpClient.patch<AgentTextUnit>(
    url(`${AGENT_TEXT_UNITS_API}/${encodeURIComponent(name)}`, params),
    data
  );
}

/** `GET /api/v1/agent-text-units/{name}/versions` — newest version first.
 *
 *  History belongs to the ADDRESSED LAYER only: asking for an account's
 *  history never falls back to the fleet default's chain, because they are
 *  different rows with different edits. */
export async function listAgentTextUnitVersions(
  kind: string,
  name: string,
  layer?: LayerRef
): Promise<AgentTextUnitVersionListResponse> {
  const params = new URLSearchParams({ kind });
  layerParams(layer, params);
  return httpClient.get<AgentTextUnitVersionListResponse>(
    url(`${AGENT_TEXT_UNITS_API}/${encodeURIComponent(name)}/versions`, params)
  );
}

/**
 * `POST /api/v1/agent-text-units/{name}/revert` — APPENDS a new head whose
 * files equal the target version's. It never rewinds the chain, so the
 * response carries a NEW `current_version`, not `version_number`.
 */
export async function revertAgentTextUnit(
  kind: string,
  name: string,
  versionNumber: number,
  layer?: LayerRef
): Promise<AgentTextUnit> {
  const params = new URLSearchParams({ kind });
  layerParams(layer, params);
  return httpClient.post<AgentTextUnit>(
    url(`${AGENT_TEXT_UNITS_API}/${encodeURIComponent(name)}/revert`, params),
    { version_number: versionNumber }
  );
}

/**
 * `DELETE /api/v1/agent-text-units/{name}` — removes the addressed layer's row
 * so the next layer down applies again (204 No Content).
 *
 * ⚠️ The version chain goes WITH it: `AgentTextUnitVersion.agent_text_unit_id`
 * is `ondelete="CASCADE"` and the ORM relationship is
 * `cascade="all, delete-orphan"`, so this permanently discards every stored
 * version of that layer's row. Callers must say so before firing.
 */
export async function deleteAgentTextUnit(
  kind: string,
  name: string,
  layer?: LayerRef
): Promise<void> {
  const params = new URLSearchParams({ kind });
  layerParams(layer, params);
  await httpClient.delete<void>(
    url(`${AGENT_TEXT_UNITS_API}/${encodeURIComponent(name)}`, params)
  );
}
