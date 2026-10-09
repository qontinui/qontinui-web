/**
 * The agent-claims dashboard's `/operations` routes: active claims, the
 * coord-native agent status feed, recent conflicts, claim steals, and the gate
 * list with its approve / reject actions.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`
 * D5, Phase 7). These calls used to be a bare `fetch` to the absolute
 * `${ApiConfig.API_BASE_URL}/api/v1/operations` base, which carried no bearer
 * and no `X-Qontinui-Active-Tenant`; on `httpClient.fetch` over the relative
 * {@link OPERATIONS_BASE} they carry both (the hop change absolute -> relative
 * is the plan's D6). A non-2xx rejects with
 * `<METHOD> <url> failed: <status> - <body>`.
 *
 * Reads take the caller's `HttpOptions`; the dashboard passes
 * `COORD_DASHBOARD_POLL_OPTIONS` (one request per tick, as the bare `fetch`
 * was). Each function calls `httpClient.fetch` directly with its URL inline; a
 * shared `request(path)` helper would be a wrapper of a wrapper, which
 * `route-walker.test.ts` cannot resolve.
 */

import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/** One row of `get_claims_list` — a live claim and its holder. */
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

/** `get_claims_list` envelope. */
export interface ActiveClaimsResponse {
  kind: string;
  prefix: string;
  holders: ActiveClaim[];
  truncated: boolean;
}

/**
 * Coord-native MCP coordination surface (Phase 2). One row from
 * `GET /agent-status` (`get_agent_status`) -> coord `GET /coord/agent-status`,
 * backed by `coord.agent_status`. Distinct from the legacy claim-metadata
 * shape ({@link ActiveClaim}): work-unit-grain, carries structured coordination
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

/** `get_agent_status` envelope. */
export interface AgentStatusResponse {
  agents: AgentStatusRow[];
  count: number;
}

/** One row of `get_recent_conflicts`. */
export interface ConflictEntry {
  recorded_at: string;
  requesting_machine_id: string;
  current_holder: string;
  kind: string;
  resource_key: string;
}

/** `get_recent_conflicts` envelope. */
export interface RecentConflictsResponse {
  entries?: ConflictEntry[];
}

/** One row of `get_claims_steals`. */
export interface StealRow {
  occurred_at: string;
  claim_kind: string;
  resource_key: string;
  stolen_from_machine_id: string | null;
  stolen_by_machine_id: string | null;
  steal_reason: string | null;
}

/** `get_claims_steals` envelope. */
export interface ClaimStealsResponse {
  rows?: StealRow[];
}

/** One row of `get_gates_list`. */
export interface GateEntry {
  gate_id: string;
  claim_kind: string | null;
  resource_key: string | null;
  plan_id: string | null;
  phase_name: string | null;
  predicate: Record<string, unknown>;
  verdict: "open" | "cleared" | "failed";
  verdict_reason: string | null;
  registered_by: string | null;
  created_at: string;
  evaluated_at: string | null;
  cleared_at: string | null;
}

/** `get_gates_list` answers a bare list or a `{gates}` envelope. */
export type GatesListResponse = GateEntry[] | { gates?: GateEntry[] };

/** `GET /agent-status` (`get_agent_status`). */
export async function fetchAgentStatus(
  options: HttpOptions = {}
): Promise<AgentStatusResponse> {
  const url = `${OPERATIONS_BASE}/agent-status`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<AgentStatusResponse>(res, `GET ${url}`);
}

/**
 * `GET /claims/list?<query>` (`get_claims_list`). `query` carries `kind` and,
 * when set, `prefix`.
 */
export async function fetchActiveClaims(
  query: URLSearchParams,
  options: HttpOptions = {}
): Promise<ActiveClaimsResponse> {
  const url = `${OPERATIONS_BASE}/claims/list?${query.toString()}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<ActiveClaimsResponse>(res, `GET ${url}`);
}

/** `GET /claims/recent-conflicts?limit=N` (`get_recent_conflicts`). */
export async function fetchRecentConflicts(
  limit: number,
  options: HttpOptions = {}
): Promise<RecentConflictsResponse> {
  const url = `${OPERATIONS_BASE}/claims/recent-conflicts?limit=${limit}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<RecentConflictsResponse>(res, `GET ${url}`);
}

/** `GET /claims/steals?limit=N` (`get_claims_steals`). */
export async function fetchClaimSteals(
  limit: number,
  options: HttpOptions = {}
): Promise<ClaimStealsResponse> {
  const url = `${OPERATIONS_BASE}/claims/steals?limit=${limit}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<ClaimStealsResponse>(res, `GET ${url}`);
}

/** `GET /gates/list` (`get_gates_list`). */
export async function fetchGatesList(
  options: HttpOptions = {}
): Promise<GatesListResponse> {
  const url = `${OPERATIONS_BASE}/gates/list`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<GatesListResponse>(res, `GET ${url}`);
}

/**
 * `POST /gates/{gate_id}/approve` (`approve_gate`). Not declared idempotent,
 * so a 5xx is never replayed; the caller re-reads the list and ignores the
 * body.
 */
export async function approveGate(
  gateId: string,
  options: HttpOptions = {}
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/gates/${encodeURIComponent(gateId)}/approve`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "POST",
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

/** `POST /gates/{gate_id}/reject` (`reject_gate`). See {@link approveGate}. */
export async function rejectGate(
  gateId: string,
  options: HttpOptions = {}
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/gates/${encodeURIComponent(gateId)}/reject`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "POST",
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}
