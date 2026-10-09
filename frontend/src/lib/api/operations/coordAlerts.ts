/**
 * `/operations/alerts*` — coord's alert rollup reads.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`
 * D5). Bodies are returned UNPARSED: the red-main banner and the
 * fault-to-visibility panel each own a tolerant parser for their own slice,
 * and a body they cannot read is UNKNOWN, not empty.
 */

import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/**
 * `GET /alerts?include_resolved=&kind=` — the alert rollup, filtered by `kind`
 * on coord's side. Either `{alerts: [...]}` or a bare list, by coord vintage.
 */
export async function fetchAlerts(
  params: { includeResolved: boolean; kind: string },
  options: HttpOptions = {}
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/alerts?include_resolved=${params.includeResolved}&kind=${encodeURIComponent(params.kind)}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<unknown>(res, `GET ${url}`);
}

/** `GET /alerts/fault-to-visibility` — the trailing-window fault-to-visibility percentiles. */
export async function fetchFaultToVisibility(
  options: HttpOptions = {}
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/alerts/fault-to-visibility`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<unknown>(res, `GET ${url}`);
}
