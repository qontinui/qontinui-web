// ============================================================================
// Agent-sessions (session identity registry) API client
//
// Typed fetch wrappers for the admin agent-sessions surface
// (`/api/v1/admin/agent-sessions*`) — the web backend's proxy over coord's
// `GET /coord/agent-sessions` list + `GET /coord/agent-sessions/:id`
// resolver (plan `2026-07-02-digital-twin-session-identity-registry`,
// coord PR #894). Shapes mirror the coord wire contract exactly; the web
// backend only adds the `derived_name` / `name` enrichment on list rows.
//
// Same conventions as `devenv-api.ts`: requests go through the shared
// `httpClient` (Bearer token, 401-refresh, 429/5xx retry) and errors carry
// the HTTP status so callers can branch on 404 (resolver: zero matches).
// ============================================================================

import { ApiConfig } from "@/services/api-config";
import { httpClient } from "@/services/service-factory";
import type { SessionToolActivity } from "@/components/sessions/types";

/** Base URL for the admin agent-sessions surface. */
export const AGENT_SESSIONS_API = `${ApiConfig.API_BASE_URL}/api/v1/admin/agent-sessions`;

/** The web backend's proxy for coord's `GET /coord/sessions/census`. */
export const SESSION_CENSUS_API = `${ApiConfig.API_BASE_URL}/api/v1/admin/sessions/census`;

// ---------------------------------------------------------------------------
// Wire shapes — mirror coord PR #894 exactly.
// ---------------------------------------------------------------------------

/** Derived session status (`status` list filter vocabulary). */
export type AgentSessionStatus = "live" | "stale" | "closed";

/**
 * The durable account stamp on `coord.agent_sessions` — which Claude account
 * (config dir) a session ran on, and the names it was known by. Plan
 * `2026-10-19-session-lookup-by-name-shows-claude-account-in-web` Phase 1:
 * a runner reporter posts these for every session id its box can still
 * resolve (live or ended), and coord serves them on every
 * `GET /coord/agent-sessions` list row and every `:id` resolver card.
 *
 * Every field is OPTIONAL **and** nullable, and the two say different things —
 * a consumer must NOT collapse them:
 *
 * | wire | means |
 * |---|---|
 * | key ABSENT | coord does not serve the stamp at all (a build predating Phase 1, or its missing-column fallback). UNKNOWN, for a reason about COORD. |
 * | `null` | coord serves the stamp and no runner has reported this session yet. UNKNOWN, for a reason about the REPORTING DEVICE. |
 *
 * `components/sessions/sessionAccount.ts` is the one place that reading is
 * encoded.
 */
export interface SessionAccountStamp {
  /**
   * The census account label: the config-dir basename minus `.claude-`, and
   * `default` for the bare `~/.claude` home. NOT a roster id — the roster
   * shortcut (`accounts.json`) is not coord data and is never shown.
   */
  account?: string | null;
  /** The account's config dir on the reporting device, verbatim. */
  config_dir?: string | null;
  /** RFC 3339. When the account was observed — the newest turn's time for a
   *  session migrated between accounts. */
  account_observed_at?: string | null;
  /** The Claude Code registry name (`<config_dir>/sessions/<pid>.json`),
   *  reported only from a live row whose name is not derived. */
  registry_name?: string | null;
  /** The fleet tag name (`~/.qontinui/session-names/<id>`) — the source of a
   *  commit's `Session-Name:` trailer. Can differ from `registry_name`. */
  tag_name?: string | null;
}

/**
 * One row from `GET /api/v1/admin/agent-sessions`. The identity-registry
 * fields (`name` / `derived_name` / `summary` / `status`) are nullable /
 * optional so the UI degrades cleanly against a pre-#894 coord.
 *
 * `extends SessionToolActivity` adds the tool-grain fields from plan
 * `2026-08-11-coord-hook-sourced-agent-status`. This is the CANONICAL exported
 * type for this endpoint, so it carries the mixin for the same anti-drift
 * reason the mixin exists at all — `AgentSessionsDashboard` keeps a private
 * row interface of its own, and two declarations of one wire row that disagree
 * on their fields is precisely the drift being prevented.
 *
 * The fields are inert until coord's `GET /coord/agent-sessions` joins
 * `coord.sessions` in and emits them (that handler builds its response from a
 * hand-written key set, so pass-through alone does not carry them). Declaring
 * them here is honest only because every field is optional AND nullable and
 * every consumer treats absent, null and unknown identically.
 */
export interface AgentSessionRow
  extends SessionToolActivity, SessionAccountStamp {
  id: string;
  user_id: string | null;
  device_id: string | null;
  first_seen: string | null;
  last_seen: string | null;
  label: string | null;
  closed_at: string | null;
  /** Display name: `label ?? derived_name`; null when both are absent. */
  name?: string | null;
  derived_name?: string | null;
  /** One-line "working on" summary derived from session activity. */
  summary?: string | null;
  status?: AgentSessionStatus | string | null;
}

export interface AgentSessionsListResponse {
  sessions: AgentSessionRow[];
  count: number;
  /**
   * True when coord's DB predates the topic-search migration — `q=` then
   * degrades to name-only matching.
   */
  search_degraded?: boolean;
}

/** `machine.environment` on a resolved card. */
export interface SessionCardEnvironment {
  id: string;
  name: string;
}

/** Devenv-twin machine bound to the session's coord device. */
export interface SessionCardMachine {
  id: string;
  name: string;
  hostname: string | null;
  environment: SessionCardEnvironment | null;
}

/** `working_on.session` — the live coord session snapshot, when any. */
export interface SessionWorkingOnSession {
  intent_purpose: string | null;
  /** The linked work unit's slug. Coord emitted this under the legacy
   *  `plan_slug` key until the wire-key retirement (plan
   *  `2026-07-30-coord-web-plan-slug-wire-key-retirement`, Phase 1); it
   *  dual-emits both keys today and drops `plan_slug` in Phase 4. */
  work_unit_slug: string | null;
  correlation_topic: string | null;
  repo: string | null;
  branch: string | null;
  provider: string | null;
  session_kind: string | null;
  state: string | null;
}

/** One recent commit attributed to the session. */
export interface SessionCommit {
  repo: string;
  sha: string;
  branch: string | null;
  occurred_at: string | null;
}

/** One lineage timeline entry (worktree / claim / build / merge …). */
export interface SessionLineageEntry {
  kind: string;
  handle: string;
  occurred_at: string | null;
}

export interface SessionWorkingOn {
  session: SessionWorkingOnSession | null;
  commits: SessionCommit[];
  lineage: SessionLineageEntry[];
}

/**
 * Full identity card from the resolver. `derived_name` is never null here;
 * `machine` / `working_on.session` may be. The account stamp fields are
 * {@link SessionAccountStamp}'s — absent and `null` mean different things.
 */
export interface SessionCard extends SessionAccountStamp {
  id: string;
  name: string | null;
  label: string | null;
  derived_name: string;
  user_id: string | null;
  device_id: string | null;
  first_seen: string | null;
  last_seen: string | null;
  closed_at: string | null;
  status: AgentSessionStatus | string;
  machine: SessionCardMachine | null;
  summary: string | null;
  working_on: SessionWorkingOn | null;
}

/**
 * `GET /api/v1/admin/agent-sessions/{key}` envelope. Names can be
 * ambiguous, so `resolved` may carry several cards (newest-first); 404
 * only on zero matches.
 */
export interface ResolveSessionResponse {
  resolved: SessionCard[];
  count: number;
}

// ---------------------------------------------------------------------------
// Error handling — mirrors DevenvApiError (status-carrying Error).
// ---------------------------------------------------------------------------

export class AgentSessionsApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AgentSessionsApiError";
    this.status = status;
  }
}

async function parseError(res: Response): Promise<AgentSessionsApiError> {
  let message = `Request failed (${res.status})`;
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body.detail === "string" && body.detail) {
      message = body.detail;
    }
  } catch {
    // Non-JSON body — keep the status-based default message.
  }
  return new AgentSessionsApiError(res.status, message);
}

async function request<T>(path: string): Promise<T> {
  const res = await httpClient.fetch(`${AGENT_SESSIONS_API}${path}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw await parseError(res);
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

export interface ListAgentSessionsParams {
  /** Full-text topic search (name-only pre-migration → `search_degraded`). */
  q?: string;
  status?: AgentSessionStatus;
  device_id?: string;
  repo?: string;
  live?: boolean;
  user_id?: string;
  since?: string;
  limit?: number;
}

export function listAgentSessions(
  params: ListAgentSessionsParams = {}
): Promise<AgentSessionsListResponse> {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.status) search.set("status", params.status);
  if (params.device_id) search.set("device_id", params.device_id);
  if (params.repo) search.set("repo", params.repo);
  if (params.live) search.set("live", "true");
  if (params.user_id) search.set("user_id", params.user_id);
  if (params.since) search.set("since", params.since);
  if (params.limit != null) search.set("limit", String(params.limit));
  const qs = search.toString();
  return request<AgentSessionsListResponse>(qs ? `?${qs}` : "");
}

/** Resolve a session by UUID or name. Throws status 404 on zero matches. */
export function resolveAgentSession(
  key: string
): Promise<ResolveSessionResponse> {
  return request<ResolveSessionResponse>(`/${encodeURIComponent(key)}`);
}

// ---------------------------------------------------------------------------
// The session census — is the process running RIGHT NOW?
// ---------------------------------------------------------------------------

/** coord's census liveness word. */
export type CensusLiveness = "alive" | "dead" | "unknown";

/**
 * One row of coord's census read (`session_census.rs` `CensusRow`). Only the
 * fields the detail card reads are declared; the rest pass through untyped.
 */
export interface SessionCensusRow {
  session_id: string;
  /** coord ids that name the same session — a census row is asked for by
   *  either the Claude Code session uuid or a `coord.sessions` id. */
  aliases?: string[];
  device_id?: string | null;
  hostname?: string | null;
  account?: string | null;
  liveness: CensusLiveness | string;
  /** Why `liveness` is `unknown` (or `dead`) — coord's own words. */
  liveness_reason?: string | null;
  last_acted_at?: string | null;
  observed_at?: string | null;
  census_age_secs?: number | null;
}

/** coord answered the census read. */
export interface SessionCensusServed {
  served: true;
  /** `false` ⇒ the census tables are unreadable: every row is unknown and an
   *  empty list is UNKNOWN, not "no sessions". */
  census_present: boolean;
  sessions: SessionCensusRow[];
  count: number;
  /** More rows matched than `limit` — a miss proves nothing. */
  truncated?: boolean;
}

/**
 * coord answered 404 — the deployed build does not serve the census route
 * (qontinui-coord#2738 is not deployed). There is deliberately NO `sessions`
 * key: an empty census would read as "not live".
 */
export interface SessionCensusNotServed {
  served: false;
  unknown_reason: string;
  detail?: string;
}

export type SessionCensusResponse =
  | SessionCensusServed
  | SessionCensusNotServed;

export interface SessionCensusParams {
  session_id?: string;
  session_name?: string;
  pr?: string;
  limit?: number;
  signal?: AbortSignal;
}

/**
 * Read coord's session census through the web proxy. A coord that does not
 * serve the route resolves to {@link SessionCensusNotServed} (the proxy turns
 * coord's 404 into that envelope); every other failure throws
 * {@link AgentSessionsApiError}, which is a read that did not land.
 */
export async function getSessionCensus(
  params: SessionCensusParams = {}
): Promise<SessionCensusResponse> {
  const search = new URLSearchParams();
  if (params.session_id) search.set("session_id", params.session_id);
  if (params.session_name) search.set("session_name", params.session_name);
  if (params.pr) search.set("pr", params.pr);
  if (params.limit != null) search.set("limit", String(params.limit));
  const qs = search.toString();
  const res = await httpClient.fetch(
    qs ? `${SESSION_CENSUS_API}?${qs}` : SESSION_CENSUS_API,
    { cache: "no-store", signal: params.signal }
  );
  if (!res.ok) {
    throw await parseError(res);
  }
  return (await res.json()) as SessionCensusResponse;
}
