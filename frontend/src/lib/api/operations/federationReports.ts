/**
 * `/operations/federation/reports` — federation sync reports.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7). `httpClient.fetch` on the RELATIVE `OPERATIONS_BASE` with the URL
 * inline; a non-2xx rejects with `<METHOD> <url> failed: <status> - <body>`.
 */

import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

export interface FederationReport {
  id: string;
  device_id: string;
  session_id?: string;
  account?: string;
  pushed: number;
  pulled: number;
  failed: number;
  failed_names?: string[];
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface FederationReportsResponse {
  reports?: FederationReport[];
  items?: FederationReport[];
  count?: number;
}

/** `GET /federation/reports?<query>` — a dashboard poll: no client retries. */
export async function fetchFederationReports(
  query: URLSearchParams
): Promise<FederationReportsResponse> {
  const url = `${OPERATIONS_BASE}/federation/reports?${query.toString()}`;
  const res = await httpClient.fetch(url, {
    method: "GET",
    idempotent: true,
    maxRetries: 0,
  });
  return readJson<FederationReportsResponse>(res, `GET ${url}`);
}
