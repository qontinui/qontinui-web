/**
 * `/operations/kpis` — coord's per-work-unit KPIs (schema `kpis/v1`), served
 * verbatim.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`).
 * Same conventions as `coordDelivery.ts`' `fetchDomainCost`: `httpClient.fetch`
 * on the RELATIVE `OPERATIONS_BASE`, the URL inline, the caller's `HttpOptions`
 * (a dashboard read passes `COORD_DASHBOARD_POLL_OPTIONS`: one request), and a
 * non-2xx rejecting through {@link readJson} with
 * `GET <url> failed: <status> - <body>`.
 *
 * The body comes back as `unknown`: the caller narrows it with
 * `isKpisPayload`, because a body of another shape (a newer schema, a partial
 * answer) is a failed read with its own wording, not a parse error.
 *
 * Plan `2026-10-09-kpi-telemetry-and-dashboards` Phase 4. The wire types are
 * `components/admin/coord/kpisV1.ts`; the handler is `get_kpis` in
 * `backend/app/api/v1/endpoints/operations/__init__.py`, which forwards
 * `window` and `repos` to coord's `GET /coord/kpis` and nothing else.
 */

import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/** The query `GET /kpis` takes. Each is omitted from the URL when unset. */
export interface KpisQuery {
  /** Coord's grammar: `28d`, 1..=365 days. Coord defaults it to 28d. */
  window?: string;
  /** Comma-separated `owner/name`. Unset = every repo of the tenant. */
  repos?: string;
}

/** `GET /kpis?<window>&<repos>` (`get_kpis`). */
export async function fetchKpis(
  query: KpisQuery = {},
  options: HttpOptions = {}
): Promise<unknown> {
  const qs = new URLSearchParams();
  if (query.window) qs.set("window", query.window);
  if (query.repos) qs.set("repos", query.repos);
  const suffix = qs.size > 0 ? `?${qs.toString()}` : "";
  const url = `${OPERATIONS_BASE}/kpis${suffix}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<unknown>(res, `GET ${url}`);
}
