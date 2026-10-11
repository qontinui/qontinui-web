/**
 * `/operations` reads behind the Overview and Regression Tests (conditions)
 * pages: coord's domain cost ledger, the work-unit list the Summary's progress
 * is computed from, and the fleet drain roster the runner-availability hint
 * reads.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D2 + D5 + D6, Phase 7). Every function calls `httpClient.fetch` on the
 * RELATIVE `OPERATIONS_BASE` with its URL inline, states its retry policy, and
 * returns the PARSED body through `readJson`; a non-2xx rejects with
 * `GET <url> failed: <status> - <body>`.
 */

import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import type { CoordPlanRow } from "@/components/admin/coord/planStatus";
import { OPERATIONS_BASE, readJson } from "./base";

/**
 * `GET /domain-cost` — coord's domain cost ledger. Resolves `unknown` on
 * purpose: only the caller's `isDomainCostPayload` may decide a body is a
 * ledger. `options` carries the poll's retry budget.
 */
export async function fetchDomainCost(
  options: HttpOptions = {}
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/domain-cost`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<unknown>(res, `GET ${url}`);
}

/**
 * `GET /fleet/drain` — which devices coord is holding out of the fleet.
 * Resolves `unknown`: the shared `parseFleetDrain` owns the shape. `options`
 * carries the poll's retry budget.
 */
export async function fetchFleetDrain(
  options: HttpOptions = {}
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/fleet/drain`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<unknown>(res, `GET ${url}`);
}

/**
 * The body of `GET /plans`: the rows under `work_units` on a current coord and
 * under `plans` on an older one.
 */
export interface WorkUnitPlansBody {
  work_units?: CoordPlanRow[];
  plans?: CoordPlanRow[];
}

/** `GET /plans?<query>` — the project's work units (`limit`, `exclude_slug_prefix`, …). */
export async function fetchWorkUnitPlans(
  query: URLSearchParams
): Promise<WorkUnitPlansBody> {
  const url = `${OPERATIONS_BASE}/plans?${query.toString()}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<WorkUnitPlansBody>(res, `GET ${url}`);
}
