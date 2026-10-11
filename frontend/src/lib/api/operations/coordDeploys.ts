/**
 * `/operations/deploys` — the deploy-verification list behind
 * `/admin/coord/deploys`.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D2 + D5 + D6, Phase 7). Calls `httpClient.fetch` on the RELATIVE
 * `OPERATIONS_BASE` with its URL inline and parses through `readJson`.
 */

import { httpClient } from "@/services/service-factory";
import type { DeployRow } from "@/components/admin/coord/deployTypes";
import { OPERATIONS_BASE, readJson } from "./base";

/** The body of `GET /deploys`. */
export interface DeploysResponse {
  deploys?: DeployRow[] | null;
}

/**
 * `GET /deploys?service=&limit=` — recent deploys with their verification
 * verdicts. A dashboard poll: one request, no client retries
 * (`maxRetries: 0`) — the next tick is the retry. An empty `service` is not
 * sent.
 */
export async function fetchDeploys(
  service: string,
  limit: number
): Promise<DeploysResponse> {
  const qs = new URLSearchParams();
  if (service.trim()) qs.set("service", service.trim());
  qs.set("limit", String(limit));
  const url = `${OPERATIONS_BASE}/deploys?${qs.toString()}`;
  const res = await httpClient.fetch(url, {
    method: "GET",
    idempotent: true,
    maxRetries: 0,
  });
  return readJson<DeploysResponse>(res, `GET ${url}`);
}
