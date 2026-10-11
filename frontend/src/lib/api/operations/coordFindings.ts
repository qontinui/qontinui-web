/**
 * `/operations` coord findings read: `GET /coord/findings`, the findings
 * list (filtered, keyset-paged) and the by-id read.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7). Calls `httpClient.fetch` on the RELATIVE `OPERATIONS_BASE` with
 * the URL inline and parses through `readJson`.
 *
 * Resolves `unknown` on purpose: the caller's `readBody` and the findings
 * helpers decide what a body that is not the expected envelope means.
 */

import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/**
 * `GET /coord/findings?<query>` — `query` is an already-encoded query string
 * (the page's `buildQuery`, or `finding_id=<uuid>` for the by-id read).
 */
export async function fetchCoordFindings(query: string): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/findings?${query}`;
  const res = await httpClient.fetch(url, { method: "GET" });
  return readJson<unknown>(res, `GET ${url}`);
}
