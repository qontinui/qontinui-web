/**
 * `/operations/coord/audit/recent`: the operator audit panel's read of coord's
 * recent operator-action trail.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D2 + D5 + D6, Phase 7). The function calls `httpClient.fetch` on the
 * RELATIVE `OPERATIONS_BASE` (same-origin, D6) with its URL inline and returns
 * the PARSED body through `readJson`; a non-2xx rejects with
 * `GET <url> failed: <status> - <body>`.
 */

import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/**
 * `GET /coord/audit/recent?<query>` — a proxy of coord's operator audit read.
 * `query` is the already-encoded query string (`limit`, and the optional
 * `action` / `via` / `resource_key` filters). Resolves `unknown` on purpose:
 * only the caller's `parseAuditPayload` decides what a body means. Not a
 * poll — a one-shot read per filter change or Refresh — so it keeps
 * `httpClient`'s default retry budget.
 */
export async function fetchOperatorAudit(query: string): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/audit/recent?${query}`;
  const res = await httpClient.fetch(url, { method: "GET" });
  return readJson<unknown>(res, `GET ${url}`);
}
