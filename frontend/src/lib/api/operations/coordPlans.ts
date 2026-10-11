/**
 * `/operations/plans` reads: the work-unit list (history, spawn and the
 * work-units pages), its whole-corpus overview, and the throughput aggregate.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7). Every function calls `httpClient.fetch` on the RELATIVE
 * `OPERATIONS_BASE` with its URL inline, states its retry policy, and returns
 * the PARSED body through `readJson`. A non-2xx rejects with
 * `GET <url> failed: <status> - <body>`.
 *
 * The list handler is `list_coord_plans` (a proxy of coord's
 * `GET /coord/work-units`); the query string is the caller's, built from the
 * filters it owns (`status`, `exclude_slug_prefix`, `limit`, `order`, the
 * keyset cursor).
 */

import { httpClient } from "@/services/service-factory";
import type { CoordPlanRow } from "@/components/admin/coord/planStatus";
import type { PlanBodySignalBlock } from "@/components/admin/coord/planBodySignal";
import { OPERATIONS_BASE, readJson } from "./base";

/** The keyset cursor a full `authored_desc` page carries. */
export interface WalkCursor {
  /** RFC3339, or null while walking the NULL-authored tail. */
  after_authored_at: string | null;
  after_slug: string;
}

/** `GET /plans` body. */
export interface PlansListResponse {
  // coord `/coord/work-units` returns rows under `work_units`. `plans` is
  // kept for backwards-tolerance during the cutover (harmless if absent).
  work_units?: CoordPlanRow[];
  plans?: CoordPlanRow[];
  limit?: number;
  offset?: number;
  count?: number;
  /** Echoed by a coord that understood `order`; absent on an older one. */
  order?: string;
  /** Non-null only when the page was full and another may follow. */
  next_cursor?: WalkCursor | null;
  /**
   * The size of the WHOLE matching population, when coord serves one (it
   * does not today: the envelope is `{work_units, limit, offset}` plus
   * `count`). Never substituted from `count`, which is the size of the PAGE.
   */
  total?: number;
  /**
   * Why a `has_body: false` on THIS PAGE is (or is not) evidence — computed
   * per request by the proxy. Absent when the page had no rows to annotate,
   * and on a backend that predates the signals.
   */
  body_signal?: PlanBodySignalBlock;
}

/**
 * The fields of coord's `GET /coord/work-units/overview` the work-units page
 * reads. It deliberately does NOT declare `corpus_complete`: see
 * `overviewTotalFor` in `work-units/planWalk.ts`.
 */
export interface WorkUnitOverview {
  row_count?: number;
  facets?: {
    by_status?: Record<string, number>;
    by_status_truncated?: boolean;
  };
}

/**
 * `GET /plans?<query>` — one page of the list, with the client's default
 * retry (the corpus walk is a user-visible read, not a timer tick).
 */
export async function fetchPlansPage(
  query: URLSearchParams
): Promise<PlansListResponse> {
  const url = `${OPERATIONS_BASE}/plans?${query.toString()}`;
  const res = await httpClient.fetch(url, { method: "GET" });
  return readJson<PlansListResponse>(res, `GET ${url}`);
}

/**
 * `GET /plans?<query>` for a dashboard poll: one request, no client retries
 * (`maxRetries: 0`) — the next tick is the retry.
 */
export async function pollPlans(
  query: URLSearchParams
): Promise<PlansListResponse> {
  const url = `${OPERATIONS_BASE}/plans?${query.toString()}`;
  const res = await httpClient.fetch(url, { method: "GET", maxRetries: 0 });
  return readJson<PlansListResponse>(res, `GET ${url}`);
}

/** `GET /plans/overview` — coord's whole-corpus tally, client-default retry. */
export async function fetchPlansOverview(): Promise<WorkUnitOverview> {
  const url = `${OPERATIONS_BASE}/plans/overview`;
  const res = await httpClient.fetch(url, { method: "GET" });
  return readJson<WorkUnitOverview>(res, `GET ${url}`);
}

/**
 * `GET /plans/throughput?since=` — coord's throughput aggregate. Resolves
 * `unknown` on purpose: only `deriveThroughput` may decide what an unreadable
 * body means. A dashboard poll: no client retries (`maxRetries: 0`).
 */
export async function fetchPlansThroughput(since: string): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/plans/throughput?${new URLSearchParams({ since }).toString()}`;
  const res = await httpClient.fetch(url, { method: "GET", maxRetries: 0 });
  return readJson<unknown>(res, `GET ${url}`);
}
