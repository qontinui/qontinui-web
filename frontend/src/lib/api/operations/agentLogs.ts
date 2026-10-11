/**
 * `/operations/agent-logs/by-agent/{id}` — one agent's log tail.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7). `httpClient.fetch` on the RELATIVE `OPERATIONS_BASE` with the URL
 * inline; a non-2xx rejects with `<METHOD> <url> failed: <status> - <body>`.
 */

import type { AgentLogRow } from "@/components/admin/coord/LogRow";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

export interface AgentLogsByAgentResponse {
  agent_id?: string;
  logs?: AgentLogRow[];
}

/**
 * `GET /agent-logs/by-agent/{agentId}?<query>` — a dashboard poll: no client
 * retries, the next tick is the retry. The wire may answer a bare array; it is
 * normalised to `{ logs }`.
 */
export async function fetchAgentLogsByAgent(
  agentId: string,
  query: URLSearchParams
): Promise<AgentLogsByAgentResponse> {
  const url = `${OPERATIONS_BASE}/agent-logs/by-agent/${encodeURIComponent(agentId)}?${query.toString()}`;
  const res = await httpClient.fetch(url, {
    method: "GET",
    idempotent: true,
    maxRetries: 0,
  });
  const body = await readJson<unknown>(res, `GET ${url}`);
  return Array.isArray(body)
    ? { logs: body as AgentLogRow[] }
    : (body as AgentLogsByAgentResponse);
}
