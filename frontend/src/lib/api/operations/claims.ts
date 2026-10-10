/**
 * `/operations/claims/*` and `/operations/agent-status` — the agent-claims
 * observability reads: active claims by kind + prefix, the recent-conflicts
 * ring buffer, recent steals, and coord's work-unit-grain agent status.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D5, Phase 7 batch 1). These replace the bare `fetch` calls of
 * `components/admin/agent-claims/AgentClaimsDashboard.tsx`, which sent no
 * Bearer token. Every function calls `httpClient.fetch` on the RELATIVE
 * `OPERATIONS_BASE` (D6) with its URL inline, states its retry policy, and
 * returns the PARSED body through `readJson`; a non-2xx rejects with
 * `GET <url> failed: <status> - <body>`.
 *
 * Each read takes the caller's `HttpOptions` (the dashboard passes
 * `COORD_DASHBOARD_POLL_OPTIONS`: one request per tick, the next tick is the
 * retry). The wire types are hand-written — these handlers declare no
 * `response_model` — and each names the handler it mirrors in
 * `backend/app/api/v1/endpoints/operations/__init__.py`.
 */

import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/** One holder row of {@link ActiveClaimsResponse}. */
export interface ActiveClaim {
  kind: string;
  resource_key: string;
  machine_id: string;
  ttl_seconds: number;
  // Agent-self-reported free-text status + blocker (coord claim metadata,
  // surfaced by /coord/claims/list). Optional — older claims have none.
  status_text?: string | null;
  blocked_on?: string | null;
}

/**
 * `GET /claims/list` — `get_claims_list`, proxying coord's
 * `/coord/claims/list` (tenant-scoped).
 */
export interface ActiveClaimsResponse {
  kind: string;
  prefix: string;
  holders: ActiveClaim[];
  truncated: boolean;
}

/**
 * Coord-native MCP coordination surface (Phase 2). One row from
 * `GET /api/v1/operations/agent-status` → coord `GET /coord/agent-status`,
 * backed by `coord.agent_status`. Distinct from the legacy claim-metadata
 * shape (`ActiveClaim`): work-unit-grain, carries structured coordination
 * free-text + the topic peers collaborate on.
 */
export interface AgentStatusRow {
  device_id: string;
  tenant_id: string;
  correlation_topic: string;
  work_unit_id: string;
  status_text: string;
  blocked_on: string | null;
  intent_globs: string[] | null;
  updated_at: string;
  expires_at: string;
}

/**
 * `GET /agent-status` — `get_agent_status`. The envelope mirrors coord:
 * `{agents, count}`. (Not the per-session `AgentStatusResponse` of
 * `components/sessions/types.ts`, which is `/sessions/{id}/agent-status`.)
 */
export interface AgentStatusListResponse {
  agents: AgentStatusRow[];
  count: number;
}

/** One entry of coord's recent-conflicts ring buffer. */
export interface ConflictEntry {
  recorded_at: string;
  requesting_machine_id: string;
  current_holder: string;
  kind: string;
  resource_key: string;
}

/** `GET /claims/recent-conflicts` — `get_recent_conflicts`. */
export interface RecentConflictsResponse {
  entries?: ConflictEntry[];
}

/** One `event='admin_stolen'` audit row. */
export interface StealRow {
  occurred_at: string;
  claim_kind: string;
  resource_key: string;
  stolen_from_machine_id: string | null;
  stolen_by_machine_id: string | null;
  steal_reason: string | null;
}

/** `GET /claims/steals` — `get_claims_steals`. */
export interface ClaimStealsResponse {
  rows?: StealRow[];
}

/**
 * The claims route family as the dashboard names it to the operator
 * ("backed by `/api/v1/operations/claims/*`"). Display text only — never
 * fetched — kept here so the route string has one owner.
 */
export const CLAIMS_ROUTES_LABEL = `${OPERATIONS_BASE}/claims/*`;

/** `GET /agent-status` — the active tenant's live agent-status rows. */
export async function fetchAgentStatus(
  options: HttpOptions = {}
): Promise<AgentStatusListResponse> {
  const url = `${OPERATIONS_BASE}/agent-status`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<AgentStatusListResponse>(res, `GET ${url}`);
}

/**
 * `GET /claims/list?kind=<kind>[&prefix=<prefix>]` — active claims of one
 * kind. `prefix` is sent only when non-empty, as the dashboard always did.
 */
export async function fetchActiveClaims(
  kind: string,
  prefix: string,
  options: HttpOptions = {}
): Promise<ActiveClaimsResponse> {
  const qs = new URLSearchParams({ kind });
  if (prefix) qs.set("prefix", prefix);
  const url = `${OPERATIONS_BASE}/claims/list?${qs.toString()}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<ActiveClaimsResponse>(res, `GET ${url}`);
}

/** `GET /claims/recent-conflicts?limit=<limit>` — coord's conflict ring buffer. */
export async function fetchRecentConflicts(
  limit: number,
  options: HttpOptions = {}
): Promise<RecentConflictsResponse> {
  const url = `${OPERATIONS_BASE}/claims/recent-conflicts?limit=${encodeURIComponent(limit)}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<RecentConflictsResponse>(res, `GET ${url}`);
}

/** `GET /claims/steals?limit=<limit>` — recent `admin_stolen` audit rows. */
export async function fetchClaimSteals(
  limit: number,
  options: HttpOptions = {}
): Promise<ClaimStealsResponse> {
  const url = `${OPERATIONS_BASE}/claims/steals?limit=${encodeURIComponent(limit)}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<ClaimStealsResponse>(res, `GET ${url}`);
}
