/**
 * `/operations/agent-logs/*` — coord's agent-activity log reads: the newest
 * events across every agent, and one agent's events.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D5, Phase 7 batch 1). These replace the `httpClient.get` reads of
 * `admin/coord/agents/page.tsx` and `admin/coord/agents/[agent_id]/page.tsx`.
 * Every function calls `httpClient.fetch` on the RELATIVE `OPERATIONS_BASE`
 * (D6 + its amendment: `httpClient.get` prefixed the absolute base onto those
 * pages' relative `/api/v1/operations`, so this is a transport change) with
 * its URL inline, states its retry policy, and parses through `readJson`,
 * which rejects in `httpClient.get`'s own `GET <url> failed: <status> - <body>`
 * shape. Each read takes the caller's `HttpOptions` (both pages pass
 * `COORD_DASHBOARD_POLL_OPTIONS`).
 *
 * The bodies are raw coord passthroughs (no `response_model`):
 * `get_agent_logs_recent` and `get_agent_logs_by_agent` in
 * `backend/app/api/v1/endpoints/operations/__init__.py`. Either envelope or a
 * bare row list is accepted, because no build pins which one this coord
 * answers; the pages normalise it.
 */

import type { AgentLogRow } from "@/components/admin/coord/LogRow";
import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/** `GET /agent-logs/recent` — `get_agent_logs_recent`. */
export type RecentAgentLogsResponse = { logs?: AgentLogRow[] } | AgentLogRow[];

/** `GET /agent-logs/by-agent/{agent_id}` — `get_agent_logs_by_agent`. */
export type AgentLogsByAgentResponse =
  | { agent_id?: string; logs?: AgentLogRow[] }
  | AgentLogRow[];

/** `GET /agent-logs/recent?limit=<limit>` — the newest events, every agent. */
export async function fetchRecentAgentLogs(
  limit: number,
  options: HttpOptions = {}
): Promise<RecentAgentLogsResponse> {
  const qs = new URLSearchParams();
  qs.set("limit", String(limit));
  const url = `${OPERATIONS_BASE}/agent-logs/recent?${qs.toString()}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<RecentAgentLogsResponse>(res, `GET ${url}`);
}

/** What {@link fetchAgentLogsByAgent} asks for. */
export interface AgentLogsByAgentQuery {
  limit: number;
  /** RFC 3339 lower bound; omitted means "any time". */
  since?: string;
}

/** `GET /agent-logs/by-agent/{agent_id}?limit=<n>[&since=<iso>]` — one agent's events. */
export async function fetchAgentLogsByAgent(
  agentId: string,
  query: AgentLogsByAgentQuery,
  options: HttpOptions = {}
): Promise<AgentLogsByAgentResponse> {
  const qs = new URLSearchParams();
  qs.set("limit", String(query.limit));
  if (query.since !== undefined) qs.set("since", query.since);
  const url = `${OPERATIONS_BASE}/agent-logs/by-agent/${encodeURIComponent(agentId)}?${qs.toString()}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<AgentLogsByAgentResponse>(res, `GET ${url}`);
}
