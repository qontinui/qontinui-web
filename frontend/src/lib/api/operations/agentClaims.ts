/**
 * `/operations` claims surface: the active claim holders, the coord-native
 * `agent-status` rows, the recent conflicts and steals, and the gate list with
 * its approve / reject writes — everything the `/admin/agent-claims` dashboard
 * reads and writes.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D2 + D5 + D6, Phase 7). Every function calls `httpClient.fetch` on the
 * RELATIVE `OPERATIONS_BASE` with its URL inline and returns the PARSED body
 * through `readJson`. The dashboard polls, so each read states
 * `maxRetries: 0`: the next tick is the retry. A non-2xx rejects with
 * `<METHOD> <url> failed: <status> - <body>`, which the dashboard words with
 * `httpStatusOf` / `httpBodyOf`.
 *
 * Wire shapes mirror the coord JSON exactly.
 */

import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/** The claims route family as the dashboard names it in its footer. */
export const CLAIMS_ROUTE_PATTERN = `${OPERATIONS_BASE}/claims/*`;

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

export interface ActiveClaimsResponse {
  kind: string;
  prefix: string;
  holders: ActiveClaim[];
  truncated: boolean;
}

/**
 * Coord-native MCP coordination surface (Phase 2). One row from
 * `GET /agent-status` → coord `GET /coord/agent-status`, backed by
 * `coord.agent_status`. Distinct from the legacy claim-metadata shape
 * (`ActiveClaim`): work-unit-grain, carries structured coordination free-text
 * + the topic peers collaborate on.
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

export interface AgentStatusResponse {
  agents: AgentStatusRow[];
  count: number;
}

export interface ConflictEntry {
  recorded_at: string;
  requesting_machine_id: string;
  current_holder: string;
  kind: string;
  resource_key: string;
}

export interface StealRow {
  occurred_at: string;
  claim_kind: string;
  resource_key: string;
  stolen_from_machine_id: string | null;
  stolen_by_machine_id: string | null;
  steal_reason: string | null;
}

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

/** `GET /agent-status` — the coord-native agent status rows. */
export async function fetchAgentStatus(): Promise<AgentStatusResponse> {
  const url = `${OPERATIONS_BASE}/agent-status`;
  const res = await httpClient.fetch(url, {
    method: "GET",
    idempotent: true,
    maxRetries: 0,
  });
  return readJson<AgentStatusResponse>(res, `GET ${url}`);
}

/** `GET /claims/list?kind=…[&prefix=…]` — the active holders of one claim kind. */
export async function fetchActiveClaims(
  kind: string,
  prefix: string
): Promise<ActiveClaimsResponse> {
  const params = new URLSearchParams({ kind });
  if (prefix) params.set("prefix", prefix);
  const url = `${OPERATIONS_BASE}/claims/list?${params.toString()}`;
  const res = await httpClient.fetch(url, {
    method: "GET",
    idempotent: true,
    maxRetries: 0,
  });
  return readJson<ActiveClaimsResponse>(res, `GET ${url}`);
}

/** `GET /claims/recent-conflicts?limit=…` — rejected claim attempts. */
export async function fetchRecentClaimConflicts(
  limit: number
): Promise<{ entries?: ConflictEntry[] }> {
  const url = `${OPERATIONS_BASE}/claims/recent-conflicts?limit=${limit}`;
  const res = await httpClient.fetch(url, {
    method: "GET",
    idempotent: true,
    maxRetries: 0,
  });
  return readJson<{ entries?: ConflictEntry[] }>(res, `GET ${url}`);
}

/** `GET /claims/steals?limit=…` — recent claim steals. */
export async function fetchRecentClaimSteals(
  limit: number
): Promise<{ rows?: StealRow[] }> {
  const url = `${OPERATIONS_BASE}/claims/steals?limit=${limit}`;
  const res = await httpClient.fetch(url, {
    method: "GET",
    idempotent: true,
    maxRetries: 0,
  });
  return readJson<{ rows?: StealRow[] }>(res, `GET ${url}`);
}

/**
 * `GET /gates/list` — every gate. Coord has served both a bare list and a
 * `{gates: [...]}` envelope, so the body resolves as either.
 */
export async function fetchClaimGates(): Promise<
  GateEntry[] | { gates?: GateEntry[] }
> {
  const url = `${OPERATIONS_BASE}/gates/list`;
  const res = await httpClient.fetch(url, {
    method: "GET",
    idempotent: true,
    maxRetries: 0,
  });
  return readJson<GateEntry[] | { gates?: GateEntry[] }>(res, `GET ${url}`);
}

/** `POST /gates/{id}/approve` — approves one open gate. */
export async function approveClaimGate(gateId: string): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/gates/${gateId}/approve`;
  const res = await httpClient.fetch(url, { method: "POST" });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

/** `POST /gates/{id}/reject` — rejects one open gate. */
export async function rejectClaimGate(gateId: string): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/gates/${gateId}/reject`;
  const res = await httpClient.fetch(url, { method: "POST" });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}
