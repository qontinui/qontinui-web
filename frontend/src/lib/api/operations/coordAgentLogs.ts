/**
 * `/operations/agent-logs` — the recent-agent-logs poll behind
 * `/admin/coord/agents`.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D2 + D5 + D6, Phase 7). Calls `httpClient.fetch` on the RELATIVE
 * `OPERATIONS_BASE` with its URL inline and parses through `readJson`.
 */

import { httpClient } from "@/services/service-factory";
import type { AgentLogRow } from "@/components/admin/coord/LogRow";
import { OPERATIONS_BASE, readJson } from "./base";

/** The body of `GET /agent-logs/recent`. */
export interface RecentAgentLogsResponse {
  logs?: AgentLogRow[];
}

/**
 * `GET /agent-logs/recent?limit=N` — newest agent log rows, proxied from
 * coord. Resolves `unknown`: the caller tolerates a bare list as well as the
 * `{logs}` envelope. A dashboard poll: one request, no client retries
 * (`maxRetries: 0`) — the next tick is the retry.
 */
export async function fetchRecentAgentLogs(limit: number): Promise<unknown> {
  const qs = new URLSearchParams();
  qs.set("limit", String(limit));
  const url = `${OPERATIONS_BASE}/agent-logs/recent?${qs.toString()}`;
  const res = await httpClient.fetch(url, {
    method: "GET",
    idempotent: true,
    maxRetries: 0,
  });
  return readJson<unknown>(res, `GET ${url}`);
}
