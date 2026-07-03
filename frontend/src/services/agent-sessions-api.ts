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

/** Base URL for the admin agent-sessions surface. */
export const AGENT_SESSIONS_API = `${ApiConfig.API_BASE_URL}/api/v1/admin/agent-sessions`;

// ---------------------------------------------------------------------------
// Wire shapes — mirror coord PR #894 exactly.
// ---------------------------------------------------------------------------

/** Derived session status (`status` list filter vocabulary). */
export type AgentSessionStatus = "live" | "stale" | "closed";

/**
 * One row from `GET /api/v1/admin/agent-sessions`. The identity-registry
 * fields (`name` / `derived_name` / `summary` / `status`) are nullable /
 * optional so the UI degrades cleanly against a pre-#894 coord.
 */
export interface AgentSessionRow {
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
  plan_slug: string | null;
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
 * `machine` / `working_on.session` may be.
 */
export interface SessionCard {
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
