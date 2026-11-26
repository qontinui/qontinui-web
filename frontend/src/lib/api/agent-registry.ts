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

import { readAnswerJson, type HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { ApiConfig } from "@/services/api-config";
import {
  isOutcomeUnknownStatus,
  isWriteFailureUnknown,
} from "@/components/admin/coord/writeOutcome";

const AGENT_REGISTRY_API = `${ApiConfig.API_BASE_URL}/api/v1/agent-registry`;

/** What happens when a spawn of a disabled policy-required agent is requested. */
export type AgentDisposition = "block" | "degrade" | "warn_proceed";

/** Whether the effective enabled/disposition comes from the registry default,
 *  the user's own recorded preference, or the tenant-admin CEILING (`admin`:
 *  spawns switched off tenant-wide, which no member pref can widen). */
export type AgentPrefSource = "default" | "user_pref" | "admin";

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
  /**
   * Whether `message` is the server's reason. `false` means the body gave none
   * and `message` is this client's fallback ("Failed to save …"), which must
   * not be quoted where the outcome is unknown (`outcomeUnknownReason`).
   */
  readonly detailServed: boolean;

  constructor(
    message: string,
    code: AgentPrefErrorCode | null,
    status: number,
    detailServed = true
  ) {
    super(message);
    this.name = "AgentPrefError";
    this.code = code;
    this.status = status;
    this.detailServed = detailServed;
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

/** The reason in an error body: FastAPI's own `{detail}`, or what the backend's
 *  error handler serves in production, `{error, message, timestamp, path}`. */
function extractMessage(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const { detail, message } = body as { detail?: unknown; message?: unknown };
  if (typeof detail === "string") return detail;
  if (
    typeof detail === "object" &&
    detail !== null &&
    "message" in detail &&
    typeof (detail as { message: unknown }).message === "string"
  ) {
    return (detail as { message: string }).message;
  }
  return typeof message === "string" ? message : null;
}

/**
 * Whether a failed write may still have landed, so the caller must re-read
 * before saying anything about it: the rule every coord write shares
 * (`writeOutcome.ts`), over what this client or `httpClient` throws. A 4xx is a
 * refusal, and so is a door's own connect-failure 502. Any other 5xx proves
 * nothing, a client timeout or a failure with no HTTP status is the same state,
 * and an offline browser is taken as not having sent it.
 */
export function isWriteOutcomeUnknown(err: unknown): boolean {
  return err instanceof AgentPrefError
    ? isOutcomeUnknownStatus(err.status, err.message)
    : isWriteFailureUnknown(err);
}

async function handleResponse<T>(
  response: Response,
  fallback: string
): Promise<T> {
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => ({}));
    const served = extractMessage(body);
    throw new AgentPrefError(
      served ?? fallback,
      extractErrorCode(body),
      response.status,
      served !== null
    );
  }
  return readAnswerJson<T>(response);
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
 *  passes through untouched.
 *
 *  `options` are the request's own (a dashboard poll passes
 *  `COORD_DASHBOARD_POLL_OPTIONS`: one request, the next poll is the retry). */
export async function listAgentRegistry(
  options?: HttpOptions
): Promise<AgentRegistryEntry[]> {
  const response = await httpClient.fetch(AGENT_REGISTRY_API, options);
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
 *  (disabling a policy-required agent without one).
 *
 *  Sent ONCE (`maxRetries: 0`): the client would re-send a PUT on any 5xx, and
 *  the classifier (`writeOutcome.ts`) reads only the last answer. A first 504
 *  after coord committed, followed by retries answering the proxy's
 *  connect-failure 502, would then read as a refusal of a write that landed. */
export async function putAgentPref(
  agentName: string,
  update: AgentPrefUpdate
): Promise<void> {
  const response = await httpClient.fetch(
    `${AGENT_REGISTRY_API}/prefs/${encodeURIComponent(agentName)}`,
    { method: "PUT", body: JSON.stringify(update), maxRetries: 0 }
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
  /** The tenant-admin ceiling's detail, from the LAST admin-switch write (in
   *  either direction). Absent on a coord that predates the ceiling. The
   *  ceiling's on/off STATE is read from the catalog, not from these. */
  admin_disposition?: string | null;
  admin_reason?: string | null;
  admin_disabled_by?: string | null;
  admin_disabled_at?: string | null;
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
 *  passes through untouched. `options` as for `listAgentRegistry`. */
export async function listAdminAgentRegistry(
  options?: HttpOptions
): Promise<AdminAgentRegistryRow[]> {
  const response = await httpClient.fetch(
    `${AGENT_REGISTRY_API}/admin/registry`,
    options
  );
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

/** ADMIN: set one agent's tenant default. Sent once, for the reason
 *  {@link putAgentPref} gives. */
export async function putAgentRegistryDefaults(
  agentName: string,
  update: AgentRegistryDefaultsUpdate
): Promise<void> {
  const response = await httpClient.fetch(
    `${AGENT_REGISTRY_API}/admin/registry/${encodeURIComponent(agentName)}`,
    { method: "PUT", body: JSON.stringify(update), maxRetries: 0 }
  );
  await handleResponse<unknown>(response, "Failed to save the tenant default");
}

// ── The agent catalog and the tenant-admin spawn switch ────────────────────
//
// Plan `2026-11-24-tenant-admins-switch-agent-spawns-off-per-agent-type`
// Phase 7. The catalog is every agent type a spawn may be authorized under —
// with or without a registry row — and is readable by ANY member. The switch
// is the tenant CEILING (`admin_disabled`): separate from the tenant default
// above, and binding over every member's own preference.
//
// The catalog shape is coord's (`GET /coord/agent-registry/catalog`,
// `crates/coord/src/agent_registry_catalog.rs` — qontinui-coord#4585) and is
// declared HERE ONLY, so a field rename in coord is a change to this block.
// Two fields of a stacked coord follow-up (`also_vetoes`, the
// `hook_or_advisory` enforcement with its `enforcement_note`) are typed as
// optional: absent today, rendered when present.

/** Which source named an entry — coord's `CatalogSource`, tagged by `source`. */
export type AgentCatalogSource =
  | { source: "row" }
  | { source: "contract_kind" }
  | { source: "contract_class" }
  | { source: "runner_key" }
  | { source: "harness_builtin" }
  | { source: "declared_role"; repo: string; sha: string; path: string }
  | {
      source: "observed";
      last_seen_at: string;
      /** The reporter's claim, shown as given. */
      spawn_path_hint?: string | null;
    }
  /** A source this build has no type for: named, never dropped. */
  | { source: string; [field: string]: unknown };

/** Where a disable of this type binds (plan D7). `hook_or_advisory` is the
 *  stacked follow-up's honest label; any other string is shown as unknown. */
export type AgentEnforcement =
  | "coord"
  | "runner"
  | "hook"
  | "advisory"
  | "hook_or_advisory";

export interface AgentCatalogEntry {
  agent_name: string;
  /** `null` when coord could not read the row source. */
  has_row: boolean | null;
  spawn_path: string | null;
  purpose: string | null;
  sources: AgentCatalogSource[];
  /** The tenant-admin ceiling. `false` with no row; `null` when the row
   *  source is unread — UNKNOWN, never "on". */
  admin_disabled: boolean | null;
  admin_disposition?: string | null;
  admin_reason?: string | null;
  /** The member default (with no row, the value a created row would get);
   *  `null` when the row source is unread. */
  default_enabled: boolean | null;
  policy_required?: boolean | null;
  /** The dispositions an admin may pick: the row's, or the default set for a
   *  row the switch would create. */
  allowed_dispositions?: string[] | null;
  enforcement: AgentEnforcement | string;
  /** Coord's own qualification of `enforcement` (stacked follow-up). */
  enforcement_note?: string | null;
  /** Other agent types a disable of this one also vetoes (stacked follow-up). */
  also_vetoes?: string[] | null;
}

/** A catalog source (or one repo of it) coord could not read: UNKNOWN,
 *  never an empty list. */
export interface AgentCatalogUnreadSource {
  source: string;
  repo?: string | null;
  reason: string;
}

/** A role file whose declared name coord's grammar refuses. */
export interface AgentCatalogSkippedDeclared {
  repo: string;
  path: string;
  declared_name: string;
  reason: string;
}

export interface AgentCatalog {
  agents: AgentCatalogEntry[];
  sources_unread: AgentCatalogUnreadSource[];
  declared_skipped: AgentCatalogSkippedDeclared[];
}

/** Body for the tenant-admin switch. `disposition` only with `disabled`. */
export interface AgentAdminSwitchUpdate {
  disabled: boolean;
  disposition?: AgentDisposition;
  reason?: string;
}

/** Coord's answer to an admin-switch write. */
export interface AgentAdminSwitchResult {
  agent: AdminAgentRegistryRow & { admin_disabled?: boolean };
  effective: AgentRegistryEntry & { admin_disabled?: boolean };
  created: boolean;
}

/** The error code in a refusal body (`{detail: {error}}` or `{error}`), or
 *  null. Unlike {@link extractErrorCode} this names ANY code coord sent, so
 *  the switch can quote coord's own reason rather than a fixed list. */
export function refusalCodeOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const { detail, error } = body as { detail?: unknown; error?: unknown };
  if (typeof detail === "object" && detail !== null) {
    const inner = (detail as { error?: unknown }).error;
    if (typeof inner === "string") return inner;
  }
  return typeof error === "string" ? error : null;
}

/** Error from the admin switch, carrying coord's code (`disposition_not_allowed`,
 *  `invalid_agent_name`, `registry_not_provisioned`, …) when it sent one. */
export class AgentAdminSwitchError extends AgentPrefError {
  readonly coordCode: string | null;

  constructor(
    message: string,
    coordCode: string | null,
    status: number,
    detailServed: boolean
  ) {
    super(message, null, status, detailServed);
    this.name = "AgentAdminSwitchError";
    this.coordCode = coordCode;
  }
}

/** Every agent type the tenant's spawns may be authorized under. Any member.
 *
 *  Throws rather than returning an empty catalog when `agents` is not a list,
 *  and treats a missing `sources_unread` as one UNKNOWN source rather than "all
 *  read" — the backend already does both; this is the same rule at the last
 *  hop. */
export async function getAgentCatalog(
  options?: HttpOptions
): Promise<AgentCatalog> {
  const response = await httpClient.fetch(
    `${AGENT_REGISTRY_API}/catalog`,
    options
  );
  const body = await handleResponse<
    Partial<Record<keyof AgentCatalog, unknown>>
  >(response, "Failed to load the agent catalog");
  if (!Array.isArray(body?.agents)) {
    throw new AgentPrefError(
      "The agent catalog response carried no agent list; refusing to show " +
        "an empty catalog.",
      null,
      response.status
    );
  }
  // One malformed entry must not blank the page: it is dropped, and the drop
  // is said as an UNKNOWN source rather than hidden.
  const agents = (body.agents as unknown[]).filter(
    (e): e is AgentCatalogEntry =>
      typeof e === "object" &&
      e !== null &&
      typeof (e as { agent_name?: unknown }).agent_name === "string"
  );
  const dropped = body.agents.length - agents.length;
  // The envelope's own lists get the same rule as `agents`: an element that
  // is not an object with string text is dropped and counted, never handed
  // to a render that would throw on it.
  let droppedNotes = 0;
  const text = (v: unknown) => (typeof v === "string" ? v : null);
  const unreadServed: AgentCatalogUnreadSource[] = [];
  for (const u of Array.isArray(body.sources_unread)
    ? (body.sources_unread as unknown[])
    : []) {
    const o =
      typeof u === "object" && u !== null
        ? (u as Record<string, unknown>)
        : null;
    const source = o ? text(o.source) : null;
    const reason = o ? text(o.reason) : null;
    if (source === null || reason === null) {
      droppedNotes += 1;
      continue;
    }
    const repo = o ? text(o.repo) : null;
    unreadServed.push(
      repo === null ? { source, reason } : { source, reason, repo }
    );
  }
  const skippedServed: AgentCatalogSkippedDeclared[] = [];
  for (const d of Array.isArray(body.declared_skipped)
    ? (body.declared_skipped as unknown[])
    : []) {
    const o =
      typeof d === "object" && d !== null
        ? (d as Record<string, unknown>)
        : null;
    const repo = o ? text(o.repo) : null;
    const path = o ? text(o.path) : null;
    const declared_name = o ? text(o.declared_name) : null;
    const reason = o ? text(o.reason) : null;
    if (
      repo === null ||
      path === null ||
      declared_name === null ||
      reason === null
    ) {
      droppedNotes += 1;
      continue;
    }
    skippedServed.push({ repo, path, declared_name, reason });
  }
  const sourcesUnread: AgentCatalogUnreadSource[] = Array.isArray(
    body.sources_unread
  )
    ? unreadServed
    : [
        {
          source: "sources_unread",
          reason:
            "the catalog answer carried no sources_unread list, so whether " +
            "every source was read is unknown",
        },
      ];
  if (dropped > 0) {
    sourcesUnread.push({
      source: "malformed_entries",
      reason: `${dropped} catalog entr${dropped === 1 ? "y was" : "ies were"} malformed (no agent name) and not shown; what ${dropped === 1 ? "it" : "they"} would have listed is unknown`,
    });
  }
  // The same rule one level down: a source that is not an object naming its
  // `source` is dropped and counted, never allowed to throw in a render.
  let droppedSources = 0;
  const cleaned = agents.map((e) => {
    const raw: unknown[] = Array.isArray(e.sources) ? e.sources : [];
    const sources = raw.filter(
      (src): src is AgentCatalogSource =>
        typeof src === "object" &&
        src !== null &&
        typeof (src as { source?: unknown }).source === "string"
    );
    droppedSources += raw.length - sources.length;
    // Wrong-typed fields read as absent (`null`), never as a value a render
    // would call a method on. A field coord did not send stays absent.
    const str = (v: unknown) => (typeof v === "string" ? v : null);
    const list = (v: unknown) =>
      Array.isArray(v)
        ? v.filter((x): x is string => typeof x === "string")
        : null;
    const out: AgentCatalogEntry = {
      ...e,
      sources,
      purpose: str(e.purpose),
      spawn_path: str(e.spawn_path),
      enforcement:
        typeof e.enforcement === "string" ? e.enforcement : "unknown",
    };
    if (e.admin_disposition !== undefined)
      out.admin_disposition = str(e.admin_disposition);
    if (e.admin_reason !== undefined) out.admin_reason = str(e.admin_reason);
    if (e.enforcement_note !== undefined)
      out.enforcement_note = str(e.enforcement_note);
    if (e.allowed_dispositions !== undefined)
      out.allowed_dispositions = list(e.allowed_dispositions);
    if (e.also_vetoes !== undefined) out.also_vetoes = list(e.also_vetoes);
    return out;
  });
  if (droppedSources > 0) {
    sourcesUnread.push({
      source: "malformed_entries",
      reason: `${droppedSources} catalog source record${droppedSources === 1 ? " was" : "s were"} malformed and not shown`,
    });
  }
  if (droppedNotes > 0) {
    sourcesUnread.push({
      source: "malformed_entries",
      reason: `${droppedNotes} catalog note${droppedNotes === 1 ? " was" : "s were"} malformed and not shown; what ${droppedNotes === 1 ? "it" : "they"} said is unknown`,
    });
  }
  return {
    agents: cleaned,
    sources_unread: sourcesUnread,
    declared_skipped: skippedServed,
  };
}

/** ADMIN: switch spawns of one agent type off (or back on) tenant-wide.
 *  Sent once, for the reason {@link putAgentPref} gives. */
export async function putAgentAdminSwitch(
  agentName: string,
  update: AgentAdminSwitchUpdate
): Promise<AgentAdminSwitchResult> {
  const response = await httpClient.fetch(
    `${AGENT_REGISTRY_API}/admin/registry/${encodeURIComponent(agentName)}/switch`,
    { method: "PUT", body: JSON.stringify(update), maxRetries: 0 }
  );
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => ({}));
    const served = extractMessage(body);
    const code = refusalCodeOf(body);
    throw new AgentAdminSwitchError(
      served ?? code ?? "Failed to save the spawn switch",
      code,
      response.status,
      served !== null || code !== null
    );
  }
  return readAnswerJson<AgentAdminSwitchResult>(response);
}
