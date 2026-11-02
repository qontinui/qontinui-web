/**
 * Coord's retrospective readouts: the operator audit trail
 * (`GET /coord/audit/recent`) and the fault-to-visibility percentiles
 * (`GET /alerts/fault-to-visibility`) — what operators did, and how long a
 * fault took to become visible to them.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`
 * D5). Each function calls `httpClient.fetch` on the relative
 * `OPERATIONS_BASE` with its URL inline and parses through `readJson`, so a
 * non-2xx rejects as `GET <url> failed: <status> - <body>` — the shape
 * `httpClient.get` threw and `describeCoordPollError` reads.
 *
 * Both return `unknown`: the handlers pass coord's body through verbatim, and
 * each body is validated by its one reader (`parseAuditPayload` in
 * `components/operations/operatorAudit.ts`, `isFaultToVisibilityPayload` in
 * `components/operations/useFaultToVisibility.ts`) before anything renders it.
 */

import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/** The filters `GET /coord/audit/recent` accepts — `get_coord_audit_recent`. */
export interface CoordAuditQuery {
  limit: number;
  /** An action, or a prefix ending in a literal `*` (e.g. `fleet.*`). Empty/absent = no filter. */
  action?: string | null;
  via?: string | null;
  resource_key?: string | null;
}

/**
 * `GET /coord/audit/recent?limit=&action=&via=&resource_key=`
 * (`get_coord_audit_recent`) — the newest `coord.operator_audit` rows. Absent
 * filters are omitted from the query. Read on demand (mount, filter change,
 * Refresh), so it keeps `httpClient`'s default retry budget.
 */
export async function fetchCoordAuditRecent(
  query: CoordAuditQuery
): Promise<unknown> {
  const params = new URLSearchParams({ limit: String(query.limit) });
  if (query.action) params.set("action", query.action);
  if (query.via) params.set("via", query.via);
  if (query.resource_key) params.set("resource_key", query.resource_key);
  const url = `${OPERATIONS_BASE}/coord/audit/recent?${params.toString()}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<unknown>(res, `GET ${url}`);
}

/**
 * `GET /alerts/fault-to-visibility` (`get_coord_alerts_fault_to_visibility`) —
 * coord's trailing-window p50/p90 of fault onset to operator visibility, per
 * alert kind and in total, over coord's default window.
 */
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
